import 'server-only'

import { refreshCertificates } from '@/lib/cert-store'
import { notifyAfterCheck } from '@/lib/notify/engine'
import { loadNotificationSettings, type NotificationSettings } from '@/lib/notify/slack'
import { checkSite, type SiteCheck } from '@/lib/probe'
import { serviceClient } from '@/lib/supabase/server'
import type { CheckStatus, RunSummary, Site } from '@/lib/types'

/**
 * Hard ceiling for the whole run. Worst case for one site is a page check with
 * its retry (10s + 2s + 10s) plus one health call (10s) = 32s, and every site
 * runs in parallel, so this only bites if the platform itself is struggling.
 * It exists so the route always gets to write its results and return rather
 * than being killed mid-flight by Vercel.
 */
const RUN_DEADLINE_MS = 45_000

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

async function recordAndNotify(
  site: Site,
  check: SiteCheck,
  settings: NotificationSettings | null,
): Promise<void> {
  const supabase = serviceClient()

  // `record_health_check` returns a composite type, so PostgREST hands back a
  // single object rather than an array.
  // `http_status` / `response_ms` are the PAGE's; the health call has its own columns.
  const { data, error } = await supabase.rpc('record_health_check', {
    p_site_id: site.id,
    p_status: check.status,
    p_http_status: check.page.httpStatus,
    p_response_ms: check.page.responseMs,
    p_payload: check.payload,
    p_error: check.error,
    p_health_http_status: check.health?.httpStatus ?? null,
    p_health_ms: check.health?.responseMs ?? null,
  })

  if (error) {
    throw new Error(`Failed to record check for ${site.slug}: ${error.message}`)
  }

  const outcome = data as RecordOutcome | null

  // Slack: decided from the recorded transition. Never throws into the run.
  await notifyAfterCheck(settings, site, check, outcome)
}

/**
 * Run every enabled site and persist the results.
 *
 * Shared by `POST /api/checks/run` (cron secret) and the dashboard's
 * "Check now" server action, so both paths behave identically.
 */
export async function runChecks(): Promise<RunSummary> {
  const startedAt = performance.now()
  const deadlineAt = Date.now() + RUN_DEADLINE_MS
  const supabase = serviceClient()

  const { data: sites, error } = await supabase
    .from('monitored_sites')
    .select('*')
    .eq('enabled', true)
    .returns<Site[]>()

  if (error) {
    throw new Error(`Could not load monitored sites: ${error.message}`)
  }

  // Read once per run; null (e.g. migration not applied) simply means no Slack.
  const settings = await loadNotificationSettings()

  const deadline = new AbortController()
  const deadlineTimer = setTimeout(
    () => deadline.abort(new DOMException('Run deadline reached', 'AbortError')),
    RUN_DEADLINE_MS,
  )

  const tally: Record<CheckStatus, number> = { up: 0, degraded: 0, down: 0 }

  try {
    const results = await Promise.allSettled(
      (sites ?? []).map(async (site) => {
        const check = await checkSite(site, deadline.signal)
        await recordAndNotify(site, check, settings)
        return check.status
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

    // SSL expiry: certificates older than 24 h, inside what is left of the deadline. Never throws.
    await refreshCertificates(sites ?? [], settings, deadlineAt)
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
