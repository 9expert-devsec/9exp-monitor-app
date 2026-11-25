'use server'

import { authorizeAction } from '@/lib/session'
import { getTvData, type TvData } from '@/lib/tv-data'

export type TvRefreshResult = { ok: true; data: TvData } | { ok: false; reason: 'signed_out' | 'error' }

/**
 * The TV wall's 30-second refresh. The session is verified first (any
 * signed-in, enabled role); only then is anything read. Errors are returned,
 * not thrown, so a failed refresh keeps the last data on screen instead of
 * replacing the wall with the error page.
 */
export async function refreshTvAction(): Promise<TvRefreshResult> {
  if (!(await authorizeAction())) return { ok: false, reason: 'signed_out' }
  try {
    return { ok: true, data: await getTvData() }
  } catch (error) {
    console.error('[tv] refresh failed:', error instanceof Error ? error.message : error)
    return { ok: false, reason: 'error' }
  }
}
