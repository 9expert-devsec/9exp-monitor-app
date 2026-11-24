import { hasValidCronSecret } from '@/lib/auth'
import { runChecks } from '@/lib/checker'

/**
 * Worst case for a single site is 10s + 2s retry delay + 10s = 22s, and sites
 * run fully in parallel, so the run is bounded by the slowest site rather than
 * by how many are registered. 60s leaves room for the DB writes on top.
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
