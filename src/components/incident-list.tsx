import { StatusDot } from '@/components/status-dot'
import { formatDuration, formatTime } from '@/lib/format'
import type { Incident } from '@/lib/types'

/** Reverse-chronological incident history for one site. */
export function IncidentList({ incidents, now }: { incidents: Incident[]; now: number }) {
  if (incidents.length === 0) {
    return (
      <p
        className="rounded-xl border p-6 text-sm"
        style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
      >
        No incidents recorded. This site has never been down since monitoring began.
      </p>
    )
  }

  return (
    <ol className="flex flex-col gap-2">
      {incidents.map((incident) => {
        const open = incident.resolved_at === null

        return (
          <li
            key={incident.id}
            className="rounded-xl border p-4"
            style={{
              background: 'var(--surface-card)',
              borderColor: open ? 'var(--status-down)' : 'var(--border-subtle)',
            }}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="flex items-center gap-2 font-bold">
                <StatusDot status={open ? 'down' : 'up'} size={12} />
                {open ? 'Ongoing outage' : 'Resolved'}
              </span>
              <span className="font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>
                {formatDuration(incident.started_at, incident.resolved_at, now)}
              </span>
            </div>

            <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
              {formatTime(incident.started_at)} →{' '}
              {incident.resolved_at ? formatTime(incident.resolved_at) : 'now'}
              {incident.http_status !== null && ` · HTTP ${incident.http_status}`}
            </p>

            {incident.last_error && (
              <p
                className="mt-2 rounded-md px-2 py-1.5 font-mono text-xs wrap-break-word"
                style={{
                  background: 'var(--surface-sunken)',
                  color: 'var(--text-secondary)',
                }}
              >
                {incident.last_error}
              </p>
            )}
          </li>
        )
      })}
    </ol>
  )
}
