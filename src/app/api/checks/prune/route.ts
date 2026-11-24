import { hasValidCronSecret } from '@/lib/auth'
import { pruneChecks } from '@/lib/checker'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const RETAIN_DAYS = 30

export async function POST(request: Request) {
  if (!hasValidCronSecret(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { deleted } = await pruneChecks(RETAIN_DAYS)
    return Response.json(
      { deleted, retain_days: RETAIN_DAYS },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    )
  } catch (error) {
    console.error('[api/checks/prune] prune failed:', error)
    return Response.json(
      { error: error instanceof Error ? error.message : 'Prune failed' },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    )
  }
}
