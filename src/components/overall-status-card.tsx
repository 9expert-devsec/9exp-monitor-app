import { CheckNowButton } from '@/components/check-now-button'
import { StatusDot } from '@/components/status-dot'
import { formatClock, formatRelative } from '@/lib/format'
import { CHECKER_STALLED_MESSAGE } from '@/lib/messages'
import { isStale } from '@/lib/status'
import type { DisplayStatus } from '@/lib/types'

export type StatusCounts = Record<DisplayStatus, number>

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** Worst status first; drives the dot and the card border. */
export function worstStatus(counts: StatusCounts, total: number): DisplayStatus {
  if (counts.down > 0) return 'down'
  if (counts.degraded > 0) return 'degraded'
  if (counts.stale > 0 || total === 0) return 'stale'
  return 'up'
}

/**
 * "All systems operational", "1 site down · 1 degraded", or "No recent data".
 * A part is omitted when its count is 0.
 */
export function headlineFor(counts: StatusCounts, total: number): string {
  if (total === 0 || counts.stale === total) return 'No recent data'

  const parts: string[] = []
  if (counts.down > 0) parts.push(`${plural(counts.down, 'site')} down`)
  if (counts.degraded > 0) {
    parts.push(parts.length === 0 ? `${plural(counts.degraded, 'site')} degraded` : `${counts.degraded} degraded`)
  }
  if (counts.stale > 0) {
    parts.push(parts.length === 0 ? `${plural(counts.stale, 'site')} with no data` : `${counts.stale} no data`)
  }
  return parts.length === 0 ? 'All systems operational' : parts.join(' · ')
}

export function OverallStatusCard({
  counts,
  total,
  lastRunAt,
  now,
}: {
  counts: StatusCounts
  total: number
  lastRunAt: string | null
  now: number
}) {
  const status = worstStatus(counts, total)
  const checkerStalled = isStale(lastRunAt, now)
  const borderColor =
    status === 'down'
      ? 'var(--status-down)'
      : status === 'degraded'
        ? 'var(--status-degraded)'
        : 'var(--border-subtle)'

  return (
    <section
      aria-label="Overall status"
      className="flex flex-col gap-4 rounded-lg border bg-(--surface-card) px-6 py-5"
      style={{ borderColor }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4 sm:items-center">
          <StatusDot status={status} size={24} className="mt-1.5 sm:mt-0" />
          <div>
            <h1 className="text-[28px] leading-tight font-bold">{headlineFor(counts, total)}</h1>
            <p className="mt-1 text-sm text-(--text-secondary)">
              {plural(total, 'site')} monitored · last run {formatClock(lastRunAt)} (
              {formatRelative(lastRunAt, now)}) · checks every 5 min
            </p>
          </div>
        </div>
        <CheckNowButton className="w-full sm:w-auto" />
      </div>

      {checkerStalled && (
        <p
          role="alert"
          className="rounded-md bg-(--status-degraded-soft) px-4 py-3 text-sm text-(--status-degraded)"
        >
          {CHECKER_STALLED_MESSAGE}
        </p>
      )}
    </section>
  )
}
