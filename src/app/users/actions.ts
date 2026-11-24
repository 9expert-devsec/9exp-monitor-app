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

// --- Change email --------------------------------------------------------------

export type ChangeEmailResult =
  | {
      ok: true
      /** `user.email` after the update, read back with getUserById. */
      email: string
      /** The `email` identity's `identity_data.email`, read back the same way. */
      identityEmail: string | null
      /** True when the identity did not follow the user's email. */
      identityMismatch: boolean
      self: boolean
    }
  | { ok: false; error: string; field: 'email' | null }

/**
 * Changes an account's sign-in email through the Auth admin API, confirmed
 * immediately (accounts are admin-created; no confirmation mail is sent).
 * `profiles` keeps no copy of the email, so nothing else needs updating.
 * The result reports the identity's email too: if the admin API ever stops
 * updating `auth.identities`, the UI says so instead of hiding it.
 */
export async function changeEmailAction(userId: string, rawEmail: string): Promise<ChangeEmailResult> {
  const caller = await authorizeAction({ admin: true })
  if (!caller) return { ok: false, error: NOT_ALLOWED, field: null }

  const email = String(rawEmail ?? '').trim().toLowerCase()
  if (!looksLikeEmail(email)) return { ok: false, error: 'Enter a valid email.', field: 'email' }

  const admin = serviceClient()
  const { data: current, error: currentError } = await admin.auth.admin.getUserById(userId)
  if (currentError || !current.user) return { ok: false, error: 'That account no longer exists.', field: null }
  if ((current.user.email ?? '').toLowerCase() === email) {
    return { ok: false, error: 'That is already the email of this account.', field: 'email' }
  }

  // Duplicate check first, for a clear message; Auth's own uniqueness is the backstop.
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listError) return { ok: false, error: listError.message, field: null }
  if (list.users.some((user) => user.id !== userId && (user.email ?? '').toLowerCase() === email)) {
    return { ok: false, error: 'Another account already uses this email.', field: 'email' }
  }

  const { error } = await admin.auth.admin.updateUserById(userId, { email, email_confirm: true })
  if (error) {
    if (error.code === 'email_exists' || error.code === 'user_already_exists') {
      return { ok: false, error: 'Another account already uses this email.', field: 'email' }
    }
    return { ok: false, error: error.message, field: null }
  }

  const { data: after, error: afterError } = await admin.auth.admin.getUserById(userId)
  if (afterError || !after.user) {
    return { ok: false, error: 'Email changed, but the account could not be re-read.', field: null }
  }

  const identity = after.user.identities?.find((item) => item.provider === 'email')
  const identityEmail = typeof identity?.identity_data?.email === 'string' ? identity.identity_data.email : null
  const userEmail = after.user.email ?? ''

  revalidatePath('/users')
  return {
    ok: true,
    email: userEmail,
    identityEmail,
    identityMismatch: identityEmail !== null && identityEmail.toLowerCase() !== userEmail.toLowerCase(),
    self: userId === caller.userId,
  }
}
