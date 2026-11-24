import Link from 'next/link'

import { AvatarMenu } from '@/components/avatar-menu'
import { Logo } from '@/components/logo'
import { NavLinks } from '@/components/nav-links'
import { getSession } from '@/lib/session'

/** Live / off pill on the right of the nav. */
function LivePill({ live }: { live: boolean }) {
  if (!live) {
    return (
      <span className="rounded-pill border border-(--border-subtle) px-3 py-1 text-xs font-medium text-(--text-muted)">
        Live updates off
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-pill bg-(--status-up-soft) px-3 py-1 text-xs font-semibold text-(--status-up)">
      <span aria-hidden="true" className="size-2 rounded-full bg-(--status-up)" />
      Live
    </span>
  )
}

/** Rendered only for a signed-in user — the login page has no nav. */
export async function TopNav({ live }: { live: boolean }) {
  const session = await getSession()
  if (!session) return null
  const { profile, email } = session

  return (
    <header className="h-16 border-b border-(--border-subtle) bg-(--surface-card)">
      <div className="flex h-full items-center gap-8 px-4 sm:px-12">
        <Link href="/" className="flex items-center gap-3">
          <Logo size={28} className="sm:hidden" />
          <Logo size={36} className="hidden sm:block" />
          <span className="flex flex-col">
            <span className="text-base leading-tight font-semibold">9Expert Monitor</span>
            <span className="hidden text-xs text-(--text-muted) sm:block">Internal status</span>
          </span>
        </Link>

        <NavLinks isAdmin={profile.role === 'admin' && !profile.disabled} />

        <div className="ml-auto flex items-center gap-3">
          <LivePill live={live} />
          <AvatarMenu name={profile.full_name} email={email} />
        </div>
      </div>
    </header>
  )
}
