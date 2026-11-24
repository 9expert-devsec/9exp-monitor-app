'use client'

import { useActionState } from 'react'

import { updatePasswordAction, type PasswordState } from '@/app/account/password/actions'
import { Button } from '@/components/button'
import { Field } from '@/components/field'
import { PasswordInput } from '@/components/password-input'
import { MIN_PASSWORD_LENGTH } from '@/lib/password'

export function PasswordForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState<PasswordState, FormData>(
    updatePasswordAction,
    { error: null, field: null },
  )

  const fieldError = (field: PasswordState['field']) => (state.field === field ? state.error : null)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {/* Lets password managers attach the new password to the right account. */}
      <input type="text" name="username" autoComplete="username" value={email} hidden readOnly />

      <Field
        label="New password"
        htmlFor="password"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters`}
        error={fieldError('password')}
        errorId="password-error"
      >
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          aria-invalid={state.field === 'password' ? true : undefined}
          aria-describedby={state.field === 'password' ? 'password-error' : undefined}
        />
      </Field>

      <Field
        label="Confirm new password"
        htmlFor="confirm"
        error={fieldError('confirm')}
        errorId="confirm-error"
      >
        <PasswordInput
          id="confirm"
          name="confirm"
          autoComplete="new-password"
          required
          aria-invalid={state.field === 'confirm' ? true : undefined}
          aria-describedby={state.field === 'confirm' ? 'confirm-error' : undefined}
        />
      </Field>

      {state.error && state.field === null && (
        <p role="alert" className="text-sm text-(--status-down)">
          {state.error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending} className="w-full py-3">
        {pending ? 'Updating…' : 'Update password'}
      </Button>
    </form>
  )
}
