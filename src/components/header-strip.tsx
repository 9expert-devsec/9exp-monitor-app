import { CheckNowButton } from '@/components/check-now-button'
import { StatusDot } from '@/components/status-dot'
import { formatRelative, formatTime } from '@/lib/format'
import { displayStatusOf, isStale } from '@/lib/status'
import type { DisplayStatus, SiteSnapshot } from '@/lib/types'

interface Overall {
  headline: string
  status: DisplayStatus
}

function summarise(snapshots: SiteSnapshot[], now: number): Overall {
  const counts = { up: 0, degraded: 0, down: 0, stale: 0 }
  for (const snapshot of snapshots) {
    counts[displayStatusOf(snapshot.latest, now)] += 1
  }

  if (counts.down > 0) {
    return {
      status: 'down',
      headline: `${counts.down} site${counts.down === 1 ? '' : 's'} down`,
    }
  }
  if (counts.degraded > 0) {
    return {
      status: 'degraded',
      headline: `${counts.degraded} site${counts.degraded === 1 ? '' : 's'} degraded`,
    }
  }
  if (counts.stale > 0 && counts.up === 0) {
    return { status: 'stale', headline: 'No recent data' }
  }
  if (counts.stale > 0) {
    return {
      status: 'stale',
      headline: `${counts.stale} site${counts.stale === 1 ? '' : 's'} without recent data`,
    }
  }
  return { status: 'up', headline: 'All systems operational' }
}

export function HeaderStrip({
  snapshots,
  lastRunAt,
  now,
}: {
  snapshots: SiteSnapshot[]
  lastRunAt: string | null
  now: number
}) {
  const overall = summarise(snapshots, now)
  const checkerStalled = isStale(lastRunAt, now)

  return (
    <header
      className="rounded-xl border p-5"
      style={{ background: 'var(--surface-card)', borderColor: 'var(--border-subtle)' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <StatusDot status={overall.status} size={20} />
          <div>
            <h1 className="text-xl font-extrabold leading-tight">{overall.headline}</h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {snapshots.length} site{snapshots.length === 1 ? '' : 's'} monitored · last
              run {formatTime(lastRunAt)} ({formatRelative(lastRunAt, now)})
            </p>
          </div>
        </div>

        <CheckNowButton />
      </div>

      {checkerStalled && (
        <p
          role="alert"
          className="mt-4 rounded-md px-3 py-2 text-sm"
          style={{
            background: 'var(--status-degraded-soft)',
            color: 'var(--status-degraded)',
          }}
        >
          <strong>The checker may not be running.</strong> Nothing has been recorded in the
          last 15 minutes, so the statuses below are shown as unknown rather than as
          healthy. Check the <code>monitor</code> workflow in GitHub Actions.
        </p>
      )}
    </header>
  )
}
