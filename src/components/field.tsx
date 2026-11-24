import type { ReactNode } from 'react'

/** Shared text-input styling. */
export const INPUT_CLASS =
  'w-full rounded-md border border-(--border-strong) bg-(--surface-sunken) px-3 py-2.5 text-sm ' +
  'text-(--text-primary) placeholder:text-(--text-muted) ' +
  'focus-visible:border-(--brand-air-blue) focus-visible:outline-none aria-invalid:border-(--status-down)'

/** Label + control + optional hint / error, stacked. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  errorId,
  children,
}: {
  label: string
  htmlFor: string
  hint?: ReactNode
  error?: string | null
  /** id for `aria-describedby` on the control. */
  errorId?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-(--text-secondary)">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-(--text-muted)">{hint}</p>}
      {error && (
        <p id={errorId} className="text-xs text-(--status-down)">
          {error}
        </p>
      )}
    </div>
  )
}

/** The down-soft box used for a form's top-level error. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-md bg-(--status-down-soft) px-3 py-2.5 font-sans text-sm text-(--status-down)"
    >
      {children}
    </p>
  )
}
