import 'server-only'

import { getDashboardData, type DashboardData } from '@/lib/dashboard'
import { rollupDayKey } from '@/lib/format'
import { serviceClient } from '@/lib/supabase/server'
import {
  bucketAverages,
  bucketWorstStatus,
  groupedMs,
  shortDuration,
  type FeedItem,
  type HeatStatus,
  type TimedValue,
} from '@/lib/tv'
import type { CheckStatus } from '@/lib/types'

/**
 * Everything the TV wall shows, read-only. Same pattern as the overview: the
 * caller has verified the session; reads use the service role.
 *
 * Queries (all in parallel after getDashboardData):
 *  - health_checks of the last 24 h, one paged query for all sites (sparklines
 *    and the status heatmap share it)
 *    (≈ 288 rows per site; PostgREST returns at most 1000 rows per page);
 *  - incidents touching the last 24 h;
 *  - degraded_episodes started in the last 24 h or still open;
 *  - daily_rollups for today and yesterday (Bangkok days).
 */

const DAY_MS = 86_400_000
const SPARK_POINTS = 48 // 30-minute buckets over 24 h
const RAIL_POINTS = 36 // 10-minute buckets over 6 h
const PAGE = 1000

export interface TodayStats {
  up: number
  total: number
  /** Weighted mean response today / yesterday across all sites; null without samples. */
  avgMs: number | null
  avgMsYesterday: number | null
  uptimeToday: number | null
  uptime30d: number | null
  /** Downs + slow spells that started today (Bangkok). */
  incidentsToday: number
  /** Of those, still ongoing. */
  incidentsOpen: number
}

export interface TvData extends Pick<DashboardData, 'snapshots' | 'lastRunAt' | 'renderedAt'> {
  /** Per site id: 48 bucket averages over the last 24 h, oldest first. */
  sparklines: Record<string, (number | null)[]>
  /**
   * Per site id: worst status checked in each of the same 48 buckets (down rows
   * included, unlike the sparkline); null = no check in that bucket.
   */
  heatmap: Record<string, HeatStatus[]>
  /** Start of the first sparkline bucket (changes every 30 min — drives the slide-in). */
  sparkStart: string
  /** Per site id: when its open degraded spell began. */
  degradedSince: Record<string, string>
  feed: FeedItem[]
  today: TodayStats
  /** All-sites average over the last 6 h, 36 × 10-minute buckets. */
  avg6h: (number | null)[]
  /** The shared "degraded above" value, only when every site uses the same one. */
  threshold: number | null
  /** Sites recorded in the newest run (rows within a minute of it). */
  lastRunChecked: number
  /** Per-query timings in ms, for diagnostics only. */
  timings: Record<string, number>
}

interface CheckRow {
  site_id: string
  checked_at: string
  status: CheckStatus
  response_ms: number | null
}

interface IncidentRow {
  id: number
  site_id: string
  started_at: string
  resolved_at: string | null
  last_error: string | null
  http_status: number | null
}

interface EpisodeRow {
  id: number
  site_id: string
  started_at: string
  ended_at: string | null
}

interface RollupRow {
  site_id: string
  day: string
  up_count: number
  degraded_count: number
  down_count: number
  avg_response_ms: number | null
  response_sample_count: number
}

async function timed<T>(timings: Record<string, number>, name: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now()
  try {
    return await run()
  } finally {
    timings[name] = Math.round(performance.now() - started)
  }
}

async function checksSince(since: string): Promise<CheckRow[]> {
  const rows: CheckRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await serviceClient()
      .from('health_checks')
      .select('site_id, checked_at, status, response_ms')
      .gte('checked_at', since)
      .order('checked_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
      .returns<CheckRow[]>()
    if (error) throw new Error(`Could not load checks: ${error.message}`)
    rows.push(...(data ?? []))
    if ((data ?? []).length < PAGE) return rows
  }
}

function weightedAverage(rows: RollupRow[]): number | null {
  let sum = 0
  let samples = 0
  for (const row of rows) {
    if (row.avg_response_ms === null || row.response_sample_count === 0) continue
    sum += row.avg_response_ms * row.response_sample_count
    samples += row.response_sample_count
  }
  return samples > 0 ? Math.round(sum / samples) : null
}

function uptimeOf(up: number, degraded: number, down: number): number | null {
  const total = up + degraded + down
  return total > 0 ? ((up + degraded) / total) * 100 : null
}

export async function getTvData(): Promise<TvData> {
  const timings: Record<string, number> = {}
  const dashboard = await timed(timings, 'dashboard', getDashboardData)

  const now = Date.now()
  const since24h = new Date(now - DAY_MS).toISOString()
  const today = rollupDayKey(new Date(now))
  const yesterday = rollupDayKey(new Date(now - DAY_MS))
  const todayStart = Date.parse(`${today}T00:00:00+07:00`)

  const supabase = serviceClient()
  const [checks, incidentsResult, episodesResult, rollupsResult] = await Promise.all([
    timed(timings, 'checks24h', () => checksSince(since24h)),
    timed(timings, 'incidents', async () =>
      supabase
        .from('incidents')
        .select('id, site_id, started_at, resolved_at, last_error, http_status')
        .or(`started_at.gte.${since24h},resolved_at.gte.${since24h},resolved_at.is.null`)
        .returns<IncidentRow[]>(),
    ),
    timed(timings, 'degraded', async () =>
      supabase
        .from('degraded_episodes')
        .select('id, site_id, started_at, ended_at')
        .or(`started_at.gte.${since24h},ended_at.is.null`)
        .returns<EpisodeRow[]>(),
    ),
    timed(timings, 'rollups', async () =>
      supabase
        .from('daily_rollups')
        .select('site_id, day, up_count, degraded_count, down_count, avg_response_ms, response_sample_count')
        .in('day', [today, yesterday])
        .returns<RollupRow[]>(),
    ),
  ])

  // Missing tables (e.g. degraded_episodes before its migration) degrade to empty, not a crash.
  const incidents = incidentsResult.data ?? []
  const episodes = episodesResult.data ?? []
  const rollups = rollupsResult.data ?? []
  if (incidentsResult.error) console.error('[tv] incidents:', incidentsResult.error.message)
  if (episodesResult.error) console.error('[tv] degraded_episodes:', episodesResult.error.message)
  if (rollupsResult.error) console.error('[tv] rollups:', rollupsResult.error.message)

  const sites = dashboard.snapshots.map((snapshot) => snapshot.site)
  const enabled = new Set(sites.map((site) => site.id))
  const nameOf = new Map(sites.map((site) => [site.id, site.name]))
  const siteChecks = checks.filter((row) => enabled.has(row.site_id))

  // --- sparklines (24 h) and the 6 h all-sites average -------------------------------
  const sparkSize = DAY_MS / SPARK_POINTS
  const sparkStartMs = Math.floor(now / sparkSize) * sparkSize - (SPARK_POINTS - 1) * sparkSize
  const responsive = (row: CheckRow) => row.status !== 'down' && row.response_ms !== null
  const bySite = new Map<string, TimedValue[]>()
  for (const row of siteChecks) {
    if (!responsive(row)) continue
    const list = bySite.get(row.site_id) ?? []
    list.push({ at: Date.parse(row.checked_at), value: row.response_ms! })
    bySite.set(row.site_id, list)
  }
  const sparklines: Record<string, (number | null)[]> = {}
  for (const site of sites) {
    sparklines[site.id] = bucketAverages(bySite.get(site.id) ?? [], sparkStartMs, sparkSize, SPARK_POINTS)
  }

  // Status heatmap: the same buckets, from every row (down ones too).
  const statusRows = new Map<string, { at: number; status: CheckStatus }[]>()
  for (const row of siteChecks) {
    const list = statusRows.get(row.site_id) ?? []
    list.push({ at: Date.parse(row.checked_at), status: row.status })
    statusRows.set(row.site_id, list)
  }
  const heatmap: Record<string, HeatStatus[]> = {}
  for (const site of sites) {
    heatmap[site.id] = bucketWorstStatus(statusRows.get(site.id) ?? [], sparkStartMs, sparkSize, SPARK_POINTS)
  }

  const railSize = 10 * 60_000
  const railStart = Math.floor(now / railSize) * railSize - (RAIL_POINTS - 1) * railSize
  const avg6h = bucketAverages([...bySite.values()].flat(), railStart, railSize, RAIL_POINTS)
  const thresholds = new Set(sites.map((site) => site.expected_ms))
  const threshold = thresholds.size === 1 ? [...thresholds][0] : null

  // --- incident feed (24 h) ----------------------------------------------------------
  const feed: FeedItem[] = []
  const sinceMs = now - DAY_MS
  for (const incident of incidents) {
    const siteName = nameOf.get(incident.site_id)
    if (!siteName) continue // paused or deleted sites stay off the wall
    if (Date.parse(incident.started_at) >= sinceMs) {
      feed.push({
        id: `down-${incident.id}`,
        at: incident.started_at,
        siteName,
        kind: 'down',
        detail: incident.http_status !== null ? `HTTP ${incident.http_status}` : (incident.last_error ?? ''),
      })
    }
    if (incident.resolved_at && Date.parse(incident.resolved_at) >= sinceMs) {
      feed.push({
        id: `rec-${incident.id}`,
        at: incident.resolved_at,
        siteName,
        kind: 'recovered',
        detail: `${shortDuration(Date.parse(incident.resolved_at) - Date.parse(incident.started_at))} downtime`,
      })
    }
  }
  const degradedSince: Record<string, string> = {}
  for (const episode of episodes) {
    const siteName = nameOf.get(episode.site_id)
    if (!siteName) continue
    if (episode.ended_at === null) degradedSince[episode.site_id] = episode.started_at
    const startedMs = Date.parse(episode.started_at)
    if (startedMs < sinceMs) continue
    const first = siteChecks.find(
      (row) => row.site_id === episode.site_id && row.status === 'degraded' && Date.parse(row.checked_at) >= startedMs - 60_000,
    )
    feed.push({
      id: `deg-${episode.id}`,
      at: episode.started_at,
      siteName,
      kind: 'degraded',
      detail: first?.response_ms != null ? groupedMs(first.response_ms) : '',
    })
  }
  feed.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))

  // --- today ---------------------------------------------------------------------------
  const enabledRollups = rollups.filter((row) => enabled.has(row.site_id))
  const todayRows = enabledRollups.filter((row) => row.day === today)
  const yesterdayRows = enabledRollups.filter((row) => row.day === yesterday)
  const sum = (rows: RollupRow[], key: 'up_count' | 'degraded_count' | 'down_count') =>
    rows.reduce((total, row) => total + row[key], 0)

  let up30 = 0
  let degraded30 = 0
  let down30 = 0
  for (const snapshot of dashboard.snapshots) {
    for (const bucket of snapshot.history.slice(-30)) {
      up30 += bucket.up
      degraded30 += bucket.degraded
      down30 += bucket.down
    }
  }

  // "Incidents today" matches the feed: downs AND slow (degraded) spells that
  // STARTED today (Bangkok); "open" = those of them still ongoing.
  const downsToday = incidents.filter((row) => enabled.has(row.site_id) && Date.parse(row.started_at) >= todayStart)
  const slowToday = episodes.filter((row) => enabled.has(row.site_id) && Date.parse(row.started_at) >= todayStart)

  const todayStats: TodayStats = {
    up: 0, // filled on the client from live statuses (it ages with the clock)
    total: sites.length,
    avgMs: weightedAverage(todayRows),
    avgMsYesterday: weightedAverage(yesterdayRows),
    uptimeToday: uptimeOf(sum(todayRows, 'up_count'), sum(todayRows, 'degraded_count'), sum(todayRows, 'down_count')),
    uptime30d: uptimeOf(up30, degraded30, down30),
    incidentsToday: downsToday.length + slowToday.length,
    incidentsOpen:
      downsToday.filter((row) => row.resolved_at === null).length +
      slowToday.filter((row) => row.ended_at === null).length,
  }

  // --- checker -------------------------------------------------------------------------
  const lastRunMs = dashboard.lastRunAt ? Date.parse(dashboard.lastRunAt) : null
  const lastRunChecked =
    lastRunMs === null
      ? 0
      : new Set(
          siteChecks.filter((row) => Date.parse(row.checked_at) >= lastRunMs - 60_000).map((row) => row.site_id),
        ).size

  return {
    snapshots: dashboard.snapshots,
    lastRunAt: dashboard.lastRunAt,
    renderedAt: dashboard.renderedAt,
    sparklines,
    heatmap,
    sparkStart: new Date(sparkStartMs).toISOString(),
    degradedSince,
    feed: feed.slice(0, 20),
    today: todayStats,
    avg6h,
    threshold,
    lastRunChecked,
    timings,
  }
}
