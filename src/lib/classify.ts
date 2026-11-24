import type { CheckStatus, HealthDependency, HealthPayload } from '@/lib/types'

/**
 * The classification rules, separated from the network I/O in `checker.ts` so
 * the decision table can be reasoned about — and exercised — on its own.
 *
 * Network failures and timeouts are handled by the caller; by the time we get
 * here a response was received.
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
  expectedMs: number
}

function dependenciesOf(payload: HealthPayload): HealthDependency[] {
  return Array.isArray(payload.checks) ? payload.checks : []
}

function truncate(value: string, max = 1000): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

export function classifyResponse({
  httpStatus,
  statusText = '',
  body,
  responseMs,
  expectedMs,
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

  if (Buffer.byteLength(body, 'utf8') > MAX_PAYLOAD_BYTES) {
    return {
      status: 'degraded',
      payload: null,
      error: `Health payload exceeds ${MAX_PAYLOAD_BYTES} bytes; not stored`,
    }
  }

  let payload: HealthPayload
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Health response is not a JSON object')
    }
    payload = parsed as HealthPayload
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      status: 'degraded',
      payload: null,
      error: truncate(`Malformed health response: ${reason}`),
    }
  }

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
