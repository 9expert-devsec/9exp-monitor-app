import { formatMs, formatTime } from '@/lib/format'
import type { SeriesPoint } from '@/lib/dashboard'

const WIDTH = 960
const HEIGHT = 260
const PADDING = { top: 16, right: 16, bottom: 28, left: 52 }

const PLOT_WIDTH = WIDTH - PADDING.left - PADDING.right
const PLOT_HEIGHT = HEIGHT - PADDING.top - PADDING.bottom

/** Rounds a max value up to something that makes a readable axis. */
function niceCeiling(value: number): number {
  if (value <= 0) return 100
  const magnitude = 10 ** Math.floor(Math.log10(value))
  return Math.ceil(value / magnitude) * magnitude
}

/**
 * Response time over the selected window, rendered as inline SVG.
 *
 * The series is already bucketed by `site_response_series()` in Postgres, so
 * this never has to thin thousands of raw rows in the browser. Buckets that
 * contain a `down` check are marked so an outage reads as a gap with a flag,
 * not as a line that quietly dips to zero.
 */
export function ResponseChart({
  series,
  expectedMs,
}: {
  series: SeriesPoint[]
  expectedMs: number
}) {
  const measured = series.filter((point) => point.avg_response_ms !== null)

  if (measured.length === 0) {
    return (
      <div
        className="flex h-56 items-center justify-center rounded-xl border text-sm"
        style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
      >
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

  const x = (iso: string) =>
    PADDING.left + ((Date.parse(iso) - firstTs) / span) * PLOT_WIDTH
  const y = (ms: number) =>
    PADDING.top + PLOT_HEIGHT - (Math.min(ms, yMax) / yMax) * PLOT_HEIGHT

  const linePath = measured
    .map((point, index) => {
      const command = index === 0 ? 'M' : 'L'
      return `${command}${x(point.bucket).toFixed(1)} ${y(point.avg_response_ms!).toFixed(1)}`
    })
    .join(' ')

  const areaPath = `${linePath} L${x(measured[measured.length - 1].bucket).toFixed(1)} ${
    PADDING.top + PLOT_HEIGHT
  } L${x(measured[0].bucket).toFixed(1)} ${PADDING.top + PLOT_HEIGHT} Z`

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(yMax * fraction))
  const outages = series.filter((point) => point.down_count > 0)

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-64 w-full min-w-[560px]"
        role="img"
        aria-label={`Response time from ${formatTime(series[0].bucket)} to ${formatTime(
          series[series.length - 1].bucket,
        )}`}
      >
        <defs>
          <linearGradient id="response-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand-blue)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--color-brand-blue)" stopOpacity="0" />
          </linearGradient>
        </defs>

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
            <text
              x={PADDING.left - 8}
              y={y(value) + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--text-muted)"
            >
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
        <text
          x={WIDTH - PADDING.right}
          y={y(expectedMs) - 6}
          textAnchor="end"
          fontSize="11"
          fill="var(--status-degraded)"
        >
          degraded above {formatMs(expectedMs)}
        </text>

        {outages.map((point) => (
          <rect
            key={`outage-${point.bucket}`}
            x={x(point.bucket) - 1.5}
            y={PADDING.top}
            width="3"
            height={PLOT_HEIGHT}
            fill="var(--status-down)"
            opacity="0.5"
          >
            <title>{`${formatTime(point.bucket)} — ${point.down_count} down`}</title>
          </rect>
        ))}

        <path d={areaPath} fill="url(#response-fill)" />
        <path
          d={linePath}
          fill="none"
          stroke="var(--color-brand-blue)"
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
              {`${formatTime(point.bucket)} — avg ${formatMs(point.avg_response_ms)}, max ${formatMs(point.max_response_ms)}`}
            </title>
          </circle>
        ))}

        <text
          x={PADDING.left}
          y={HEIGHT - 8}
          fontSize="11"
          fill="var(--text-muted)"
        >
          {formatTime(series[0].bucket)}
        </text>
        <text
          x={WIDTH - PADDING.right}
          y={HEIGHT - 8}
          textAnchor="end"
          fontSize="11"
          fill="var(--text-muted)"
        >
          {formatTime(series[series.length - 1].bucket)}
        </text>
      </svg>
    </div>
  )
}
