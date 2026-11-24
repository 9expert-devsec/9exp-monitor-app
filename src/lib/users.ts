import 'server-only'

import type { Profile, Role } from '@/lib/session'
import { serviceClient } from '@/lib/supabase/server'

export interface UserRow {
  id: string
  fullName: string
  email: string
  role: Role
  disabled: boolean
  mustChangePassword: boolean
  /** From `auth.users.last_sign_in_at`; null = never. */
  lastSignInAt: string | null
}

/**
 * Every account that has a profile, admins first, then by name. Auth data
 * (email, last sign-in) comes from the admin API — `auth.users` is not
 * exposed through PostgREST. Service role; callers must be admins.
 */
export async function listUsers(): Promise<UserRow[]> {
  const admin = serviceClient()

  const [profilesResult, authResult] = await Promise.all([
    admin.from('profiles').select('*').returns<Profile[]>(),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ])

  if (profilesResult.error) throw new Error(`Could not load profiles: ${profilesResult.error.message}`)
  if (authResult.error) throw new Error(`Could not load accounts: ${authResult.error.message}`)

  const authById = new Map(authResult.data.users.map((user) => [user.id, user]))

  return (profilesResult.data ?? [])
    .map((profile) => {
      const user = authById.get(profile.id)
      return {
        id: profile.id,
        fullName: profile.full_name,
        email: user?.email ?? '—',
        role: profile.role,
        disabled: profile.disabled,
        mustChangePassword: profile.must_change_password,
        lastSignInAt: user?.last_sign_in_at ?? null,
      }
    })
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === 'admin' ? -1 : 1
      return a.fullName.localeCompare(b.fullName)
    })
}
