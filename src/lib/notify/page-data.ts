import 'server-only'

import { loadNotificationSettings } from '@/lib/notify/slack'
import { hhmm } from '@/lib/notify/quiet-hours'
import { maskWebhookUrl, previewMessages, type SlackMessageModel } from '@/lib/notify/slack-message'
import { serviceClient } from '@/lib/supabase/server'

/** Settings as the browser may see them: the webhook only ever masked. */
export interface PublicNotificationSettings {
  slackEnabled: boolean
  webhookMasked: string | null
  lastTestAt: string | null
  lastTestOk: boolean | null
  lastTestError: string | null
  ruleDown: boolean
  ruleRecover: boolean
  ruleDegraded: boolean
  degradedMinutes: number
  ruleCheckerStalled: boolean
  stalledMinutes: number
  quietEnabled: boolean
  quietStart: string
  quietEnd: string
  quietOverrideMinutes: number
}

export interface DeliveryLogRow {
  id: number
  createdAt: string
  /** "10:45", "Yesterday 22:18" or "Nov 20 14:05" (Bangkok). */
  when: string
  event: string
  siteName: string | null
  status: 'sent' | 'failed' | 'suppressed_quiet' | 'skipped_disabled'
  httpStatus: number | null
  error: string | null
}

export interface NotificationPageData {
  settings: PublicNotificationSettings | null
  log: DeliveryLogRow[]
  preview: SlackMessageModel[]
}

const TIME_ZONE = 'Asia/Bangkok'
const dayKey = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: TIME_ZONE })
const clock = (date: Date) =>
  date.toLocaleTimeString('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false })

function relativeWhen(iso: string, now: Date): string {
  const date = new Date(iso)
  if (dayKey(date) === dayKey(now)) return clock(date)
  if (dayKey(date) === dayKey(new Date(now.getTime() - 86_400_000))) return `Yesterday ${clock(date)}`
  const day = date.toLocaleDateString('en-US', { timeZone: TIME_ZONE, month: 'short', day: 'numeric' })
  return `${day} ${clock(date)}`
}

export async function getNotificationPageData(): Promise<NotificationPageData> {
  const now = new Date()
  const settings = await loadNotificationSettings()

  const { data: logRows, error } = await serviceClient()
    .from('notification_log')
    .select('id, created_at, event, status, http_status, error, monitored_sites(name)')
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) console.error('[notifications] could not load log:', error.message)

  type Row = {
    id: number
    created_at: string
    event: string
    status: DeliveryLogRow['status']
    http_status: number | null
    error: string | null
    monitored_sites: { name: string } | { name: string }[] | null
  }

  const log = ((logRows ?? []) as Row[]).map((row) => {
    const site = Array.isArray(row.monitored_sites) ? row.monitored_sites[0] : row.monitored_sites
    return {
      id: row.id,
      createdAt: row.created_at,
      when: relativeWhen(row.created_at, now),
      event: row.event,
      siteName: site?.name ?? null,
      status: row.status,
      httpStatus: row.http_status,
      error: row.error,
    }
  })

  return {
    settings: settings && {
      slackEnabled: settings.slack_enabled,
      webhookMasked: maskWebhookUrl(settings.slack_webhook_url),
      lastTestAt: settings.slack_last_test_at,
      lastTestOk: settings.slack_last_test_ok,
      lastTestError: settings.slack_last_test_error,
      ruleDown: settings.rule_down,
      ruleRecover: settings.rule_recover,
      ruleDegraded: settings.rule_degraded,
      degradedMinutes: settings.degraded_minutes,
      ruleCheckerStalled: settings.rule_checker_stalled,
      stalledMinutes: settings.stalled_minutes,
      quietEnabled: settings.quiet_enabled,
      quietStart: hhmm(settings.quiet_start),
      quietEnd: hhmm(settings.quiet_end),
      quietOverrideMinutes: settings.quiet_override_minutes,
    },
    log,
    preview: previewMessages(now),
  }
}

