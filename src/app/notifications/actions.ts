'use server'

import { revalidatePath } from 'next/cache'

import { loadNotificationSettings, logDelivery, postToSlack } from '@/lib/notify/slack'
import { minutesOfDay } from '@/lib/notify/quiet-hours'
import { SLACK_WEBHOOK_PATTERN } from '@/lib/notify/slack-message'
import { authorizeAction } from '@/lib/session'
import { serviceClient } from '@/lib/supabase/server'

/*
 * Admin-only. The webhook URL arrives here from the form when the admin types
 * a new one, and is otherwise only ever read from the database on the server —
 * it is never returned to the browser and never logged.
 */

const NOT_ALLOWED = 'Only an admin can do this.'

export type SaveNotificationsResult = { ok: true } | { ok: false; error: string }

function intIn(value: FormDataEntryValue | null, min: number, max: number, label: string): number {
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be a whole number from ${min} to ${max}.`)
  }
  return number
}

function timeOf(value: FormDataEntryValue | null, label: string): string {
  const text = String(value ?? '')
  minutesOfDay(text) // throws on a bad value
  if (!/^\d{2}:\d{2}$/.test(text)) throw new Error(`${label} must look like 06:00.`)
  return text
}

export async function saveNotificationSettingsAction(formData: FormData): Promise<SaveNotificationsResult> {
  const caller = await authorizeAction({ admin: true })
  if (!caller) return { ok: false, error: NOT_ALLOWED }

  const on = (name: string) => formData.get(name) === 'true'
  let update: Record<string, unknown>
  try {
    update = {
      slack_enabled: on('slack_enabled'),
      rule_down: on('rule_down'),
      rule_recover: on('rule_recover'),
      rule_degraded: on('rule_degraded'),
      degraded_minutes: intIn(formData.get('degraded_minutes'), 1, 1440, 'Degraded minutes'),
      rule_checker_stalled: on('rule_checker_stalled'),
      stalled_minutes: intIn(formData.get('stalled_minutes'), 5, 1440, 'Checker-stopped minutes'),
      quiet_enabled: on('quiet_enabled'),
      quiet_start: timeOf(formData.get('quiet_start'), 'Quiet hours start'),
      quiet_end: timeOf(formData.get('quiet_end'), 'Quiet hours end'),
      quiet_override_minutes: intIn(formData.get('quiet_override_minutes'), 5, 1440, 'Override minutes'),
      updated_at: new Date().toISOString(),
      updated_by: caller.userId,
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid settings.' }
  }

  // An empty webhook field means "keep the saved one"; only a typed URL replaces it.
  const typed = String(formData.get('slack_webhook_url') ?? '').trim()
  if (typed) {
    if (!SLACK_WEBHOOK_PATTERN.test(typed)) {
      return { ok: false, error: 'The webhook URL must start with https://hooks.slack.com/.' }
    }
    update.slack_webhook_url = typed
  }

  if (update.slack_enabled) {
    const current = await loadNotificationSettings()
    if (!typed && !current?.slack_webhook_url) {
      return { ok: false, error: 'Add a webhook URL before turning Slack on.' }
    }
  }

  const { error } = await serviceClient().from('notification_settings').update(update).eq('id', 1)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/notifications')
  return { ok: true }
}

export type SendTestResult =
  | { ok: true; at: string }
  | { ok: false; error: string; at: string | null }

/**
 * Posts a `test` message to the webhook just typed (if any) or the saved one,
 * records the outcome on the settings row and in the delivery log.
 */
export async function sendSlackTestAction(typedWebhook: string | null): Promise<SendTestResult> {
  const caller = await authorizeAction({ admin: true })
  if (!caller) return { ok: false, error: NOT_ALLOWED, at: null }

  const typed = (typedWebhook ?? '').trim()
  if (typed && !SLACK_WEBHOOK_PATTERN.test(typed)) {
    return { ok: false, error: 'The webhook URL must start with https://hooks.slack.com/.', at: null }
  }
  const settings = await loadNotificationSettings()
  if (!settings) return { ok: false, error: 'Notification settings are missing — apply the migration.', at: null }

  const webhook = typed || settings.slack_webhook_url
  if (!webhook) return { ok: false, error: 'Add a webhook URL first.', at: null }

  const result = await postToSlack(webhook, { kind: 'test' })
  const at = new Date().toISOString()

  await serviceClient()
    .from('notification_settings')
    .update({ slack_last_test_at: at, slack_last_test_ok: result.ok, slack_last_test_error: result.error })
    .eq('id', 1)
  await logDelivery({
    event: 'test',
    status: result.ok ? 'sent' : 'failed',
    siteId: null,
    incidentKey: null,
    httpStatus: result.httpStatus,
    error: result.error,
  })

  revalidatePath('/notifications')
  return result.ok ? { ok: true, at } : { ok: false, error: result.error ?? 'Slack did not accept the message.', at }
}
