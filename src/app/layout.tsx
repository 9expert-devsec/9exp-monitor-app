import type { Metadata, Viewport } from 'next'

import { Toaster } from '@/components/toaster'
import { NavGate } from '@/components/nav-gate'
import { TopNav } from '@/components/top-nav'
import { publicRealtimeConfig } from '@/lib/env'

import './globals.css'

export const metadata: Metadata = {
  title: '9Expert Monitor',
  description: 'Health of every 9Expert project, in one place.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: '#08131f',
  colorScheme: 'dark',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col antialiased">
        <NavGate>
          <TopNav live={publicRealtimeConfig() !== null} />
        </NavGate>
        <div className="flex flex-1 flex-col">{children}</div>
        <Toaster />
      </body>
    </html>
  )
}
