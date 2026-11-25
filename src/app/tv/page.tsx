import type { Metadata } from 'next'

import { TvWall } from '@/app/tv/tv-wall'
import { requirePageSession } from '@/lib/session'
import { getTvData } from '@/lib/tv-data'

export const metadata: Metadata = { title: 'TV · 9Expert System Status' }
export const dynamic = 'force-dynamic'

/** Wall display. Same login as the rest of the app; any role. No nav (see NavGate). */
export default async function TvPage() {
  await requirePageSession()
  return <TvWall initial={await getTvData()} />
}
