'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { runChecksAction } from '@/app/actions'

export function CheckNowButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleClick() {
    setError(null)
    startTransition(async () => {
      const result = await runChecksAction()
      if (result.ok) {
        // Realtime patches the cards as rows land, but the aggregates
        // (24h average, rollups, uptime) are server-computed.
        router.refresh()
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-lg px-3.5 py-2 text-sm font-bold transition-opacity hover:opacity-90 disabled:cursor-progress disabled:opacity-60"
        style={{ background: 'var(--color-brand-lime)', color: '#0a1834' }}
      >
        {pending ? 'Checking…' : 'Check now'}
      </button>
      {error && (
        <p role="status" className="text-xs" style={{ color: 'var(--status-down)' }}>
          {error}
        </p>
      )}
    </div>
  )
}
