import 'server-only'

import { createServerClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

import { supabaseServiceRoleKey, supabaseUrl } from '@/lib/env'
import { publicSupabaseConfig } from '@/lib/supabase/config'

let cached: SupabaseClient | null = null

/**
 * The service role client. Bypasses RLS, so it must never be constructed
 * anywhere that can reach the browser — `server-only` above enforces that.
 *
 * Used for the dashboard's reads (pages are only reachable signed in — see
 * src/proxy.ts and src/lib/session.ts), the checker, and every account write.
 */
export function serviceClient(): SupabaseClient {
  if (cached) return cached

  cached = createClient(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    // The checker runs in a short-lived serverless invocation; a realtime
    // socket here would just be an open handle that never gets used.
    global: { headers: { 'x-application-name': '9exp-monitor' } },
  })

  return cached
}

/**
 * The signed-in user's client: anon key + the session from the request
 * cookies, so RLS sees the caller as `authenticated`. One per request — the
 * cookie adapter is bound to this request's cookie store.
 *
 * Server Components cannot write cookies; a token refresh there is dropped
 * silently, which is fine because src/proxy.ts refreshes the session before
 * any page renders. Server Actions and Route Handlers can, and do.
 */
export async function sessionClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies()
  const { url, anonKey } = publicSupabaseConfig()

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Called from a Server Component — see the note above.
        }
      },
    },
  })
}
