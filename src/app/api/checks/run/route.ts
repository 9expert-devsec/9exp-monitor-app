import { hasValidCronSecret } from '@/lib/auth'
import { runChecks } from '@/lib/checker'

/**
 * Worst case for a single site is the page check, its retry and the optional
 * health call: 10s + 2s + 10s + 10s = 32s. Sites run fully in parallel, so the
 * run is bounded by the slowest site rather than by how many are registered.
 * The checker stops itself at 45s (RUN_DEADLINE_MS in src/lib/checker.ts) so it
 * can still record and answer; 60s leaves room for the DB writes on top. The
 * pg_cron caller waits 65s before giving up.
 */
export const maxDuration = 60

/** Never cached, never prerendered — this route has side effects. */
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  if (!hasValidCronSecret(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const summary = await runChecks()
    return Response.json(summary, {
      status: 200,
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    console.error('[api/checks/run] run failed:', error)
    return Response.json(
      { error: error instanceof Error ? error.message : 'Run failed' },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    )
  }
}
