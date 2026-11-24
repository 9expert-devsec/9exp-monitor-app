import type { InputHTMLAttributes } from 'react'

const TRACK =
  'relative h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-pill bg-(--border-strong) transition-colors ' +
  'checked:bg-(--brand-nine-blue) disabled:cursor-not-allowed disabled:opacity-60 ' +
  'before:absolute before:top-0.5 before:left-0.5 before:size-4 before:rounded-full before:bg-(--brand-cloud-base) before:transition-transform ' +
  'checked:before:translate-x-4'

/**
 * A checkbox drawn as an on/off switch. Native input, so forms and keyboard
 * just work. `labelHidden` keeps the label for screen readers only (table
 * rows); `description` adds a muted second line under the label.
 */
export function Switch({
  label,
  id,
  labelHidden = false,
  description,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'> & {
  label: string
  id: string
  labelHidden?: boolean
  description?: string
}) {
  if (labelHidden) {
    return <input {...props} id={id} type="checkbox" role="switch" aria-label={label} className={TRACK} />
  }

  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-4 text-sm">
      <span className="flex flex-col gap-0.5">
        <span className="text-(--text-secondary)">{label}</span>
        {description && <span className="text-xs text-(--text-muted)">{description}</span>}
      </span>
      <input
        {...props}
        id={id}
        type="checkbox"
        role="switch"
        className={TRACK}
      />
    </label>
  )
}
