import type { InputHTMLAttributes } from 'react'

/** A checkbox drawn as an on/off switch. Native input, so forms and keyboard just work. */
export function Switch({
  label,
  id,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'> & { label: string; id: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-4 text-sm">
      <span className="text-(--text-secondary)">{label}</span>
      <input
        {...props}
        id={id}
        type="checkbox"
        role="switch"
        className={
          'relative h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-pill bg-(--border-strong) transition-colors ' +
          'checked:bg-(--brand-nine-blue) ' +
          'before:absolute before:top-0.5 before:left-0.5 before:size-4 before:rounded-full before:bg-(--brand-cloud-base) before:transition-transform ' +
          'checked:before:translate-x-4'
        }
      />
    </label>
  )
}
