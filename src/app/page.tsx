import { DashboardClient } from '@/components/dashboard-client'
import { getDashboardData } from '@/lib/dashboard'
import { publicRealtimeConfig } from '@/lib/env'

/** Status is never cacheable — every request reflects the database as it is now. */
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const { snapshots, lastRunAt, renderedAt } = await getDashboardData()
  const realtime = publicRealtimeConfig()

  return (
    <main className="mx-auto flex w-full max-w-360 flex-col gap-8 px-4 py-6 sm:p-12">
      <DashboardClient
        snapshots={snapshots}
        lastRunAt={lastRunAt}
        realtime={realtime}
        serverNow={renderedAt}
      />
      <footer className="text-center text-xs text-(--text-muted)">
        9Expert Internal Status Monitor · {realtime ? 'live updates' : 'refreshes on reload'}
      </footer>
    </main>
  )
}
