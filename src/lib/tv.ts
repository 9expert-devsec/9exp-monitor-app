/**
 * TV wall rules. Pure; no I/O. Status itself comes from `displayStatusOf()` in
 * status.ts — nothing here re-decides up / degraded / down / stale.
 */

import { STALE_AFTER_MS } from './status'
import type { CheckStatus, DisplayStatus, SiteSnapshot } from './types'

export interface TvEntry {
  snapshot: SiteSnapshot
  status: DisplayStatus
}

/** Issues first: Down, then Degraded, then No data, then Operational. */
const TV_RANK: Record<DisplayStatus, number> = { down: 0, degraded: 1, stale: 2, up: 3 }

/**
 * Issues-first order for the wall. Within a status the incoming order (group,
 * then the admin's sort_order) is kept — except Down, which is longest-down
 * first. Array.prototype.sort is stable, so ties keep their input order.
 */
export function orderForTv(entries: TvEntry[]): TvEntry[] {
  return entries.slice().sort((a, b) => {
    const byRank = TV_RANK[a.status] - TV_RANK[b.status]
    if (byRank !== 0) return byRank
    if (a.status === 'down') {
      const since = (entry: TvEntry) =>
        entry.snapshot.openIncident ? Date.parse(entry.snapshot.openIncident.started_at) : Number.POSITIVE_INFINITY
      return since(a) - since(b)
    }
    return 0
  })
}

// --- grid ------------------------------------------------------------------------

export type TvLayout = 'tv' | 'ultrawide' | 'laptop' | 'portrait'

export interface TvGridSize {
  columns: number
  rows: number
  /** Tile type scale; shrinks as the grid gets denser. */
  scale: number
}

/**
 * Columns and rows per layout. The layout itself is chosen by CSS media
 * queries; these numbers are handed to CSS as variables so every layout has
 * its grid ready. Rows never drop below a minimum so short lists keep the
 * designed tile proportions (empty slots stay empty).
 */
export function gridSizes(count: number): Record<TvLayout, TvGridSize> {
  const landscape = (minRows: number): TvGridSize => {
    const [columns, scale] =
      count <= 9 ? [3, 1] : count <= 12 ? [4, 0.86] : count <= 20 ? [5, 0.74] : count <= 30 ? [6, 0.62] : [7, 0.54]
    return { columns, rows: Math.max(minRows, Math.ceil(count / columns)), scale }
  }
  const ultraColumns = count <= 10 ? 5 : count <= 18 ? 6 : 7
  const portraitColumns = count <= 12 ? 2 : 3
  return {
    tv: landscape(3),
    laptop: landscape(3),
    ultrawide: {
      columns: ultraColumns,
      rows: Math.max(2, Math.ceil(count / ultraColumns)),
      // 5 columns are narrower than the 16:9 tiles relative to the 1.33× type; scale back so
      // the longest primary value ("Down 1h 05m 04s") still fits.
      scale: count <= 10 ? 0.8 : 0.7,
    },
    portrait: {
      columns: portraitColumns,
      rows: Math.max(4, Math.ceil(count / portraitColumns)),
      scale: count <= 12 ? 1 : 0.8,
    },
  }
}

// --- time buckets ----------------------------------------------------------------

export interface TimedValue {
  at: number
  value: number
}

/**
 * Averages values into `count` equal buckets covering [start, start + count × size).
 * A bucket with no values is null, so the chart breaks there instead of
 * drawing a misleading line.
 */
export function bucketAverages(values: TimedValue[], start: number, size: number, count: number): (number | null)[] {
  const sums = new Array<number>(count).fill(0)
  const counts = new Array<number>(count).fill(0)
  for (const { at, value } of values) {
    const index = Math.floor((at - start) / size)
    if (index < 0 || index >= count) continue
    sums[index] += value
    counts[index] += 1
  }
  return sums.map((sum, index) => (counts[index] > 0 ? Math.round(sum / counts[index]) : null))
}

export type HeatStatus = 'up' | 'degraded' | 'down' | null

const HEAT_RANK: Record<CheckStatus, number> = { up: 1, degraded: 2, down: 3 }

/**
 * Worst status checked in each of `count` buckets covering [start, start + count × size):
 * down > degraded > up; a bucket without a check is null ("No data"). Called with
 * the sparkline's start / size / count so the heatmap and sparkline line up.
 */
export function bucketWorstStatus(
  rows: { at: number; status: CheckStatus }[],
  start: number,
  size: number,
  count: number,
): HeatStatus[] {
  const worst = new Array<HeatStatus>(count).fill(null)
  for (const { at, status } of rows) {
    const index = Math.floor((at - start) / size)
    if (index < 0 || index >= count) continue
    const current = worst[index]
    if (current === null || HEAT_RANK[status] > HEAT_RANK[current]) worst[index] = status
  }
  return worst
}

/** Bangkok has no daylight saving: local time is always UTC+7. */
const BANGKOK_OFFSET_MS = 7 * 3_600_000

export interface HeatAxis {
  /** Index of the first bucket of Bangkok "today" — the midnight divider sits on its left edge. */
  midnight: number | null
  /** Buckets that start on a labelled hour (12:00 / 18:00 / 00:00 / 06:00 Bangkok). */
  ticks: { index: number; label: string }[]
}

export function heatAxis(start: number, size: number, count: number, hours: number[] = [12, 18, 0, 6]): HeatAxis {
  let midnight: number | null = null
  const ticks: HeatAxis['ticks'] = []
  for (let index = 0; index < count; index += 1) {
    const local = start + index * size + BANGKOK_OFFSET_MS
    const minuteOfDay = Math.floor((((local % 86_400_000) + 86_400_000) % 86_400_000) / 60_000)
    if (minuteOfDay % 60 !== 0) continue
    const hour = minuteOfDay / 60
    if (hour === 0 && index > 0) midnight = index
    if (hours.includes(hour)) ticks.push({ index, label: `${String(hour).padStart(2, '0')}:00` })
  }
  return { midnight, ticks }
}

// --- per-site threshold in the sparkline ---------------------------------------------

export type ThresholdMode = 'in-scale' | 'above' | null

/**
 * Where the site's "degraded above" line goes. In scale when the 24 h peak is at
 * least half the threshold (it then joins the y-range); otherwise "above": the
 * site keeps its own y-range so its shape stays readable, and the line is pinned
 * to the top edge. No points at all → "above" (nothing to compare with).
 */
export function thresholdMode(points: (number | null)[], threshold: number | null): ThresholdMode {
  if (threshold === null) return null
  let peak: number | null = null
  for (const value of points) if (value !== null && (peak === null || value > peak)) peak = value
  if (peak === null) return 'above'
  return peak >= threshold * 0.5 ? 'in-scale' : 'above'
}

// --- incident feed -----------------------------------------------------------------

export type FeedKind = 'down' | 'recovered' | 'degraded'

export interface FeedItem {
  /** Stable across refreshes: "down-12", "rec-12", "deg-7". */
  id: string
  at: string
  siteName: string
  kind: FeedKind
  /** "HTTP 503", "14m downtime", "1,620 ms". */
  detail: string
}

export function feedText(item: FeedItem): string {
  const verb = item.kind === 'down' ? 'down' : item.kind === 'recovered' ? 'recovered' : 'slow'
  return item.detail ? `${item.siteName} ${verb} · ${item.detail}` : `${item.siteName} ${verb}`
}

// --- checks schedule ---------------------------------------------------------------

/** pg_cron `monitor-checker` runs at every minute divisible by 5. */
export const CHECK_INTERVAL_MS = 5 * 60_000
/** After a boundary, how long "Checking…" may show while the run's data arrives. */
const CHECKING_GRACE_MS = 2 * 60_000

export interface CountdownState {
  checking: boolean
  /** ms until the next boundary (0 while checking). */
  remaining: number
  /** Start of the current 5-minute window (for the ring's animation phase). */
  windowStart: number
}

/**
 * Next-check countdown, computed on the client only. Right after a boundary,
 * until data from that run arrives (lastRunAt ≥ boundary), it says "Checking…".
 */
export function countdownAt(now: number, lastRunAt: string | null): CountdownState {
  const windowStart = Math.floor(now / CHECK_INTERVAL_MS) * CHECK_INTERVAL_MS
  const lastRun = lastRunAt ? Date.parse(lastRunAt) : 0
  if (now - windowStart < CHECKING_GRACE_MS && lastRun < windowStart) {
    return { checking: true, remaining: 0, windowStart }
  }
  return { checking: false, remaining: windowStart + CHECK_INTERVAL_MS - now, windowStart }
}

export type CheckerState = 'healthy' | 'late' | 'stopped'

/** Healthy; late after 7 min without a run; stopped past the 15-min stale rule. */
export function checkerStateAt(now: number, lastRunAt: string | null): CheckerState {
  if (!lastRunAt) return 'stopped'
  const age = now - Date.parse(lastRunAt)
  if (age > STALE_AFTER_MS) return 'stopped'
  if (age > 7 * 60_000) return 'late'
  return 'healthy'
}

// --- formatting ----------------------------------------------------------------------

/** "12m", "1h 05m" — minutes resolution, for summaries. */
export function shortDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/** "12m 04s", "1h 05m 04s" — the ticking down timer. */
export function ticking(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m ${ss}s` : `${m}m ${ss}s`
}

/**
 * Width budget, in characters, of a tile's primary value — drives `--chars`
 * (tv.css `.tv-fit`). At least 5: the short values ("Down", "—", "75 ms") are
 * wider per character than the --em-per-char budget, which is measured on the
 * long ones.
 */
export function primaryChars(text: string): number {
  return Math.max(5, text.length)
}

export function groupedMs(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${Math.round(value).toLocaleString('en-US')} ms`
}

// --- sparkline plan ----------------------------------------------------------------------

export interface SparkPoint {
  index: number
  value: number
}

export interface SparkPlan {
  /** Connected runs (≥ 2 points) after bridging short gaps — drawn as line + area. */
  runs: SparkPoint[][]
  /** Isolated points (no neighbour even after bridging) — drawn as a dot only. */
  dots: SparkPoint[]
  /** Y range with ~15 % padding; a flat series sits mid-height. */
  lo: number
  hi: number
  /** Fewer than `minPoints` real buckets: baseline + dots + "Collecting data…" only. */
  collecting: boolean
  /** Index of the live end-dot — only when the newest bucket is non-null. */
  endIndex: number | null
}

/**
 * How to draw a fixed-axis sparkline from buckets that may be mostly empty.
 * Gaps of up to `maxBridge` empty buckets between two values are bridged by a
 * straight line (≤ 1 h at 30-minute buckets); longer gaps stay broken.
 */
export function planSparkline(
  points: (number | null)[],
  { maxBridge = 2, minPoints = 4, threshold = null }: { maxBridge?: number; minPoints?: number; threshold?: number | null } = {},
): SparkPlan {
  const real = points.flatMap((value, index) => (value === null ? [] : [{ index, value }]))
  const last = points.length - 1
  const endIndex = last >= 0 && points[last] !== null ? last : null

  const range = [...real.map((p) => p.value), ...(threshold !== null ? [threshold] : [])]
  let lo = range.length ? Math.min(...range) : 0
  let hi = range.length ? Math.max(...range) : 1
  if (hi === lo) {
    lo -= 1
    hi += 1
  } else {
    const pad = (hi - lo) * 0.15
    lo -= pad
    hi += pad
  }

  if (real.length < minPoints) return { runs: [], dots: real, lo, hi, collecting: true, endIndex }

  // Bridge short interior gaps by linear interpolation (for drawing only).
  const filled = points.slice()
  for (let i = 0; i < real.length - 1; i += 1) {
    const a = real[i]
    const b = real[i + 1]
    const gap = b.index - a.index - 1
    if (gap > 0 && gap <= maxBridge) {
      for (let k = 1; k <= gap; k += 1) filled[a.index + k] = a.value + ((b.value - a.value) * k) / (gap + 1)
    }
  }

  const runs: SparkPoint[][] = []
  const dots: SparkPoint[] = []
  let run: SparkPoint[] = []
  const flush = () => {
    if (run.length === 1) dots.push(run[0])
    else if (run.length > 1) runs.push(run)
    run = []
  }
  filled.forEach((value, index) => {
    if (value === null) flush()
    else run.push({ index, value })
  })
  flush()

  return { runs, dots, lo, hi, collecting: false, endIndex }
}
