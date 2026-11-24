import { ChevronRight, ExternalLink } from 'lucide-react'
import Link from 'next/link'

import { DependencyChips, checksOf } from '@/components/dependency-chips'
import { HistoryBar } from '@/components/history-bar'
import { StatusDot } from '@/components/status-dot'
import { StatusPill } from '@/components/status-pill'
import {
  formatCheckError,
  formatDelta,
  formatDuration,
  formatMs,
  formatPercent,
  formatRelative,
  hostOf,
} from '@/lib/format'
import { STALE_MESSAGE, slowerThanThresholdMessage } from '@/lib/messages'
import { STATUS_COLOR, STATUS_SOFT, displayStatusOf } from '@/lib/status'
import type { DisplayStatus, SiteSnapshot } from '@/lib/types'

/**
 * The one-line explanation under a card that is not operational.
 *
 * Degraded has several causes (slow, failing dependency, bad payload, non-2xx).
 * The Thai "slower than threshold" sentence is only true for the first, so the
 * other causes show the checker's own error text instead of a wrong reason.
 */
function messageFor(snapshot: SiteSnapshot, status: DisplayStatus): string | null {
  const { latest, openIncident, site } = snapshot
  if (status === 'stale') return STALE_MESSAGE
  if (status === 'down') {
    const error = openIncident?.last_error ?? latest?.error
    return error ? formatCheckError(error) : null
  }
  if (status === 'degraded') {
    const slow = latest?.response_ms != null && latest.response_ms > site.expected_ms
    if (slow) return slowerThanThresholdMessage(site.expected_ms)
    return latest?.error ? formatCheckError(latest.error) : null
  }
  return null
}

const DELTA_COLOR = {
  slower: 'var(--status-degraded)',
  faster: 'var(--status-up)',
  flat: 'var(--text-muted)',
} as const

export function SiteCard({ snapshot, now }: { snapshot: SiteSnapshot; now: number }) {
  const { site, latest, avg24hMs, uptime30d, history, openIncident } = snapshot
  const status = displayStatusOf(latest, now)
  const down = status === 'down'
  const delta = down ? null : formatDelta(latest?.response_ms, avg24hMs)
  const message = messageFor(snapshot, status)
  const checks = checksOf(latest?.payload)

  return (
    <article
      className="flex flex-col gap-4 rounded-lg bg-(--surface-card) p-5"
      style={{
        border: down ? '1.5px solid var(--status-down)' : '1px solid var(--border-subtle)',
      }}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/sites/${site.slug}`}
            className="block truncate text-base font-semibold hover:underline"
          >
            {site.name}
          </Link>
          <p className="truncate font-mono text-xs text-(--text-muted)">{hostOf(site.url)}</p>
        </div>
        <a
          href={site.url}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`Open ${site.name} in a new tab`}
          title={site.url}
          className="shrink-0 rounded-sm p-1 text-(--text-muted) hover:text-(--text-primary)"
        >
          <ExternalLink size={16} aria-hidden="true" />
        </a>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={status} />
        <span className="text-xs text-(--text-muted)">
          {down && openIncident
            ? `Down for ${formatDuration(openIncident.started_at, null, now)}`
            : `Checked ${formatRelative(latest?.checked_at, now)}`}
        </span>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="overline">Response time</p>
          <p
            className="mt-1 font-mono text-2xl leading-none font-bold"
            style={{ color: down ? 'var(--status-down)' : undefined }}
          >
            {down ? '—' : formatMs(latest?.response_ms)}
          </p>
          {delta && (
            <p className="mt-1.5 text-xs" style={{ color: DELTA_COLOR[delta.direction] }}>
              {delta.text}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="overline">Uptime · 30d</p>
          <p className="mt-1 font-mono text-base font-semibold">{formatPercent(uptime30d)}</p>
        </div>
      </div>

      <div>
        <HistoryBar history={history} />
        <div className="mt-1.5 flex justify-between text-xs text-(--text-muted)">
          <span>90 days ago</span>
          <span>Today</span>
        </div>
      </div>

      <DependencyChips checks={checks} />

      {message && (
        <p
          className="rounded-md px-3 py-2 font-mono text-xs wrap-break-word"
          style={{ background: STATUS_SOFT[status], color: STATUS_COLOR[status] }}
        >
          {message}
        </p>
      )}
    </article>
  )
}

/** Compact row used in the mobile "Operational" list. The whole row is the link. */
export function SiteRow({ snapshot, now }: { snapshot: SiteSnapshot; now: number }) {
  const { site, latest } = snapshot
  const status = displayStatusOf(latest, now)

  return (
    <Link
      href={`/sites/${site.slug}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-(--surface-raised)"
    >
      <StatusDot status={status} size={12} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{site.name}</span>
      <span className="font-mono text-xs text-(--text-secondary)">
        {formatMs(latest?.response_ms)}
      </span>
      <ChevronRight size={16} aria-hidden="true" className="text-(--text-muted)" />
    </Link>
  )
}
