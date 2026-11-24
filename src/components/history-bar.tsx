import { formatDay, formatMs } from '@/lib/format'
import { STATUS_COLOR } from '@/lib/status'
import type { DayBucket } from '@/lib/types'

const NO_DATA_COLOR = 'var(--surface-sunken)'

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
 * 90 thin vertical bars, oldest on the left, coloured by the worst status seen
 * that day. Days with no data are drawn as an empty slot rather than skipped so
 * the bar always spans exactly 90 days and gaps in coverage stay visible.
 */
export function HistoryBar({ history }: { history: DayBucket[] }) {
  return (
    <div
      className="flex h-8 items-stretch gap-px overflow-hidden rounded-sm"
      role="img"
      aria-label={`Daily status for the last ${history.length} days`}
    >
      {history.map((bucket) => (
        <div
          key={bucket.day}
          title={tooltipFor(bucket)}
          className="min-w-px flex-1 rounded-[1px] transition-opacity hover:opacity-70"
          style={{
            background: bucket.worst ? STATUS_COLOR[bucket.worst] : NO_DATA_COLOR,
          }}
        />
      ))}
    </div>
  )
}
