'use client'

import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'

/**
 * A native `<dialog>` opened with `showModal()`: the browser provides the focus
 * trap, inert background and focus return.
 *
 * Closing is driven by React state only — Escape (`cancel`, prevented), the
 * backdrop and the X button call `onClose`. The native `close` event is
 * deliberately NOT wired: React Strict Mode runs the effect mount → cleanup →
 * mount in dev, and the cleanup's `close()` queues a `close` event that lands
 * after the remount, which used to unmount the dialog the instant it opened
 * (the "Delete site does nothing" bug).
 */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      // A click on the backdrop lands on the <dialog> element itself.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-105 rounded-lg border border-(--border-strong) bg-(--surface-card) p-0 text-(--text-primary) backdrop:bg-black/60"
    >
      <div className="flex flex-col gap-5 p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id="modal-title" className="text-xl font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-1 rounded-sm p-1 text-(--text-muted) hover:text-(--text-primary)"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
