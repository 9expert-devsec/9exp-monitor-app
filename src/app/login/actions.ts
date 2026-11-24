'use server'

import { redirect } from 'next/navigation'

import {
  ACCOUNT_DISABLED_MESSAGE,
  ACCOUNT_LOCKED_MESSAGE,
  wrongCredentialsMessage,
} from '@/lib/messages'
import { safeNextPath } from '@/lib/redirect'
import { serviceClient, sessionClient } from '@/lib/supabase/server'

// A 'use server' module may only export async functions.
const MAX_FAILED_ATTEMPTS = 5
const LOCK_MINUTES = 15

export type SignInState = { error: string | null; email: string }

interface FailureRow {
  failed_count: number
  locked_until: string | null
}

/**
 * Email + password sign-in with a per-email lockout: 5 wrong passwords lock
 * the address for 15 minutes. An unknown email and a wrong password get the
 * same answer and go through the same counter, so the form cannot be used to
 * find out which addresses have accounts.
 *
 * The counter is read-then-write, not atomic: parallel attempts can undercount
 * by a few. Supabase Auth's own rate limit still sits behind it.
 */
export async function signInAction(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const next = safeNextPath(formData.get('next'))

  if (!email || !password) return { error: wrongCredentialsMessage(null), email }

  const admin = serviceClient()
  const { data: failure } = await admin
    .from('login_failures')
    .select('failed_count, locked_until')
    .eq('email', email)
    .maybeSingle<FailureRow>()

  const lockedUntil = failure?.locked_until ? Date.parse(failure.locked_until) : 0
  if (lockedUntil > Date.now()) return { error: ACCOUNT_LOCKED_MESSAGE, email }

  const supabase = await sessionClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    const count = (failure?.failed_count ?? 0) + 1
    const now = new Date()

    if (count >= MAX_FAILED_ATTEMPTS) {
      await admin.from('login_failures').upsert({
        email,
        failed_count: 0,
        locked_until: new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString(),
        updated_at: now.toISOString(),
      })
      return { error: ACCOUNT_LOCKED_MESSAGE, email }
    }

    await admin.from('login_failures').upsert({
      email,
      failed_count: count,
      locked_until: null,
      updated_at: now.toISOString(),
    })
    return { error: wrongCredentialsMessage(MAX_FAILED_ATTEMPTS - count), email }
  }

  await admin.from('login_failures').delete().eq('email', email)

  const { data: profile } = await admin
    .from('profiles')
    .select('disabled, must_change_password')
    .eq('id', data.user.id)
    .maybeSingle<{ disabled: boolean; must_change_password: boolean }>()

  // No profile row means the account was not created through this app.
  if (!profile || profile.disabled) {
    await supabase.auth.signOut()
    return { error: ACCOUNT_DISABLED_MESSAGE, email }
  }

  redirect(profile.must_change_password ? '/account/password' : next)
}
