import { STATUS_CODES } from 'node:http'

import {
  classifyResponse,
  combineCheck,
  pageIsOk,
  parseHealthPayload,
  type CombinedResult,
  type HealthResult,
  type PageResult,
} from './classify'
import type { HealthPayload } from './types'

/**
 * The one check, used by everything that checks a site: the cron/"Check now"
 * runner (`checker.ts`), the drawer's "Test connection", and `npm run probe`.
 *
 * Network I/O only — every decision is made by the pure functions in
 * `classify.ts`. No `server-only` and only relative imports, so the probe
 * script can run it under plain `tsx`; it never touches the database or env.
 */

export const USER_AGENT = '9ExpertMonitor/1.0 (+internal uptime check)'
/** Per-attempt network timeout. */
export const ATTEMPT_TIMEOUT_MS = 10_000
/** Cool-down before the single retry that guards against cold starts. */
export const RETRY_DELAY_MS = 2_000
/** A 5xx health body is read only up to this size (enough for any health JSON, not for an HTML error page). */
export const HEALTH_5XX_BODY_LIMIT = 16 * 1024

export interface CheckTarget {
  url: string
  health_url: string | null
  expected_ms: number
}

export interface SiteCheck extends CombinedResult {
  page: PageResult
  /** Null when the site has no health URL, or the page already failed. */
  health: HealthResult | null
  /** The health JSON, stored so the dependency chips keep working. */
  payload: HealthPayload | null
}

function truncate(value: string, max = 300): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

/** Error codes from Node's fetch (undici) live on `error.cause`, sometimes nested. */
function errorCodeOf(error: unknown): string | null {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') return code
    current = (current as { cause?: unknown }).cause
  }
  return null
}

/** Short English reason for a request that got no response. */
export function describeNetworkError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return `Timeout after ${ATTEMPT_TIMEOUT_MS / 1000} s`
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'Request aborted (run deadline reached)'
  }

  const code = errorCodeOf(error)
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
    case 'EAI_FAIL':
    case 'EAI_NONAME':
      return 'DNS lookup failed'
    case 'ECONNREFUSED':
      return 'Connection refused'
    case 'ECONNRESET':
      return 'Connection reset'
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return 'Host unreachable'
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
    case 'UND_ERR_HEADERS_TIMEOUT':
      return `Timeout after ${ATTEMPT_TIMEOUT_MS / 1000} s`
  }
  if (code && /CERT|SSL|TLS/.test(code)) return `TLS certificate error (${code})`

  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? `: ${error.cause.message}` : ''
    return truncate(`${error.message}${cause}`)
  }
  return truncate(String(error))
}

function phraseOf(response: Response): string {
  // HTTP/2 has no reason phrase on the wire, so fall back to the standard one.
  return response.statusText || STATUS_CODES[response.status] || ''
}

function signalFor(runSignal: AbortSignal): AbortSignal {
  return AbortSignal.any([AbortSignal.timeout(ATTEMPT_TIMEOUT_MS), runSignal])
}

/** One `GET {url}`. Never throws. */
async function pageOnce(url: string, runSignal: AbortSignal): Promise<PageResult> {
  const startedAt = performance.now()
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      signal: signalFor(runSignal),
    })
    // Timed at the final response's headers; the body is not needed.
    const responseMs = Math.round(performance.now() - startedAt)
    await response.body?.cancel().catch(() => {})
    return {
      httpStatus: response.status,
      statusText: phraseOf(response),
      responseMs,
      networkError: null,
    }
  } catch (error) {
    return { httpStatus: null, statusText: '', responseMs: null, networkError: describeNetworkError(error) }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })

    function finish() {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
  })
}

/**
 * The page check, retried once before it counts as a failure: cold starts and
 * transient blips are the biggest source of false alarms in a 5-minute
 * monitor. A slow page is not retried — that is real information.
 */
async function pageCheck(url: string, runSignal: AbortSignal): Promise<PageResult> {
  const first = await pageOnce(url, runSignal)
  if (pageIsOk(first) || runSignal.aborted) return first

  await sleep(RETRY_DELAY_MS, runSignal)
  if (runSignal.aborted) return first

  return pageOnce(url, runSignal)
}

/**
 * Reads at most `limit` bytes of a body; null when it is larger (the rest is
 * cancelled) or the read fails / times out (same fetch signal as the request).
 */
async function readBounded(response: Response, limit: number): Promise<string | null> {
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
    }
  } catch {
    await reader.cancel().catch(() => {})
    return null
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/** The `/api/health` contract check. One attempt; a failure here only degrades. */
async function healthCheck(url: string, runSignal: AbortSignal): Promise<HealthResult> {
  const startedAt = performance.now()

  let response: Response
  try {
    response = await fetch(url, {
      cache: 'no-store',
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: signalFor(runSignal),
    })
  } catch (error) {
    return {
      status: 'down',
      payload: null,
      error: describeNetworkError(error),
      httpStatus: null,
      responseMs: null,
    }
  }

  const responseMs = Math.round(performance.now() - startedAt)
  const httpStatus = response.status

  // A 5xx is decided by the status line alone. Its body is still read (≤ 16 KB):
  // most health endpoints answer 503 with JSON naming the failing dependency,
  // which is stored as the payload so the TV can say "DB unreachable". The
  // verdict (status / error / httpStatus) is the same with or without it.
  if (httpStatus >= 500) {
    const body = await readBounded(response, HEALTH_5XX_BODY_LIMIT)
    const parsed = body === null ? null : parseHealthPayload(body)
    return {
      status: 'down',
      payload: parsed && 'payload' in parsed ? parsed.payload : null,
      error: `HTTP ${httpStatus} ${phraseOf(response)}`.trim(),
      httpStatus,
      responseMs,
    }
  }

  let body: string
  try {
    body = await response.text()
  } catch (error) {
    return {
      status: 'degraded',
      payload: null,
      error: `Could not read health response: ${describeNetworkError(error)}`,
      httpStatus,
      responseMs,
    }
  }

  const verdict = classifyResponse({ httpStatus, statusText: phraseOf(response), body, responseMs })
  return { ...verdict, httpStatus, responseMs }
}

/**
 * Page first, then (if set, and the page answered) the health endpoint, then
 * the combined verdict. Never throws.
 */
export async function checkSite(
  target: CheckTarget,
  runSignal: AbortSignal = new AbortController().signal,
): Promise<SiteCheck> {
  const page = await pageCheck(target.url, runSignal)

  // A page that is down is down whatever its health endpoint says; skip the call.
  const health =
    target.health_url && pageIsOk(page) && !runSignal.aborted
      ? await healthCheck(target.health_url, runSignal)
      : null

  const combined = combineCheck(page, health, target.expected_ms)
  return { ...combined, page, health, payload: health?.payload ?? null }
}
