/**
 * TV wall rules. Pure; no I/O. Status itself comes from `displayStatusOf()` in
 * status.ts — nothing here re-decides up / degraded / down / stale.
 */

import { STALE_AFTER_MS } from './status'
import type { DisplayStatus, SiteSnapshot } from './types'

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

export function groupedMs(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${Math.round(value).toLocaleString('en-US')} ms`
}
