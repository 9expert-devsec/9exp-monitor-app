'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/** Full-screen pages that must not show the app's top navigation. */
const NO_NAV_PATHS = new Set(['/tv'])

/** Renders the top nav everywhere except on full-screen pages such as the TV wall. */
export function NavGate({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  return NO_NAV_PATHS.has(pathname) ? null : children
}
