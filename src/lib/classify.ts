import type { CheckStatus, HealthDependency, HealthPayload } from './types'

/**
 * The classification rules, separated from the network I/O in `probe.ts` so
 * the decision table can be reasoned about — and exercised — on its own.
 * Pure functions only: no fetch, no clock, no database. (Relative import
 * above so `scripts/probe.ts` can load this outside Next.js.)
 *
 * Two layers:
 *  - `classifyResponse()` — the `/api/health` JSON contract, unchanged.
 *  - `combineCheck()`     — page-first: the page decides up/down, then speed
 *                           and the optional health check decide degraded.
 */

/** Health payloads are small by contract; anything larger is not stored. */
export const MAX_PAYLOAD_BYTES = 64 * 1024

export interface Classification {
  status: CheckStatus
  payload: HealthPayload | null
  /** Why it is not `up`, or null when it is. */
  error: string | null
}

export interface ClassifyInput {
  httpStatus: number
  statusText?: string
  body: string
  responseMs: number
  /**
   * Optional. Since page-first checks, "too slow" is judged on the page's
   * response time in `combineCheck()`; the health call is not timed against it.
   */
  expectedMs?: number
}

function dependenciesOf(payload: HealthPayload): HealthDependency[] {
  return Array.isArray(payload.checks) ? payload.checks : []
}

function truncate(value: string, max = 1000): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

/**
 * The one parser for a health body: a JSON object within MAX_PAYLOAD_BYTES.
 * Used by `classifyResponse()` and, for a 5xx, by the probe (payload only).
 */
export function parseHealthPayload(body: string): { payload: HealthPayload } | { error: string } {
  if (Buffer.byteLength(body, 'utf8') > MAX_PAYLOAD_BYTES) {
    return { error: `Health payload exceeds ${MAX_PAYLOAD_BYTES} bytes; not stored` }
  }
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Health response is not a JSON object')
    }
    return { payload: parsed as HealthPayload }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { error: truncate(`Malformed health response: ${reason}`) }
  }
}

export function classifyResponse({
  httpStatus,
  statusText = '',
  body,
  responseMs,
  expectedMs = Number.POSITIVE_INFINITY,
}: ClassifyInput): Classification {
  const httpLabel = `HTTP ${httpStatus} ${statusText}`.trim()

  if (httpStatus >= 500) {
    return { status: 'down', payload: null, error: httpLabel }
  }

  // Anything that is not a 2xx is not a health report, but it is also not the
  // >= 500 / network failure that the spec reserves `down` for. Treat it as
  // degraded so a mis-deployed or auth-walled endpoint is visible without
  // firing an incident.
  if (httpStatus < 200 || httpStatus >= 300) {
    return { status: 'degraded', payload: null, error: httpLabel }
  }

  const parsed = parseHealthPayload(body)
  if ('error' in parsed) return { status: 'degraded', payload: null, error: parsed.error }
  const { payload } = parsed

  const reasons: string[] = []

  if (payload.status !== 'ok') {
    reasons.push(`reported status "${String(payload.status ?? 'missing')}"`)
  }

  for (const dependency of dependenciesOf(payload)) {
    if (dependency?.status !== 'ok') {
      const name = dependency?.name ?? 'unnamed check'
      reasons.push(`${name} is "${String(dependency?.status ?? 'missing')}"`)
    }
  }

  if (responseMs > expectedMs) {
    reasons.push(`responded in ${responseMs}ms (expected < ${expectedMs}ms)`)
  }

  return {
    status: reasons.length > 0 ? 'degraded' : 'up',
    // A degraded payload is still worth storing — it is what the chips render.
    payload,
    error: reasons.length > 0 ? truncate(reasons.join('; ')) : null,
  }
}

// ---------------------------------------------------------------------------
// Page-first combination
// ---------------------------------------------------------------------------

/** What the `GET {url}` produced. */
export interface PageResult {
  /** Final status after redirects, or null when no response arrived. */
  httpStatus: number | null
  /** Reason phrase for `httpStatus` ('' when unknown). */
  statusText: string
  /** Time to the final response's headers, or null when none arrived. */
  responseMs: number | null
  /** Network-level failure ("DNS lookup failed", "Timeout after 10 s"), if any. */
  networkError: string | null
}

/** What the optional health check produced. */
export interface HealthResult extends Classification {
  httpStatus: number | null
  responseMs: number | null
}

/** Which explanation the UI should show. The text lives in `messages.ts`. */
export type CheckMessage =
  | { key: 'page_down'; reason: string }
  | { key: 'slow_page'; expectedMs: number; responseMs: number }
  | { key: 'health_problem'; reason: string }

export interface CombinedResult {
  status: CheckStatus
  /** English text stored in `health_checks.error`; null when up. */
  error: string | null
  message: CheckMessage | null
}

export function pageIsOk(page: PageResult): boolean {
  return page.httpStatus !== null && page.httpStatus >= 200 && page.httpStatus < 300
}

/** "HTTP 503 · Service Unavailable", or "HTTP 599" without a known phrase. */
export function describeHttpFailure(httpStatus: number, statusText: string): string {
  const phrase = statusText.trim()
  return phrase ? `HTTP ${httpStatus} · ${phrase}` : `HTTP ${httpStatus}`
}

/** One-line reason a health check is not OK, for the "health problem" message. */
export function healthReasonOf(health: HealthResult): string {
  return health.error ?? `health check returned "${health.status}"`
}

/**
 * The decision table (section 1.3 of the round-3 spec):
 *
 * | page                     | health                  | result                     |
 * | ------------------------ | ----------------------- | -------------------------- |
 * | not 2xx / no response    | (not consulted)         | down      · page_down      |
 * | 2xx, slower than expected| any                     | degraded  · slow_page      |
 * | 2xx                      | failing / bad dependency| degraded  · health_problem |
 * | 2xx                      | ok, or no health URL    | up                         |
 *
 * When the page is both slow and the health check fails, the slow page wins the
 * message and the stored error carries both reasons.
 */
export function combineCheck(
  page: PageResult,
  health: HealthResult | null,
  expectedMs: number,
): CombinedResult {
  if (!pageIsOk(page)) {
    const reason =
      page.networkError ??
      (page.httpStatus !== null
        ? describeHttpFailure(page.httpStatus, page.statusText)
        : 'No response')
    return { status: 'down', error: truncate(reason), message: { key: 'page_down', reason } }
  }

  const healthProblem = health !== null && health.status !== 'up' ? healthReasonOf(health) : null

  if (page.responseMs !== null && page.responseMs > expectedMs) {
    const slow = `Page responded in ${page.responseMs} ms (expected < ${expectedMs} ms)`
    return {
      status: 'degraded',
      error: truncate(healthProblem ? `${slow}; health: ${healthProblem}` : slow),
      message: { key: 'slow_page', expectedMs, responseMs: page.responseMs },
    }
  }

  if (healthProblem) {
    return {
      status: 'degraded',
      error: truncate(healthProblem),
      message: { key: 'health_problem', reason: healthProblem },
    }
  }

  return { status: 'up', error: null, message: null }
}
