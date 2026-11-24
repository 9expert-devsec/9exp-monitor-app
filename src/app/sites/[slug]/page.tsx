import { ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { buttonClassName } from '@/components/button'
import { CheckNowButton } from '@/components/check-now-button'
import { DependencyChips, checksOf } from '@/components/dependency-chips'
import { HistoryBar } from '@/components/history-bar'
import { IncidentList } from '@/components/incident-list'
import { RecentChecks } from '@/components/recent-checks'
import { ResponseChart } from '@/components/response-chart'
import { StatusDot } from '@/components/status-dot'
import { StatusPill } from '@/components/status-pill'
import { getSiteDetail, type DetailRange } from '@/lib/dashboard'
import {
  formatCheckError,
  formatClock,
  formatDuration,
  formatMonthDay,
  formatMs,
  formatPercent,
  formatRelative,
} from '@/lib/format'
import { displayStatusOf } from '@/lib/status'

export const dynamic = 'force-dynamic'

const RANGES: DetailRange[] = ['24h', '7d', '30d']

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

  const { snapshot, series, incidents, incidents30d, recentChecks, uptime90d, now } = detail
  const { site, latest, avg24hMs, uptime30d, history, openIncident } = snapshot

  const status = displayStatusOf(latest, now)
  const down = status === 'down'
  const checks = checksOf(latest?.payload)
  const lastError = down ? (openIncident?.last_error ?? latest?.error) : latest?.error

  let statusLine: string
  if (down && openIncident) {
    statusLine = `Down since ${formatClock(openIncident.started_at)} (${formatDuration(
      openIncident.started_at,
      null,
      now,
    )}) · last checked ${formatClock(latest?.checked_at)}`
  } else if (latest) {
    statusLine = `Last checked ${formatClock(latest.checked_at)} (${formatRelative(latest.checked_at, now)})`
  } else {
    statusLine = 'No checks recorded yet'
  }

  return (
    <main className="mx-auto flex w-full max-w-360 flex-col gap-6 px-4 py-6 sm:p-12">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <Link href="/" className="text-(--brand-air-blue) hover:underline">
          ← Overview
        </Link>
        <span aria-hidden="true" className="text-(--text-muted)">
          /
        </span>
        <span aria-current="page" className="truncate text-(--text-secondary)">
          {site.name}
        </span>
      </nav>

      {/* Header card */}
      <section
        className="flex flex-col gap-5 rounded-lg border bg-(--surface-card) p-5 sm:p-6"
        style={{ borderColor: down ? 'var(--status-down)' : 'var(--border-subtle)' }}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center gap-3">
              <StatusDot status={status} size={24} />
              <h1 className="text-[28px] leading-tight font-bold">{site.name}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={status} />
              <span className="text-sm text-(--text-secondary)">{statusLine}</span>
            </div>
            <p className="font-mono text-xs break-all text-(--text-muted)">
              health: {site.health_url}
              <span className="px-3" aria-hidden="true">
                ·
              </span>
              group: {site.group_name ?? '—'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:flex sm:items-start">
            <a
              href={site.url}
              target="_blank"
              rel="noreferrer noopener"
              className={buttonClassName('secondary')}
            >
              <ExternalLink size={16} aria-hidden="true" />
              Open site
            </a>
            <CheckNowButton />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
          <Stat label="Current" value={down ? '—' : formatMs(latest?.response_ms)} />
          <Stat label="24h average" value={formatMs(avg24hMs)} />
          <Stat label="Uptime · 30d" value={formatPercent(uptime30d)} />
          <Stat label="Degraded above" value={formatMs(site.expected_ms)} desktopOnly />
          <Stat label="Incidents · 30d" value={String(incidents30d)} />
        </dl>

        {(lastError || checks.length > 0) && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            {lastError ? (
              <p className="min-w-0 flex-1 rounded-md bg-(--status-down-soft) px-3 py-2 font-mono text-xs wrap-break-word text-(--status-down)">
                {formatCheckError(lastError)}
              </p>
            ) : (
              <span className="flex-1" />
            )}
            <DependencyChips checks={checks} />
          </div>
        )}
      </section>

      {/* Response time */}
      <section className="flex flex-col gap-4 rounded-lg border border-(--border-subtle) bg-(--surface-card) p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Response time</h2>
            <p className="mt-1 text-xs text-(--text-muted)">
              Dashed line = degraded threshold ({site.expected_ms} ms) · red band = downtime
            </p>
          </div>
          <nav
            aria-label="Chart range"
            className="flex w-fit gap-1 rounded-pill border border-(--border-subtle) bg-(--surface-sunken) p-1"
          >
            {RANGES.map((option) => {
              const active = option === range
              return (
                <Link
                  key={option}
                  href={`/sites/${site.slug}?range=${option}`}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-pill px-3.5 py-1 font-mono text-sm ${
                    active
                      ? 'bg-(--brand-nine-blue) text-(--brand-cloud-base)'
                      : 'text-(--text-secondary) hover:text-(--text-primary)'
                  }`}
                >
                  {option}
                </Link>
              )
            })}
          </nav>
        </div>
        <ResponseChart series={series} expectedMs={site.expected_ms} />
      </section>

      {/* Last 90 days */}
      <section className="flex flex-col gap-4 rounded-lg border border-(--border-subtle) bg-(--surface-card) p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">Last 90 days</h2>
          <p className="font-mono text-base text-(--text-secondary)">
            Uptime · 90d&nbsp;&nbsp;{formatPercent(uptime90d)}
          </p>
        </div>
        <div>
          <HistoryBar history={history} height={40} />
          <div className="mt-1.5 flex justify-between text-xs text-(--text-muted)">
            <span>{history[0] ? formatMonthDay(history[0].day) : ''}</span>
            <span>Today</span>
          </div>
        </div>
      </section>

      {/* Incidents + recent checks */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <section className="flex min-w-0 flex-1 flex-col gap-3">
          <h2 className="text-xl font-semibold">Incidents</h2>
          <IncidentList incidents={incidents} now={now} />
        </section>
        <section className="flex w-full flex-col gap-3 lg:w-130 lg:shrink-0">
          <h2 className="text-xl font-semibold">Recent checks</h2>
          <RecentChecks checks={recentChecks} />
        </section>
      </div>
    </main>
  )
}

function Stat({
  label,
  value,
  desktopOnly = false,
}: {
  label: string
  value: string
  /** Dropped below 640 px so the other four fill a 2 × 2 grid exactly. */
  desktopOnly?: boolean
}) {
  return (
    <div
      className={`flex-col gap-1 rounded-md bg-(--surface-sunken) px-4 py-3 ${
        desktopOnly ? 'hidden sm:flex' : 'flex'
      }`}
    >
      <dt className="text-xs text-(--text-muted)">{label}</dt>
      <dd className="font-mono text-2xl font-bold">{value}</dd>
    </div>
  )
}
