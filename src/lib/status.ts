import type { CheckStatus, DisplayStatus, HealthCheck } from './types'

/**
 * A check older than this is not trustworthy — the scheduler runs every 5
 * minutes, so 15 minutes means three consecutive misses. Past that we render
 * `stale` rather than repeating an "up" that nobody has verified recently.
 */
export const STALE_AFTER_MS = 15 * 60 * 1000

const SEVERITY: Record<DisplayStatus, number> = {
  up: 0,
  stale: 1,
  degraded: 2,
  down: 3,
}

export function worseOf<T extends DisplayStatus>(a: T, b: T): T {
  return SEVERITY[a] >= SEVERITY[b] ? a : b
}

export function isStale(checkedAt: string | null | undefined, now = Date.now()): boolean {
  if (!checkedAt) return true
  const ts = Date.parse(checkedAt)
  return Number.isNaN(ts) || now - ts > STALE_AFTER_MS
}

/**
 * What the UI should show for a site. Never returns `up` from a check that has
 * gone stale — a monitor that lies when it stops running is worse than no
 * monitor at all.
 */
export function displayStatusOf(
  latest: Pick<HealthCheck, 'status' | 'checked_at'> | null | undefined,
  now = Date.now(),
): DisplayStatus {
  if (!latest) return 'stale'
  return isStale(latest.checked_at, now) ? 'stale' : latest.status
}

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  up: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
  stale: 'No recent data',
}

/**
 * Status colours are paired with a distinct dot shape in <StatusDot>, so the
 * four states stay distinguishable without relying on hue.
 */
export const STATUS_COLOR: Record<DisplayStatus, string> = {
  up: 'var(--status-up)',
  degraded: 'var(--status-degraded)',
  down: 'var(--status-down)',
  stale: 'var(--status-stale)',
}

/** Classifies one dependency chip from `payload.checks[]`. */
export function dependencyStatus(raw: string | undefined | null): 'ok' | 'warn' {
  return (raw ?? '').toLowerCase() === 'ok' ? 'ok' : 'warn'
}

/** Uptime treats `degraded` as available — the site answered, just slowly. */
export function uptimePercent(up: number, degraded: number, down: number): number | null {
  const total = up + degraded + down
  if (total === 0) return null
  return ((up + degraded) / total) * 100
}

export function statusOfDay(
  up: number,
  degraded: number,
  down: number,
): CheckStatus | null {
  if (down > 0) return 'down'
  if (degraded > 0) return 'degraded'
  if (up > 0) return 'up'
  return null
}
