import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { publicSupabaseConfig } from '@/lib/supabase/config'

/**
 * Request interception (Next.js 16 renamed `middleware.ts` to `proxy.ts`).
 *
 * 1. Refreshes the Supabase session cookies on every request.
 * 2. Signed out            → /login?next=<path>
 * 3. Disabled / no profile → signed out, /login?error=disabled
 * 4. Temporary password    → /account/password (except that page and sign-out)
 * 5. Signed in on /login   → /
 *
 * Pages and Server Actions check again on their own (src/lib/session.ts) —
 * a matcher is not an authorization boundary.
 */

const LOGIN_PATH = '/login'
const PASSWORD_PATH = '/account/password'
const SIGN_OUT_PATH = '/auth/sign-out'

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const { url, anonKey } = publicSupabaseConfig()

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        // Make the refreshed tokens visible to the page rendering this request…
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        // …and send them back to the browser.
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value)
      },
    },
  })

  // Nothing may run between creating the client and this call: it is what
  // validates the JWT and rotates an expiring session.
  const { data } = await supabase.auth.getClaims()
  const userId = data?.claims?.sub

  const { pathname, search } = request.nextUrl

  /** A redirect that keeps whatever cookies the refresh / sign-out produced. */
  function redirectTo(path: string, params: Record<string, string> = {}) {
    const target = request.nextUrl.clone()
    target.pathname = path
    target.search = new URLSearchParams(params).toString()
    const redirect = NextResponse.redirect(target)
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie)
    for (const header of ['cache-control', 'expires', 'pragma']) {
      const value = response.headers.get(header)
      if (value) redirect.headers.set(header, value)
    }
    return redirect
  }

  if (!userId) {
    if (pathname === LOGIN_PATH || pathname === SIGN_OUT_PATH) return response
    return redirectTo(LOGIN_PATH, { next: `${pathname}${search}` })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('disabled, must_change_password')
    .eq('id', userId)
    .maybeSingle<{ disabled: boolean; must_change_password: boolean }>()

  if (!profile || profile.disabled) {
    await supabase.auth.signOut()
    // On /login itself, just let the page (or the sign-in POST) through
    // without the session; redirecting a Server Action POST would break it.
    if (pathname === LOGIN_PATH) return response
    return redirectTo(LOGIN_PATH, { error: 'disabled' })
  }

  if (pathname === LOGIN_PATH) return redirectTo('/')

  if (profile.must_change_password && pathname !== PASSWORD_PATH && pathname !== SIGN_OUT_PATH) {
    return redirectTo(PASSWORD_PATH)
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except:
     * - /api/checks/run, /api/checks/prune, /api/cron/watchdog — CRON_SECRET auth
     * - /_next/static, /_next/image       — build output
     * - /icon.png, /apple-icon.png        — favicon and touch icon
     * - /logo.png                         — the login card's logo
     * - /fonts/*                          — the brand font the login page uses
     */
    '/((?!api/checks/run|api/checks/prune|api/cron/watchdog|_next/static|_next/image|icon\\.png|apple-icon\\.png|logo\\.png|fonts/).*)',
  ],
}
