'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The browser client, used for Realtime only.
 *
 * It reads the session from the auth cookies, so the Realtime socket carries
 * the signed-in user's JWT and `postgres_changes` are delivered to the
 * `authenticated` role (anon has no SELECT any more). supabase-js hands the
 * refreshed token to Realtime on its own whenever the session rotates.
 * `createBrowserClient` is a singleton in the browser.
 */
export function realtimeClient(url: string, anonKey: string): SupabaseClient {
  return createBrowserClient(url, anonKey, {
    realtime: { params: { eventsPerSecond: 5 } },
  })
}
