/**
 * The publishable Supabase settings: project URL and anon key.
 *
 * Required since auth landed — sign-in, the session cookies and Realtime all
 * run on them. Deliberately free of `server-only` so `src/proxy.ts` and the
 * browser client can both import it; it never touches a secret.
 *
 * `process.env.NEXT_PUBLIC_*` must be referenced literally for Next.js to
 * inline the values into the browser bundle.
 */
export function publicSupabaseConfig(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Sign-in needs both — see .env.example.',
    )
  }
  return { url, anonKey }
}
