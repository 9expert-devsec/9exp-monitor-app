import { formatMs, formatShortDateTime } from '@/lib/format'
import type { SeriesPoint } from '@/lib/dashboard'

const WIDTH = 960
const HEIGHT = 260
const PADDING = { top: 16, right: 16, bottom: 30, left: 60 }

const PLOT_WIDTH = WIDTH - PADDING.left - PADDING.right
const PLOT_HEIGHT = HEIGHT - PADDING.top - PADDING.bottom

const AXIS_TEXT = {
  fontSize: 12,
  fill: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
} as const

/** Rounds a max value up to something that makes a readable axis. */
function niceCeiling(value: number): number {
  if (value <= 0) return 100
  const magnitude = 10 ** Math.floor(Math.log10(value))
  return Math.ceil(value / magnitude) * magnitude
}

/** Consecutive buckets containing a `down` check, merged into [start, end] index pairs. */
function downtimeSpans(series: SeriesPoint[]): [number, number][] {
  const spans: [number, number][] = []
  series.forEach((point, index) => {
    if (point.down_count === 0) return
    const last = spans[spans.length - 1]
    if (last && last[1] === index - 1) last[1] = index
    else spans.push([index, index])
  })
  return spans
}

/**
 * Response time over the selected window, rendered as inline SVG.
 *
 * The series is already bucketed by `site_response_series()` in Postgres, so
 * this never has to thin thousands of raw rows in the browser. Downtime is drawn
 * as a red band behind the line, so an outage reads as a marked gap rather than
 * a line that quietly dips to zero.
 */
export function ResponseChart({
  series,
  expectedMs,
}: {
  series: SeriesPoint[]
  expectedMs: number
}) {
  const measured = series.filter((point) => point.avg_response_ms !== null)

  if (series.length === 0 || measured.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-md border border-(--border-subtle) text-sm text-(--text-muted)">
        No response-time data in this window.
      </div>
    )
  }

  const observedMax = Math.max(
    ...measured.map((point) => point.max_response_ms ?? point.avg_response_ms ?? 0),
  )
  // Always keep the expected-time threshold on the canvas, even on a fast day.
  const yMax = niceCeiling(Math.max(observedMax, expectedMs * 1.2))

  const firstTs = Date.parse(series[0].bucket)
  const lastTs = Date.parse(series[series.length - 1].bucket)
  const span = Math.max(1, lastTs - firstTs)
  const stepPx = series.length > 1 ? PLOT_WIDTH / (series.length - 1) : PLOT_WIDTH

  const x = (iso: string) => PADDING.left + ((Date.parse(iso) - firstTs) / span) * PLOT_WIDTH
  const y = (ms: number) => PADDING.top + PLOT_HEIGHT - (Math.min(ms, yMax) / yMax) * PLOT_HEIGHT

  const linePath = measured
    .map((point, index) => {
      const command = index === 0 ? 'M' : 'L'
      return `${command}${x(point.bucket).toFixed(1)} ${y(point.avg_response_ms!).toFixed(1)}`
    })
    .join(' ')

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(yMax * fraction))
  const middle = series[Math.floor(series.length / 2)]

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-64 w-full min-w-140"
        role="img"
        aria-label={`Response time from ${formatShortDateTime(series[0].bucket)} to ${formatShortDateTime(
          series[series.length - 1].bucket,
        )}`}
      >
        {downtimeSpans(series).map(([start, end]) => {
          const left = Math.max(PADDING.left, x(series[start].bucket) - stepPx / 2)
          const right = Math.min(WIDTH - PADDING.right, x(series[end].bucket) + stepPx / 2)
          const downCount = series
            .slice(start, end + 1)
            .reduce((total, point) => total + point.down_count, 0)
          return (
            <rect
              key={`down-${series[start].bucket}`}
              x={left}
              y={PADDING.top}
              width={Math.max(2, right - left)}
              height={PLOT_HEIGHT}
              fill="var(--status-down-soft)"
            >
              <title>
                {`Downtime ${formatShortDateTime(series[start].bucket)} – ${formatShortDateTime(
                  series[end].bucket,
                )} · ${downCount} down check${downCount === 1 ? '' : 's'}`}
              </title>
            </rect>
          )
        })}

        {gridValues.map((value) => (
          <g key={value}>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={y(value)}
              y2={y(value)}
              stroke="var(--border-subtle)"
              strokeWidth="1"
            />
            <text x={PADDING.left - 10} y={y(value) + 4} textAnchor="end" {...AXIS_TEXT}>
              {formatMs(value)}
            </text>
          </g>
        ))}

        {/* The site's own degraded threshold. */}
        <line
          x1={PADDING.left}
          x2={WIDTH - PADDING.right}
          y1={y(expectedMs)}
          y2={y(expectedMs)}
          stroke="var(--status-degraded)"
          strokeWidth="1.5"
          strokeDasharray="6 4"
        />

        <path
          d={linePath}
          fill="none"
          stroke="var(--brand-nine-blue)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {measured.map((point) => (
          <circle
            key={point.bucket}
            cx={x(point.bucket)}
            cy={y(point.avg_response_ms!)}
            r="6"
            fill="transparent"
          >
            <title>
              {`${formatShortDateTime(point.bucket)} — avg ${formatMs(point.avg_response_ms)}, max ${formatMs(point.max_response_ms)}`}
            </title>
          </circle>
        ))}

        <text x={PADDING.left} y={HEIGHT - 8} {...AXIS_TEXT}>
          {formatShortDateTime(series[0].bucket)}
        </text>
        <text x={x(middle.bucket)} y={HEIGHT - 8} textAnchor="middle" {...AXIS_TEXT}>
          {formatShortDateTime(middle.bucket)}
        </text>
        <text x={WIDTH - PADDING.right} y={HEIGHT - 8} textAnchor="end" {...AXIS_TEXT}>
          {formatShortDateTime(series[series.length - 1].bucket)}
        </text>
      </svg>
    </div>
  )
}
