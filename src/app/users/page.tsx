import type { Metadata } from 'next'

import { CreateAccountCard, FocusCreateFormButton } from '@/app/users/create-account-card'
import { UsersTable } from '@/app/users/users-table'
import { generateTemporaryPassword } from '@/lib/password'
import { requireAdminPage } from '@/lib/session'
import { listUsers } from '@/lib/users'

export const metadata: Metadata = { title: 'Users · 9Expert Monitor' }
export const dynamic = 'force-dynamic'

/** Admin only. Anyone else gets the ordinary 404 page. */
export default async function UsersPage() {
  const session = await requireAdminPage()
  const users = await listUsers()

  return (
    <main className="mx-auto flex w-full max-w-360 flex-col gap-6 px-4 py-6 sm:p-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[28px] leading-tight font-bold">Users</h1>
          <p className="mt-1 text-sm text-(--text-secondary)">
            Accounts are created here only — there is no public sign-up.
          </p>
        </div>
        <FocusCreateFormButton />
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <UsersTable users={users} currentUserId={session.userId} />
        </div>
        <CreateAccountCard initialPassword={generateTemporaryPassword()} />
      </div>
    </main>
  )
}
