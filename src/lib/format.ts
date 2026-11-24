/** Formatting helpers shared by server and client components. */

const TIME_ZONE = 'Asia/Bangkok'

/**
 * The `day` key used by `daily_rollups`, in the same Bangkok-local timezone the
 * `record_health_check()` migration function uses. `en-CA` is the shortest way
 * to get ISO-shaped YYYY-MM-DD out of `toLocaleDateString`.
 */
export function rollupDayKey(date: Date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: TIME_ZONE })
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  // Two decimals below 100 so 99.99% and 100% do not both render as "100%".
  return value >= 100 ? '100%' : `${value.toFixed(2)}%`
}

/**
 * Relative difference against a baseline: "▲ 312% vs 24h avg",
 * "▼ 6% vs 24h avg" or "Same as 24h avg".
 * Returns null when there is nothing meaningful to compare.
 */
export function formatDelta(
  current: number | null | undefined,
  baseline: number | null | undefined,
): { text: string; direction: 'faster' | 'slower' | 'flat' } | null {
  if (current === null || current === undefined) return null
  if (baseline === null || baseline === undefined || baseline <= 0) return null

  const percent = Math.round(((current - baseline) / baseline) * 100)
  if (percent === 0) return { text: 'Same as 24h avg', direction: 'flat' }
  return percent > 0
    ? { text: `▲ ${percent}% vs 24h avg`, direction: 'slower' }
    : { text: `▼ ${Math.abs(percent)}% vs 24h avg`, direction: 'faster' }
}

/** "14:05", Bangkok time. */
export function formatClock(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('en-GB', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** "Aug 26 14:05", Bangkok time. */
export function formatShortDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const day = date.toLocaleDateString('en-US', {
    timeZone: TIME_ZONE,
    month: 'short',
    day: 'numeric',
  })
  return `${day} ${formatClock(iso)}`
}

/** "Aug 26" for a YYYY-MM-DD rollup day key. */
export function formatMonthDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return day
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
}

/** "HTTP 503 Service Unavailable" → "HTTP 503 · Service Unavailable". */
export function formatCheckError(error: string): string {
  return error.replace(/^HTTP (\d{3}) (?=\S)/, 'HTTP $1 · ')
}

/** "www.9expert.co.th" from a full URL; the raw string if it does not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return date.toLocaleString('en-GB', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return day
  return date.toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/** "3 minutes ago", "2 hours ago". Coarse on purpose. */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never'
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return 'unknown'

  const seconds = Math.round((now - ts) / 1000)
  if (seconds < 0) return 'just now'
  if (seconds < 60) return `${seconds}s ago`

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  return `${Math.round(hours / 24)}d ago`
}

/** Incident duration, or elapsed-so-far when still open. */
export function formatDuration(startIso: string, endIso: string | null, now = Date.now()): string {
  const start = Date.parse(startIso)
  const end = endIso ? Date.parse(endIso) : now
  if (Number.isNaN(start) || Number.isNaN(end)) return '—'

  const totalMinutes = Math.max(1, Math.round((end - start) / 60_000))
  if (totalMinutes < 60) return `${totalMinutes}m`

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours < 24) return minutes ? `${hours}h ${minutes}m` : `${hours}h`

  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}
