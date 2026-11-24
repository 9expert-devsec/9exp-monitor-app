import type { Metadata } from 'next'

import { LoginForm } from '@/app/login/login-form'
import { AuroraBackground } from '@/components/aurora/aurora-background'
import { Logo } from '@/components/logo'
import { ACCOUNT_DISABLED_MESSAGE } from '@/lib/messages'
import { safeNextPath } from '@/lib/redirect'

export const metadata: Metadata = { title: 'Sign in · 9Expert Monitor' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)
  const next = safeNextPath(first(params.next))
  const initialError = first(params.error) === 'disabled' ? ACCOUNT_DISABLED_MESSAGE : null

  return (
    <main
      className="relative flex min-h-dvh flex-1 flex-col items-center justify-center bg-(--surface-sunken) px-4 py-16"
      // Static fallback: what shows before the Aurora mounts, and for good
      // where WebGL2 is unavailable.
      style={{
        backgroundImage:
          'radial-gradient(ellipse 80% 55% at 50% 0%, rgb(36 134 255 / 0.15), transparent 70%)',
      }}
    >
      <AuroraBackground />

      <section
        aria-labelledby="login-title"
        className="relative z-10 flex w-full max-w-105 flex-col gap-5 rounded-lg border border-(--border-strong) p-9 backdrop-blur-[24px]"
        style={{ background: 'color-mix(in srgb, var(--surface-card) 78%, transparent)' }}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo size={64} />
          <h1 id="login-title" className="text-[28px] leading-tight font-bold">
            9Expert Monitor
          </h1>
          <p className="text-sm text-(--text-secondary)">Sign in with the account your admin created</p>
        </div>

        <LoginForm next={next} initialError={initialError} />

        <p className="text-center text-xs text-(--text-muted)">
          No self sign-up. Forgot your password? Ask an admin to reset it.
        </p>
      </section>

      <footer className="absolute inset-x-0 bottom-6 z-10 text-center text-xs text-(--text-muted)">
        9Expert Training · Internal tool
      </footer>
    </main>
  )
}
