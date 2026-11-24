import { Check, X } from 'lucide-react'

import { formatMs } from '@/lib/format'
import { dependencyStatus } from '@/lib/status'
import type { HealthDependency } from '@/lib/types'

/** One `payload.checks[]` entry. The glyph, not only the colour, carries the state. */
export function DependencyChip({ check }: { check: HealthDependency }) {
  const ok = dependencyStatus(check?.status) === 'ok'
  const name = check?.name ?? 'unnamed'
  const detail =
    check?.error ??
    `${name}: ${check?.status ?? 'missing'}${
      typeof check?.response_ms === 'number' ? ` · ${formatMs(check.response_ms)}` : ''
    }`

  return (
    <li
      title={detail}
      className="inline-flex items-center gap-1.5 rounded-sm border border-(--border-subtle) bg-(--surface-raised) px-2 py-1 font-mono text-xs leading-4 text-(--text-secondary)"
    >
      {ok ? (
        <Check size={12} strokeWidth={2.5} className="text-(--status-up)" aria-label="ok" />
      ) : (
        <X size={12} strokeWidth={2.5} className="text-(--status-down)" aria-label="failing" />
      )}
      {name}
    </li>
  )
}

/** Renders nothing when the payload reported no dependencies. */
export function DependencyChips({ checks }: { checks: HealthDependency[] }) {
  if (checks.length === 0) return null

  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Dependencies">
      {checks.map((check, index) => (
        <DependencyChip key={`${check?.name ?? 'check'}-${index}`} check={check} />
      ))}
    </ul>
  )
}

export function checksOf(payload: { checks?: unknown } | null | undefined): HealthDependency[] {
  const checks = payload?.checks
  return Array.isArray(checks) ? (checks as HealthDependency[]) : []
}
