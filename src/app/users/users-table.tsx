'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition, type FormEvent } from 'react'

import {
  resetPasswordAction,
  updateAccountAction,
  type ResetPasswordResult,
} from '@/app/users/actions'
import { Avatar } from '@/components/avatar'
import { Button } from '@/components/button'
import { CopyButton } from '@/components/copy-button'
import { Field, INPUT_CLASS } from '@/components/field'
import { Modal } from '@/components/modal'
import { formatShortDateTime } from '@/lib/format'
import type { Role } from '@/lib/session'
import type { UserRow } from '@/lib/users'

function RolePill({ role }: { role: Role }) {
  return role === 'admin' ? (
    <span className="rounded-pill bg-(--brand-action-blue) px-2.5 py-1 text-xs font-semibold text-(--brand-cloud-base)">
      Admin
    </span>
  ) : (
    <span className="rounded-pill bg-(--surface-raised) px-2.5 py-1 text-xs font-semibold text-(--text-secondary)">
      Viewer
    </span>
  )
}

function StatusPill({ disabled }: { disabled: boolean }) {
  return disabled ? (
    <span className="rounded-pill bg-(--status-stale-soft) px-2.5 py-1 text-xs font-semibold text-(--status-stale)">
      Disabled
    </span>
  ) : (
    <span className="rounded-pill bg-(--status-up-soft) px-2.5 py-1 text-xs font-semibold text-(--status-up)">
      Active
    </span>
  )
}

type Dialog =
  | { kind: 'reset'; user: UserRow; result: ResetPasswordResult | null }
  | { kind: 'edit'; user: UserRow }
  | null

export function UsersTable({ users, currentUserId }: { users: UserRow[]; currentUserId: string }) {
  const [dialog, setDialog] = useState<Dialog>(null)

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-(--border-subtle) bg-(--surface-card)">
      <div className="overflow-x-auto">
        <table className="w-full min-w-170 text-sm">
          <thead>
            <tr className="label-overline border-b border-(--border-subtle) text-left">
              <th scope="col" className="px-5 py-3 font-semibold">User</th>
              <th scope="col" className="px-4 py-3 font-semibold">Role</th>
              <th scope="col" className="px-4 py-3 font-semibold">Last sign-in</th>
              <th scope="col" className="px-4 py-3 font-semibold">Status</th>
              <th scope="col" className="px-4 py-3 font-semibold">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-(--border-subtle)">
            {users.map((user) => (
              <tr key={user.id} className={user.disabled ? 'opacity-55' : undefined}>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={user.fullName} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {user.fullName}
                        {user.id === currentUserId && (
                          <span className="ml-1.5 text-xs font-normal text-(--text-muted)">(you)</span>
                        )}
                      </p>
                      <p className="truncate font-mono text-xs text-(--text-muted)">{user.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <RolePill role={user.role} />
                </td>
                <td className="px-4 py-3 font-mono text-xs text-(--text-secondary)">
                  {user.lastSignInAt ? formatShortDateTime(user.lastSignInAt) : 'Never'}
                </td>
                <td className="px-4 py-3">
                  <StatusPill disabled={user.disabled} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      className="px-2.5 py-1.5"
                      onClick={() => setDialog({ kind: 'reset', user, result: null })}
                    >
                      Reset password
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-2.5 py-1.5"
                      onClick={() => setDialog({ kind: 'edit', user })}
                    >
                      Edit
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialog?.kind === 'reset' && (
        <ResetPasswordDialog
          user={dialog.user}
          result={dialog.result}
          onResult={(result) => setDialog({ ...dialog, result })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'edit' && (
        <EditAccountDialog
          user={dialog.user}
          isSelf={dialog.user.id === currentUserId}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

/** Confirm, then show the new temporary password exactly once. */
function ResetPasswordDialog({
  user,
  result,
  onResult,
  onClose,
}: {
  user: UserRow
  result: ResetPasswordResult | null
  onResult: (result: ResetPasswordResult) => void
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <Modal title="Reset password" onClose={onClose}>
      {result?.ok ? (
        <>
          <p className="text-sm text-(--text-secondary)">
            New temporary password for <span className="text-(--text-primary)">{user.email}</span>.
            It is shown only this once — share it with them directly. They must change it at
            their next sign-in.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-(--border-strong) bg-(--surface-sunken) px-3 py-2.5 font-mono text-sm">
              {result.password}
            </code>
            <CopyButton value={result.password} />
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-(--text-secondary)">
            Generate a new temporary password for{' '}
            <span className="text-(--text-primary)">{user.fullName}</span>? Their current password
            stops working.
          </p>
          {result && !result.ok && (
            <p role="alert" className="text-sm text-(--status-down)">
              {result.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const next = await resetPasswordAction(user.id)
                  onResult(next)
                  if (next.ok) router.refresh()
                })
              }
            >
              {pending ? 'Resetting…' : 'Reset password'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}

function EditAccountDialog({
  user,
  isSelf,
  onClose,
}: {
  user: UserRow
  isSelf: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // The clicked button's name/value ("disabled") is part of the form data.
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    const formData = new FormData(event.currentTarget, submitter)
    setError(null)
    startTransition(async () => {
      const result = await updateAccountAction(formData)
      if (result.ok) {
        router.refresh()
        onClose()
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <Modal title="Edit account" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <input type="hidden" name="userId" value={user.id} />
        <p className="font-mono text-xs text-(--text-muted)">{user.email}</p>

        <Field label="Full name" htmlFor="edit-full-name">
          <input
            id="edit-full-name"
            name="fullName"
            defaultValue={user.fullName}
            required
            className={INPUT_CLASS}
          />
        </Field>

        <Field
          label="Role"
          htmlFor="edit-role"
          hint={isSelf ? 'You cannot change your own role.' : undefined}
        >
          <select
            id="edit-role"
            name="role"
            defaultValue={user.role}
            disabled={isSelf}
            className={INPUT_CLASS}
          >
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
        {/* A disabled <select> is not submitted; keep the value. */}
        {isSelf && <input type="hidden" name="role" value={user.role} />}

        {error && (
          <p role="alert" className="text-sm text-(--status-down)">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-(--border-subtle) pt-4">
          {user.disabled ? (
            <Button type="submit" name="disabled" value="false" variant="secondary" disabled={pending}>
              Enable account
            </Button>
          ) : (
            <Button
              type="submit"
              name="disabled"
              value="true"
              variant="danger"
              disabled={pending || isSelf}
              title={isSelf ? 'You cannot disable your own account.' : undefined}
            >
              Disable account
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              name="disabled"
              value={String(user.disabled)}
              variant="primary"
              disabled={pending}
            >
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
