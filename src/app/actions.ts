'use server'

import { revalidatePath } from 'next/cache'

import { runChecks } from '@/lib/checker'
import { authorizeAction } from '@/lib/session'
import type { RunSummary } from '@/lib/types'

/**
 * "Check now", backing the dashboard button.
 *
 * Any signed-in, enabled account may run it — viewers included. Server Actions
 * are public POST endpoints whatever the UI shows, so the session is verified
 * here rather than trusted from the page. It calls the exact same
 * `runChecks()` as the cron route, and keeps `CRON_SECRET` away from the
 * browser.
 */

/**
 * A run fans out real HTTP requests to every monitored site, so an unattended
 * tab holding down the button must not be able to hammer them. Module scope on
 * a serverless platform means this is per-instance, not global — it is a
 * courtesy throttle, not a security control.
 */
const MANUAL_COOLDOWN_MS = 15_000
let lastManualRunAt = 0

export type ManualRunResult =
  | { ok: true; summary: RunSummary }
  | { ok: false; error: string }

export async function runChecksAction(): Promise<ManualRunResult> {
  if (!(await authorizeAction())) return { ok: false, error: 'Sign in again to run checks.' }

  const now = Date.now()
  if (now - lastManualRunAt < MANUAL_COOLDOWN_MS) {
    const wait = Math.ceil((MANUAL_COOLDOWN_MS - (now - lastManualRunAt)) / 1000)
    return { ok: false, error: `Just ran. Try again in ${wait}s.` }
  }
  lastManualRunAt = now

  try {
    const summary = await runChecks()
    revalidatePath('/')
    return { ok: true, summary }
  } catch (error) {
    console.error('[actions] manual run failed:', error)
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Run failed',
    }
  }
}
