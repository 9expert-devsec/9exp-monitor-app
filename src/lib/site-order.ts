/**
 * Display order for sites, shared by the Sites table, the dashboard and the
 * Server Actions. Isomorphic, no I/O.
 *
 *  1. Group: `In-house`, then `Outsourced`, then any other group A→Z, then
 *     sites with no group.
 *  2. `sort_order` within the group (set by "Reorder"; 10, 20, 30, …).
 *  3. Name, as a tie-breaker.
 */

import type { Site } from './types'

export const GROUP_ORDER = ['In-house', 'Outsourced'] as const

/** Gap between neighbours; new and moved sites go to `max + SORT_STEP`. */
export const SORT_STEP = 10

/** Sort key for a group. Fixed groups first, then others alphabetically, null last. */
function groupKey(group: string | null): [number, string] {
  if (group === null) return [3, '']
  const fixed = (GROUP_ORDER as readonly string[]).indexOf(group)
  return fixed === -1 ? [2, group.toLowerCase()] : [fixed, '']
}

export function compareGroups(a: string | null, b: string | null): number {
  const [rankA, nameA] = groupKey(a)
  const [rankB, nameB] = groupKey(b)
  return rankA !== rankB ? rankA - rankB : nameA.localeCompare(nameB)
}

type Orderable = Pick<Site, 'group_name' | 'sort_order' | 'name'>

export function compareSites(a: Orderable, b: Orderable): number {
  const byGroup = compareGroups(a.group_name, b.group_name)
  if (byGroup !== 0) return byGroup
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
  return a.name.localeCompare(b.name)
}

/** `sort_order` that puts a site at the bottom of a group with these orders. */
export function bottomSortOrder(existing: readonly number[]): number {
  return (existing.length > 0 ? Math.max(...existing) : 0) + SORT_STEP
}
