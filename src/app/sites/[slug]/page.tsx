import Link from 'next/link'
import { notFound } from 'next/navigation'

import { DependencyChips } from '@/components/dependency-chips'
import { HistoryBar } from '@/components/history-bar'
import { IncidentList } from '@/components/incident-list'
import { ResponseChart } from '@/components/response-chart'
import { StatusDot } from '@/components/status-dot'
import { getSiteDetail, type DetailRange } from '@/lib/dashboard'
import { formatMs, formatPercent, formatRelative, formatTime } from '@/lib/format'
import { STATUS_LABEL, displayStatusOf } from '@/lib/status'
import type { HealthDependency } from '@/lib/types'

export const dynamic = 'force-dynamic'

const RANGES: DetailRange[] = ['24h', '7d', '30d']
const RANGE_LABEL: Record<DetailRange, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
}

function parseRange(raw: string | string[] | undefined): DetailRange {
  const value = Array.isArray(raw) ? raw[0] : raw
  return RANGES.includes(value as DetailRange) ? (value as DetailRange) : '24h'
}

export default async function SiteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { slug } = await params
  const range = parseRange((await searchParams).range)

  const detail = await getSiteDetail(slug, range)
  if (!detail) notFound()

  const { snapshot, series, incidents, now } = detail
  const { site, latest, avg24hMs, uptime30d, history } = snapshot

  const status = displayStatusOf(latest, now)
  const checks: HealthDependency[] = Array.isArray(latest?.payload?.checks)
    ? latest.payload.checks
    : []

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <Link
          href="/"
          className="text-sm hover:underline"
          style={{ color: 'var(--color-brand-blue)' }}
        >
          ← All sites
        </Link>
      </div>

      <header
        className="flex flex-col gap-4 rounded-xl border p-5"
        style={{ background: 'var(--surface-card)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <StatusDot status={status} size={20} className="mt-1.5" />
            <div>
              <h1 className="text-2xl font-extrabold leading-tight">{site.name}</h1>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {STATUS_LABEL[status]} · last checked {formatRelative(latest?.checked_at, now)}
                {latest?.checked_at && ` (${formatTime(latest.checked_at)})`}
              </p>
            </div>
          </div>
          <a
            href={site.url}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:opacity-80"
            style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
          >
            Open site ↗
          </a>
        </div>

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Current" value={formatMs(latest?.response_ms)} />
          <Stat label="24h average" value={formatMs(avg24hMs)} />
          <Stat label="Uptime · 30d" value={formatPercent(uptime30d)} />
          <Stat label="Degraded above" value={formatMs(site.expected_ms)} />
        </dl>

        {checks.length > 0 && <DependencyChips checks={checks} />}

        {latest?.error && (
          <p
            className="rounded-md px-3 py-2 font-mono text-xs wrap-break-word"
            style={{
              background:
                status === 'down' ? 'var(--status-down-soft)' : 'var(--status-degraded-soft)',
              color: status === 'down' ? 'var(--status-down)' : 'var(--status-degraded)',
            }}
          >
            {latest.error}
          </p>
        )}
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Response time</h2>
          <nav className="flex gap-1" aria-label="Chart range">
            {RANGES.map((option) => {
              const active = option === range
              return (
                <Link
                  key={option}
                  href={`/sites/${site.slug}?range=${option}`}
                  aria-current={active ? 'page' : undefined}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium"
                  style={{
                    background: active ? 'var(--color-brand-blue)' : 'transparent',
                    color: active ? '#ffffff' : 'var(--text-secondary)',
                    border: `1px solid ${active ? 'var(--color-brand-blue)' : 'var(--border-subtle)'}`,
                  }}
                >
                  {RANGE_LABEL[option]}
                </Link>
              )
            })}
          </nav>
        </div>
        <ResponseChart series={series} expectedMs={site.expected_ms} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">Last 90 days</h2>
        <HistoryBar history={history} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">Incidents</h2>
        <IncidentList incidents={incidents} now={now} />
      </section>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {label}
      </dt>
      <dd className="font-mono text-xl font-bold">{value}</dd>
    </div>
  )
}
