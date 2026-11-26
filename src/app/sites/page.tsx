import type { Metadata } from 'next'

import { SiteDrawer } from '@/app/sites/site-drawer'
import { SitesTable } from '@/app/sites/sites-table'
import { requirePageSession } from '@/lib/session'
import { siteLogoOf } from '@/lib/site-logo-url'
import { listSites } from '@/lib/sites'

export const metadata: Metadata = { title: 'Sites · 9Expert Monitor' }
export const dynamic = 'force-dynamic'

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** Everyone signed in sees the list; only admins get the toggles, Edit, Add and Reorder. */
export default async function SitesPage() {
  const session = await requirePageSession()
  const isAdmin = session.profile.role === 'admin'
  const rows = await listSites()

  const active = rows.filter((row) => row.site.enabled).length
  const paused = rows.length - active

  return (
    <main className="mx-auto flex w-full max-w-360 flex-col gap-6 px-4 py-6 sm:p-12">
      <SitesTable
        rows={rows}
        isAdmin={isAdmin}
        heading={
          <>
            <h1 className="text-[28px] leading-tight font-bold">Monitored sites</h1>
            <p className="mt-1 text-sm text-(--text-secondary)">
              {plural(rows.length, 'site')} · {active} active · {paused} paused — every site gets a
              page check; health check is optional
            </p>
          </>
        }
      />

      {isAdmin && (
        <SiteDrawer
          sites={rows.map((row) => row.site)}
          logos={Object.fromEntries(rows.map((row) => [row.site.id, siteLogoOf(row.site)]))}
        />
      )}
    </main>
  )
}
