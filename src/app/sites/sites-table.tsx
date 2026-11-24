'use client'

import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react'
import Link from 'next/link'
import {
  useEffect,
  useOptimistic,
  useState,
  useTransition,
  type DragEvent,
  type ReactNode,
} from 'react'

import { saveSiteOrderAction, setSiteEnabledAction, type GroupOrder } from '@/app/sites/actions'
import { Button, buttonClassName } from '@/components/button'
import { StatusPill } from '@/components/status-pill'
import { Switch } from '@/components/switch'
import { toast } from '@/components/toaster'
import { hostOf } from '@/lib/format'
import { healthPathLabel } from '@/lib/site-form'
import type { DisplayStatus, Site } from '@/lib/types'

export interface SiteTableRow {
  site: Site
  status: DisplayStatus
}

function editHref(slug: string): string {
  return `/sites?edit=${encodeURIComponent(slug)}`
}

function LastStatus({ row }: { row: SiteTableRow }) {
  if (!row.site.enabled) return <span className="text-xs text-(--text-muted)">Paused</span>
  return <StatusPill status={row.status} />
}

function HealthCell({ site }: { site: Site }) {
  if (!site.health_url) return <span className="text-xs text-(--text-muted)">— Page check only</span>
  return (
    <span className="font-mono text-xs text-(--text-secondary)" title={site.health_url}>
      {healthPathLabel(site.url, site.health_url)}
    </span>
  )
}

// --- Reorder helpers ----------------------------------------------------------

/** Rows arrive sorted by group, so each group is one contiguous run. */
function sameGroup(a: SiteTableRow, b: SiteTableRow): boolean {
  return a.site.group_name === b.site.group_name
}

/** Moves the row with `id` one place up/down, never across a group boundary. */
function moveByOne(rows: SiteTableRow[], id: string, direction: -1 | 1): SiteTableRow[] {
  const from = rows.findIndex((row) => row.site.id === id)
  const to = from + direction
  if (from === -1 || to < 0 || to >= rows.length || !sameGroup(rows[from], rows[to])) return rows
  const next = rows.slice()
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

/** Moves `id` to just before / after `targetId` (same group only). */
function moveTo(
  rows: SiteTableRow[],
  id: string,
  targetId: string,
  position: 'before' | 'after',
): SiteTableRow[] {
  if (id === targetId) return rows
  const moving = rows.find((row) => row.site.id === id)
  const target = rows.find((row) => row.site.id === targetId)
  if (!moving || !target || !sameGroup(moving, target)) return rows
  const without = rows.filter((row) => row.site.id !== id)
  const index = without.findIndex((row) => row.site.id === targetId)
  without.splice(position === 'before' ? index : index + 1, 0, moving)
  return without
}

/** The groups whose order differs from the saved one, as the action expects them. */
function changedGroups(saved: SiteTableRow[], staged: SiteTableRow[]): GroupOrder[] {
  const idsByGroup = (rows: SiteTableRow[]) => {
    const map = new Map<string | null, string[]>()
    for (const { site } of rows) {
      const list = map.get(site.group_name)
      if (list) list.push(site.id)
      else map.set(site.group_name, [site.id])
    }
    return map
  }
  const before = idsByGroup(saved)
  const after = idsByGroup(staged)
  const changes: GroupOrder[] = []
  for (const [group, ids] of after) {
    const previous = before.get(group) ?? []
    if (ids.join() !== previous.join()) changes.push({ group, ids })
  }
  return changes
}

type FocusTarget = { id: string; direction: 'up' | 'down'; variant: 'table' | 'card' } | null
type DropTarget = { id: string; position: 'before' | 'after' } | null

const DROP_LINE = {
  before: '[&>td]:shadow-[inset_0_2px_0_0_var(--brand-nine-blue)]',
  after: '[&>td]:shadow-[inset_0_-2px_0_0_var(--brand-nine-blue)]',
} as const

/**
 * The Sites header actions, table (≥ 640 px) and card list (< 640 px).
 *
 * Admins: the enabled toggle saves immediately (optimistic; it flips back by
 * itself if the action fails). "Reorder" stages a new order locally — drag
 * within a group on desktop, or the up/down buttons anywhere — and saves it in
 * one action. Nothing is written until "Save order".
 */
export function SitesTable({
  rows,
  isAdmin,
  heading,
}: {
  rows: SiteTableRow[]
  isAdmin: boolean
  /** Title and sub-line, rendered on the server. */
  heading: ReactNode
}) {
  const [optimisticRows, setEnabled] = useOptimistic(
    rows,
    (state, change: { id: string; enabled: boolean }) =>
      state.map((row) =>
        row.site.id === change.id ? { ...row, site: { ...row.site, enabled: change.enabled } } : row,
      ),
  )
  const [, startToggle] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Reorder mode: `staged` is the working order; null when not reordering.
  const [staged, setStaged] = useState<SiteTableRow[] | null>(null)
  const [saving, startSave] = useTransition()
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget>(null)
  const [focusTarget, setFocusTarget] = useState<FocusTarget>(null)

  const reordering = staged !== null
  const shown = staged ?? optimisticRows
  const changes = staged ? changedGroups(rows, staged) : []
  const dirty = changes.length > 0

  // Moving a row re-inserts its DOM node, which drops focus. Put it back on
  // the moved row's button (or its other button once it reaches an end).
  useEffect(() => {
    if (!focusTarget) return
    const { id, direction, variant } = focusTarget
    const other = direction === 'up' ? 'down' : 'up'
    const preferred = document.getElementById(`move-${variant}-${direction}-${id}`) as HTMLButtonElement | null
    const fallback = document.getElementById(`move-${variant}-${other}-${id}`) as HTMLButtonElement | null
    ;(preferred && !preferred.disabled ? preferred : fallback)?.focus()
  }, [focusTarget, staged])

  function toggle(site: Site, enabled: boolean) {
    setError(null)
    startToggle(async () => {
      setEnabled({ id: site.id, enabled })
      const result = await setSiteEnabledAction(site.id, enabled)
      if (!result.ok) setError(`Could not ${enabled ? 'resume' : 'pause'} ${site.name}: ${result.error}`)
    })
  }

  function startReorder() {
    setError(null)
    setStaged(rows.slice())
  }

  function cancelReorder() {
    setStaged(null)
    setError(null)
    setDropTarget(null)
    setDragId(null)
  }

  function saveOrder() {
    if (!staged || !dirty) {
      cancelReorder()
      return
    }
    setError(null)
    startSave(async () => {
      const result = await saveSiteOrderAction(changes)
      // Either way the action revalidated, so `rows` is the real saved order:
      // leave reorder mode and show it (with the error, if any).
      setStaged(null)
      if (result.ok) toast('Order saved')
      else setError(`Could not save the order: ${result.error}`)
    })
  }

  function move(id: string, direction: 'up' | 'down', variant: 'table' | 'card') {
    setStaged((current) => (current ? moveByOne(current, id, direction === 'up' ? -1 : 1) : current))
    setFocusTarget({ id, direction, variant })
  }

  // --- Native drag and drop (desktop table only) ---
  const dragRow = dragId ? shown.find((row) => row.site.id === dragId) : undefined

  function onDragStart(event: DragEvent<HTMLTableRowElement>, id: string) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
    setDragId(id)
  }

  function onDragOver(event: DragEvent<HTMLTableRowElement>, row: SiteTableRow) {
    // Only rows of the dragged row's group accept the drop.
    if (!dragRow || !sameGroup(dragRow, row)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const box = event.currentTarget.getBoundingClientRect()
    const position = event.clientY < box.top + box.height / 2 ? 'before' : 'after'
    if (dropTarget?.id !== row.site.id || dropTarget.position !== position) {
      setDropTarget({ id: row.site.id, position })
    }
  }

  function onDrop(event: DragEvent<HTMLTableRowElement>) {
    event.preventDefault()
    if (dragId && dropTarget) {
      setStaged((current) => (current ? moveTo(current, dragId, dropTarget.id, dropTarget.position) : current))
    }
    setDragId(null)
    setDropTarget(null)
  }

  function onDragEnd() {
    setDragId(null)
    setDropTarget(null)
  }

  function canMove(index: number, direction: -1 | 1): boolean {
    const neighbour = shown[index + direction]
    return neighbour !== undefined && sameGroup(shown[index], neighbour)
  }

  // A render helper, not a nested component: a component defined in here
  // would remount on every render and lose the buttons' DOM nodes.
  function moveButtons(row: SiteTableRow, index: number, variant: 'table' | 'card') {
    const { site } = row
    return (
      <div className="flex justify-end gap-1">
        <button
          type="button"
          id={`move-${variant}-up-${site.id}`}
          aria-label={`Move ${site.name} up`}
          disabled={!canMove(index, -1) || saving}
          onClick={() => move(site.id, 'up', variant)}
          className="rounded-sm p-1.5 text-(--text-secondary) hover:bg-(--surface-raised) hover:text-(--text-primary) disabled:opacity-30"
        >
          <ChevronUp size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          id={`move-${variant}-down-${site.id}`}
          aria-label={`Move ${site.name} down`}
          disabled={!canMove(index, 1) || saving}
          onClick={() => move(site.id, 'down', variant)}
          className="rounded-sm p-1.5 text-(--text-secondary) hover:bg-(--surface-raised) hover:text-(--text-primary) disabled:opacity-30"
        >
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </div>
    )
  }

  const reorderBar = reordering && (
    <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-(--border-subtle) bg-(--surface-raised) px-5 py-3">
      <p className="text-sm" aria-live="polite">
        {dirty ? (
          <span className="font-semibold text-(--text-primary)">Unsaved order</span>
        ) : (
          <span className="text-(--text-secondary)">
            <span className="hidden sm:inline">Drag rows to reorder within each group</span>
            <span className="sm:hidden">Use the arrows to reorder within each group</span>
          </span>
        )}
      </p>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={cancelReorder} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" onClick={saveOrder} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save order'}
        </Button>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>{heading}</div>
        {isAdmin && !reordering && (
          <div className="flex gap-2">
            {rows.length > 1 && (
              <Button variant="secondary" onClick={startReorder}>
                Reorder
              </Button>
            )}
            <Link href="/sites?new=1" scroll={false} className={buttonClassName('primary')}>
              + Add site
            </Link>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-(--status-down-soft) px-3 py-2.5 text-sm text-(--status-down)">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-(--border-subtle) bg-(--surface-card) p-6 text-sm text-(--text-secondary)">
          No sites yet.
          {isAdmin ? ' Add the first one with “+ Add site”.' : ' An admin can add them here.'}
        </p>
      ) : (
        <>
          {/* ≥ 640 px: table. `overflow-clip` (not hidden) keeps the bar sticky to the page. */}
          <div className="hidden overflow-clip rounded-lg border border-(--border-subtle) bg-(--surface-card) sm:block">
            {reorderBar}
            <div className="overflow-x-auto">
              <table className="w-full min-w-200 text-sm">
                <thead>
                  <tr className="label-overline bg-(--surface-raised) text-left">
                    {isAdmin && (
                      <th scope="col" className="w-16 px-5 py-3 font-semibold">
                        <span className="sr-only">{reordering ? 'Drag handle' : 'Enabled'}</span>
                      </th>
                    )}
                    <th scope="col" className="px-4 py-3 font-semibold">Site / page URL</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Group</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Health check</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Degraded above</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Last status</th>
                    {isAdmin && (
                      <th scope="col" className="px-4 py-3 font-semibold">
                        <span className="sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-(--border-subtle)">
                  {shown.map((row, index) => {
                    const { site } = row
                    const isDropTarget = dropTarget?.id === site.id
                    const rowClass = [
                      site.enabled ? '' : 'opacity-55',
                      reordering ? 'cursor-grab' : '',
                      dragId === site.id ? 'opacity-40' : '',
                      isDropTarget ? DROP_LINE[dropTarget.position] : '',
                    ].join(' ')
                    return (
                      <tr
                        key={site.id}
                        className={rowClass}
                        draggable={reordering && !saving}
                        onDragStart={reordering ? (event) => onDragStart(event, site.id) : undefined}
                        onDragOver={reordering ? (event) => onDragOver(event, row) : undefined}
                        onDrop={reordering ? onDrop : undefined}
                        onDragEnd={reordering ? onDragEnd : undefined}
                      >
                        {isAdmin && (
                          <td className="w-16 px-5 py-3">
                            {reordering ? (
                              <GripVertical size={16} aria-hidden="true" className="text-(--text-muted)" />
                            ) : (
                              <Switch
                                id={`enabled-${site.id}`}
                                label={`Monitor ${site.name}`}
                                labelHidden
                                checked={site.enabled}
                                onChange={(event) => toggle(site, event.target.checked)}
                              />
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3">
                          {reordering ? (
                            <span className="text-sm font-medium">{site.name}</span>
                          ) : (
                            <Link href={`/sites/${site.slug}`} className="text-sm font-medium hover:underline">
                              {site.name}
                            </Link>
                          )}
                          <p className="font-mono text-xs text-(--text-muted)">{hostOf(site.url)}</p>
                        </td>
                        <td className="px-4 py-3 text-(--text-secondary)">{site.group_name ?? '—'}</td>
                        <td className="px-4 py-3">
                          <HealthCell site={site} />
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{site.expected_ms} ms</td>
                        <td className="px-4 py-3">
                          <LastStatus row={row} />
                        </td>
                        {isAdmin && (
                          <td className="px-4 py-3 text-right">
                            {reordering ? (
                              moveButtons(row, index, 'table')
                            ) : (
                              <Link
                                href={editHref(site.slug)}
                                scroll={false}
                                className={buttonClassName('ghost', 'px-2.5 py-1.5')}
                              >
                                Edit
                              </Link>
                            )}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* < 640 px: cards. Reorder uses the arrows only — no drag. */}
          <div className="flex flex-col gap-3 sm:hidden">
            {reordering && <div className="overflow-clip rounded-lg border border-(--border-subtle)">{reorderBar}</div>}
            <ul className="flex flex-col gap-3">
              {shown.map((row, index) => {
                const { site } = row
                return (
                  <li
                    key={site.id}
                    className={`flex items-start gap-3 rounded-lg border border-(--border-subtle) bg-(--surface-card) p-4 ${
                      site.enabled ? '' : 'opacity-55'
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      {reordering ? (
                        <span className="truncate text-sm font-medium">{site.name}</span>
                      ) : (
                        <Link href={`/sites/${site.slug}`} className="truncate text-sm font-medium hover:underline">
                          {site.name}
                        </Link>
                      )}
                      <p className="truncate font-mono text-xs text-(--text-muted)">{hostOf(site.url)}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-(--text-secondary)">{site.group_name ?? '—'}</span>
                        <LastStatus row={row} />
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        {reordering ? (
                          moveButtons(row, index, 'card')
                        ) : (
                          <>
                            <Switch
                              id={`enabled-mobile-${site.id}`}
                              label={`Monitor ${site.name}`}
                              labelHidden
                              checked={site.enabled}
                              onChange={(event) => toggle(site, event.target.checked)}
                            />
                            <Link
                              href={editHref(site.slug)}
                              scroll={false}
                              className={buttonClassName('ghost', 'px-2.5 py-1.5')}
                            >
                              Edit
                            </Link>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
