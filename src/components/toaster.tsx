'use client'

import { CircleAlert, CircleCheck } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * Minimal toasts. `toast()` can be called from any client code; the single
 * <Toaster /> in the root layout renders them. A window event keeps it free of
 * context providers.
 */

type Tone = 'success' | 'error'
interface ToastItem {
  id: number
  text: string
  tone: Tone
}

const EVENT = 'monitor:toast'
const DURATION_MS = 4000

export function toast(text: string, tone: Tone = 'success') {
  window.dispatchEvent(new CustomEvent<Omit<ToastItem, 'id'>>(EVENT, { detail: { text, tone } }))
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    let next = 0
    function onToast(event: Event) {
      const { text, tone } = (event as CustomEvent<Omit<ToastItem, 'id'>>).detail
      next += 1
      const id = next
      setItems((current) => [...current, { id, text, tone }])
      setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), DURATION_MS)
    }
    window.addEventListener(EVENT, onToast)
    return () => window.removeEventListener(EVENT, onToast)
  }, [])

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-100 flex w-[min(24rem,calc(100%-2rem))] flex-col gap-2"
    >
      {items.map((item) => (
        <div
          key={item.id}
          role={item.tone === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto flex items-start gap-2.5 rounded-md border px-4 py-3 text-sm shadow-lg shadow-black/40 ${
            item.tone === 'error'
              ? 'border-(--status-down) bg-(--status-down-soft) text-(--status-down)'
              : 'border-(--status-up) bg-(--status-up-soft) text-(--status-up)'
          }`}
        >
          {item.tone === 'error' ? (
            <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          ) : (
            <CircleCheck size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          )}
          <span className="font-sans">{item.text}</span>
        </div>
      ))}
    </div>
  )
}
