'use client'

import { useActionState } from 'react'

import { signInAction, type SignInState } from '@/app/login/actions'
import { Button } from '@/components/button'
import { Field, FormError, INPUT_CLASS } from '@/components/field'
import { PasswordInput } from '@/components/password-input'

export function LoginForm({ next, initialError }: { next: string; initialError: string | null }) {
  const [state, formAction, pending] = useActionState<SignInState, FormData>(signInAction, {
    error: initialError,
    email: '',
  })

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />

      <Field label="Email" htmlFor="email">
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state.email}
          // Re-mount on each result so `defaultValue` keeps what was typed.
          key={state.email}
          className={INPUT_CLASS}
          aria-invalid={state.error ? true : undefined}
        />
      </Field>

      <Field label="Password" htmlFor="password">
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          aria-invalid={state.error ? true : undefined}
        />
      </Field>

      <Button type="submit" variant="primary" disabled={pending} className="w-full py-3">
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>

      {state.error && <FormError>{state.error}</FormError>}
    </form>
  )
}
