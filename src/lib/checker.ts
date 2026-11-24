import 'server-only'

import { classifyResponse } from '@/lib/classify'
import { getNotifier, notifySafely } from '@/lib/notifier'
import { serviceClient } from '@/lib/supabase/server'
import type {
  CheckStatus,
  HealthPayload,
  Incident,
  RunSummary,
  Site,
} from '@/lib/types'

/** Per-attempt network timeout. */
const ATTEMPT_TIMEOUT_MS = 10_000
/** Cool-down before the single retry that guards against cold starts. */
const RETRY_DELAY_MS = 2_000
/**
 * Hard ceiling for the whole run. Worst case for one site is
 * 10s + 2s + 10s = 22s, and every site runs in parallel, so this only bites if
 * the platform itself is struggling. It exists so the route always gets to
 * write its results and return rather than being killed mid-flight by Vercel.
 */
const RUN_DEADLINE_MS = 45_000

interface Probe {
  status: CheckStatus
  httpStatus: number | null
  responseMs: number | null
  payload: HealthPayload | null
  error: string | null
}

/** Shape returned by the `record_health_check` Postgres function. */
interface RecordOutcome {
  check_id: number
  incident_event: 'opened' | 'resolved' | null
  incident_id: number | null
  incident_started_at: string | null
  incident_resolved_at: string | null
  incident_last_error: string | null
  incident_http_status: number | null
}

function truncate(value: string, max = 1000): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function describeError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return `Timed out after ${ATTEMPT_TIMEOUT_MS}ms`
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'Request aborted (run deadline reached)'
  }
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? `: ${error.cause.message}` : ''
    return truncate(`${error.message}${cause}`)
  }
  return truncate(String(error))
}

/**
 * One attempt against one site. Never throws — a thrown network error is a
 * result, not an exception, as far as the run is concerned.
 */
async function probeOnce(site: Site, runSignal: AbortSignal): Promise<Probe> {
  const startedAt = performance.now()

  let response: Response
  try {
    response = await fetch(site.health_url, {
      cache: 'no-store',
      redirect: 'follow',
      headers: { accept: 'application/json', 'user-agent': '9exp-monitor/1.0' },
      signal: AbortSignal.any([
        AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        runSignal,
      ]),
    })
  } catch (error) {
    return {
      status: 'down',
      httpStatus: null,
      responseMs: Math.round(performance.now() - startedAt),
      payload: null,
      error: describeError(error),
    }
  }

  const responseMs = Math.round(performance.now() - startedAt)
  const httpStatus = response.status

  // A 5xx is decided by the status line alone, so there is no reason to pull
  // an error page's body across the wire.
  if (httpStatus >= 500) {
    return {
      status: 'down',
      httpStatus,
      responseMs,
      payload: null,
      error: `HTTP ${httpStatus} ${response.statusText}`.trim(),
    }
  }

  // Read the body defensively: a hung stream on an otherwise-successful
  // response should not escape as an unhandled rejection.
  let body: string
  try {
    body = await response.text()
  } catch (error) {
    return {
      status: 'degraded',
      httpStatus,
      responseMs,
      payload: null,
      error: `Could not read response body: ${describeError(error)}`,
    }
  }

  const verdict = classifyResponse({
    httpStatus,
    statusText: response.statusText,
    body,
    responseMs,
    expectedMs: site.expected_ms,
  })

  return { ...verdict, httpStatus, responseMs }
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
 * Probe a site, retrying once before committing to `down`.
 *
 * Cold starts and transient network blips are the single biggest source of
 * false alarms in a 5-minute monitor, so `down` has to survive two attempts
 * two seconds apart. `degraded` is not retried — a slow or unhealthy response
 * is real information and re-measuring it would only hide it.
 */
async function probeSite(site: Site, runSignal: AbortSignal): Promise<Probe> {
  const first = await probeOnce(site, runSignal)
  if (first.status !== 'down' || runSignal.aborted) return first

  await sleep(RETRY_DELAY_MS, runSignal)
  if (runSignal.aborted) return first

  const second = await probeOnce(site, runSignal)
  if (second.status === 'down') {
    return { ...second, error: second.error ?? first.error }
  }
  return second
}

async function recordAndNotify(site: Site, probe: Probe): Promise<void> {
  const supabase = serviceClient()

  // `record_health_check` returns a composite type, so PostgREST hands back a
  // single object rather than an array.
  const { data, error } = await supabase.rpc('record_health_check', {
    p_site_id: site.id,
    p_status: probe.status,
    p_http_status: probe.httpStatus,
    p_response_ms: probe.responseMs,
    p_payload: probe.payload,
    p_error: probe.error,
  })

  if (error) {
    throw new Error(`Failed to record check for ${site.slug}: ${error.message}`)
  }

  const outcome = data as RecordOutcome | null
  if (!outcome?.incident_event || outcome.incident_id === null) return

  const incident: Incident = {
    id: outcome.incident_id,
    site_id: site.id,
    started_at: outcome.incident_started_at ?? new Date().toISOString(),
    resolved_at: outcome.incident_resolved_at,
    last_error: outcome.incident_last_error,
    http_status: outcome.incident_http_status,
  }

  const notifier = getNotifier()
  if (outcome.incident_event === 'opened') {
    await notifySafely(
      () => notifier.onIncidentOpened(site, incident),
      `onIncidentOpened(${site.slug})`,
    )
  } else {
    await notifySafely(
      () => notifier.onIncidentResolved(site, incident),
      `onIncidentResolved(${site.slug})`,
    )
  }
}

/**
 * Run every enabled site and persist the results.
 *
 * Shared by `POST /api/checks/run` (cron secret) and the dashboard's
 * "Check now" server action, so both paths behave identically.
 */
export async function runChecks(): Promise<RunSummary> {
  const startedAt = performance.now()
  const supabase = serviceClient()

  const { data: sites, error } = await supabase
    .from('monitored_sites')
    .select('*')
    .eq('enabled', true)
    .order('sort_order', { ascending: true })
    .returns<Site[]>()

  if (error) {
    throw new Error(`Could not load monitored sites: ${error.message}`)
  }

  const deadline = new AbortController()
  const deadlineTimer = setTimeout(
    () => deadline.abort(new DOMException('Run deadline reached', 'AbortError')),
    RUN_DEADLINE_MS,
  )

  const tally: Record<CheckStatus, number> = { up: 0, degraded: 0, down: 0 }

  try {
    const results = await Promise.allSettled(
      (sites ?? []).map(async (site) => {
        const probe = await probeSite(site, deadline.signal)
        await recordAndNotify(site, probe)
        return probe.status
      }),
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        tally[result.value] += 1
      } else {
        // A site whose row could not be written is not a site that was checked.
        // Log it and leave it out of the tally rather than inventing a status.
        console.error('[checker] site failed:', result.reason)
      }
    }
  } finally {
    clearTimeout(deadlineTimer)
  }

  return {
    checked: tally.up + tally.degraded + tally.down,
    up: tally.up,
    degraded: tally.degraded,
    down: tally.down,
    duration_ms: Math.round(performance.now() - startedAt),
  }
}

/** Deletes `health_checks` rows older than `retainDays`. */
export async function pruneChecks(retainDays = 30): Promise<{ deleted: number }> {
  const supabase = serviceClient()
  const { data, error } = await supabase.rpc('prune_health_checks', {
    p_retain_days: retainDays,
  })

  if (error) {
    throw new Error(`Prune failed: ${error.message}`)
  }

  return { deleted: typeof data === 'number' ? data : 0 }
}
