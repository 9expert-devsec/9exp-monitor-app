/**
 * Every sentence that explains a problem to the user, in one place.
 *
 * Language rule: UI copy is English; only these problem explanations are Thai.
 * Keep it that way — a grep for Thai characters over src/ should land here and
 * on the error / 404 pages only.
 *
 * Render these in the sans font. Mono is for raw English error text, numbers,
 * URLs and codes only — Thai in a monospace fallback is hard to read.
 */

export function slowerThanThresholdMessage(expectedMs: number): string {
  return `ตอบช้ากว่าเกณฑ์ ${expectedMs} ms`
}

export const STALE_MESSAGE = 'ไม่มีผลตรวจเกิน 15 นาที — ตัวตรวจอาจหยุดทำงาน'

/** A site that has no health check at all yet. */
export const SITE_NEVER_CHECKED_MESSAGE = 'ยังไม่เคยตรวจเว็บนี้'

export const CHECKER_STALLED_MESSAGE =
  'ไม่มีผลตรวจเข้ามาเกิน 15 นาที สถานะด้านล่างจึงแสดงเป็น "No data" แทนที่จะถือว่าปกติ — ตรวจ workflow "monitor" ใน GitHub Actions'

/** No check has ever been recorded, for any site. */
export const CHECKER_NEVER_RAN_MESSAGE =
  'ยังไม่เคยมีผลตรวจ — กด Check now หรือรอ GitHub Actions รอบแรก'
