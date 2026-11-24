import { DashboardClient } from '@/components/dashboard-client'
import { getDashboardData } from '@/lib/dashboard'
import { publicRealtimeConfig } from '@/lib/env'
import { requirePageSession } from '@/lib/session'

/** Status is never cacheable — every request reflects the database as it is now. */
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const session = await requirePageSession()
  const { snapshots, totalSites, lastRunAt, renderedAt } = await getDashboardData()
  const realtime = publicRealtimeConfig()

  return (
    <main className="mx-auto flex w-full max-w-360 flex-col gap-8 px-4 py-6 sm:p-12">
      <DashboardClient
        snapshots={snapshots}
        totalSites={totalSites}
        lastRunAt={lastRunAt}
        realtime={realtime}
        serverNow={renderedAt}
        canAddSites={session.profile.role === 'admin'}
      />
      <footer className="text-center text-xs text-(--text-muted)">
        9Expert Internal Status Monitor · {realtime ? 'live updates' : 'refreshes on reload'}
      </footer>
    </main>
  )
}
