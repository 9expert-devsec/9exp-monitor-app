/**
 * Quiet hours, in Asia/Bangkok time. Pure; no I/O.
 *
 * Bangkok is UTC+7 all year (no daylight saving), so local minutes are a fixed
 * offset from UTC — no time-zone database needed.
 */

const BANGKOK_OFFSET_MINUTES = 7 * 60
const MINUTES_PER_DAY = 24 * 60

/** "06:00" or "06:00:00" → 360. Throws on anything else. */
export function minutesOfDay(time: string): number {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time.trim())
  if (!match) throw new Error(`Invalid time "${time}"`)
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) throw new Error(`Invalid time "${time}"`)
  return hours * 60 + minutes
}

/** Minutes since midnight in Bangkok for an instant. */
export function bangkokMinutes(now: Date): number {
  const utc = now.getUTCHours() * 60 + now.getUTCMinutes()
  return (utc + BANGKOK_OFFSET_MINUTES) % MINUTES_PER_DAY
}

/**
 * True when `now` falls in [start, end). The window may cross midnight
 * ("22:00"–"06:00"). start === end means an empty window.
 */
export function isQuietTime(start: string, end: string, now: Date): boolean {
  const from = minutesOfDay(start)
  const to = minutesOfDay(end)
  const at = bangkokMinutes(now)
  if (from === to) return false
  return from < to ? at >= from && at < to : at >= from || at < to
}

/** "00:00:00" → "00:00". */
export function hhmm(time: string): string {
  return time.slice(0, 5)
}
