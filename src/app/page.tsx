import { DashboardClient } from '@/components/dashboard-client'
import { getDashboardData } from '@/lib/dashboard'
import { publicRealtimeConfig } from '@/lib/env'

/** Status is never cacheable — every request reflects the database as it is now. */
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const { snapshots, lastRunAt, renderedAt } = await getDashboardData()

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <DashboardClient
        snapshots={snapshots}
        lastRunAt={lastRunAt}
        realtime={publicRealtimeConfig()}
        serverNow={renderedAt}
      />
      <footer
        className="mt-10 text-center text-xs"
        style={{ color: 'var(--text-muted)' }}
      >
        9Expert Internal Status Monitor · checks run every 5 minutes
      </footer>
    </main>
  )
}
