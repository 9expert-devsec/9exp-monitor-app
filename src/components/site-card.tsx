import Link from 'next/link'

import { DependencyChips } from '@/components/dependency-chips'
import { HistoryBar } from '@/components/history-bar'
import { StatusDot } from '@/components/status-dot'
import { formatDelta, formatMs, formatPercent, formatRelative } from '@/lib/format'
import { STATUS_LABEL, displayStatusOf } from '@/lib/status'
import type { HealthDependency, SiteSnapshot } from '@/lib/types'

function checksOf(snapshot: SiteSnapshot): HealthDependency[] {
  const checks = snapshot.latest?.payload?.checks
  return Array.isArray(checks) ? checks : []
}

export function SiteCard({ snapshot, now }: { snapshot: SiteSnapshot; now: number }) {
  const { site, latest, avg24hMs, uptime30d, history, openIncident } = snapshot
  const status = displayStatusOf(latest, now)
  const delta = formatDelta(latest?.response_ms, avg24hMs)

  return (
    <article
      className="flex flex-col gap-4 rounded-xl border p-4 shadow-sm"
      style={{
        background: 'var(--surface-card)',
        borderColor: status === 'down' ? 'var(--status-down)' : 'var(--border-subtle)',
      }}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <StatusDot status={status} size={14} className="mt-1" />
          <div className="min-w-0">
            <Link
              href={`/sites/${site.slug}`}
              className="block truncate font-bold hover:underline"
              style={{ color: 'var(--text-primary)' }}
            >
              {site.name}
            </Link>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {STATUS_LABEL[status]} · checked {formatRelative(latest?.checked_at, now)}
            </p>
          </div>
        </div>

        <a
          href={site.url}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`Open ${site.name} in a new tab`}
          title={`Open ${site.url}`}
          className="shrink-0 rounded p-1 hover:opacity-70"
          style={{ color: 'var(--text-muted)' }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M5.5 2H2v10h10V8.5M8.5 1.5H12.5V5.5M12.5 1.5L6.5 7.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
      </header>

      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-2xl font-bold leading-none">
            {formatMs(latest?.response_ms)}
          </p>
          {delta && (
            <p
              className="mt-1 text-xs"
              style={{
                color:
                  delta.direction === 'slower'
                    ? 'var(--status-degraded)'
                    : delta.direction === 'faster'
                      ? 'var(--status-up)'
                      : 'var(--text-muted)',
              }}
            >
              {delta.direction === 'slower' ? '▲ ' : delta.direction === 'faster' ? '▼ ' : ''}
              {delta.text}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-bold leading-none">
            {formatPercent(uptime30d)}
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            uptime · 30d
          </p>
        </div>
      </div>

      <div>
        <HistoryBar history={history} />
        <div
          className="mt-1 flex justify-between text-[11px]"
          style={{ color: 'var(--text-muted)' }}
        >
          <span>90 days ago</span>
          <span>today</span>
        </div>
      </div>

      <DependencyChips checks={checksOf(snapshot)} />

      {(latest?.error || openIncident) && (
        <p
          className="rounded-md px-2 py-1.5 text-xs wrap-break-word"
          style={{
            background:
              status === 'down' ? 'var(--status-down-soft)' : 'var(--status-degraded-soft)',
            color: status === 'down' ? 'var(--status-down)' : 'var(--status-degraded)',
          }}
        >
          {openIncident?.last_error ?? latest?.error}
        </p>
      )}
    </article>
  )
}
