import { hasValidCronSecret } from '@/lib/auth'
import { runWatchdog } from '@/lib/notify/engine'

/**
 * "Checker stopped" watchdog. The checker cannot report its own absence, so
 * this must be called by a scheduler that does NOT depend on the checker's
 * (GitHub Actions) — see README → Notifications. Protected by CRON_SECRET,
 * idempotent: one Slack post per stall however often it is called.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  if (!hasValidCronSecret(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runWatchdog()
    return Response.json(result, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    console.error('[api/cron/watchdog] failed:', error)
    return Response.json(
      { error: error instanceof Error ? error.message : 'Watchdog failed' },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    )
  }
}
