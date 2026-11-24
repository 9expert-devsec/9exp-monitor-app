import { NextResponse, type NextRequest } from 'next/server'

import { sessionClient } from '@/lib/supabase/server'

/**
 * Sign-out is a plain POST route rather than a Server Action, so the proxy
 * can let it through for a user still on a temporary password (Server
 * Actions post to whatever page they sit on). POST only: a GET would let any
 * page sign you out with an <img> tag.
 */
export async function POST(request: NextRequest) {
  const supabase = await sessionClient()
  await supabase.auth.signOut()
  // 303 so the browser follows with a GET.
  return NextResponse.redirect(new URL('/login', request.url), 303)
}
