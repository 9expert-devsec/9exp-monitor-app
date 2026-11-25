'use client'

import { Maximize, Minimize, WifiOff } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'

import { refreshTvAction } from '@/app/tv/actions'
import { HistoryBar } from '@/components/history-bar'
import { Logo } from '@/components/logo'
import { headlineFor, worstStatus, type StatusCounts } from '@/components/overall-status-card'
import { messageFor } from '@/components/site-card'
import { StatusDot } from '@/components/status-dot'
import type { DashboardData } from '@/lib/dashboard'
import { formatDuration, formatPercent, hostOf } from '@/lib/format'
import { CHECKER_NEVER_RAN_MESSAGE, CHECKER_STALLED_MESSAGE } from '@/lib/messages'
import { STATUS_COLOR, STATUS_LABEL, displayStatusOf, isStale } from '@/lib/status'
import { gridFor, orderForTv, type TvEntry } from '@/lib/tv'
import type { DisplayStatus } from '@/lib/types'

const REFRESH_MS = 30_000
/** Long-running kiosk browsers leak; a full reload every 6 hours sheds that. */
const FULL_RELOAD_MS = 6 * 60 * 60 * 1000
const IDLE_MS = 5_000
const TIME_ZONE = 'Asia/Bangkok'
const LEGEND: DisplayStatus[] = ['up', 'degraded', 'down', 'stale']

/**
 * A length that scales with the screen. Designed at 1920 × 1080: `u(24)` is
 * 24 px there, 48 px at 3840 × 2160 and ~17 px at 1366 × 768 — whichever of
 * width or height is tighter wins, so it never overflows a non-16:9 screen.
 * Tile text is multiplied by --tv-scale, which shrinks as the grid gets denser.
 */
function u(px: number, scaled = false): string {
  const base = `min(${(px / 19.2).toFixed(3)}vw, ${(px / 10.8).toFixed(3)}vh)`
  return scaled ? `calc(${base} * var(--tv-scale, 1))` : base
}

// --- clock: one tick per second, client only (no hydration mismatch) ---------
function subscribeToSeconds(onTick: () => void) {
  const timer = setInterval(onTick, 1000)
  return () => clearInterval(timer)
}
const currentSecond = () => Math.floor(Date.now() / 1000)
const noSecondOnServer = () => null

function clockText(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false })
}

/** "Tue, Nov 24 2026" in Bangkok time. */
function dateText(ms: number): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      .formatToParts(new Date(ms))
      .map((part) => [part.type, part.value]),
  )
  return `${parts.weekday}, ${parts.month} ${parts.day} ${parts.year}`
}

function ms(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${Math.round(value).toLocaleString('en-US')} ms`
}

const TONE: Record<DisplayStatus, { border: string; background: string; glow?: string }> = {
  down: { border: 'var(--status-down)', background: 'var(--status-down-soft)', glow: '0 0 0 1px var(--status-down), 0 0 32px -8px var(--status-down)' },
  degraded: { border: 'var(--status-degraded)', background: 'var(--status-degraded-soft)', glow: '0 0 24px -10px var(--status-degraded)' },
  up: { border: 'color-mix(in srgb, var(--status-up) 45%, transparent)', background: 'var(--status-up-soft)' },
  stale: { border: 'var(--status-stale)', background: 'var(--status-stale-soft)' },
}

function Dot({ status, px, scaled = false }: { status: DisplayStatus; px: number; scaled?: boolean }) {
  return (
    <span className="inline-flex shrink-0 [&>svg]:size-full" style={{ width: u(px, scaled), height: u(px, scaled) }}>
      <StatusDot status={status} decorative />
    </span>
  )
}

export interface TvInitial {
  snapshots: DashboardData['snapshots']
  lastRunAt: string | null
  renderedAt: string
}

/**
 * The wall display. Refreshes its data every 30 s through a Server Action (the
 * same `getDashboardData()` as the overview) and keeps the last good data on
 * screen when a refresh fails. Runs unattended: keeps the screen awake, hides
 * the cursor when idle, reloads itself every 6 hours.
 */
export function TvWall({ initial, autoRefresh = true }: { initial: TvInitial; autoRefresh?: boolean }) {
  const [data, setData] = useState(initial)
  const [connectionLost, setConnectionLost] = useState(false)
  const [pointerActive, setPointerActive] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const second = useSyncExternalStore(subscribeToSeconds, currentSecond, noSecondOnServer)
  const now = second !== null ? second * 1000 : Date.parse(data.renderedAt)

  // Data refresh, every 30 s. A failure keeps the last data and shows a note.
  useEffect(() => {
    if (!autoRefresh) return
    let cancelled = false
    const timer = setInterval(async () => {
      try {
        const result = await refreshTvAction()
        if (cancelled) return
        if (result.ok) {
          setData({ snapshots: result.data.snapshots, lastRunAt: result.data.lastRunAt, renderedAt: result.data.renderedAt })
          setConnectionLost(false)
        } else if (result.reason === 'signed_out') {
          // Let the proxy send the browser to /login rather than showing stale data forever.
          window.location.reload()
        } else {
          setConnectionLost(true)
        }
      } catch {
        if (!cancelled) setConnectionLost(true)
      }
    }, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [autoRefresh])

  // Full reload every 6 hours.
  useEffect(() => {
    if (!autoRefresh) return
    const timer = setTimeout(() => window.location.reload(), FULL_RELOAD_MS)
    return () => clearTimeout(timer)
  }, [autoRefresh])

  // Keep the screen awake where the Wake Lock API exists; re-acquire when the tab is shown again.
  useEffect(() => {
    if (!('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    const acquire = async () => {
      try {
        if (document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen')
      } catch {
        // Unsupported, denied or battery saver: ignore silently.
      }
    }
    void acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      document.removeEventListener('visibilitychange', acquire)
      void lock?.release().catch(() => {})
    }
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

  // --- derive ---------------------------------------------------------------------
  const entries: TvEntry[] = data.snapshots.map((snapshot) => ({
    snapshot,
    status: displayStatusOf(snapshot.latest, now),
  }))
  const counts: StatusCounts = { up: 0, degraded: 0, down: 0, stale: 0 }
  for (const entry of entries) counts[entry.status] += 1
  const total = entries.length
  const ordered = orderForTv(entries)
  const grid = gridFor(total)

  const checkerStalled = isStale(data.lastRunAt, now)
  const bannerStatus: DisplayStatus = checkerStalled ? 'stale' : worstStatus(counts, total)
  const headline = checkerStalled ? 'No recent data' : headlineFor(counts, total)
  const banner = TONE[bannerStatus]

  return (
    <div
      onPointerMove={onPointerMove}
      className={`fixed inset-0 flex flex-col overflow-hidden bg-(--surface-page) text-(--text-primary) ${
        pointerActive ? '' : 'cursor-none'
      }`}
      style={{ padding: u(48), gap: u(24) }}
    >
      {/* Top bar */}
      <header className="flex shrink-0 items-center justify-between" style={{ gap: u(24) }}>
        <div className="flex min-w-0 items-center" style={{ gap: u(20) }}>
          <Logo size={104} style={{ width: u(52), height: u(52) }} />
          <div className="min-w-0">
            <h1 className="truncate leading-tight font-bold" style={{ fontSize: u(40) }}>
              9Expert System Status
            </h1>
            <p className="flex items-center text-(--text-secondary)" style={{ fontSize: u(18), gap: u(12) }}>
              <span className="truncate">
                Auto-refresh · checks every 5 min · last run{' '}
                <span className="font-mono">{data.lastRunAt ? clockText(Date.parse(data.lastRunAt)) : 'never'}</span>
              </span>
              {connectionLost && (
                <span
                  role="status"
                  className="inline-flex shrink-0 items-center rounded-pill bg-(--status-degraded-soft) text-(--status-degraded)"
                  style={{ gap: u(6), padding: `${u(2)} ${u(10)}` }}
                >
                  <WifiOff aria-hidden="true" style={{ width: u(16), height: u(16) }} />
                  Connection lost — retrying
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono leading-none font-bold tabular-nums" style={{ fontSize: u(56) }}>
            {second !== null ? clockText(now) : '--:--'}
          </p>
          <p className="text-(--text-secondary)" style={{ fontSize: u(18), marginTop: u(6) }}>
            {second !== null ? dateText(now) : ' '}
          </p>
        </div>
      </header>

      {/* Banner */}
      <section
        aria-label="Overall status"
        className="flex shrink-0 items-center justify-between rounded-lg border-2"
        style={{ borderColor: banner.border, background: banner.background, minHeight: u(104), padding: `${u(16)} ${u(32)}`, gap: u(24) }}
      >
        <div className="flex min-w-0 items-center" style={{ gap: u(20) }}>
          <Dot status={bannerStatus} px={40} />
          <div className="min-w-0">
            <p className="truncate leading-tight font-bold" style={{ fontSize: u(36) }}>
              {headline}
            </p>
            {checkerStalled && (
              <p className="truncate font-sans text-(--text-secondary)" style={{ fontSize: u(18) }}>
                {data.lastRunAt === null ? CHECKER_NEVER_RAN_MESSAGE : CHECKER_STALLED_MESSAGE}
              </p>
            )}
          </div>
        </div>
        <p className="shrink-0 font-mono font-semibold tabular-nums" style={{ fontSize: u(28) }}>
          {counts.up} / {total} <span className="font-sans font-normal text-(--text-secondary)">operational</span>
        </p>
      </section>

      {/* Grid */}
      {total === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-(--text-secondary)" style={{ fontSize: u(28) }}>
          No sites to show — every site is paused or none have been added yet.
        </div>
      ) : (
        <div
          className="grid min-h-0 flex-1"
          style={
            {
              '--tv-scale': grid.scale,
              gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
              gap: u(24, true),
            } as CSSProperties
          }
        >
          {ordered.map((entry) => (
            <Tile key={entry.snapshot.site.id} entry={entry} now={now} historyDays={grid.historyDays} />
          ))}
        </div>
      )}

      {/* Footer */}
      <footer className="flex shrink-0 items-center text-(--text-muted)" style={{ fontSize: u(16), gap: u(20) }}>
        <span className="shrink-0">Sites with issues are always listed first</span>
        <span aria-hidden="true" className="h-px flex-1 bg-(--border-subtle)" />
        <ul className="flex shrink-0 items-center" style={{ gap: u(24) }} aria-label="Legend">
          {LEGEND.map((status) => (
            <li key={status} className="flex items-center" style={{ gap: u(8) }}>
              <Dot status={status} px={14} />
              {STATUS_LABEL[status]}
            </li>
          ))}
        </ul>
      </footer>

      {/* Fullscreen needs a user gesture, so the control appears only while the mouse moves. */}
      {pointerActive && (
        <button
          type="button"
          onClick={toggleFullscreen}
          className="fixed inline-flex items-center rounded-md border border-(--border-strong) bg-(--surface-raised) text-(--text-primary) shadow-lg shadow-black/40"
          style={{ right: u(24), bottom: u(24), gap: u(8), padding: `${u(8)} ${u(14)}`, fontSize: u(16) }}
        >
          {fullscreen ? (
            <Minimize aria-hidden="true" style={{ width: u(18), height: u(18) }} />
          ) : (
            <Maximize aria-hidden="true" style={{ width: u(18), height: u(18) }} />
          )}
          {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        </button>
      )}
    </div>
  )
}

function Tile({ entry, now, historyDays }: { entry: TvEntry; now: number; historyDays: number }) {
  const { snapshot, status } = entry
  const { site, latest, openIncident, uptime30d, history } = snapshot
  const tone = TONE[status]
  const message = messageFor(snapshot, status)

  let primary: string
  let secondary: { text: string; mono: boolean } | null
  if (status === 'down') {
    primary = openIncident ? `Down for ${formatDuration(openIncident.started_at, null, now)}` : 'Down'
    secondary = message ? { text: message.text, mono: message.kind === 'raw' } : null
  } else if (status === 'degraded') {
    primary = ms(latest?.response_ms)
    secondary = message ? { text: message.text, mono: message.kind === 'raw' } : null
  } else if (status === 'up') {
    primary = ms(latest?.response_ms)
    secondary = { text: hostOf(site.url), mono: true }
  } else {
    primary = '—'
    secondary = message ? { text: message.text, mono: false } : null
  }

  return (
    <article
      className="flex min-h-0 min-w-0 flex-col justify-between rounded-lg bg-(--surface-card)"
      style={{
        border: `${status === 'down' ? 2 : 1}px solid ${status === 'up' || status === 'stale' ? 'var(--border-subtle)' : tone.border}`,
        boxShadow: tone.glow,
        padding: `${u(20, true)} ${u(24, true)}`,
        gap: u(10, true),
      }}
    >
      {/* Row 1 */}
      <div className="flex min-w-0 items-center justify-between" style={{ gap: u(12, true) }}>
        <div className="flex min-w-0 items-center" style={{ gap: u(12, true) }}>
          <Dot status={status} px={20} scaled />
          <h2 className="truncate leading-tight font-semibold" style={{ fontSize: u(26, true) }} title={site.name}>
            {site.name}
          </h2>
        </div>
        <span className="shrink-0 font-semibold" style={{ fontSize: u(16, true), color: STATUS_COLOR[status] }}>
          {STATUS_LABEL[status]}
        </span>
      </div>

      {/* Row 2 */}
      <div className="flex min-w-0 items-end justify-between" style={{ gap: u(16, true) }}>
        <div className="min-w-0">
          <p
            className="truncate font-mono leading-none font-bold tabular-nums"
            style={{ fontSize: u(44, true), color: status === 'down' ? 'var(--status-down)' : undefined }}
          >
            {primary}
          </p>
          {secondary && (
            <p
              className={`truncate text-(--text-secondary) ${secondary.mono ? 'font-mono' : 'font-sans'}`}
              style={{ fontSize: u(16, true), marginTop: u(8, true) }}
              title={secondary.text}
            >
              {secondary.text}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono leading-none font-semibold tabular-nums" style={{ fontSize: u(26, true) }}>
            {formatPercent(uptime30d)}
          </p>
          <p className="text-(--text-muted)" style={{ fontSize: u(14, true), marginTop: u(6, true) }}>
            Uptime · 30d
          </p>
        </div>
      </div>

      {/* Row 3 — the most recent `historyDays` days, so dense grids never overflow. */}
      <div className="min-w-0 overflow-hidden">
        <HistoryBar history={history.slice(-historyDays)} height={u(28, true)} />
      </div>
    </article>
  )
}
