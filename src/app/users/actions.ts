'use server'

import { revalidatePath } from 'next/cache'

import { MIN_PASSWORD_LENGTH, generateTemporaryPassword } from '@/lib/password'
import { authorizeAction, type Profile, type Role } from '@/lib/session'
import { serviceClient } from '@/lib/supabase/server'

/*
 * Account administration. Every action re-checks that the caller is an
 * enabled admin — these are public POST endpoints whatever the UI shows — and
 * every write goes through the service role (profiles has no write policy).
 *
 * Guards: an admin cannot disable or demote themselves, and the last active
 * admin can never be disabled or demoted. The last-admin check is
 * read-then-write; two admins demoting each other at the same instant could
 * both pass it. Acceptable for a handful of accounts.
 */

const NOT_ALLOWED = 'Only an admin can do this.'
/** Supabase bans are durations; ~100 years is "until re-enabled". */
const BAN_FOREVER = '876000h'

function isRole(value: unknown): value is Role {
  return value === 'admin' || value === 'viewer'
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

async function countActiveAdmins(): Promise<number> {
  const { count, error } = await serviceClient()
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin')
    .eq('disabled', false)
  if (error) throw new Error(`Could not count admins: ${error.message}`)
  return count ?? 0
}

// --- Create ------------------------------------------------------------------

export type CreateAccountResult =
  | { ok: true; email: string; password: string }
  | { ok: false; error: string; field: 'fullName' | 'email' | 'password' | null }

export async function createAccountAction(formData: FormData): Promise<CreateAccountResult> {
  const caller = await authorizeAction({ admin: true })
  if (!caller) return { ok: false, error: NOT_ALLOWED, field: null }

  const fullName = String(formData.get('fullName') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const role = formData.get('role')
  const password = String(formData.get('password') ?? '')
  const mustChange = formData.get('mustChange') === 'on'

  if (!fullName) return { ok: false, error: 'Enter a name.', field: 'fullName' }
  if (!looksLikeEmail(email)) return { ok: false, error: 'Enter a valid email.', field: 'email' }
  if (!isRole(role)) return { ok: false, error: 'Pick a role.', field: null }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
      field: 'password',
    }
  }

  const admin = serviceClient()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (error || !data.user) {
    if (error?.code === 'email_exists' || error?.code === 'user_already_exists') {
      return { ok: false, error: 'Email already has an account', field: 'email' }
    }
    console.error('[users] createUser failed:', error?.message)
    return { ok: false, error: error?.message ?? 'Could not create the account.', field: null }
  }

  const { error: profileError } = await admin.from('profiles').insert({
    id: data.user.id,
    full_name: fullName,
    role,
    must_change_password: mustChange,
    created_by: caller.userId,
  })

  if (profileError) {
    // Do not leave an auth user behind that has no profile (it could not sign in anyway).
    await admin.auth.admin.deleteUser(data.user.id)
    console.error('[users] profile insert failed:', profileError.message)
    return { ok: false, error: 'Could not save the account. Nothing was created.', field: null }
  }

  revalidatePath('/users')
  return { ok: true, email, password }
}

// --- Reset password ----------------------------------------------------------

export type ResetPasswordResult = { ok: true; password: string } | { ok: false; error: string }

export async function resetPasswordAction(userId: string): Promise<ResetPasswordResult> {
  const caller = await authorizeAction({ admin: true })
  if (!caller) return { ok: false, error: NOT_ALLOWED }

  const admin = serviceClient()
  const password = generateTemporaryPassword()

  const { error } = await admin.auth.admin.updateUserById(userId, { password })
  if (error) return { ok: false, error: error.message }

  const { error: profileError } = await admin
    .from('profiles')
    .update({ must_change_password: true })
    .eq('id', userId)
  if (profileError) return { ok: false, error: profileError.message }

  revalidatePath('/users')
  return { ok: true, password }
}

// --- Edit (name, role, disabled) ---------------------------------------------

export type UpdateAccountResult = { ok: true } | { ok: false; error: string }

export async function updateAccountAction(formData: FormData): Promise<UpdateAccountResult> {
  const caller = await authorizeAction({ admin: true })
  if (!caller) return { ok: false, error: NOT_ALLOWED }

  const userId = String(formData.get('userId') ?? '')
  const fullName = String(formData.get('fullName') ?? '').trim()
  const role = formData.get('role')
  const disabled = formData.get('disabled') === 'true'

  if (!fullName) return { ok: false, error: 'Enter a name.' }
  if (!isRole(role)) return { ok: false, error: 'Pick a role.' }

  const admin = serviceClient()
  const { data: target, error: targetError } = await admin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle<Profile>()
  if (targetError) return { ok: false, error: targetError.message }
  if (!target) return { ok: false, error: 'That account no longer exists.' }

  const staysActiveAdmin = role === 'admin' && !disabled

  if (target.id === caller.userId && !staysActiveAdmin) {
    return { ok: false, error: 'You cannot disable or demote your own account.' }
  }

  const wasActiveAdmin = target.role === 'admin' && !target.disabled
  if (wasActiveAdmin && !staysActiveAdmin && (await countActiveAdmins()) <= 1) {
    return { ok: false, error: 'This is the last active admin. Promote someone else first.' }
  }

  // Ban first: once disabled, the account's refresh tokens must stop working.
  if (disabled !== target.disabled) {
    const { error } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: disabled ? BAN_FOREVER : 'none',
    })
    if (error) return { ok: false, error: error.message }
  }

  const { error: updateError } = await admin
    .from('profiles')
    .update({ full_name: fullName, role, disabled })
    .eq('id', userId)

  if (updateError) {
    // Put the ban back the way it was so Auth and the profile agree.
    if (disabled !== target.disabled) {
      await admin.auth.admin.updateUserById(userId, {
        ban_duration: target.disabled ? BAN_FOREVER : 'none',
      })
    }
    return { ok: false, error: updateError.message }
  }

  revalidatePath('/users')
  return { ok: true }
}
