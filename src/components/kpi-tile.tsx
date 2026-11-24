import { StatusDot } from '@/components/status-dot'
import { STATUS_COLOR, STATUS_LABEL } from '@/lib/status'
import type { DisplayStatus } from '@/lib/types'

export function KpiTile({ status, count }: { status: DisplayStatus; count: number }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-(--border-subtle) bg-(--surface-card) p-5">
      <div className="flex items-center gap-2 text-sm text-(--text-secondary)">
        <StatusDot status={status} size={14} decorative />
        {STATUS_LABEL[status]}
      </div>
      <p
        className="font-mono text-[32px] leading-none font-bold"
        style={{ color: status === 'up' ? 'var(--text-primary)' : STATUS_COLOR[status] }}
      >
        {count}
      </p>
    </div>
  )
}
