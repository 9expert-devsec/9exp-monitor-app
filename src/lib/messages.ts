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

// --- Sign-in and passwords -------------------------------------------------

/**
 * Wrong email or password — the same text for both, on purpose. `attemptsLeft`
 * is how many more failures the address has before it locks; the warning only
 * appears once that is 1 or 2.
 */
export function wrongCredentialsMessage(attemptsLeft: number | null): string {
  if (attemptsLeft !== null && attemptsLeft >= 1 && attemptsLeft <= 2) {
    return `อีเมลหรือรหัสผ่านไม่ถูกต้อง — ผิดอีก ${attemptsLeft} ครั้ง บัญชีจะถูกล็อก 15 นาที`
  }
  return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
}

export const ACCOUNT_LOCKED_MESSAGE = 'บัญชีถูกล็อกชั่วคราว 15 นาที เพราะใส่รหัสผ่านผิดหลายครั้ง'

export const ACCOUNT_DISABLED_MESSAGE = 'บัญชีนี้ถูกปิดใช้งาน — ติดต่อผู้ดูแลระบบ'

export const PASSWORD_TOO_SHORT_MESSAGE = 'รหัสผ่านต้องยาวอย่างน้อย 12 ตัวอักษร'

export const PASSWORDS_DO_NOT_MATCH_MESSAGE = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน'
