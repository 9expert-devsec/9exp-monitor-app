import type { Metadata, Viewport } from 'next'

import './globals.css'

export const metadata: Metadata = {
  title: '9Expert Status Monitor',
  description: 'Health of every 9Expert project, in one place.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2f5fb' },
    { media: '(prefers-color-scheme: dark)', color: '#060f24' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  )
}
