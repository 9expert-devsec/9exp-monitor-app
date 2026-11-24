'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavItem {
  label: string
  href: string
  /** Hidden from viewers. The page itself also refuses them (404). */
  adminOnly?: boolean
}

/**
 * The single source of the top-level navigation. Later rounds append to this
 * array (Sites, Notifications, …); nothing else needs to change.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', href: '/' },
  { label: 'Sites', href: '/sites' },
  { label: 'Notifications', href: '/notifications', adminOnly: true },
  { label: 'Users', href: '/users', adminOnly: true },
]

function isActive(pathname: string, href: string): boolean {
  // A site's detail page is reached from the overview, so it lights up Overview.
  if (href === '/') return pathname === '/' || pathname.startsWith('/sites/')
  if (href === '/sites') return pathname === '/sites'
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** Hidden below 640 px this round. */
export function NavLinks({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname()
  const items = NAV_ITEMS.filter((item) => isAdmin || !item.adminOnly)

  return (
    <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
      {items.map((item) => {
        const active = isActive(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-md px-3 py-2 text-sm font-medium ${
              active
                ? 'bg-(--surface-raised) text-(--text-primary)'
                : 'text-(--text-secondary) hover:text-(--text-primary)'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
