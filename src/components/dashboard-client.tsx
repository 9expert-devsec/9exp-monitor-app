'use client'

import { useEffect, useMemo, useState } from 'react'

import { HeaderStrip } from '@/components/header-strip'
import { SiteCard } from '@/components/site-card'
import { rollupDayKey } from '@/lib/format'
import { statusOfDay } from '@/lib/status'
import { realtimeClient } from '@/lib/supabase/browser'
import type { DayBucket, HealthCheck, Incident, SiteSnapshot } from '@/lib/types'

export interface RealtimeConfig {
  url: string
  anonKey: string
}

interface Props {
  snapshots: SiteSnapshot[]
  lastRunAt: string | null
  realtime: RealtimeConfig | null
  /**
   * The server's clock at render time. Used for the first client render too, so
   * relative timestamps and staleness match the server HTML and do not trip a
   * hydration mismatch.
   */
  serverNow: string
}

/** How often the displayed clock advances. Not a data poll — no request is made. */
const CLOCK_TICK_MS = 30_000

/** Folds a freshly-arrived check into today's bucket of the 90-day history. */
function patchHistory(history: DayBucket[], check: HealthCheck): DayBucket[] {
  const today = rollupDayKey(new Date(check.checked_at))
  const index = history.findIndex((bucket) => bucket.day === today)
  if (index === -1) return history

  const previous = history[index]
  const up = previous.up + (check.status === 'up' ? 1 : 0)
  const degraded = previous.degraded + (check.status === 'degraded' ? 1 : 0)
  const down = previous.down + (check.status === 'down' ? 1 : 0)

  const copy = history.slice()
  copy[index] = { ...previous, up, degraded, down, worst: statusOfDay(up, degraded, down) }
  return copy
}

/**
 * The dashboard, live.
 *
 * Realtime rows are held in two small maps rather than folded into a copy of
 * the server's data. Merging happens at render time, and the merge always
 * prefers whichever side is newer — so a server refresh (navigation, or
 * `router.refresh()` after "Check now") automatically wins back with its
 * recomputed aggregates, and no effect has to reset anything.
 */
export function DashboardClient({ snapshots, lastRunAt, realtime, serverNow }: Props) {
  const [liveChecks, setLiveChecks] = useState<Map<string, HealthCheck>>(() => new Map())
  const [liveIncidents, setLiveIncidents] = useState<Map<string, Incident>>(() => new Map())
  const [now, setNow] = useState(() => Date.parse(serverNow))

  // Advance the clock so cards cross into `stale` on their own, without the
  // dashboard having to re-fetch anything.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!realtime) return

    const supabase = realtimeClient(realtime.url, realtime.anonKey)

    const channel = supabase
      .channel('monitor-dashboard')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'health_checks' },
        (message) => {
          const check = message.new as HealthCheck
          if (!check?.site_id) return

          setLiveChecks((previous) => {
            const existing = previous.get(check.site_id)
            // Runs can overlap; never let an older row overwrite a newer one.
            if (existing && existing.checked_at >= check.checked_at) return previous
            return new Map(previous).set(check.site_id, check)
          })
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'incidents' },
        (message) => {
          const incident = (message.new ?? message.old) as Incident | undefined
          if (!incident?.site_id) return

          setLiveIncidents((previous) => {
            const existing = previous.get(incident.site_id)
            if (existing && existing.id > incident.id) return previous
            return new Map(previous).set(incident.site_id, incident)
          })
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [realtime])

  const merged = useMemo(() => {
    return snapshots.map((snapshot) => {
      let next = snapshot

      const check = liveChecks.get(snapshot.site.id)
      if (check && (!snapshot.latest || check.checked_at > snapshot.latest.checked_at)) {
        next = { ...next, latest: check, history: patchHistory(next.history, check) }
      }

      // Incident ids are monotonic, so a live row only wins if it is at least as
      // recent as whatever the server last told us about.
      const incident = liveIncidents.get(snapshot.site.id)
      if (incident && incident.id >= (snapshot.openIncident?.id ?? 0)) {
        next = {
          ...next,
          openIncident: incident.resolved_at === null ? incident : null,
        }
      }

      return next
    })
  }, [snapshots, liveChecks, liveIncidents])

  const currentLastRunAt = useMemo(() => {
    let newest = lastRunAt
    for (const check of liveChecks.values()) {
      if (!newest || check.checked_at > newest) newest = check.checked_at
    }
    return newest
  }, [lastRunAt, liveChecks])

  const groups = useMemo(() => {
    const byGroup = new Map<string, SiteSnapshot[]>()
    for (const snapshot of merged) {
      const key = snapshot.site.group_name ?? 'Ungrouped'
      const list = byGroup.get(key)
      if (list) list.push(snapshot)
      else byGroup.set(key, [snapshot])
    }
    return [...byGroup.entries()]
  }, [merged])

  return (
    <div className="flex flex-col gap-6">
      <HeaderStrip snapshots={merged} lastRunAt={currentLastRunAt} now={now} />

      {!realtime && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Live updates are off — set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to enable them.
        </p>
      )}

      {merged.length === 0 && (
        <p
          className="rounded-xl border p-6 text-sm"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
        >
          No sites are enabled yet. Add one to <code>config/sites.ts</code> and run{' '}
          <code>npm run seed</code>.
        </p>
      )}

      {groups.map(([groupName, groupSnapshots]) => (
        <section key={groupName} className="flex flex-col gap-3">
          <h2
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: 'var(--text-muted)' }}
          >
            {groupName}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {groupSnapshots.map((snapshot) => (
              <SiteCard key={snapshot.site.id} snapshot={snapshot} now={now} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
