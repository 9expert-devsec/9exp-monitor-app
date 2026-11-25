import type { Metadata } from 'next'

import { TvWall } from '@/app/tv/tv-wall'
import { getDashboardData } from '@/lib/dashboard'
import { requirePageSession } from '@/lib/session'

export const metadata: Metadata = { title: 'TV · 9Expert System Status' }
export const dynamic = 'force-dynamic'

/** Wall display. Same login as the rest of the app; any role. No nav (see NavGate). */
export default async function TvPage() {
  await requirePageSession()
  const { snapshots, lastRunAt, renderedAt } = await getDashboardData()
  return <TvWall initial={{ snapshots, lastRunAt, renderedAt }} />
}
