'use client'

import { Maximize, Minimize } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

import './tv.css'

import { refreshTvAction } from '@/app/tv/actions'
import {
  Clock,
  Countdown,
  DownTimer,
  FeedIcon,
  FeedList,
  FeedTime,
  LivePill,
  LogoPulse,
  Sparkline,
  Ticker,
  TweenNumber,
  clockText,
  prefersReducedMotion,
  u,
  useMinute,
  type LiveState,
} from '@/app/tv/tv-parts'
import { HistoryBar } from '@/components/history-bar'
import { headlineFor, worstStatus, type StatusCounts } from '@/components/overall-status-card'
import { messageFor } from '@/components/site-card'
import { StatusDot } from '@/components/status-dot'
import { StatusHeatmap, type HeatRow } from '@/components/tv/status-heatmap'
import { hostOf } from '@/lib/format'
import { CHECKER_NEVER_RAN_MESSAGE, CHECKER_STALLED_MESSAGE } from '@/lib/messages'
import { STATUS_COLOR, STATUS_LABEL, STATUS_SOFT, displayStatusOf, isStale } from '@/lib/status'
import { checkerStateAt, feedText, gridSizes, orderForTv, shortDuration, type TvEntry, type TvLayout } from '@/lib/tv'
import type { TvData } from '@/lib/tv-data'
import type { DisplayStatus } from '@/lib/types'

const REFRESH_MS = 30_000
/** Long-running kiosk browsers leak; a full reload every 6 hours sheds that. */
const FULL_RELOAD_MS = 6 * 60 * 60 * 1000
const IDLE_MS = 5_000
const LEGEND: DisplayStatus[] = ['up', 'degraded', 'down', 'stale']
const LIME = 'var(--brand-signal-lime)'

type Change = { ids: ReadonlySet<string>; generation: number }
const NO_CHANGE: Change = { ids: new Set(), generation: 0 }

function Dot({ status, size }: { status: DisplayStatus; size: string }) {
  return (
    <span className="inline-flex shrink-0 [&>svg]:size-full" style={{ width: size, height: size }}>
      <StatusDot status={status} decorative />
    </span>
  )
}

/**
 * TV wall v2. One page for every screen: CSS picks the layout (tv.css). Data
 * refreshes every 30 s through a Server Action; the last good data stays on
 * screen when a refresh fails. Ticking values re-render only themselves; all
 * loops are CSS or the Web Animations API.
 */
export function TvWall({ initial, autoRefresh = true }: { initial: TvData; autoRefresh?: boolean }) {
  const [data, setData] = useState(initial)
  const [connectionLost, setConnectionLost] = useState(false)
  const [flash, setFlash] = useState<Change>(NO_CHANGE)
  const [feedChange, setFeedChange] = useState<Change>(NO_CHANGE)
  const [pointerActive, setPointerActive] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const shiftRef = useRef<HTMLDivElement>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dataRef = useRef(initial)

  const now = useMinute(data.renderedAt)

  // --- 30 s refresh; work out which tiles got a new check (M5) and which feed rows are new (M10).
  useEffect(() => {
    if (!autoRefresh) return
    let cancelled = false
    const timer = setInterval(async () => {
      try {
        const result = await refreshTvAction()
        if (cancelled) return
        if (!result.ok) {
          if (result.reason === 'signed_out') window.location.reload()
          else setConnectionLost(true)
          return
        }
        const previous = dataRef.current
        const next = result.data
        const before = new Map(previous.snapshots.map((s) => [s.site.id, s.latest?.checked_at ?? null]))
        const checked = new Set(
          next.snapshots
            .filter((s) => (s.latest?.checked_at ?? null) !== (before.get(s.site.id) ?? null))
            .map((s) => s.site.id),
        )
        const known = new Set(previous.feed.map((item) => item.id))
        const fresh = new Set(next.feed.filter((item) => !known.has(item.id)).map((item) => item.id))
        dataRef.current = next
        setData(next)
        setConnectionLost(false)
        if (checked.size > 0) setFlash((f) => ({ ids: checked, generation: f.generation + 1 }))
        if (fresh.size > 0) setFeedChange((f) => ({ ids: fresh, generation: f.generation + 1 }))
      } catch {
        if (!cancelled) setConnectionLost(true)
      }
    }, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [autoRefresh])

  // --- 6 h full reload.
  useEffect(() => {
    if (!autoRefresh) return
    const timer = setTimeout(() => window.location.reload(), FULL_RELOAD_MS)
    return () => clearTimeout(timer)
  }, [autoRefresh])

  // --- Wake Lock, re-acquired when the tab is shown again; loops pause while hidden.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    const onVisibility = async () => {
      rootRef.current?.classList.toggle('tv-paused', document.hidden)
      if (document.hidden || !('wakeLock' in navigator)) return
      try {
        lock = await navigator.wakeLock.request('screen')
      } catch {
        // Unsupported, denied or battery saver: ignore silently.
      }
    }
    void onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      void lock?.release().catch(() => {})
    }
  }, [])

  // --- M12 burn-in guard: every 10 min glide up to 4 px; back to 0 on each full hour. Not on mobile.
  useEffect(() => {
    const apply = () => {
      const element = shiftRef.current
      if (!element || window.matchMedia('(max-width: 639px)').matches) return
      const minute = new Date().getMinutes()
      if (minute % 10 !== 0) return
      const offset = () => Math.round((Math.random() * 2 - 1) * 4)
      element.style.transform = minute === 0 ? 'translate(0, 0)' : `translate(${offset()}px, ${offset()}px)`
    }
    const timer = setInterval(apply, 60_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [])

  function onPointerMove() {
    setPointerActive(true)
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setPointerActive(false), IDLE_MS)
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void document.documentElement.requestFullscreen?.().catch(() => {})
  }

  // --- derive ----------------------------------------------------------------------
  const entries: TvEntry[] = data.snapshots.map((snapshot) => ({ snapshot, status: displayStatusOf(snapshot.latest, now) }))
  const counts: StatusCounts = { up: 0, degraded: 0, down: 0, stale: 0 }
  for (const entry of entries) counts[entry.status] += 1
  const total = entries.length
  const ordered = orderForTv(entries)

  const stalled = isStale(data.lastRunAt, now)
  const bannerStatus: DisplayStatus = stalled ? 'stale' : worstStatus(counts, total)
  const headline = stalled ? 'No recent data' : headlineFor(counts, total)
  const issues = ordered
    .filter((entry) => entry.status === 'down' || entry.status === 'degraded')
    .map(({ snapshot, status }) => {
      const since = status === 'down' ? snapshot.openIncident?.started_at : data.degradedSince[snapshot.site.id]
      const verb = status === 'down' ? 'down' : 'slow'
      return since ? `${snapshot.site.name} ${verb} for ${shortDuration(now - Date.parse(since))}` : `${snapshot.site.name} ${verb}`
    })
  const summary = stalled
    ? data.lastRunAt === null
      ? CHECKER_NEVER_RAN_MESSAGE
      : CHECKER_STALLED_MESSAGE
    : issues.length > 0
      ? issues.slice(0, 3).join(' · ') + (issues.length > 3 ? ` · +${issues.length - 3} more` : '')
      : 'Every site answered within its threshold'

  const liveState: LiveState = connectionLost ? 'reconnecting' : stalled ? 'stale' : 'live'
  const logoMood = stalled ? 'stale' : counts.down > 0 ? 'down' : 'normal'
  const checker = checkerStateAt(now, data.lastRunAt)
  const checkerText = {
    healthy: `Checker healthy · last run ${data.lastRunAt ? clockText(Date.parse(data.lastRunAt)) : '—'} · ${data.lastRunChecked}/${total}`,
    late: `Checker late · last run ${data.lastRunAt ? clockText(Date.parse(data.lastRunAt)) : '—'}`,
    stopped: `Checker stopped · last run ${data.lastRunAt ? clockText(Date.parse(data.lastRunAt)) : 'never'}`,
  }[checker]
  const checkerColor = { healthy: 'var(--status-up)', late: 'var(--status-degraded)', stopped: 'var(--status-down)' }[checker]

  // M13 heatmap rows: the same order as the tiles on every layout.
  const heatRows: HeatRow[] = ordered.map(({ snapshot, status }) => ({
    id: snapshot.site.id,
    name: snapshot.site.name,
    issue: status === 'down' || status === 'degraded',
    cells: data.heatmap[snapshot.site.id] ?? [],
  }))

  const sizes = gridSizes(total)
  const gridVars = Object.fromEntries(
    (Object.keys(sizes) as TvLayout[]).flatMap((layout) => {
      const key = layout === 'ultrawide' ? 'uw' : layout
      return [
        [`--cols-${key}`, sizes[layout].columns],
        [`--rows-${key}`, sizes[layout].rows],
        [`--scale-${key}`, sizes[layout].scale],
      ]
    }),
  ) as CSSProperties

  const avgDelta =
    data.today.avgMs !== null && data.today.avgMsYesterday
      ? Math.round(((data.today.avgMs - data.today.avgMsYesterday) / data.today.avgMsYesterday) * 100)
      : null
  const needAttention = total - counts.up
  const stats: { label: string; value: React.ReactNode; delta: string; color: string }[] = [
    {
      label: 'Sites up',
      value: (
        <>
          <TweenNumber value={counts.up} format="int" /> / {total}
        </>
      ),
      delta: needAttention > 0 ? `${needAttention} need attention` : 'All good',
      color: needAttention > 0 ? (counts.down > 0 ? 'var(--status-down)' : 'var(--status-degraded)') : 'var(--status-up)',
    },
    {
      label: 'Avg response',
      value: <TweenNumber value={data.today.avgMs} format="ms" />,
      delta: avgDelta === null ? 'No data yesterday' : avgDelta === 0 ? 'Same as yesterday' : `${avgDelta < 0 ? '▼' : '▲'} ${Math.abs(avgDelta)}% vs yesterday`,
      color: avgDelta === null || avgDelta === 0 ? 'var(--text-muted)' : avgDelta < 0 ? 'var(--status-up)' : 'var(--status-degraded)',
    },
    {
      label: 'Uptime today',
      value: <TweenNumber value={data.today.uptimeToday} format="pct" />,
      delta: `30d · ${data.today.uptime30d === null ? '—' : `${data.today.uptime30d >= 100 ? '100' : data.today.uptime30d.toFixed(2)}%`}`,
      color: 'var(--text-muted)',
    },
    {
      label: 'Incidents today',
      value: <TweenNumber value={data.today.incidentsToday} format="int" />,
      delta: data.today.incidentsOpen > 0 ? `${data.today.incidentsOpen} open` : 'None open',
      color: data.today.incidentsOpen > 0 ? 'var(--status-down)' : 'var(--status-up)',
    },
  ]

  return (
    <>
      <div
        ref={rootRef}
        className={`tv-root ${pointerActive ? '' : 'tv-hide-cursor'}`}
        onPointerMove={onPointerMove}
      >
        <div ref={shiftRef} className="tv-shift">
          {/* Top bar */}
          <header className="tv-top flex min-w-0 items-center justify-between" style={{ gap: u(24) }}>
            <div className="flex min-w-0 items-center" style={{ gap: u(16) }}>
              <LogoPulse mood={logoMood} size={u(44)} />
              <div className="min-w-0">
                <h1 className="tv-title truncate leading-tight font-bold" style={{ fontSize: u(34) }}>
                  9Expert System Status
                </h1>
                <p className="tv-subtitle truncate text-(--text-secondary)" style={{ fontSize: u(16) }}>
                  Realtime · {total} {total === 1 ? 'site' : 'sites'} · checked every 5 min by pg_cron
                  <span className="tv-show-laptop" style={{ color: checkerColor }}>
                    {' · '}
                    {checkerText}
                  </span>
                </p>
              </div>
            </div>
            <div className="tv-right flex shrink-0 items-center" style={{ gap: u(28) }}>
              <LivePill state={liveState} />
              <Countdown lastRunAt={data.lastRunAt} />
              <Clock />
              {/* Own slot in the top bar, so it never covers the legend; shown only while the mouse moves. */}
              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                className="inline-flex items-center justify-center rounded-md border border-(--border-strong) bg-(--surface-raised) text-(--text-primary)"
                style={{ width: u(40), height: u(40), visibility: pointerActive ? 'visible' : 'hidden' }}
              >
                {fullscreen ? (
                  <Minimize aria-hidden="true" style={{ width: u(18), height: u(18) }} />
                ) : (
                  <Maximize aria-hidden="true" style={{ width: u(18), height: u(18) }} />
                )}
              </button>
            </div>
          </header>

          {/* Banner */}
          <section aria-label="Overall status" className="tv-banner">
            {(['down', 'degraded', 'up', 'stale'] as DisplayStatus[]).map((tone) => (
              <span
                key={tone}
                className="tv-tone"
                data-on={tone === bannerStatus}
                style={{
                  background: STATUS_SOFT[tone],
                  borderColor: tone === 'up' ? 'color-mix(in srgb, var(--status-up) 40%, transparent)' : STATUS_COLOR[tone],
                }}
              />
            ))}
            <div className="relative flex min-w-0 items-center" style={{ gap: u(20) }}>
              <Dot status={bannerStatus} size={u(36)} />
              <div className="min-w-0">
                <p key={headline} className="tv-fade-in font-heading truncate leading-tight font-bold" style={{ fontSize: u(34) }}>
                  {headline}
                </p>
                <p className="truncate font-sans text-(--text-secondary)" style={{ fontSize: u(16), marginTop: u(4) }} title={summary}>
                  {summary}
                </p>
              </div>
            </div>
            <dl className="tv-stats relative">
              {stats.map((stat) => (
                <div key={stat.label} className="min-w-0">
                  <dt className="font-semibold tracking-wider text-(--text-muted) uppercase" style={{ fontSize: u(12) }}>
                    {stat.label}
                  </dt>
                  <dd className="tv-num leading-tight font-bold whitespace-nowrap" style={{ fontSize: u(30) }}>
                    {stat.value}
                  </dd>
                  <dd className="truncate" style={{ fontSize: u(13), color: stat.color }}>
                    {stat.delta}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Grid + rail */}
          <div className="tv-main">
            <div className="tv-left">
              <TileGrid entries={ordered} data={data} now={now} flash={flash} style={gridVars} />
              {/* Portrait and ultrawide: the heatmap as a card under the grid (portrait: instead of the rail). */}
              {total > 0 && (
                <section className="tv-heat-card" aria-label="Status, last 24 hours">
                  <StatusHeatmap rows={heatRows} start={data.sparkStart} variant="large" />
                  <div className="tv-heat-foot">
                    <div className="flex min-w-0 flex-1 items-center overflow-hidden" style={{ gap: u(28) }}>
                      {data.feed.length === 0 ? (
                        <span className="text-(--text-muted)">No incidents in the last 24h</span>
                      ) : (
                        data.feed.slice(0, 2).map((item) => (
                          <span key={item.id} className="flex min-w-0 items-center" style={{ gap: u(10) }}>
                            <FeedTime at={item.at} now={now} />
                            <FeedIcon kind={item.kind} size={u(10)} />
                            <span className="truncate">{feedText(item)}</span>
                          </span>
                        ))
                      )}
                    </div>
                    <span className="flex shrink-0 items-center text-(--text-secondary)" style={{ gap: u(8) }}>
                      <span className="shrink-0 rounded-pill" style={{ width: u(9), height: u(9), background: checkerColor }} />
                      {checkerText}
                    </span>
                  </div>
                </section>
              )}
            </div>

            <aside className="tv-rail" aria-label="Incidents">
              <div className="flex items-baseline justify-between">
                <h2 className="font-semibold" style={{ fontSize: u(20) }}>
                  Incidents
                </h2>
                <span className="text-(--text-muted)" style={{ fontSize: u(14) }}>
                  Last 24h
                </span>
              </div>
              <FeedList items={data.feed} now={now} newIds={feedChange.ids} generation={feedChange.generation} rowHeight={u(40)} />
              {total > 0 && (
                <div className="tv-heat-rail border-t border-(--border-subtle)" style={{ paddingTop: u(14) }}>
                  <StatusHeatmap rows={heatRows} start={data.sparkStart} variant="compact" />
                </div>
              )}
              <div className="tv-rail-chart flex flex-col border-t border-(--border-subtle)" style={{ paddingTop: u(14), gap: u(8) }}>
                <div className="flex items-baseline justify-between" style={{ fontSize: u(14) }}>
                  <span className="font-medium">Avg response · all sites</span>
                  <span className="text-(--text-muted)">6h</span>
                </div>
                <div className="relative" style={{ height: u(96) }}>
                  <Sparkline points={data.avg6h} color={LIME} version={data.renderedAt.slice(0, 15)} threshold={data.threshold} />
                </div>
              </div>
              <p
                className="flex items-center border-t border-(--border-subtle)"
                style={{ paddingTop: u(12), gap: u(10), fontSize: u(14) }}
              >
                <span className="shrink-0 rounded-pill" style={{ width: u(10), height: u(10), background: checkerColor }} />
                <span className="truncate text-(--text-secondary)">{checkerText}</span>
              </p>
            </aside>
          </div>

          {/* Laptop: the feed as a ticker */}
          <Ticker items={data.feed} now={now} />

          {/* Footer */}
          <footer className="flex items-center text-(--text-muted)" style={{ fontSize: u(15), gap: u(20) }}>
            <span className="shrink-0">Sites with issues are always listed first</span>
            <span aria-hidden="true" className="h-px flex-1 bg-(--border-subtle)" />
            <ul className="flex shrink-0 items-center" style={{ gap: u(22) }} aria-label="Legend" data-legend>
              {LEGEND.map((status) => (
                <li key={status} className="flex items-center" style={{ gap: u(8) }}>
                  <Dot status={status} size={u(13)} />
                  {STATUS_LABEL[status]}
                </li>
              ))}
            </ul>
          </footer>
        </div>
      </div>

      <MobileView
        data={data}
        ordered={ordered}
        now={now}
        headline={headline}
        summary={summary}
        bannerStatus={bannerStatus}
        liveState={liveState}
        stats={stats}
        feedChange={feedChange}
        heatRows={heatRows}
      />
    </>
  )
}

// --- grid with FLIP reorder (M9) ----------------------------------------------------------

function TileGrid({
  entries,
  data,
  now,
  flash,
  style,
}: {
  entries: TvEntry[]
  data: TvData
  now: number
  flash: Change
  style: CSSProperties
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  const rects = useRef(new Map<string, DOMRect>())
  const orderKey = entries.map((entry) => entry.snapshot.site.id).join(',')

  // Measure every tile; on an order change, slide each from its old slot (450 ms, no bounce).
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const tiles = [...grid.querySelectorAll<HTMLElement>('[data-tile]')]
    const reduce = prefersReducedMotion()
    for (const tile of tiles) {
      const id = tile.dataset.tile!
      const next = tile.getBoundingClientRect()
      const previous = rects.current.get(id)
      if (previous && !reduce && (previous.left !== next.left || previous.top !== next.top)) {
        tile.animate(
          [{ transform: `translate(${previous.left - next.left}px, ${previous.top - next.top}px)` }, { transform: 'translate(0, 0)' }],
          { duration: 450, easing: 'cubic-bezier(.25,1,.5,1)' },
        )
      }
      rects.current.set(id, next)
    }
  }, [orderKey])

  // Keep stored positions current when the screen size changes (no animation for that).
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const observer = new ResizeObserver(() => {
      for (const tile of grid.querySelectorAll<HTMLElement>('[data-tile]')) {
        rects.current.set(tile.dataset.tile!, tile.getBoundingClientRect())
      }
    })
    observer.observe(grid)
    return () => observer.disconnect()
  }, [])

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center text-(--text-secondary)" style={{ fontSize: u(26) }}>
        No sites to show — every site is paused or none have been added yet.
      </div>
    )
  }

  let flashIndex = 0
  return (
    <div ref={gridRef} className="tv-grid" style={style}>
      {entries.map((entry) => {
        const id = entry.snapshot.site.id
        const flashing = flash.ids.has(id)
        const delay = flashing ? flashIndex++ * 40 : 0
        return (
          <Tile
            key={id}
            entry={entry}
            now={now}
            points={data.sparklines[id] ?? []}
            sparkVersion={data.sparkStart}
            degradedSince={data.degradedSince[id]}
            flashKey={flashing ? flash.generation : 0}
            flashDelay={delay}
          />
        )
      })}
    </div>
  )
}

function Tile({
  entry,
  now,
  points,
  sparkVersion,
  degradedSince,
  flashKey,
  flashDelay,
}: {
  entry: TvEntry
  now: number
  points: (number | null)[]
  sparkVersion: string
  degradedSince: string | undefined
  flashKey: number
  flashDelay: number
}) {
  const { snapshot, status } = entry
  const { site, latest, openIncident, uptime30d, history } = snapshot
  const message = messageFor(snapshot, status)
  const color = STATUS_COLOR[status]

  let primary: React.ReactNode
  let secondary: { text: string; mono: boolean } | null
  if (status === 'down') {
    primary = openIncident ? <DownTimer since={openIncident.started_at} /> : 'Down'
    secondary = message ? { text: message.text, mono: message.kind === 'raw' } : null
  } else if (status === 'degraded') {
    primary = <TweenNumber value={latest?.response_ms ?? null} format="ms" />
    const forHow = degradedSince ? ` · ${shortDuration(now - Date.parse(degradedSince))}` : ''
    secondary = message ? { text: `${message.text}${forHow}`, mono: message.kind === 'raw' } : null
  } else if (status === 'up') {
    primary = <TweenNumber value={latest?.response_ms ?? null} format="ms" />
    secondary = { text: hostOf(site.url), mono: true }
  } else {
    primary = '—'
    secondary = message ? { text: message.text, mono: false } : null
  }

  return (
    <article className="tv-tile" data-tile={site.id} data-status={status}>
      {status === 'down' && <span className="tv-glow" />}
      {status === 'degraded' && <span className="tv-breathe" />}
      {flashKey > 0 && <span key={flashKey} className="tv-flash" style={{ animationDelay: `${flashDelay}ms` }} />}

      <div className="relative flex min-w-0 items-center justify-between" style={{ gap: u(12, true) }}>
        <div className="flex min-w-0 items-center" style={{ gap: u(10, true) }}>
          <Dot status={status} size={u(18, true)} />
          <h2 className="font-heading truncate leading-tight font-semibold" style={{ fontSize: u(24, true) }} title={site.name}>
            {site.name}
          </h2>
        </div>
        <span
          className="shrink-0 rounded-pill font-semibold"
          style={{ background: STATUS_SOFT[status], color, fontSize: u(13, true), padding: `${u(4, true)} ${u(10, true)}` }}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>

      <div className="relative flex min-w-0 items-end justify-between" style={{ gap: u(16, true) }}>
        <div className="min-w-0">
          <p
            className="tv-num truncate leading-none font-bold"
            style={{ fontSize: u(40, true), color: status === 'down' ? 'var(--status-down)' : status === 'degraded' ? 'var(--status-degraded)' : undefined }}
          >
            {primary}
          </p>
          {secondary && (
            <p
              className={`truncate text-(--text-secondary) ${secondary.mono ? 'font-mono' : 'font-sans'}`}
              style={{ fontSize: u(14, true), marginTop: u(6, true) }}
              title={secondary.text}
            >
              {secondary.text}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <TweenNumber value={uptime30d} format="pct" className="block leading-none font-semibold" style={{ fontSize: u(24, true) }} />
          <p className="text-(--text-muted)" style={{ fontSize: u(12, true), marginTop: u(5, true) }}>
            Uptime · 30d
          </p>
        </div>
      </div>

      <div className="tv-spark-wrap">
        <Sparkline
          points={points}
          color={status === 'stale' ? 'var(--status-stale)' : color}
          version={sparkVersion}
          siteThreshold={site.expected_ms}
        />
      </div>

      <div className="tv-hist relative">
        <HistoryBar history={history} height={u(16, true)} />
      </div>
    </article>
  )
}

// --- mobile (< 640 px, scrolls) --------------------------------------------------------------

function MobileView({
  data,
  ordered,
  now,
  headline,
  summary,
  bannerStatus,
  liveState,
  stats,
  feedChange,
  heatRows,
}: {
  data: TvData
  ordered: TvEntry[]
  now: number
  headline: string
  summary: string
  bannerStatus: DisplayStatus
  liveState: LiveState
  stats: { label: string; value: React.ReactNode; delta: string; color: string }[]
  feedChange: Change
  heatRows: HeatRow[]
}) {
  return (
    <div className="tv-mobile min-h-dvh flex-col gap-4 bg-(--surface-page) p-4 text-(--text-primary)">
      <header className="flex items-center gap-2.5">
        <LogoPulse mood={bannerStatus === 'stale' ? 'stale' : ordered.some((e) => e.status === 'down') ? 'down' : 'normal'} size="1.75rem" />
        <h1 className="min-w-0 flex-1 truncate text-base font-bold">System Status</h1>
        <LivePill state={liveState} compact />
        <Clock compact />
      </header>

      <section
        className="flex flex-col gap-3 rounded-lg border p-4"
        style={{
          background: STATUS_SOFT[bannerStatus],
          borderColor: bannerStatus === 'up' ? 'color-mix(in srgb, var(--status-up) 40%, transparent)' : STATUS_COLOR[bannerStatus],
        }}
      >
        <div className="flex items-center gap-3">
          <Dot status={bannerStatus} size="1.25rem" />
          <p className="text-lg leading-tight font-bold">{headline}</p>
        </div>
        <p className="text-sm text-(--text-secondary)">{summary}</p>
        <Countdown lastRunAt={data.lastRunAt} variant="bar" />
      </section>

      <dl className="grid grid-cols-2 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="min-w-0 rounded-md border border-(--border-subtle) bg-(--surface-card) p-3">
            <dt className="text-[10px] font-semibold tracking-wider text-(--text-muted) uppercase">{stat.label}</dt>
            <dd className="tv-num text-xl font-bold">{stat.value}</dd>
            <dd className="truncate text-xs" style={{ color: stat.color }}>
              {stat.delta}
            </dd>
          </div>
        ))}
      </dl>

      <h2 className="text-sm font-semibold text-(--text-secondary)">Sites</h2>
      <ul className="flex flex-col divide-y divide-(--border-subtle) overflow-hidden rounded-lg border border-(--border-subtle) bg-(--surface-card)">
        {ordered.map(({ snapshot, status }) => {
          const message = messageFor(snapshot, status)
          const line =
            status === 'up' ? hostOf(snapshot.site.url) : (message?.text ?? STATUS_LABEL[status])
          const color = STATUS_COLOR[status]
          return (
            <li key={snapshot.site.id} className="flex items-center gap-3 px-3 py-2.5">
              <Dot status={status} size="0.75rem" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{snapshot.site.name}</p>
                <p className="truncate text-xs text-(--text-muted)">{line}</p>
              </div>
              <div className="relative shrink-0" style={{ width: 64, height: 28 }}>
                <Sparkline points={data.sparklines[snapshot.site.id] ?? []} color={color} version={data.sparkStart} showCollectingLabel={false} />
              </div>
              <span className="tv-num w-14 shrink-0 text-right text-sm font-semibold" style={{ color: status === 'up' ? undefined : color }}>
                {status === 'down' ? 'DOWN' : status === 'stale' ? '—' : <TweenNumber value={snapshot.latest?.response_ms ?? null} format="plain-ms" />}
              </span>
            </li>
          )
        })}
      </ul>

      {heatRows.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-(--text-secondary)">Status · 24h</h2>
          <section className="rounded-lg border border-(--border-subtle) bg-(--surface-card) p-3" aria-label="Status, last 24 hours">
            <StatusHeatmap rows={heatRows} start={data.sparkStart} variant="mobile" />
          </section>
        </>
      )}

      <section className="flex flex-col gap-2 rounded-lg border border-(--border-subtle) bg-(--surface-card) p-4">
        <h2 className="text-sm font-semibold">
          Incidents <span className="font-normal text-(--text-muted)">· 24h</span>
        </h2>
        <FeedList items={data.feed.slice(0, 4)} now={now} newIds={feedChange.ids} generation={feedChange.generation} rowHeight="2rem" compact />
      </section>
      <p className="text-center text-xs text-(--text-muted)">Sites with issues are always listed first</p>
    </div>
  )
}
