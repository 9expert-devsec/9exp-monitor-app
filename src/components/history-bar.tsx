import { formatDay, formatMs } from '@/lib/format'
import { STATUS_COLOR } from '@/lib/status'
import type { DayBucket } from '@/lib/types'

const NO_DATA_COLOR = 'var(--border-subtle)'

function tooltipFor(bucket: DayBucket): string {
  const total = bucket.up + bucket.degraded + bucket.down
  if (total === 0) return `${formatDay(bucket.day)} — no data`

  const parts = [`${bucket.up} up`]
  if (bucket.degraded > 0) parts.push(`${bucket.degraded} degraded`)
  if (bucket.down > 0) parts.push(`${bucket.down} down`)
  parts.push(`avg ${formatMs(bucket.avgResponseMs)}`)

  return `${formatDay(bucket.day)} — ${parts.join(', ')}`
}

/**
 * 90 equal bars, oldest on the left, coloured by the worst status seen that
 * day. Days with no data are drawn as an empty slot rather than skipped so the
 * bar always spans exactly 90 days and gaps in coverage stay visible.
 *
 * Height is 28 on cards and 40 on the detail page.
 */
export function HistoryBar({
  history,
  height = 28,
}: {
  history: DayBucket[]
  /** px, or any CSS length (the TV wall passes a clamp()). */
  height?: number | string
}) {
  return (
    <div
      className="flex items-stretch gap-[2px]"
      style={{ height }}
      role="img"
      aria-label={`Daily status for the last ${history.length} days`}
    >
      {history.map((bucket) => (
        <div
          key={bucket.day}
          title={tooltipFor(bucket)}
          className="min-w-px flex-1 rounded-[2px] transition-opacity hover:opacity-70"
          style={{
            background: bucket.worst ? STATUS_COLOR[bucket.worst] : NO_DATA_COLOR,
          }}
        />
      ))}
    </div>
  )
}
