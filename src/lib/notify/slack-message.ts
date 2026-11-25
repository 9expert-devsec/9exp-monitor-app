/**
 * Slack messages: one model per event, then two renderers of that SAME model —
 * `toSlackPayload()` for the webhook and the preview card on /notifications —
 * so the preview cannot drift from what is actually sent. Pure; no I/O.
 */

const TIME_ZONE = 'Asia/Bangkok'

export const SENDER_NAME = '9Expert Monitor'

export type NotifyEventKind = 'down' | 'recover' | 'degraded' | 'checker_stalled' | 'test'

export type NotifyEvent =
  | {
      kind: 'down'
      siteName: string
      siteSlug: string
      /** Raw error from the check, e.g. "HTTP 503 · Service Unavailable" or "DNS lookup failed". */
      error: string | null
      httpStatus: number | null
      startedAt: string
      /** Number of retries the checker made before confirming (the page check retries once). */
      retries: number
      duringQuietHours?: boolean
    }
  | {
      kind: 'recover'
      siteName: string
      siteSlug: string
      startedAt: string
      resolvedAt: string
    }
  | {
      kind: 'degraded'
      siteName: string
      siteSlug: string
      minutes: number
      responseMs: number | null
      expectedMs: number
      reason: string | null
    }
  | {
      kind: 'checker_stalled'
      minutes: number
      /** Newest check result, or null if none was ever recorded. */
      lastResultAt: string | null
    }
  | { kind: 'test' }

export type MessageTone = 'down' | 'up' | 'degraded' | 'info'

export interface SlackMessageModel {
  tone: MessageTone
  /** First line, bold. */
  title: string
  /** Body lines, plain text. */
  lines: string[]
  /** "View details →" target, when there is one. */
  link: { label: string; path: string } | null
  /** Plain-text fallback for notifications and clients without attachments. */
  fallback: string
}

/** Slack attachment colour bar per tone (matches the dashboard's status colours). */
export const TONE_COLOR: Record<MessageTone, string> = {
  down: '#FF6B70',
  up: '#4FC46A',
  degraded: '#F0A33C',
  info: '#2486FF',
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function minutesBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000))
}

/** Checker errors are recorded as "HTTP 503 · Service Unavailable" (older rows: "HTTP 503 Service Unavailable"). */
function httpLine(error: string | null, httpStatus: number | null): string {
  if (error) return error.replace(/^HTTP (\d{3}) (?=[^\s·])/, 'HTTP $1 · ')
  return httpStatus !== null ? `HTTP ${httpStatus}` : 'No response'
}

export function buildMessage(event: NotifyEvent): SlackMessageModel {
  switch (event.kind) {
    case 'down': {
      const quiet = event.duringQuietHours ? ' (during quiet hours)' : ''
      const retry = `confirmed after ${event.retries} ${event.retries === 1 ? 'retry' : 'retries'}`
      const title = `${event.siteName} is down${quiet}`
      return {
        tone: 'down',
        title,
        lines: [httpLine(event.error, event.httpStatus), `Down since ${clock(event.startedAt)} · ${retry}`],
        link: { label: 'View details →', path: `/sites/${event.siteSlug}` },
        fallback: title,
      }
    }
    case 'recover': {
      const title = `${event.siteName} recovered`
      const minutes = minutesBetween(event.startedAt, event.resolvedAt)
      return {
        tone: 'up',
        title,
        lines: [`Total downtime ${minutes} min (${clock(event.startedAt)} – ${clock(event.resolvedAt)})`],
        link: { label: 'View details →', path: `/sites/${event.siteSlug}` },
        fallback: title,
      }
    }
    case 'degraded': {
      const title = `${event.siteName} degraded for ${event.minutes}+ min`
      const lines =
        event.responseMs !== null && event.responseMs > event.expectedMs
          ? [`Latest response ${event.responseMs} ms (degraded above ${event.expectedMs} ms)`]
          : [
              event.responseMs !== null ? `Latest response ${event.responseMs} ms` : 'No response time',
              ...(event.reason ? [`Health check: ${event.reason}`] : []),
            ]
      return {
        tone: 'degraded',
        title,
        lines,
        link: { label: 'View details →', path: `/sites/${event.siteSlug}` },
        fallback: title,
      }
    }
    case 'checker_stalled': {
      const title = `Checker stopped — no results for ${event.minutes}+ min`
      return {
        tone: 'down',
        title,
        lines: [
          event.lastResultAt ? `Last result at ${clock(event.lastResultAt)}` : 'No result has ever been recorded',
          'The Supabase cron job "monitor-checker" may have stopped.',
        ],
        link: { label: 'Open dashboard →', path: '/' },
        fallback: title,
      }
    }
    case 'test': {
      const title = 'Test message from 9Expert Monitor'
      return {
        tone: 'info',
        title,
        lines: ['Slack alerts are set up correctly for this channel.'],
        link: null,
        fallback: title,
      }
    }
  }
}

/** Slack mrkdwn needs &, <, > escaped in user-supplied text such as site names. */
function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * The webhook body: an attachment with a colour bar holding Block Kit text.
 * `baseUrl` is the app's public origin; without one the link is left out.
 */
export function toSlackPayload(model: SlackMessageModel, baseUrl: string | null) {
  const text = [`*${escapeMrkdwn(model.title)}*`, ...model.lines.map(escapeMrkdwn)]
  if (model.link && baseUrl) {
    text.push(`<${baseUrl.replace(/\/+$/, '')}${model.link.path}|${model.link.label}>`)
  }
  return {
    username: SENDER_NAME,
    text: model.fallback,
    attachments: [
      {
        color: TONE_COLOR[model.tone],
        fallback: model.fallback,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: text.join('\n') } }],
      },
    ],
  }
}

/** The two sample messages shown in the page's preview card. */
export function previewMessages(now = new Date()): SlackMessageModel[] {
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString()
  return [
    buildMessage({
      kind: 'down',
      siteName: 'Genesis Lab',
      siteSlug: 'genesis-lab',
      error: 'HTTP 503 · Service Unavailable',
      httpStatus: 503,
      startedAt: at(25),
      retries: 1,
    }),
    buildMessage({ kind: 'recover', siteName: 'Genesis Lab', siteSlug: 'genesis-lab', startedAt: at(25), resolvedAt: at(13) }),
  ]
}

/** "https://hooks.slack.com/services/T…/…/••••abcd" — never the full secret. */
export function maskWebhookUrl(url: string | null): string | null {
  if (!url) return null
  const tail = url.slice(-4)
  try {
    const parsed = new URL(url)
    const [, kind, team] = parsed.pathname.split('/')
    return `${parsed.origin}/${kind ?? 'services'}/${(team ?? 'T').slice(0, 1)}…/…/••••${tail}`
  } catch {
    return `••••${tail}`
  }
}

export const SLACK_WEBHOOK_PATTERN = /^https:\/\/hooks\.slack\.com\/(services|workflows|triggers)\/\S+$/
