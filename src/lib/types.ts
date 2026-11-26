/** The four states a card can be in. `stale` is derived, never stored. */
export type CheckStatus = 'up' | 'degraded' | 'down'
export type DisplayStatus = CheckStatus | 'stale'

/** A row of `monitored_sites`. */
export interface Site {
  id: string
  slug: string
  name: string
  /** The page that is always checked (https only). */
  url: string
  /** Optional JSON health endpoint (in-house projects). Null = page check only. */
  health_url: string | null
  group_name: string | null
  expected_ms: number
  enabled: boolean
  /** Whether a down incident sends alerts (used from round 4). */
  alert_enabled: boolean
  sort_order: number
  created_at: string
  updated_at: string
  created_by: string | null
  /** Object path in the `site-logos` bucket (round 10). Absent before that migration. */
  logo_path?: string | null
  /** Draw the logo as a white silhouette (round 10; default true). */
  logo_mono?: boolean
}

/** One dependency reported by a monitored project's /api/health. */
export interface HealthDependency {
  name: string
  status: string
  response_ms?: number | null
  error?: string | null
}

/** The response contract every monitored project must implement. */
export interface HealthPayload {
  status?: string
  checks?: HealthDependency[]
  version?: string
  [key: string]: unknown
}

/** A row of `health_checks`. */
export interface HealthCheck {
  id: number
  site_id: string
  checked_at: string
  status: CheckStatus
  http_status: number | null
  response_ms: number | null
  payload: HealthPayload | null
  error: string | null
  /** The health endpoint's own status / timing, when one ran. `http_status` and `response_ms` are the page's. */
  health_http_status?: number | null
  health_ms?: number | null
}

/** A row of `daily_rollups`. */
export interface DailyRollup {
  site_id: string
  day: string
  up_count: number
  degraded_count: number
  down_count: number
  avg_response_ms: number | null
  response_sample_count: number
}

/** A row of `incidents`. */
export interface Incident {
  id: number
  site_id: string
  started_at: string
  resolved_at: string | null
  last_error: string | null
  http_status: number | null
}

/** Everything the dashboard needs to render one card. */
export interface SiteSnapshot {
  site: Site
  latest: HealthCheck | null
  /** Mean response_ms over the last 24h, or null if nothing was measured. */
  avg24hMs: number | null
  /** 0–100, or null if there is no rollup data yet. */
  uptime30d: number | null
  /** Oldest first, exactly 90 entries, one per day, `null` where no data exists. */
  history: DayBucket[]
  openIncident: Incident | null
}

export interface DayBucket {
  day: string
  up: number
  degraded: number
  down: number
  avgResponseMs: number | null
  /** Worst status recorded that day, or null when nothing was recorded. */
  worst: CheckStatus | null
}

/** What `POST /api/checks/run` returns. */
export interface RunSummary {
  checked: number
  up: number
  degraded: number
  down: number
  duration_ms: number
}
