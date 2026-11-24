import 'server-only'

import { displayStatusOf } from '@/lib/status'
import { serviceClient } from '@/lib/supabase/server'
import type { DisplayStatus, HealthCheck, Site } from '@/lib/types'

export interface SiteListRow {
  site: Site
  /** Latest-check status; ignored in the UI for paused sites. */
  status: DisplayStatus
}

/** Group, then name — the order of the Sites table and the dashboard. */
export function compareSites(a: Site, b: Site): number {
  const group = (a.group_name ?? '￿').localeCompare(b.group_name ?? '￿')
  return group !== 0 ? group : a.name.localeCompare(b.name)
}

/** Every site, paused ones included, with its latest status. */
export async function listSites(): Promise<SiteListRow[]> {
  const supabase = serviceClient()
  const [sitesResult, latestResult] = await Promise.all([
    supabase.from('monitored_sites').select('*').returns<Site[]>(),
    supabase
      .from('latest_health_checks')
      .select('site_id, status, checked_at')
      .returns<Pick<HealthCheck, 'site_id' | 'status' | 'checked_at'>[]>(),
  ])

  if (sitesResult.error) throw new Error(`Could not load sites: ${sitesResult.error.message}`)
  if (latestResult.error) throw new Error(`Could not load statuses: ${latestResult.error.message}`)

  const latestBySite = new Map((latestResult.data ?? []).map((row) => [row.site_id, row]))
  const now = Date.now()

  return (sitesResult.data ?? [])
    .slice()
    .sort(compareSites)
    .map((site) => ({ site, status: displayStatusOf(latestBySite.get(site.id), now) }))
}
