'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * The single source of the top-level navigation. Later rounds append to this
 * array (Sites, Notifications, Users, …); nothing else needs to change.
 */
export const NAV_ITEMS: { label: string; href: string }[] = [{ label: 'Overview', href: '/' }]

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/' || pathname.startsWith('/sites/')
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** Hidden below 640 px this round. */
export function NavLinks() {
  const pathname = usePathname()

  return (
    <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
      {NAV_ITEMS.map((item) => {
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
