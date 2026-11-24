import 'server-only'

import { timingSafeEqual } from 'node:crypto'

import { cronSecret } from '@/lib/env'

/** Constant-time compare so the header cannot be brute-forced byte by byte. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** True when the request carries the shared secret the scheduler uses. */
export function hasValidCronSecret(request: Request): boolean {
  const provided = request.headers.get('x-cron-secret')
  if (!provided) return false
  return secretsMatch(provided, cronSecret())
}
