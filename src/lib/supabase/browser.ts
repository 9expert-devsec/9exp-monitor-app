'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

/**
 * Anon-key client, used for one thing only: subscribing to Realtime.
 *
 * The anon key is publishable by design. RLS grants it SELECT and nothing else,
 * so the worst it can do is read status data that the dashboard already renders.
 */
export function realtimeClient(url: string, anonKey: string): SupabaseClient {
  if (cached) return cached

  cached = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 5 } },
  })

  return cached
}
