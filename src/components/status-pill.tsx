import { StatusDot } from '@/components/status-dot'
import { STATUS_COLOR, STATUS_LABEL, STATUS_SOFT } from '@/lib/status'
import type { DisplayStatus } from '@/lib/types'

export function StatusPill({ status }: { status: DisplayStatus }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs leading-none font-semibold tracking-[0.06em]"
      style={{ background: STATUS_SOFT[status], color: STATUS_COLOR[status] }}
    >
      {/* The label already says it; the dot is decoration here. */}
      <StatusDot status={status} size={12} decorative />
      {STATUS_LABEL[status]}
    </span>
  )
}
