import 'server-only'

import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'

import { sessionClient } from '@/lib/supabase/server'

export type Role = 'admin' | 'viewer'

/** A row of `public.profiles`. */
export interface Profile {
  id: string
  full_name: string
  role: Role
  disabled: boolean
  must_change_password: boolean
  created_at: string
  created_by: string | null
}

export interface Session {
  userId: string
  email: string
  profile: Profile
}

/**
 * The verified caller, or null. `getUser()` asks the Auth server rather than
 * trusting the cookie, so a banned or deleted account comes back as null.
 * The profile is read through RLS ("read own row"). Memoised per request.
 *
 * src/proxy.ts already turns away signed-out, disabled and must-change users
 * before a page renders. This is the second, independent check the Next.js
 * docs ask for: pages and Server Actions verify for themselves instead of
 * relying on a matcher that a refactor could quietly change.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await sessionClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .maybeSingle<Profile>()
  if (profileError || !profile) return null

  return { userId: data.user.id, email: data.user.email ?? '', profile }
})

/** For pages: the active session, or a redirect to where the user belongs. */
export async function requirePageSession(options: { allowPasswordChange?: boolean } = {}) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.profile.disabled) redirect('/login?error=disabled')
  if (session.profile.must_change_password && !options.allowPasswordChange) {
    redirect('/account/password')
  }
  return session
}

/** For admin pages. A viewer gets the plain 404 — the page's existence is not revealed. */
export async function requireAdminPage(): Promise<Session> {
  const session = await requirePageSession()
  if (session.profile.role !== 'admin') notFound()
  return session
}

/**
 * For Server Actions, which are public POST endpoints whatever the UI shows.
 * Returns null for: signed out, disabled, still on a temporary password, or
 * (with `admin: true`) not an admin.
 */
export async function authorizeAction(options: { admin?: boolean } = {}): Promise<Session | null> {
  const session = await getSession()
  if (!session || session.profile.disabled || session.profile.must_change_password) return null
  if (options.admin && session.profile.role !== 'admin') return null
  return session
}
