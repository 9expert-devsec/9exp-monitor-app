import 'server-only'

/**
 * Server-side environment access. Importing `server-only` makes it a build
 * error for any client component to pull this module — and with it the service
 * role key — into the browser bundle.
 */

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example.`,
    )
  }
  return value
}

export function supabaseUrl(): string {
  return required('SUPABASE_URL')
}

export function supabaseServiceRoleKey(): string {
  return required('SUPABASE_SERVICE_ROLE_KEY')
}

export function cronSecret(): string {
  return required('CRON_SECRET')
}

/**
 * The publishable pair, as a nullable value for the "Live" pill and the
 * dashboard's Realtime subscription. Since auth, sign-in itself needs both —
 * see `publicSupabaseConfig()` in src/lib/supabase/config.ts, which throws.
 */
export function publicRealtimeConfig(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  return { url, anonKey }
}

/**
 * The app's public origin, for links in Slack messages ("View details →").
 * APP_BASE_URL wins; on Vercel the production domain is used as a fallback.
 * Null when neither is set — messages are then sent without links.
 */
export function appBaseUrl(): string | null {
  const explicit = process.env.APP_BASE_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  return vercel ? `https://${vercel}` : null
}
