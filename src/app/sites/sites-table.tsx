'use client'

import Link from 'next/link'
import { useOptimistic, useState, useTransition } from 'react'

import { setSiteEnabledAction } from '@/app/sites/actions'
import { buttonClassName } from '@/components/button'
import { StatusPill } from '@/components/status-pill'
import { Switch } from '@/components/switch'
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

/**
 * The Sites table (≥ 640 px) and card list (< 640 px). For admins, the enabled
 * toggle saves immediately: the row flips optimistically and flips back by
 * itself if the action fails (the optimistic state ends with the transition).
 */
export function SitesTable({ rows, isAdmin }: { rows: SiteTableRow[]; isAdmin: boolean }) {
  const [optimisticRows, setEnabled] = useOptimistic(
    rows,
    (state, change: { id: string; enabled: boolean }) =>
      state.map((row) =>
        row.site.id === change.id ? { ...row, site: { ...row.site, enabled: change.enabled } } : row,
      ),
  )
  const [, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function toggle(site: Site, enabled: boolean) {
    setError(null)
    startTransition(async () => {
      setEnabled({ id: site.id, enabled })
      const result = await setSiteEnabledAction(site.id, enabled)
      if (!result.ok) setError(`Could not ${enabled ? 'resume' : 'pause'} ${site.name}: ${result.error}`)
    })
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-(--border-subtle) bg-(--surface-card) p-6 text-sm text-(--text-secondary)">
        No sites yet.
        {isAdmin ? ' Add the first one with “+ Add site”.' : ' An admin can add them here.'}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="rounded-md bg-(--status-down-soft) px-3 py-2.5 text-sm text-(--status-down)">
          {error}
        </p>
      )}

      {/* ≥ 640 px: table */}
      <div className="hidden overflow-hidden rounded-lg border border-(--border-subtle) bg-(--surface-card) sm:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-200 text-sm">
            <thead>
              <tr className="label-overline bg-(--surface-raised) text-left">
                {isAdmin && (
                  <th scope="col" className="w-16 px-5 py-3 font-semibold">
                    <span className="sr-only">Enabled</span>
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
              {optimisticRows.map((row) => {
                const { site } = row
                return (
                  <tr key={site.id} className={site.enabled ? undefined : 'opacity-55'}>
                    {isAdmin && (
                      <td className="w-16 px-5 py-3">
                        <Switch
                          id={`enabled-${site.id}`}
                          label={`Monitor ${site.name}`}
                          labelHidden
                          checked={site.enabled}
                          onChange={(event) => toggle(site, event.target.checked)}
                        />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <Link href={`/sites/${site.slug}`} className="text-sm font-medium hover:underline">
                        {site.name}
                      </Link>
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
                        <Link href={editHref(site.slug)} scroll={false} className={buttonClassName('ghost', 'px-2.5 py-1.5')}>
                          Edit
                        </Link>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* < 640 px: cards */}
      <ul className="flex flex-col gap-3 sm:hidden">
        {optimisticRows.map((row) => {
          const { site } = row
          return (
            <li
              key={site.id}
              className={`flex items-start gap-3 rounded-lg border border-(--border-subtle) bg-(--surface-card) p-4 ${
                site.enabled ? '' : 'opacity-55'
              }`}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Link href={`/sites/${site.slug}`} className="truncate text-sm font-medium hover:underline">
                  {site.name}
                </Link>
                <p className="truncate font-mono text-xs text-(--text-muted)">{hostOf(site.url)}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-(--text-secondary)">{site.group_name ?? '—'}</span>
                  <LastStatus row={row} />
                </div>
              </div>
              {isAdmin && (
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Switch
                    id={`enabled-mobile-${site.id}`}
                    label={`Monitor ${site.name}`}
                    labelHidden
                    checked={site.enabled}
                    onChange={(event) => toggle(site, event.target.checked)}
                  />
                  <Link href={editHref(site.slug)} scroll={false} className={buttonClassName('ghost', 'px-2.5 py-1.5')}>
                    Edit
                  </Link>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
