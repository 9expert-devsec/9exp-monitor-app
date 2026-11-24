import 'server-only'

import { appBaseUrl } from '@/lib/env'
import { isQuietTime } from '@/lib/notify/quiet-hours'
import {
  buildMessage,
  toSlackPayload,
  type NotifyEvent,
  type NotifyEventKind,
} from '@/lib/notify/slack-message'
import { serviceClient } from '@/lib/supabase/server'

/**
 * Slack delivery. Server only: the webhook URL is read with the service role
 * here and nowhere else, and is never logged.
 *
 * Nothing in this module throws into the check pipeline — a Slack outage must
 * not fail a check run. Every attempt writes one `notification_log` row.
 */

const POST_TIMEOUT_MS = 5_000

/** A row of `notification_settings`, including the secret. Server only. */
export interface NotificationSettings {
  slack_enabled: boolean
  slack_webhook_url: string | null
  slack_last_test_at: string | null
  slack_last_test_ok: boolean | null
  slack_last_test_error: string | null
  rule_down: boolean
  rule_recover: boolean
  rule_degraded: boolean
  degraded_minutes: number
  rule_checker_stalled: boolean
  stalled_minutes: number
  quiet_enabled: boolean
  quiet_start: string
  quiet_end: string
  quiet_override_minutes: number
  stall_notified_for: string | null
  stall_suppressed_for: string | null
}

/** The settings row, or null if it cannot be read (e.g. migration not applied yet). */
export async function loadNotificationSettings(): Promise<NotificationSettings | null> {
  const { data, error } = await serviceClient()
    .from('notification_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle<NotificationSettings>()
  if (error) {
    console.error('[notify] could not load settings:', error.message)
    return null
  }
  return data
}

export function inQuietHours(settings: NotificationSettings, now = new Date()): boolean {
  return settings.quiet_enabled && isQuietTime(settings.quiet_start, settings.quiet_end, now)
}

export type DeliveryStatus = 'sent' | 'failed' | 'suppressed_quiet' | 'skipped_disabled'

export interface LogEntry {
  event: NotifyEventKind
  status: DeliveryStatus
  siteId: string | null
  incidentKey: string | null
  httpStatus?: number | null
  error?: string | null
}

export async function logDelivery(entry: LogEntry): Promise<void> {
  const { error } = await serviceClient().from('notification_log').insert({
    event: entry.event,
    channel: 'slack',
    status: entry.status,
    site_id: entry.siteId,
    incident_key: entry.incidentKey,
    http_status: entry.httpStatus ?? null,
    error: entry.error ?? null,
  })
  if (error) console.error('[notify] could not write notification_log:', error.message)
}

export interface PostResult {
  ok: boolean
  httpStatus: number | null
  error: string | null
}

/** POST one message. Never throws; the URL never appears in errors or logs. */
export async function postToSlack(webhookUrl: string, event: NotifyEvent): Promise<PostResult> {
  const payload = toSlackPayload(buildMessage(event), appBaseUrl())
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
      cache: 'no-store',
    })
    const body = (await response.text().catch(() => '')).slice(0, 200)
    if (response.ok) return { ok: true, httpStatus: response.status, error: null }
    return { ok: false, httpStatus: response.status, error: body || `HTTP ${response.status}` }
  } catch (error) {
    const reason =
      error instanceof DOMException && error.name === 'TimeoutError'
        ? `Timeout after ${POST_TIMEOUT_MS / 1000} s`
        : error instanceof Error
          ? (error.cause instanceof Error ? error.cause.message : error.message)
          : String(error)
    // Strip anything URL-shaped, in case a lower layer echoed the target.
    return { ok: false, httpStatus: null, error: reason.replace(/https?:\/\/\S+/g, '[webhook]') }
  }
}

/**
 * Posts an event and logs the attempt. The caller has already decided the
 * event should go out (rules, alert_enabled, claims); this only delivers.
 */
export async function deliver(
  settings: NotificationSettings,
  event: NotifyEvent,
  meta: { siteId: string | null; incidentKey: string | null },
): Promise<PostResult> {
  if (!settings.slack_webhook_url) {
    await logDelivery({ event: event.kind, status: 'failed', ...meta, error: 'No webhook URL saved' })
    return { ok: false, httpStatus: null, error: 'No webhook URL saved' }
  }
  const result = await postToSlack(settings.slack_webhook_url, event)
  await logDelivery({
    event: event.kind,
    status: result.ok ? 'sent' : 'failed',
    ...meta,
    httpStatus: result.httpStatus,
    error: result.error,
  })
  return result
}
