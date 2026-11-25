/**
 * TV wall rules. Pure; no I/O. Status itself comes from `displayStatusOf()` in
 * status.ts — nothing here re-decides up / degraded / down / stale.
 */

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

export interface TvGrid {
  columns: number
  rows: number
  /** Type scale for the tiles: 1 = design size (≤ 9 sites); smaller as the grid gets denser. */
  scale: number
  /**
   * Days of history per tile. Each day needs ~3 px (1 px bar + 2 px gap), so
   * narrow tiles show the most recent days only rather than overflowing.
   */
  historyDays: number
}

/**
 * Columns and rows so every site fits on one screen. Rows never drop below 3
 * so a short list keeps tiles at the designed proportions instead of
 * stretching them to fill the wall.
 */
export function gridFor(count: number): TvGrid {
  const [columns, scale, historyDays] =
    count <= 9
      ? [3, 1, 90]
      : count <= 12
        ? [4, 0.86, 60]
        : count <= 20
          ? [5, 0.74, 45]
          : count <= 30
            ? [6, 0.62, 30]
            : [7, 0.54, 30]
  return { columns, rows: Math.max(3, Math.ceil(count / columns)), scale, historyDays }
}
