import 'server-only'

import {
  deliver,
  inQuietHours,
  loadNotificationSettings,
  logDelivery,
  type NotificationSettings,
} from '@/lib/notify/slack'
import type { SiteCheck } from '@/lib/probe'
import { serviceClient } from '@/lib/supabase/server'
import type { Incident, Site } from '@/lib/types'

/**
 * When to post. Called by the checker after each site's result is recorded,
 * and by the watchdog route for "checker stopped".
 *
 * Exactly-once: every post is preceded by an atomic claim on a stamp column
 * (`update … set x = now() where x is null returning`). Two overlapping runs
 * race on the claim; only the winner posts. If the post itself fails, the
 * claim is released so the next run (5 min later) tries again.
 *
 * Rules (all Asia/Bangkok):
 *  - down:      on a confirmed down (the page check's retry), if slack_enabled,
 *               rule_down and the site's alert_enabled. In quiet hours it is
 *               suppressed — unless the site is still down after
 *               quiet_override_minutes, then it is posted once, marked
 *               "during quiet hours". A down still unposted when quiet hours
 *               end is posted then.
 *  - recover:   only if that incident's down was posted. Not held back by quiet
 *               hours — a posted down always gets its all-clear.
 *  - degraded:  after degraded_minutes of continuous degraded checks, once per spell.
 *  - alert_enabled = false: nothing is posted; incidents are still recorded.
 */

/** The page check retries once before recording down (see probe.ts). */
const PAGE_CHECK_RETRIES = 1

type IncidentRow = Incident & {
  notified_at: string | null
  override_notified_at: string | null
  quiet_suppressed_at: string | null
  recover_notified_at: string | null
}

interface DegradedEpisode {
  id: number
  started_at: string
  notified_at: string | null
  quiet_suppressed_at: string | null
}

/** Sets `column = now()` on one row if it is still null. True if this caller won. */
async function claim(
  table: 'incidents' | 'degraded_episodes',
  id: number,
  column: string,
): Promise<boolean> {
  const { data, error } = await serviceClient()
    .from(table)
    .update({ [column]: new Date().toISOString() })
    .eq('id', id)
    .is(column, null)
    .select('id')
  if (error) {
    console.error(`[notify] claim ${table}.${column} failed:`, error.message)
    return false
  }
  return (data ?? []).length === 1
}

async function release(table: 'incidents' | 'degraded_episodes', id: number, column: string) {
  await serviceClient().from(table).update({ [column]: null }).eq('id', id)
}

function minutesSince(iso: string, now: Date): number {
  return (now.getTime() - Date.parse(iso)) / 60_000
}

function alertsOn(settings: NotificationSettings, site: Site): boolean {
  return settings.slack_enabled && site.alert_enabled
}

// --- down / still down ----------------------------------------------------------

async function loadIncident(id: number): Promise<IncidentRow | null> {
  const { data } = await serviceClient().from('incidents').select('*').eq('id', id).maybeSingle<IncidentRow>()
  return data
}

async function loadOpenIncident(siteId: string): Promise<IncidentRow | null> {
  const { data } = await serviceClient()
    .from('incidents')
    .select('*')
    .eq('site_id', siteId)
    .is('resolved_at', null)
    .maybeSingle<IncidentRow>()
  return data
}

/**
 * A down incident that has not been posted yet: post it now, suppress it for
 * quiet hours (logged once), or post the quiet-hours override.
 */
async function handleDown(settings: NotificationSettings, site: Site, incident: IncidentRow, now: Date, opened: boolean) {
  if (incident.notified_at || incident.override_notified_at) return

  if (!alertsOn(settings, site) || !settings.rule_down) {
    // Log the decision once, on the transition — not on every 5-minute run.
    if (opened) {
      await logDelivery({ event: 'down', status: 'skipped_disabled', siteId: site.id, incidentKey: `down:${incident.id}` })
    }
    return
  }

  const event = {
    kind: 'down' as const,
    siteName: site.name,
    siteSlug: site.slug,
    error: incident.last_error,
    httpStatus: incident.http_status,
    startedAt: incident.started_at,
    retries: PAGE_CHECK_RETRIES,
  }

  if (inQuietHours(settings, now)) {
    if (minutesSince(incident.started_at, now) >= settings.quiet_override_minutes) {
      if (await claim('incidents', incident.id, 'override_notified_at')) {
        const result = await deliver(settings, { ...event, duringQuietHours: true }, {
          siteId: site.id,
          incidentKey: `down-override:${incident.id}`,
        })
        if (!result.ok) await release('incidents', incident.id, 'override_notified_at')
      }
    } else if (await claim('incidents', incident.id, 'quiet_suppressed_at')) {
      await logDelivery({ event: 'down', status: 'suppressed_quiet', siteId: site.id, incidentKey: `down:${incident.id}` })
    }
    return
  }

  if (await claim('incidents', incident.id, 'notified_at')) {
    const result = await deliver(settings, event, { siteId: site.id, incidentKey: `down:${incident.id}` })
    if (!result.ok) await release('incidents', incident.id, 'notified_at')
  }
}

// --- recover ---------------------------------------------------------------------

async function handleRecover(settings: NotificationSettings, site: Site, incident: IncidentRow) {
  const downWasPosted = Boolean(incident.notified_at || incident.override_notified_at)
  if (!downWasPosted || !incident.resolved_at) return

  if (!alertsOn(settings, site) || !settings.rule_recover) {
    await logDelivery({ event: 'recover', status: 'skipped_disabled', siteId: site.id, incidentKey: `recover:${incident.id}` })
    return
  }

  if (await claim('incidents', incident.id, 'recover_notified_at')) {
    const result = await deliver(
      settings,
      {
        kind: 'recover',
        siteName: site.name,
        siteSlug: site.slug,
        startedAt: incident.started_at,
        resolvedAt: incident.resolved_at,
      },
      { siteId: site.id, incidentKey: `recover:${incident.id}` },
    )
    if (!result.ok) await release('incidents', incident.id, 'recover_notified_at')
  }
}

// --- degraded spells -------------------------------------------------------------

async function openEpisode(siteId: string): Promise<DegradedEpisode | null> {
  const supabase = serviceClient()
  const select = () =>
    supabase
      .from('degraded_episodes')
      .select('id, started_at, notified_at, quiet_suppressed_at')
      .eq('site_id', siteId)
      .is('ended_at', null)
      .maybeSingle<DegradedEpisode>()

  const existing = await select()
  if (existing.data) return existing.data

  const inserted = await supabase
    .from('degraded_episodes')
    .insert({ site_id: siteId })
    .select('id, started_at, notified_at, quiet_suppressed_at')
    .maybeSingle<DegradedEpisode>()
  if (inserted.data) return inserted.data
  // Lost the race to a concurrent run (one open episode per site): read theirs.
  return (await select()).data
}

async function closeEpisode(siteId: string) {
  await serviceClient()
    .from('degraded_episodes')
    .update({ ended_at: new Date().toISOString() })
    .eq('site_id', siteId)
    .is('ended_at', null)
}

async function handleDegraded(settings: NotificationSettings, site: Site, check: SiteCheck, now: Date) {
  const episode = await openEpisode(site.id)
  if (!episode || episode.notified_at) return
  if (!alertsOn(settings, site) || !settings.rule_degraded) return

  const minutes = minutesSince(episode.started_at, now)
  if (minutes < settings.degraded_minutes) return

  if (inQuietHours(settings, now)) {
    if (await claim('degraded_episodes', episode.id, 'quiet_suppressed_at')) {
      await logDelivery({ event: 'degraded', status: 'suppressed_quiet', siteId: site.id, incidentKey: `degraded:${episode.id}` })
    }
    return
  }

  if (await claim('degraded_episodes', episode.id, 'notified_at')) {
    const result = await deliver(
      settings,
      {
        kind: 'degraded',
        siteName: site.name,
        siteSlug: site.slug,
        minutes: settings.degraded_minutes,
        responseMs: check.page.responseMs,
        expectedMs: site.expected_ms,
        reason: check.message?.key === 'health_problem' ? check.message.reason : null,
      },
      { siteId: site.id, incidentKey: `degraded:${episode.id}` },
    )
    if (!result.ok) await release('degraded_episodes', episode.id, 'notified_at')
  }
}

// --- entry points ------------------------------------------------------------------

export interface RecordedOutcome {
  incident_event: 'opened' | 'resolved' | null
  incident_id: number | null
}

/** After one site's check is recorded. Never throws. */
export async function notifyAfterCheck(
  settings: NotificationSettings | null,
  site: Site,
  check: SiteCheck,
  outcome: RecordedOutcome | null,
  now = new Date(),
): Promise<void> {
  if (!settings) return
  try {
    if (check.status === 'degraded') await handleDegraded(settings, site, check, now)
    else await closeEpisode(site.id)

    if (outcome?.incident_event === 'resolved' && outcome.incident_id !== null) {
      const incident = await loadIncident(outcome.incident_id)
      if (incident) await handleRecover(settings, site, incident)
    } else if (check.status === 'down') {
      const incident =
        outcome?.incident_event === 'opened' && outcome.incident_id !== null
          ? await loadIncident(outcome.incident_id)
          : await loadOpenIncident(site.id)
      if (incident) await handleDown(settings, site, incident, now, outcome?.incident_event === 'opened')
    }
  } catch (error) {
    console.error(`[notify] ${site.slug} failed:`, error instanceof Error ? error.message : error)
  }
}

export interface WatchdogResult {
  stalled: boolean
  newestResultAt: string | null
  minutesSinceNewest: number | null
  action: 'none' | 'posted' | 'failed' | 'already_posted' | 'suppressed_quiet' | 'already_suppressed' | 'disabled' | 'no_sites' | 'no_settings'
}

/**
 * "Checker stopped": the newest check result is older than stalled_minutes.
 * One post per stall — keyed by that newest result's timestamp, so a stall is
 * posted once however often the watchdog runs, and a new stall (after the
 * checker resumed and stopped again) posts again.
 */
export async function runWatchdog(now = new Date()): Promise<WatchdogResult> {
  const supabase = serviceClient()
  const settings = await loadNotificationSettings()

  const [{ count: enabledSites }, newestResult] = await Promise.all([
    supabase.from('monitored_sites').select('id', { count: 'exact', head: true }).eq('enabled', true),
    supabase
      .from('health_checks')
      .select('checked_at')
      .order('checked_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ checked_at: string }>(),
  ])

  const newest = newestResult.data?.checked_at ?? null
  const minutes = newest ? Math.round(((now.getTime() - Date.parse(newest)) / 60_000) * 10) / 10 : null
  const base = { newestResultAt: newest, minutesSinceNewest: minutes }

  if (!settings) return { stalled: false, ...base, action: 'no_settings' }
  if (!enabledSites) return { stalled: false, ...base, action: 'no_sites' }

  const stalled = minutes === null || minutes >= settings.stalled_minutes
  if (!stalled) return { stalled, ...base, action: 'none' }
  if (!settings.slack_enabled || !settings.rule_checker_stalled) return { stalled, ...base, action: 'disabled' }

  // The stall's identity: the newest result it started after ("never" = epoch).
  const stamp = newest ?? new Date(0).toISOString()
  const sameStall = (value: string | null) => value !== null && Date.parse(value) === Date.parse(stamp)
  if (sameStall(settings.stall_notified_for)) return { stalled, ...base, action: 'already_posted' }

  const claimColumn = inQuietHours(settings, now) ? 'stall_suppressed_for' : 'stall_notified_for'
  if (claimColumn === 'stall_suppressed_for' && sameStall(settings.stall_suppressed_for)) {
    return { stalled, ...base, action: 'already_suppressed' }
  }

  // Atomic claim on the single settings row.
  const previous = settings[claimColumn]
  const claimQuery = supabase.from('notification_settings').update({ [claimColumn]: stamp }).eq('id', 1)
  const { data: claimed } = await (previous === null
    ? claimQuery.is(claimColumn, null)
    : claimQuery.eq(claimColumn, previous)
  ).select('id')
  if ((claimed ?? []).length !== 1) {
    return { stalled, ...base, action: claimColumn === 'stall_notified_for' ? 'already_posted' : 'already_suppressed' }
  }

  if (claimColumn === 'stall_suppressed_for') {
    await logDelivery({ event: 'checker_stalled', status: 'suppressed_quiet', siteId: null, incidentKey: `stall:${stamp}` })
    return { stalled, ...base, action: 'suppressed_quiet' }
  }

  const result = await deliver(
    settings,
    { kind: 'checker_stalled', minutes: settings.stalled_minutes, lastResultAt: newest },
    { siteId: null, incidentKey: `stall:${stamp}` },
  )
  if (!result.ok) {
    await supabase.from('notification_settings').update({ stall_notified_for: previous }).eq('id', 1)
    return { stalled, ...base, action: 'failed' }
  }
  return { stalled, ...base, action: 'posted' }
}
