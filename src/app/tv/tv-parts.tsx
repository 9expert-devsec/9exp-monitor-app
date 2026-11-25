'use client'

import { useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react'

import { Logo } from '@/components/logo'
import { formatPercent, rollupDayKey } from '@/lib/format'
import {
  CHECK_INTERVAL_MS,
  countdownAt,
  feedText,
  groupedMs,
  planSparkline,
  thresholdMode,
  ticking,
  type FeedItem,
  type SparkPoint,
} from '@/lib/tv'

const TIME_ZONE = 'Asia/Bangkok'

/** `calc(n × --u)` — a length that scales with the screen (see tv.css). */
export function u(n: number, scaled = false): string {
  return scaled ? `calc(${n} * var(--u) * var(--s, 1))` : `calc(${n} * var(--u))`
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// --- shared clocks ------------------------------------------------------------------
// One interval each, shared by every subscriber. Only the small components that
// show a ticking value subscribe to the 1 s store, so a tick re-renders those
// text nodes and nothing else. Server snapshot is null → no hydration mismatch.

function makeClock(stepMs: number) {
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setInterval> | null = null
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      timer ??= setInterval(() => listeners.forEach((fn) => fn()), Math.min(stepMs, 1000))
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && timer) {
          clearInterval(timer)
          timer = null
        }
      }
    },
    snapshot: () => Math.floor(Date.now() / stepMs),
  }
}
const seconds = makeClock(1000)
const minutes = makeClock(60_000)
const none = () => null

/** Current time, advancing once per second (null during SSR / hydration). */
export function useSecond(): number | null {
  const tick = useSyncExternalStore(seconds.subscribe, seconds.snapshot, none)
  return tick === null ? null : tick * 1000
}

/** Current time, advancing once per minute — for status ageing and summaries. */
export function useMinute(fallbackIso: string): number {
  const tick = useSyncExternalStore(minutes.subscribe, minutes.snapshot, none)
  // Minute resolution is enough for ageing statuses (15-minute rule) and "· 18m" texts.
  return tick === null ? Date.parse(fallbackIso) : tick * 60_000
}

export function clockText(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false })
}

function secondsText(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', { timeZone: TIME_ZONE, second: '2-digit' }).padStart(2, '0')
}

/** "Wed, Nov 25 2026" in Bangkok time. */
export function dateText(ms: number): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      .formatToParts(new Date(ms))
      .map((part) => [part.type, part.value]),
  )
  return `${parts.weekday}, ${parts.month} ${parts.day} ${parts.year}`
}

// --- M4 clock -------------------------------------------------------------------------

export function Clock({ compact = false }: { compact?: boolean }) {
  const now = useSecond()
  const hhmm = now === null ? '--:--' : clockText(now)
  const [hh, mm] = hhmm.split(':')
  return (
    <div className="text-right">
      <p className="tv-num tv-clock-main leading-none font-bold" style={{ fontSize: compact ? '1.25rem' : u(52) }}>
        {hh}
        <span className="tv-colon">:</span>
        {mm}
        {!compact && (
          <span className="font-semibold text-(--text-muted)" style={{ fontSize: u(26) }}>
            :{now === null ? '--' : secondsText(now)}
          </span>
        )}
      </p>
      {!compact && (
        <p className="text-(--text-secondary)" style={{ fontSize: u(16), marginTop: u(6) }}>
          {now === null ? ' ' : dateText(now)}
        </p>
      )}
    </div>
  )
}

// --- M3 next-check countdown ---------------------------------------------------------

function mmss(ms: number): string {
  const total = Math.ceil(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** Ring (or, on mobile, a thin bar) filling over the 5-minute window toward the next pg_cron run. */
export function Countdown({ lastRunAt, variant = 'ring' }: { lastRunAt: string | null; variant?: 'ring' | 'bar' }) {
  const now = useSecond()
  const state = now === null ? null : countdownAt(now, lastRunAt)
  const progress = state === null ? 0 : state.checking ? 1 : 1 - state.remaining / CHECK_INTERVAL_MS
  const label = state === null ? '-:--' : state.checking ? 'Checking…' : mmss(state.remaining)

  if (variant === 'bar') {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-xs text-(--text-secondary)">
          <span>Next check</span>
          <span className="tv-num">{label}</span>
        </div>
        <div className="h-1 overflow-hidden rounded-pill bg-(--surface-raised)">
          <div
            className="h-full origin-left rounded-pill bg-(--brand-signal-lime)"
            style={{ transform: `scaleX(${progress})`, opacity: state?.checking ? 0.5 : 1 }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center" style={{ gap: u(12) }}>
      <svg viewBox="0 0 44 44" style={{ width: u(44), height: u(44) }} aria-hidden="true">
        <circle cx="22" cy="22" r="18" fill="none" stroke="var(--surface-raised)" strokeWidth="4" />
        {state?.checking ? (
          <g className="tv-spin">
            <circle cx="22" cy="22" r="18" fill="none" stroke="var(--brand-signal-lime)" strokeWidth="4" strokeLinecap="round" pathLength={100} strokeDasharray="22 100" />
          </g>
        ) : (
          <circle
            cx="22"
            cy="22"
            r="18"
            fill="none"
            stroke="var(--brand-signal-lime)"
            strokeWidth="4"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="100 100"
            strokeDashoffset={100 - progress * 100}
            transform="rotate(-90 22 22)"
          />
        )}
      </svg>
      <div className="leading-tight">
        <p className="font-semibold tracking-wider text-(--text-muted) uppercase" style={{ fontSize: u(12) }}>
          Next check
        </p>
        <p className="tv-num font-semibold" style={{ fontSize: u(22) }}>
          {label}
        </p>
      </div>
    </div>
  )
}

// --- M8 down timer -----------------------------------------------------------------------

export function DownTimer({ since, style, className }: { since: string; style?: CSSProperties; className?: string }) {
  const now = useSecond()
  return (
    <span className={className} style={style}>
      {now === null ? 'Down' : `Down ${ticking(now - Date.parse(since))}`}
    </span>
  )
}

// --- M6 number tween -----------------------------------------------------------------------

type TweenFormat = 'ms' | 'pct' | 'int' | 'plain-ms'

function formatAs(kind: TweenFormat, value: number | null): string {
  if (value === null) return '—'
  if (kind === 'ms') return groupedMs(value)
  if (kind === 'plain-ms') return Math.round(value).toLocaleString('en-US')
  if (kind === 'pct') return formatPercent(value)
  return String(Math.round(value))
}

/**
 * Counts from the previous value to the new one over 500 ms (ease-out) by
 * writing the text node directly — no React re-render per frame. A value that
 * more than doubles flashes its colour once.
 */
export function TweenNumber({
  value,
  format,
  className,
  style,
}: {
  value: number | null
  format: TweenFormat
  className?: string
  style?: CSSProperties
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const previous = useRef(value)

  useEffect(() => {
    const element = ref.current
    const from = previous.current
    previous.current = value
    const node = element?.firstChild
    if (!element || !node || from === value || from === null || value === null || prefersReducedMotion()) return

    let frame = 0
    const started = performance.now()
    const step = (time: number) => {
      const k = Math.min(1, (time - started) / 500)
      const eased = 1 - Math.pow(1 - k, 3)
      node.nodeValue = formatAs(format, from + (value - from) * eased)
      if (k < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    if (from > 0 && value > from * 2) {
      element.animate([{ color: 'var(--brand-signal-lime)' }, {}], { duration: 900, easing: 'ease-out' })
    }
    return () => {
      cancelAnimationFrame(frame)
      node.nodeValue = formatAs(format, value)
    }
  }, [value, format])

  return (
    <span ref={ref} className={`tv-num ${className ?? ''}`} style={style}>
      {formatAs(format, value)}
    </span>
  )
}

// --- M7 sparkline ------------------------------------------------------------------------------

/**
 * Fixed-axis sparkline (24 h for tiles, 6 h for the rail), built to read well
 * when most buckets are empty:
 *  - a faint dotted baseline spans the full width, so empty stretches read as
 *    "no data" rather than a broken chart;
 *  - gaps of ≤ 2 buckets are bridged; longer gaps stay broken;
 *  - isolated points are small dots (no area, no stub);
 *  - under 4 points: baseline + dots + "Collecting data…" instead of an area;
 *  - per-series Y range with ~15 % padding; a flat series sits mid-height;
 *  - the live end-dot only when the newest bucket has data.
 * When a new bucket arrives (`version` changes) the line slides left one step,
 * the last segment draws in (700 ms) and the end-dot pulses.
 *
 * `siteThreshold` (tiles): the site's own "degraded above" line, dashed amber.
 * In scale when the 24 h peak is ≥ 50 % of it (it joins the y-range, label on
 * the left); otherwise pinned to the top edge, faded, with "↑ 1,500 ms" on the
 * right — the threshold is above this chart. Static; only the label fades in
 * (200 ms) when a site moves between the two.
 */
export function Sparkline({
  points,
  color,
  version,
  threshold = null,
  siteThreshold = null,
  showCollectingLabel = true,
  className,
}: {
  points: (number | null)[]
  color: string
  version: string
  threshold?: number | null
  /** The site's own expected_ms (TV tiles). */
  siteThreshold?: number | null
  /** Off where there is no room for the label (the 64 × 28 mobile row). */
  showCollectingLabel?: boolean
  className?: string
}) {
  const rawId = useId()
  const gradientId = `tvg${rawId.replace(/[^a-zA-Z0-9]/g, '')}`
  const groupRef = useRef<SVGGElement>(null)
  const lastRef = useRef<SVGPathElement>(null)
  const dotRef = useRef<HTMLSpanElement>(null)
  const limitRef = useRef<HTMLSpanElement>(null)
  const seen = useRef({ version, last: points.at(-1) ?? null })

  const n = points.length
  const mode = thresholdMode(points, siteThreshold)
  const seenMode = useRef(mode)
  const plan = planSparkline(points, { threshold: mode === 'in-scale' ? siteThreshold : threshold })
  const x = (index: number) => (n > 1 ? (index / (n - 1)) * 100 : 50)
  const y = (value: number) => 100 - ((value - plan.lo) / (plan.hi - plan.lo)) * 100
  const line = (run: SparkPoint[]) =>
    run.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.index).toFixed(2)},${y(p.value).toFixed(2)}`).join(' ')

  const lastRun = plan.runs.at(-1)
  const lastSegment =
    lastRun && lastRun.length > 1 && plan.endIndex !== null && lastRun.at(-1)!.index === plan.endIndex
      ? line(lastRun.slice(-2))
      : null
  const endValue = plan.endIndex !== null ? points[plan.endIndex] : null

  useEffect(() => {
    const before = seen.current
    seen.current = { version, last: points.at(-1) ?? null }
    if (prefersReducedMotion()) return
    if (before.version !== version && n > 1) {
      const step = 100 / (n - 1)
      groupRef.current?.animate([{ transform: `translateX(${step}px)` }, { transform: 'translateX(0)' }], {
        duration: 700,
        easing: 'ease-out',
      })
      lastRef.current?.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 700, easing: 'ease-out' })
    }
    if (before.version !== version || before.last !== (points.at(-1) ?? null)) {
      dotRef.current?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.9)' }, { transform: 'scale(1)' }], {
        duration: 600,
        easing: 'ease-out',
      })
    }
  }, [version, points, n])

  useEffect(() => {
    const before = seenMode.current
    seenMode.current = mode
    if (before === mode || before === null || mode === null || prefersReducedMotion()) return
    limitRef.current?.animate([{ opacity: 0 }, {}], { duration: 200, easing: 'ease-out' })
  }, [mode])

  const limitY = mode === 'in-scale' && siteThreshold !== null ? y(siteThreshold) : 0

  // Isolated points, plus every point while collecting — minus the end-dot's own point.
  const dots = plan.dots.filter((dot) => dot.index !== plan.endIndex)

  return (
    <div className={`tv-spark ${className ?? ''}`} aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* "No data" reads as a quiet dotted floor, not as a broken chart. */}
        <line
          x1="0"
          x2="100"
          y1="99"
          y2="99"
          stroke="var(--text-muted)"
          strokeOpacity="0.35"
          strokeWidth="1"
          strokeDasharray="1 4"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {threshold !== null && (
          <line
            x1="0"
            x2="100"
            y1={y(threshold)}
            y2={y(threshold)}
            stroke="var(--status-degraded)"
            strokeWidth="1"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {mode !== null && (
          <line
            x1="0"
            x2="100"
            y1={limitY}
            y2={limitY}
            stroke="var(--status-degraded)"
            strokeOpacity={mode === 'in-scale' ? 0.9 : 0.4}
            strokeWidth="1.5"
            strokeDasharray="6 5"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <g ref={groupRef}>
          {plan.runs.map((run, i) => (
            <path
              key={`a${i}`}
              d={`${line(run)} L${x(run.at(-1)!.index).toFixed(2)},100 L${x(run[0].index).toFixed(2)},100 Z`}
              fill={`url(#${gradientId})`}
            />
          ))}
          {plan.runs.map((run, i) => (
            <path
              key={`l${i}`}
              d={line(run)}
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {lastSegment && (
            <path
              ref={lastRef}
              d={lastSegment}
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray="1 1"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>
      </svg>
      {dots.map((dot) => (
        <span
          key={dot.index}
          className="tv-spark-point"
          style={{ left: `${x(dot.index)}%`, top: `${y(dot.value)}%`, background: color }}
        />
      ))}
      {plan.endIndex !== null && endValue !== null && (
        <span
          ref={dotRef}
          className="tv-spark-dot"
          style={{ left: `${x(plan.endIndex)}%`, top: `${y(endValue)}%`, background: color, color }}
        />
      )}
      {mode !== null && siteThreshold !== null && (
        <span
          ref={limitRef}
          className="tv-spark-limit tv-num"
          data-mode={mode}
          style={mode === 'in-scale' ? { top: `${limitY}%` } : undefined}
        >
          {mode === 'above' ? `↑ ${groupedMs(siteThreshold)}` : groupedMs(siteThreshold)}
        </span>
      )}
      {plan.collecting && showCollectingLabel && <span className="tv-spark-label">Collecting data…</span>}
    </div>
  )
}

// --- M2 LIVE pill ----------------------------------------------------------------------------------

export type LiveState = 'live' | 'reconnecting' | 'stale'

export function LivePill({ state, compact = false }: { state: LiveState; compact?: boolean }) {
  const tone =
    state === 'live'
      ? { fg: 'var(--status-up)', bg: 'var(--status-up-soft)', label: 'LIVE' }
      : state === 'reconnecting'
        ? { fg: 'var(--status-degraded)', bg: 'var(--status-degraded-soft)', label: 'RECONNECTING' }
        : { fg: 'var(--status-stale)', bg: 'var(--status-stale-soft)', label: 'STALE' }
  const dot = compact ? '0.5rem' : u(10)
  return (
    <span
      role="status"
      className="inline-flex shrink-0 items-center rounded-pill font-bold tracking-wider"
      style={{
        background: tone.bg,
        color: tone.fg,
        gap: compact ? '0.4rem' : u(10),
        padding: compact ? '0.25rem 0.6rem' : `${u(6)} ${u(14)}`,
        fontSize: compact ? '0.7rem' : u(14),
      }}
    >
      <span className="relative inline-block" style={{ width: dot, height: dot }}>
        {state === 'live' && <span className="tv-halo" />}
        <span className="absolute inset-0 rounded-pill" style={{ background: tone.fg }} />
      </span>
      {tone.label}
    </span>
  )
}

// --- M1 logo heartbeat ------------------------------------------------------------------------------

/** The real logo PNG with a soft light sweep masked to its shape. Never redrawn or traced. */
export function LogoPulse({ mood, size }: { mood: 'normal' | 'down' | 'stale'; size: string }) {
  return (
    <span className="tv-logo inline-block" style={{ width: size, height: size, opacity: mood === 'stale' ? 0.6 : 1 }}>
      <Logo size={96} style={{ width: size, height: size }} />
      {mood !== 'stale' && (
        <span className="tv-logo-sweep" style={{ '--sweep': mood === 'down' ? '1.2s' : '2.4s' } as CSSProperties}>
          {mood === 'down' && <span className="tv-logo-tint" />}
        </span>
      )}
    </span>
  )
}

// --- feed ----------------------------------------------------------------------------------------------

/** "17:05" today, "Yesterday 17:05" (muted "Yesterday") for anything before today, Bangkok days. */
export function FeedTime({ at, now }: { at: string; now: number }) {
  const ms = Date.parse(at)
  const earlier = rollupDayKey(new Date(ms)) !== rollupDayKey(new Date(now))
  return (
    <span className="tv-num relative shrink-0 text-(--text-muted) whitespace-nowrap">
      {earlier && <span className="font-sans opacity-75">Yesterday </span>}
      {clockText(ms)}
    </span>
  )
}

const FEED_COLOR = {
  down: 'var(--status-down)',
  recovered: 'var(--status-up)',
  degraded: 'var(--status-degraded)',
} as const

export function FeedIcon({ kind, size }: { kind: FeedItem['kind']; size: string }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" style={{ width: size, height: size, flexShrink: 0 }}>
      {kind === 'degraded' ? (
        <path d="M6 0.5 L11.5 11 L0.5 11 Z" fill={FEED_COLOR[kind]} />
      ) : (
        <circle cx="6" cy="6" r="5" fill={FEED_COLOR[kind]} />
      )}
    </svg>
  )
}

/**
 * M10: new incidents slide in at the top (the list is pushed down) and stay
 * highlighted for 3 s. `newIds` / `generation` come from the wall's refresh.
 */
export function FeedList({
  items,
  now,
  newIds,
  generation,
  rowHeight,
  compact = false,
}: {
  items: FeedItem[]
  /** For the "Yesterday" label. */
  now: number
  newIds: ReadonlySet<string>
  generation: number
  rowHeight: string
  compact?: boolean
}) {
  const listRef = useRef<HTMLUListElement>(null)

  useLayoutEffect(() => {
    if (generation === 0 || prefersReducedMotion()) return
    const list = listRef.current
    const first = list?.firstElementChild as HTMLElement | null
    const count = items.filter((item) => newIds.has(item.id)).length
    if (!list || !first || count === 0) return
    list.animate([{ transform: `translateY(-${first.offsetHeight * count}px)` }, { transform: 'translateY(0)' }], {
      duration: 400,
      easing: 'cubic-bezier(.2,.8,.2,1)',
    })
  }, [generation, items, newIds])

  if (items.length === 0) {
    return (
      // Fills the rail's spare height like the list would, so the chart stays at the bottom.
      <p className={`text-(--text-muted) ${compact ? '' : 'flex-1'}`} style={{ fontSize: compact ? '0.8rem' : u(15) }}>
        No incidents in the last 24h
      </p>
    )
  }

  return (
    <ul ref={listRef} className={compact ? 'flex flex-col' : 'tv-feed flex-1'}>
      {items.map((item) => (
        <li
          key={item.id}
          className={`tv-feed-row flex min-w-0 items-center ${newIds.has(item.id) ? 'tv-feed-new' : ''}`}
          style={{ height: rowHeight, gap: compact ? '0.6rem' : u(12), fontSize: compact ? '0.8rem' : u(15) }}
        >
          <FeedTime at={item.at} now={now} />
          <span className="relative inline-flex">
            <FeedIcon kind={item.kind} size={compact ? '0.6rem' : u(11)} />
          </span>
          <span className="relative min-w-0 truncate" title={feedText(item)}>
            {feedText(item)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Laptop ticker: the feed as a seamless marquee at ~40 px/s. The track holds
 * the items twice; its width is measured once per resize to set the duration.
 */
export function Ticker({ items, now }: { items: FeedItem[]; now: number }) {
  const trackRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const apply = () => track.style.setProperty('--marquee', `${Math.max(10, track.scrollWidth / 2 / 40)}s`)
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(track)
    return () => observer.disconnect()
  }, [items])

  const content = items.length === 0 ? null : items
  return (
    <div
      className="tv-ticker min-w-0 items-center overflow-hidden rounded-md border border-(--border-subtle) bg-(--surface-card)"
      style={{ gap: u(16), padding: `${u(10)} ${u(16)}`, fontSize: u(15) }}
    >
      <span className="shrink-0 font-semibold tracking-wider text-(--text-muted)" style={{ fontSize: u(12) }}>
        INCIDENTS 24H
      </span>
      <div className="min-w-0 flex-1 overflow-hidden">
        {content === null ? (
          <span className="text-(--text-muted)">No incidents in the last 24h</span>
        ) : (
          <div ref={trackRef} className="tv-marquee">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex shrink-0" aria-hidden={copy === 1 ? true : undefined}>
                {content.map((item) => (
                  <span key={`${copy}-${item.id}`} className="inline-flex items-center whitespace-nowrap" style={{ gap: u(8), paddingRight: u(40) }}>
                    <FeedTime at={item.at} now={now} />
                    <FeedIcon kind={item.kind} size={u(10)} />
                    {feedText(item)}
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
