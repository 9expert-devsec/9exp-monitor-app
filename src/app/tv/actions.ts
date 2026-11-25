'use server'

import { getDashboardData, type DashboardData } from '@/lib/dashboard'
import { authorizeAction } from '@/lib/session'

export type TvRefreshResult =
  | { ok: true; data: DashboardData }
  | { ok: false; reason: 'signed_out' | 'error' }

/**
 * The TV wall's 30-second refresh: the same `getDashboardData()` the overview
 * renders from. Any signed-in, enabled role may call it. Errors are returned,
 * not thrown, so a failed refresh keeps the last data on screen instead of
 * replacing the wall with the error page.
 */
export async function refreshTvAction(): Promise<TvRefreshResult> {
  if (!(await authorizeAction())) return { ok: false, reason: 'signed_out' }
  try {
    return { ok: true, data: await getDashboardData() }
  } catch (error) {
    console.error('[tv] refresh failed:', error instanceof Error ? error.message : error)
    return { ok: false, reason: 'error' }
  }
}
