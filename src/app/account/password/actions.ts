'use server'

import { redirect } from 'next/navigation'

import { PASSWORD_TOO_SHORT_MESSAGE, PASSWORDS_DO_NOT_MATCH_MESSAGE } from '@/lib/messages'
import { MIN_PASSWORD_LENGTH } from '@/lib/password'
import { getSession } from '@/lib/session'
import { serviceClient, sessionClient } from '@/lib/supabase/server'

export type PasswordState = {
  error: string | null
  field: 'password' | 'confirm' | null
}

/**
 * Sets a new password for the signed-in user and clears
 * `must_change_password`. The session stays; the user lands on the overview.
 * Allowed while on a temporary password — that is what this page is for.
 */
export async function updatePasswordAction(
  _previous: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const session = await getSession()
  if (!session || session.profile.disabled) redirect('/login')

  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: PASSWORD_TOO_SHORT_MESSAGE, field: 'password' }
  }
  if (password !== confirm) return { error: PASSWORDS_DO_NOT_MATCH_MESSAGE, field: 'confirm' }

  const supabase = await sessionClient()
  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    if (error.code === 'same_password') {
      return { error: 'Choose a password different from the current one.', field: 'password' }
    }
    console.error('[account] password update failed:', error.message)
    return { error: error.message, field: null }
  }

  const { error: profileError } = await serviceClient()
    .from('profiles')
    .update({ must_change_password: false })
    .eq('id', session.userId)
  if (profileError) {
    console.error('[account] could not clear must_change_password:', profileError.message)
    return { error: 'Password updated, but the account could not be saved. Try again.', field: null }
  }

  redirect('/')
}
