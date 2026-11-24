/**
 * Every sentence that explains a problem to the user, in one place.
 *
 * Language rule: UI copy is English; only these problem explanations are Thai.
 * Keep it that way — a grep for Thai characters over src/ should land here and
 * on the error / 404 pages only.
 */

export function slowerThanThresholdMessage(expectedMs: number): string {
  return `ตอบช้ากว่าเกณฑ์ ${expectedMs} ms`
}

export const STALE_MESSAGE = 'ไม่มีผลตรวจเกิน 15 นาที — ตัวตรวจอาจหยุดทำงาน'

export const CHECKER_STALLED_MESSAGE =
  'ไม่มีผลตรวจเข้ามาเกิน 15 นาที สถานะด้านล่างจึงแสดงเป็น "No data" แทนที่จะถือว่าปกติ — ตรวจ workflow "monitor" ใน GitHub Actions'
