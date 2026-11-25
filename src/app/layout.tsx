import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'

import { Toaster } from '@/components/toaster'
import { NavGate } from '@/components/nav-gate'
import { TopNav } from '@/components/top-nav'
import { publicRealtimeConfig } from '@/lib/env'

import './globals.css'

// Fonts — the same two self-hosted families as genesis-lab (src/fonts/, committed):
//   --font-en   → Google Sans (SIL OFL, licence in src/fonts/OFL.txt): one variable
//                 file, wght 400–700, Latin subset. Body, detail, numbers.
//   --font-thai → LINE Seed Sans TH: Thai text and headings.
// Thai characters fall through Google Sans to LINE Seed (see --font-sans in globals.css).
const googleSans = localFont({
  src: [{ path: '../fonts/GoogleSans-Latin-wght.woff2', weight: '400 700', style: 'normal' }],
  variable: '--font-en',
  display: 'swap',
  preload: true,
})

const lineSeedSansTH = localFont({
  src: [
    { path: '../fonts/LINESeedSansTH_W_Rg.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/LINESeedSansTH_W_Bd.woff2', weight: '700', style: 'normal' },
    { path: '../fonts/LINESeedSansTH_W_He.woff2', weight: '800', style: 'normal' },
    { path: '../fonts/LINESeedSansTH_W_XBd.woff2', weight: '900', style: 'normal' },
  ],
  variable: '--font-thai',
  display: 'swap',
  preload: true,
})

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
    <html lang="en" className={`h-full ${googleSans.variable} ${lineSeedSansTH.variable}`}>
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
