'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

import { DashboardToolbar, type FilterTab } from '@/components/dashboard-toolbar'
import { KpiTile } from '@/components/kpi-tile'
import { OverallStatusCard, type StatusCounts } from '@/components/overall-status-card'
import { SiteCard, SiteRow } from '@/components/site-card'
import { rollupDayKey } from '@/lib/format'
import { SEVERITY, displayStatusOf, statusOfDay } from '@/lib/status'
import { realtimeClient } from '@/lib/supabase/browser'
import type { DayBucket, DisplayStatus, HealthCheck, Incident, SiteSnapshot } from '@/lib/types'

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

const KPI_ORDER: DisplayStatus[] = ['up', 'degraded', 'down', 'stale']
const UNGROUPED = 'Ungrouped'

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

function groupOf(snapshot: SiteSnapshot): string {
  return snapshot.site.group_name ?? UNGROUPED
}

function filterKey(group: string): string {
  return group.toLowerCase()
}

interface Entry {
  snapshot: SiteSnapshot
  status: DisplayStatus
}

/** Down, degraded, stale, then up; then by name. */
function compareEntries(a: Entry, b: Entry): number {
  const bySeverity = SEVERITY[b.status] - SEVERITY[a.status]
  if (bySeverity !== 0) return bySeverity
  return a.snapshot.site.name.localeCompare(b.snapshot.site.name)
}

/**
 * The dashboard, live.
 *
 * Realtime rows are held in two small maps rather than folded into a copy of
 * the server's data. Merging happens at render time, and the merge always
 * prefers whichever side is newer — so a server refresh (navigation, or
 * `router.refresh()` after "Check now") automatically wins back with its
 * recomputed aggregates, and no effect has to reset anything.
 *
 * The filter tab and search query live in the URL (`?filter=issues&q=…`) and
 * are derived from it on every render — never mirrored into state.
 */
export function DashboardClient({ snapshots, lastRunAt, realtime, serverNow }: Props) {
  const [liveChecks, setLiveChecks] = useState<Map<string, HealthCheck>>(() => new Map())
  const [liveIncidents, setLiveIncidents] = useState<Map<string, Incident>>(() => new Map())
  const [now, setNow] = useState(() => Date.parse(serverNow))

  const searchParams = useSearchParams()
  const pathname = usePathname()
  const filter = (searchParams.get('filter') ?? 'all').toLowerCase()
  const query = searchParams.get('q') ?? ''

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

  const entries: Entry[] = merged.map((snapshot) => ({
    snapshot,
    status: displayStatusOf(snapshot.latest, now),
  }))

  const counts: StatusCounts = { up: 0, degraded: 0, down: 0, stale: 0 }
  for (const entry of entries) counts[entry.status] += 1

  // Group names in registry order, so the tabs and sections follow config/sites.ts.
  const groupNames: string[] = []
  for (const entry of entries) {
    const group = groupOf(entry.snapshot)
    if (!groupNames.includes(group)) groupNames.push(group)
  }

  const issueCount = counts.down + counts.degraded + counts.stale
  const tabs: FilterTab[] = [
    { key: 'all', label: 'All', count: entries.length },
    { key: 'issues', label: 'Issues', count: issueCount },
    ...groupNames.map((group) => ({
      key: filterKey(group),
      label: group,
      count: entries.filter((entry) => groupOf(entry.snapshot) === group).length,
    })),
  ]
  const activeFilter = tabs.some((tab) => tab.key === filter) ? filter : 'all'

  const needle = query.trim().toLowerCase()
  const visible = entries
    .filter((entry) => {
      if (activeFilter === 'issues') return entry.status !== 'up'
      if (activeFilter !== 'all') return filterKey(groupOf(entry.snapshot)) === activeFilter
      return true
    })
    .filter((entry) => {
      if (!needle) return true
      const { name, url } = entry.snapshot.site
      return name.toLowerCase().includes(needle) || url.toLowerCase().includes(needle)
    })
    .sort(compareEntries)

  const sections = groupNames
    .map((group) => ({
      group,
      entries: visible.filter((entry) => groupOf(entry.snapshot) === group),
    }))
    .filter((section) => section.entries.length > 0)

  const mobileIssues = visible.filter((entry) => entry.status !== 'up')
  const mobileOperational = visible.filter((entry) => entry.status === 'up')

  /**
   * Writes one search param without a server round-trip. Next.js syncs
   * `history.replaceState` into `useSearchParams`, so the render that follows
   * reads the new value straight from the URL.
   */
  function setParam(name: 'filter' | 'q', value: string) {
    const params = new URLSearchParams(searchParams.toString())
    const isDefault = value === '' || (name === 'filter' && value === 'all')
    if (isDefault) params.delete(name)
    else params.set(name, value)
    const search = params.toString()
    window.history.replaceState(null, '', search ? `${pathname}?${search}` : pathname)
  }

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <OverallStatusCard
        counts={counts}
        total={entries.length}
        lastRunAt={currentLastRunAt}
        now={now}
      />

      <section aria-label="Status counts" className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-6">
        {KPI_ORDER.map((status) => (
          <KpiTile key={status} status={status} count={counts[status]} />
        ))}
      </section>

      {entries.length === 0 ? (
        <p className="rounded-lg border border-(--border-subtle) bg-(--surface-card) p-6 text-sm text-(--text-secondary)">
          No sites are enabled yet. Add one to <code>config/sites.ts</code> and run{' '}
          <code>npm run seed</code>.
        </p>
      ) : (
        <>
          <DashboardToolbar
            tabs={tabs}
            activeFilter={activeFilter}
            defaultQuery={query}
            onFilterChange={(key) => setParam('filter', key)}
            onQueryChange={(value) => setParam('q', value)}
          />

          {visible.length === 0 && (
            <p className="rounded-lg border border-(--border-subtle) bg-(--surface-card) p-6 text-center text-sm text-(--text-secondary)">
              No sites match this filter.
            </p>
          )}

          {/* ≥ 640 px: one section per group. */}
          <div className="hidden flex-col gap-8 sm:flex">
            {sections.map((section) => (
              <section key={section.group} className="flex flex-col gap-3">
                <h2 className="label-overline">
                  {section.group} ({section.entries.length})
                </h2>
                <div className="grid grid-cols-2 gap-6 xl:grid-cols-3">
                  {section.entries.map((entry) => (
                    <SiteCard key={entry.snapshot.site.id} snapshot={entry.snapshot} now={now} />
                  ))}
                </div>
              </section>
            ))}
          </div>

          {/* < 640 px: issues as full cards, everything healthy as compact rows. */}
          <div className="flex flex-col gap-6 sm:hidden">
            {mobileIssues.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="label-overline">Issues ({mobileIssues.length})</h2>
                {mobileIssues.map((entry) => (
                  <SiteCard key={entry.snapshot.site.id} snapshot={entry.snapshot} now={now} />
                ))}
              </section>
            )}
            {mobileOperational.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="label-overline">Operational ({mobileOperational.length})</h2>
                <div className="divide-y divide-(--border-subtle) overflow-hidden rounded-lg border border-(--border-subtle) bg-(--surface-card)">
                  {mobileOperational.map((entry) => (
                    <SiteRow key={entry.snapshot.site.id} snapshot={entry.snapshot} now={now} />
                  ))}
                </div>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  )
}
