'use client'

import { RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition, type FormEvent } from 'react'

import { createAccountAction, type CreateAccountResult } from '@/app/users/actions'
import { Button } from '@/components/button'
import { CopyButton } from '@/components/copy-button'
import { Field, INPUT_CLASS } from '@/components/field'
import { Switch } from '@/components/switch'
import { generateTemporaryPassword } from '@/lib/password'

export const CREATE_FORM_FIRST_FIELD_ID = 'create-full-name'

type Failure = Extract<CreateAccountResult, { ok: false }>

/**
 * The "Create account" card. Submitted through a transition instead of a form
 * `action`, so a validation error leaves what the admin typed in place.
 * The first password comes from the server so the server and client HTML match.
 */
export function CreateAccountCard({ initialPassword }: { initialPassword: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [formKey, setFormKey] = useState(0)
  const [password, setPassword] = useState(initialPassword)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null)

  function reset() {
    setFormKey((key) => key + 1)
    setPassword(generateTemporaryPassword())
    setFailure(null)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setCreated(null)
    startTransition(async () => {
      const result = await createAccountAction(formData)
      if (result.ok) {
        setCreated({ email: result.email, password: result.password })
        reset()
        router.refresh()
      } else {
        setFailure(result)
      }
    })
  }

  const fieldError = (field: Failure['field']) => (failure?.field === field ? failure.error : null)

  return (
    <section
      aria-labelledby="create-account-title"
      className="flex w-full flex-col gap-5 rounded-lg border border-(--border-subtle) bg-(--surface-card) p-6 lg:w-105 lg:shrink-0"
    >
      <div>
        <h2 id="create-account-title" className="text-xl font-semibold">
          Create account
        </h2>
        <p className="mt-1 text-sm text-(--text-secondary)">
          Share the temporary password with the user directly.
        </p>
      </div>

      {created && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-md bg-(--status-up-soft) px-3 py-3 text-sm text-(--status-up)"
        >
          <p>
            Account created for <span className="font-mono">{created.email}</span>. Temporary
            password (shown once):
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-sm bg-(--surface-sunken) px-2.5 py-2 font-mono text-(--text-primary)">
              {created.password}
            </code>
            <CopyButton value={created.password} />
          </div>
        </div>
      )}

      <form key={formKey} onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label="Full name"
          htmlFor={CREATE_FORM_FIRST_FIELD_ID}
          error={fieldError('fullName')}
          errorId="create-full-name-error"
        >
          <input
            id={CREATE_FORM_FIRST_FIELD_ID}
            name="fullName"
            autoComplete="off"
            required
            className={INPUT_CLASS}
            aria-invalid={failure?.field === 'fullName' ? true : undefined}
            aria-describedby={failure?.field === 'fullName' ? 'create-full-name-error' : undefined}
          />
        </Field>

        <Field label="Email" htmlFor="create-email" error={fieldError('email')} errorId="create-email-error">
          <input
            id="create-email"
            name="email"
            type="email"
            autoComplete="off"
            required
            className={INPUT_CLASS}
            aria-invalid={failure?.field === 'email' ? true : undefined}
            aria-describedby={failure?.field === 'email' ? 'create-email-error' : undefined}
          />
        </Field>

        <Field
          label="Role"
          htmlFor="create-role"
          hint="Admin: manage sites, notifications and users · Viewer: read-only"
        >
          <select id="create-role" name="role" defaultValue="viewer" className={INPUT_CLASS}>
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
        </Field>

        <Field
          label="Temporary password"
          htmlFor="create-password"
          error={fieldError('password')}
          errorId="create-password-error"
        >
          <div className="flex gap-2">
            <input
              id="create-password"
              name="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
              className={`${INPUT_CLASS} min-w-0 font-mono`}
              aria-invalid={failure?.field === 'password' ? true : undefined}
              aria-describedby={failure?.field === 'password' ? 'create-password-error' : undefined}
            />
            <CopyButton value={password} />
            <Button
              variant="secondary"
              aria-label="Generate a new password"
              title="Generate a new password"
              className="px-3"
              onClick={() => setPassword(generateTemporaryPassword())}
            >
              <RefreshCw size={16} aria-hidden="true" />
            </Button>
          </div>
        </Field>

        <Switch
          id="create-must-change"
          name="mustChange"
          label="Require password change on first sign-in"
          defaultChecked
        />

        {failure && failure.field === null && (
          <p role="alert" className="text-sm text-(--status-down)">
            {failure.error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={reset} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? 'Creating…' : 'Create account'}
          </Button>
        </div>
      </form>
    </section>
  )
}

/** The header's "+ Create account": jumps to and focuses the form. */
export function FocusCreateFormButton() {
  return (
    <Button
      variant="primary"
      onClick={() => {
        const field = document.getElementById(CREATE_FORM_FIRST_FIELD_ID)
        field?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        field?.focus({ preventScroll: true })
      }}
    >
      + Create account
    </Button>
  )
}
