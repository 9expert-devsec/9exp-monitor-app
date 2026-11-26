'use client'

import { LayoutGrid } from 'lucide-react'
import { useLayoutEffect, useRef, type CSSProperties } from 'react'

import { StatusDot } from '@/components/status-dot'
import { STATUS_LABEL } from '@/lib/status'
import { heatAxis, type HeatStatus } from '@/lib/tv'
import type { DisplayStatus } from '@/lib/types'

export interface HeatRow {
  id: string
  name: string
  /** Currently down or degraded — the label is drawn brighter. */
  issue: boolean
  /** Worst status per bucket, oldest first (TvData.heatmap). */
  cells: HeatStatus[]
}

/**
 * Sizes and furniture per place:
 *  - large   portrait / ultrawide card: header + legend, "Yesterday", "00:00 · Today"
 *  - compact 16:9 right column: "30-min buckets" note, no legend (the footer has one)
 *  - mobile  own section: legend under the axis
 */
export type HeatVariant = 'large' | 'compact' | 'mobile'

const LEGEND: DisplayStatus[] = ['up', 'degraded', 'down', 'stale']
const BUCKET_MS = 30 * 60_000
const SHIFT_MS = 300
const FADE_MS = 400

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function summaryOf(rows: HeatRow[]): string {
  const parts = rows.map((row) => {
    const down = row.cells.filter((cell) => cell === 'down').length
    const slow = row.cells.filter((cell) => cell === 'degraded').length
    if (down === 0 && slow === 0) {
      return row.cells.some((cell) => cell !== null) ? `${row.name}: no issues` : `${row.name}: no data`
    }
    return `${row.name}: ${down} down, ${slow} slow`
  })
  return `Status in 30-minute periods over the last 24 hours. ${parts.join('; ')}.`
}

function Legend() {
  return (
    <ul className="tv-heat-legend" aria-hidden="true">
      {LEGEND.map((status) => (
        <li key={status}>
          <span className="tv-heat-legend-dot">
            <StatusDot status={status} decorative />
          </span>
          {STATUS_LABEL[status]}
        </li>
      ))}
    </ul>
  )
}

/**
 * M13 — 24 h status heatmap. Rows are the sites in the tile order; columns are
 * the sparkline's 48 × 30-minute buckets (`start` = TvData.sparkStart). When
 * `start` advances the grid shifts one column left (300 ms); a new status in
 * the live column fades in (400 ms). Transform / opacity only; reduced motion
 * gets neither, and the live outline stays static (tv.css).
 */
export function StatusHeatmap({
  rows,
  start,
  variant,
  className,
}: {
  rows: HeatRow[]
  start: string
  variant: HeatVariant
  className?: string
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const seen = useRef<{ start: string; live: Map<string, string> } | null>(null)

  const count = Math.max(48, ...rows.map((row) => row.cells.length))
  const startMs = Date.parse(start)
  const axis = heatAxis(startMs, BUCKET_MS, count)
  const large = variant === 'large'
  // Newest-bucket status per row as a string, so the effect below re-runs only when it changes.
  const liveKey = rows.map((row) => `${row.id}=${row.cells.at(-1) ?? 'none'}`).join(' ')

  useLayoutEffect(() => {
    const before = seen.current
    const live = new Map(liveKey.split(' ').map((pair) => pair.split('=') as [string, string]))
    seen.current = { start, live }
    const track = trackRef.current
    if (!before || !track || prefersReducedMotion()) return

    if (before.start !== start) {
      // New bucket: the data already moved one column left; slide it in from where it was.
      const row = track.querySelector<HTMLElement>('.tv-heat-row')
      const gap = row ? parseFloat(getComputedStyle(row).columnGap) || 0 : 0
      const column = (track.clientWidth + gap) / count
      track.animate([{ transform: `translateX(${column}px)` }, { transform: 'translateX(0)' }], {
        duration: SHIFT_MS,
        easing: 'ease-out',
      })
      return
    }
    for (const [id, status] of live) {
      if (before.live.get(id) === status) continue
      track
        .querySelector<HTMLElement>(`[data-live="${id}"]`)
        ?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease-out' })
    }
  }, [start, liveKey, count])

  const style = { '--n': count } as CSSProperties
  // Keep hour labels clear of "Now" (and of the left edge); tiny cells need more columns of room.
  const showTick = (index: number) => index >= 1 && index <= count - (large ? 5 : 9)

  return (
    <div className={`tv-heat tv-heat-${variant} ${className ?? ''}`} style={style}>
      {variant !== 'mobile' && (
        <div className="tv-heat-head">
          <h2 className="tv-heat-title">
            <LayoutGrid className="tv-heat-icon" aria-hidden="true" />
            {large ? 'Status · last 24h' : 'Status · 24h'}
          </h2>
          {large ? <Legend /> : <span className="tv-heat-note">30-min buckets</span>}
        </div>
      )}

      <div className="tv-heat-body" role="img" aria-label={summaryOf(rows)}>
        <div className="tv-heat-labels" aria-hidden="true">
          {rows.map((row) => (
            <span key={row.id} className="tv-heat-label" data-issue={row.issue} title={row.name}>
              {row.name}
            </span>
          ))}
        </div>
        <div className="tv-heat-area" aria-hidden="true">
          <div className="tv-heat-clip">
            <div ref={trackRef} className="tv-heat-track">
              {rows.map((row) => (
                <div key={row.id} className="tv-heat-row">
                  {Array.from({ length: count }, (_, index) => {
                    const cell = row.cells[index] ?? null
                    return (
                      <span
                        key={index}
                        className="tv-heat-cell"
                        data-s={cell ?? 'none'}
                        data-live={index === count - 1 ? row.id : undefined}
                      />
                    )
                  })}
                </div>
              ))}
              {axis.midnight !== null && (
                <span className="tv-heat-midnight" style={{ '--i': axis.midnight } as CSSProperties} />
              )}
            </div>
          </div>
          <span className="tv-heat-live" />
        </div>
      </div>

      <div className="tv-heat-axis tv-num" aria-hidden="true">
        <span className="tv-heat-yesterday">{large ? 'Yesterday' : ''}</span>
        <div className="tv-heat-axis-track">
          {axis.ticks
            .filter((tick) => showTick(tick.index))
            .map((tick) => (
              <span key={tick.index} className="tv-heat-tick" style={{ '--i': tick.index } as CSSProperties}>
                {tick.index === axis.midnight && large ? (
                  <>
                    {tick.label}
                    <span className="font-sans"> · Today</span>
                  </>
                ) : (
                  tick.label
                )}
              </span>
            ))}
          <span className="tv-heat-now font-sans">Now</span>
        </div>
      </div>

      {variant === 'mobile' && <Legend />}
    </div>
  )
}
