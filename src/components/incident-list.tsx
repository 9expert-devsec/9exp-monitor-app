import { StatusDot } from '@/components/status-dot'
import { formatClock, formatDuration, formatShortDateTime } from '@/lib/format'
import type { Incident } from '@/lib/types'

/** Reverse-chronological incident history for one site. */
export function IncidentList({ incidents, now }: { incidents: Incident[]; now: number }) {
  if (incidents.length === 0) {
    return (
      <p className="rounded-lg border border-(--border-subtle) bg-(--surface-card) p-6 text-sm text-(--text-secondary)">
        No incidents recorded since monitoring began.
      </p>
    )
  }

  return (
    <ol className="flex flex-col gap-3">
      {incidents.map((incident) => {
        const open = incident.resolved_at === null

        return (
          <li
            key={incident.id}
            className="flex flex-col gap-2 rounded-lg border bg-(--surface-card) p-5"
            style={{ borderColor: open ? 'var(--status-down)' : 'var(--border-subtle)' }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-base font-semibold">
                <StatusDot status={open ? 'down' : 'up'} size={14} decorative />
                {open ? 'Ongoing outage' : 'Resolved'}
              </span>
              <span
                className="font-mono text-base"
                style={{ color: open ? 'var(--status-down)' : 'var(--text-secondary)' }}
              >
                {formatDuration(incident.started_at, incident.resolved_at, now)}
                {open && ' (ongoing)'}
              </span>
            </div>

            <p className="text-sm text-(--text-secondary)">
              {formatShortDateTime(incident.started_at)} →{' '}
              {incident.resolved_at ? formatClock(incident.resolved_at) : 'now'}
              {incident.http_status !== null && ` · HTTP ${incident.http_status}`}
            </p>

            {incident.last_error && (
              <p className="rounded-md bg-(--surface-sunken) px-3 py-2 font-mono text-xs wrap-break-word text-(--text-secondary)">
                {incident.last_error}
              </p>
            )}
          </li>
        )
      })}
    </ol>
  )
}
