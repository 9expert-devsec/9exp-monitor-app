import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { supabaseServiceRoleKey, supabaseUrl } from '@/lib/env'

let cached: SupabaseClient | null = null

/**
 * The service role client. Bypasses RLS, so it must never be constructed
 * anywhere that can reach the browser — `server-only` above enforces that.
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
