import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-md px-4 py-[9px] text-sm font-medium ' +
  'transition-[opacity,background-color] disabled:cursor-progress disabled:opacity-60'

const VARIANTS: Record<ButtonVariant, string> = {
  // Signal lime is reserved for the primary action.
  primary: 'bg-(--brand-signal-lime) text-(--text-on-lime) hover:opacity-90',
  secondary:
    'border border-(--border-strong) bg-(--surface-raised) text-(--text-primary) hover:bg-(--border-subtle)',
  ghost: 'text-(--text-secondary) hover:bg-(--surface-raised) hover:text-(--text-primary)',
  danger: 'bg-(--status-down-soft) text-(--status-down) hover:opacity-90',
}

/**
 * Class string for a button-styled element. Exported so links (`<Link>`, `<a>`)
 * can look like buttons without nesting a `<button>` inside an anchor.
 */
export function buttonClassName(variant: ButtonVariant = 'secondary', extra = ''): string {
  return `${BASE} ${VARIANTS[variant]} ${extra}`.trim()
}

export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={buttonClassName(variant, className)} {...props} />
}
