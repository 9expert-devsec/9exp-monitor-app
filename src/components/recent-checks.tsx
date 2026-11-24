import { StatusPill } from '@/components/status-pill'
import type { RecentCheck } from '@/lib/dashboard'
import { formatClock, formatMs, formatShortDateTime } from '@/lib/format'

/** The last few rows of `health_checks` for one site, newest first. */
export function RecentChecks({ checks }: { checks: RecentCheck[] }) {
  if (checks.length === 0) {
    return (
      <p className="rounded-lg border border-(--border-subtle) bg-(--surface-card) p-6 text-sm text-(--text-secondary)">
        No checks recorded yet.
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-(--border-subtle) bg-(--surface-card)">
      {/* ≥ 640 px: table. */}
      <table className="hidden w-full text-sm sm:table">
        <thead>
          <tr className="label-overline border-b border-(--border-subtle) text-left">
            <th scope="col" className="px-4 py-3 font-semibold">Time</th>
            <th scope="col" className="px-4 py-3 font-semibold">Status</th>
            <th scope="col" className="px-4 py-3 font-semibold">HTTP</th>
            <th scope="col" className="px-4 py-3 text-right font-semibold">Response</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-(--border-subtle)">
          {checks.map((check) => (
            <tr key={check.id} title={check.error ?? undefined}>
              <td className="px-4 py-2.5 font-mono text-xs text-(--text-secondary)">
                {formatShortDateTime(check.checked_at)}
              </td>
              <td className="px-4 py-2.5">
                <StatusPill status={check.status} />
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-(--text-secondary)">
                {check.http_status ?? '—'}
              </td>
              <td className="px-4 py-2.5 text-right font-mono text-xs">
                {formatMs(check.response_ms)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* < 640 px: simple rows. */}
      <ul className="divide-y divide-(--border-subtle) sm:hidden">
        {checks.map((check) => (
          <li key={check.id} className="flex items-center gap-3 px-4 py-3">
            <span className="font-mono text-xs text-(--text-secondary)">
              {formatClock(check.checked_at)}
            </span>
            <StatusPill status={check.status} />
            <span className="ml-auto font-mono text-xs">
              {check.http_status ?? '—'} · {formatMs(check.response_ms)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
