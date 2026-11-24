import { STATUS_COLOR, STATUS_LABEL } from '@/lib/status'
import type { DisplayStatus } from '@/lib/types'

/**
 * Each status gets its own shape as well as its own colour, so the four states
 * stay distinguishable in greyscale and for viewers with colour vision
 * deficiency:
 *
 *   up        filled disc
 *   degraded  filled triangle
 *   down      filled square
 *   stale     hollow diamond
 */
export function StatusDot({
  status,
  size = 12,
  className,
}: {
  status: DisplayStatus
  size?: number
  className?: string
}) {
  const color = STATUS_COLOR[status]

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      role="img"
      aria-label={STATUS_LABEL[status]}
      className={className}
      style={{ flexShrink: 0 }}
    >
      {status === 'up' && <circle cx="6" cy="6" r="5" fill={color} />}
      {status === 'degraded' && <path d="M6 0.5 L11.5 11 L0.5 11 Z" fill={color} />}
      {status === 'down' && <rect x="1" y="1" width="10" height="10" rx="1" fill={color} />}
      {status === 'stale' && (
        <path
          d="M6 1 L11 6 L6 11 L1 6 Z"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}
