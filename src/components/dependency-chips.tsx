import { formatMs } from '@/lib/format'
import { dependencyStatus } from '@/lib/status'
import type { HealthDependency } from '@/lib/types'

/**
 * The `payload.checks[]` entries a project reports, rendered inline so a
 * degraded database is visible on the card without opening the detail page.
 */
export function DependencyChips({ checks }: { checks: HealthDependency[] }) {
  if (checks.length === 0) return null

  return (
    <ul className="flex flex-wrap gap-1.5">
      {checks.map((check, index) => {
        const state = dependencyStatus(check?.status)
        const failing = state === 'warn'

        return (
          <li
            key={`${check?.name ?? 'check'}-${index}`}
            title={check?.error ?? `${check?.name}: ${check?.status}`}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4"
            style={{
              borderColor: failing ? 'var(--status-degraded)' : 'var(--border-subtle)',
              background: failing ? 'var(--status-degraded-soft)' : 'transparent',
              color: failing ? 'var(--status-degraded)' : 'var(--text-secondary)',
            }}
          >
            {/* A leading glyph, so a failing chip is not signalled by colour alone. */}
            <span aria-hidden="true">{failing ? '!' : '·'}</span>
            <span className="font-medium">{check?.name ?? 'unnamed'}</span>
            {typeof check?.response_ms === 'number' && (
              <span className="opacity-70">{formatMs(check.response_ms)}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
