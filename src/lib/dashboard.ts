import 'server-only'

import { rollupDayKey } from '@/lib/format'
import { statusOfDay, uptimePercent } from '@/lib/status'
import { serviceClient } from '@/lib/supabase/server'
import type {
  DailyRollup,
  DayBucket,
  HealthCheck,
  Incident,
  Site,
  SiteSnapshot,
} from '@/lib/types'

export const HISTORY_DAYS = 90
export const UPTIME_WINDOW_DAYS = 30

/** Oldest first, `count` consecutive Bangkok-local day keys ending today. */
function recentDayKeys(count: number, now = new Date()): string[] {
  const keys: string[] = []
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    keys.push(rollupDayKey(new Date(now.getTime() - offset * 86_400_000)))
  }
  return keys
}

function buildHistory(rollups: DailyRollup[], days: number): DayBucket[] {
  const byDay = new Map(rollups.map((row) => [row.day, row]))

  return recentDayKeys(days).map((day) => {
    const row = byDay.get(day)
    if (!row) {
      return { day, up: 0, degraded: 0, down: 0, avgResponseMs: null, worst: null }
    }
    return {
      day,
      up: row.up_count,
      degraded: row.degraded_count,
      down: row.down_count,
      avgResponseMs: row.avg_response_ms,
      worst: statusOfDay(row.up_count, row.degraded_count, row.down_count),
    }
  })
}

function computeUptime(history: DayBucket[], windowDays: number): number | null {
  const window = history.slice(-windowDays)
  let up = 0
  let degraded = 0
  let down = 0
  for (const bucket of window) {
    up += bucket.up
    degraded += bucket.degraded
    down += bucket.down
  }
  return uptimePercent(up, degraded, down)
}

export interface DashboardData {
  snapshots: SiteSnapshot[]
  /** Newest `checked_at` across all sites — i.e. when the last run completed. */
  lastRunAt: string | null
  /**
   * Server clock at load time. The client uses it for its first render so
   * relative timestamps hydrate without a mismatch.
   */
  renderedAt: string
}

/**
 * Everything the dashboard needs for its first paint, in five parallel queries.
 * Runs on the server with the service role; nothing here reaches the browser
 * except the plain data returned.
 */
export async function getDashboardData(): Promise<DashboardData> {
  const supabase = serviceClient()
  const historyFloor = recentDayKeys(HISTORY_DAYS)[0]

  const [sitesResult, latestResult, statsResult, rollupsResult, incidentsResult] =
    await Promise.all([
      supabase
        .from('monitored_sites')
        .select('*')
        .eq('enabled', true)
        .order('sort_order', { ascending: true })
        .returns<Site[]>(),
      supabase
        .from('latest_health_checks')
        .select('*')
        .returns<HealthCheck[]>(),
      supabase
        .from('site_24h_stats')
        .select('site_id, avg_response_ms')
        .returns<{ site_id: string; avg_response_ms: number | null }[]>(),
      supabase
        .from('daily_rollups')
        .select('*')
        .gte('day', historyFloor)
        .returns<DailyRollup[]>(),
      supabase
        .from('incidents')
        .select('*')
        .is('resolved_at', null)
        .returns<Incident[]>(),
    ])

  const failure = [
    sitesResult,
    latestResult,
    statsResult,
    rollupsResult,
    incidentsResult,
  ].find((result) => result.error)

  if (failure?.error) {
    throw new Error(`Could not load dashboard data: ${failure.error.message}`)
  }

  const sites = sitesResult.data ?? []
  const latestBySite = new Map((latestResult.data ?? []).map((row) => [row.site_id, row]))
  const avgBySite = new Map(
    (statsResult.data ?? []).map((row) => [row.site_id, row.avg_response_ms]),
  )
  const incidentBySite = new Map(
    (incidentsResult.data ?? []).map((row) => [row.site_id, row]),
  )

  const rollupsBySite = new Map<string, DailyRollup[]>()
  for (const row of rollupsResult.data ?? []) {
    const list = rollupsBySite.get(row.site_id)
    if (list) list.push(row)
    else rollupsBySite.set(row.site_id, [row])
  }

  const snapshots: SiteSnapshot[] = sites.map((site) => {
    const history = buildHistory(rollupsBySite.get(site.id) ?? [], HISTORY_DAYS)
    return {
      site,
      latest: latestBySite.get(site.id) ?? null,
      avg24hMs: avgBySite.get(site.id) ?? null,
      uptime30d: computeUptime(history, UPTIME_WINDOW_DAYS),
      history,
      openIncident: incidentBySite.get(site.id) ?? null,
    }
  })

  const lastRunAt = snapshots.reduce<string | null>((newest, snapshot) => {
    const checkedAt = snapshot.latest?.checked_at
    if (!checkedAt) return newest
    return !newest || checkedAt > newest ? checkedAt : newest
  }, null)

  return { snapshots, lastRunAt, renderedAt: new Date().toISOString() }
}

export type DetailRange = '24h' | '7d' | '30d'

/** Bucket sizes chosen so every range lands at roughly 150–300 chart points. */
const RANGE_CONFIG: Record<DetailRange, { hours: number; bucketMinutes: number }> = {
  '24h': { hours: 24, bucketMinutes: 5 },
  '7d': { hours: 24 * 7, bucketMinutes: 60 },
  '30d': { hours: 24 * 30, bucketMinutes: 240 },
}

export interface SeriesPoint {
  bucket: string
  avg_response_ms: number | null
  max_response_ms: number | null
  up_count: number
  degraded_count: number
  down_count: number
}

export interface SiteDetail {
  snapshot: SiteSnapshot
  series: SeriesPoint[]
  incidents: Incident[]
  range: DetailRange
  /** Server clock at load time, so the page renders without an impure call. */
  now: number
}

export async function getSiteDetail(
  slug: string,
  range: DetailRange,
): Promise<SiteDetail | null> {
  const supabase = serviceClient()

  const { data: site, error: siteError } = await supabase
    .from('monitored_sites')
    .select('*')
    .eq('slug', slug)
    .maybeSingle<Site>()

  if (siteError) {
    throw new Error(`Could not load site ${slug}: ${siteError.message}`)
  }
  if (!site) return null

  const { hours, bucketMinutes } = RANGE_CONFIG[range]
  const since = new Date(Date.now() - hours * 3_600_000).toISOString()
  const historyFloor = recentDayKeys(HISTORY_DAYS)[0]

  const [latestResult, statsResult, rollupsResult, seriesResult, incidentsResult] =
    await Promise.all([
      supabase
        .from('latest_health_checks')
        .select('*')
        .eq('site_id', site.id)
        .maybeSingle<HealthCheck>(),
      supabase
        .from('site_24h_stats')
        .select('avg_response_ms')
        .eq('site_id', site.id)
        .maybeSingle<{ avg_response_ms: number | null }>(),
      supabase
        .from('daily_rollups')
        .select('*')
        .eq('site_id', site.id)
        .gte('day', historyFloor)
        .returns<DailyRollup[]>(),
      // No generated database types in this project, so the RPC result is
      // narrowed by hand below rather than through `.returns<T>()`.
      supabase.rpc('site_response_series', {
        p_site_id: site.id,
        p_since: since,
        p_bucket_minutes: bucketMinutes,
      }),
      supabase
        .from('incidents')
        .select('*')
        .eq('site_id', site.id)
        .order('started_at', { ascending: false })
        .limit(50)
        .returns<Incident[]>(),
    ])

  const failure = [
    latestResult,
    statsResult,
    rollupsResult,
    seriesResult,
    incidentsResult,
  ].find((result) => result.error)

  if (failure?.error) {
    throw new Error(`Could not load detail for ${slug}: ${failure.error.message}`)
  }

  const history = buildHistory(rollupsResult.data ?? [], HISTORY_DAYS)
  const incidents = incidentsResult.data ?? []

  return {
    snapshot: {
      site,
      latest: latestResult.data ?? null,
      avg24hMs: statsResult.data?.avg_response_ms ?? null,
      uptime30d: computeUptime(history, UPTIME_WINDOW_DAYS),
      history,
      openIncident: incidents.find((incident) => incident.resolved_at === null) ?? null,
    },
    series: (seriesResult.data as SeriesPoint[] | null) ?? [],
    incidents,
    range,
    now: Date.now(),
  }
}

/** Slugs for `generateStaticParams`-style enumeration and link building. */
export async function getAllSiteSlugs(): Promise<string[]> {
  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('monitored_sites')
    .select('slug')
    .returns<{ slug: string }[]>()

  if (error) throw new Error(`Could not load slugs: ${error.message}`)
  return (data ?? []).map((row) => row.slug)
}
