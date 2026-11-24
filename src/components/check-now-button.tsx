'use client'

import { RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { runChecksAction } from '@/app/actions'
import { Button } from '@/components/button'

export function CheckNowButton({ className = '' }: { className?: string }) {
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
    <div className={`flex flex-col items-stretch gap-1 sm:items-end ${className}`}>
      <Button variant="primary" onClick={handleClick} disabled={pending}>
        <RefreshCw size={16} aria-hidden="true" className={pending ? 'animate-spin' : ''} />
        {pending ? 'Checking…' : 'Check now'}
      </Button>
      {error && (
        <p role="status" className="text-xs text-(--status-down)">
          {error}
        </p>
      )}
    </div>
  )
}
