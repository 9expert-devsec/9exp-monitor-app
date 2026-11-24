import type { Metadata } from 'next'

import { PasswordForm } from '@/app/account/password/password-form'
import { requirePageSession } from '@/lib/session'

export const metadata: Metadata = { title: 'Change password · 9Expert Monitor' }

export default async function ChangePasswordPage() {
  const session = await requirePageSession({ allowPasswordChange: true })
  const required = session.profile.must_change_password

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <section
        aria-labelledby="password-title"
        className="flex w-full max-w-105 flex-col gap-5 rounded-lg border border-(--border-subtle) bg-(--surface-card) p-7 sm:p-9"
      >
        <div className="flex flex-col gap-1">
          <h1 id="password-title" className="text-2xl font-bold">
            {required ? 'Set a new password' : 'Change password'}
          </h1>
          <p className="text-sm text-(--text-secondary)">
            {required
              ? 'You signed in with a temporary password. Choose your own to continue.'
              : `Signed in as ${session.email}`}
          </p>
        </div>
        <PasswordForm email={session.email} />
      </section>
    </main>
  )
}
