'use client'

import { TriangleAlert } from 'lucide-react'
import { useEffect } from 'react'

import { Button } from '@/components/button'

export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="mx-auto flex w-full max-w-140 flex-1 flex-col items-center justify-center gap-5 px-4 py-20 text-center">
      <TriangleAlert size={48} aria-hidden="true" className="text-(--status-degraded)" />
      <h1 className="text-[28px] leading-tight font-bold">The monitor itself is broken</h1>
      <p className="text-(--text-secondary)">
        Dashboard โหลดข้อมูลไม่ได้ — ปัญหานี้อยู่ที่ระบบ Monitor ไม่ได้แปลว่าเว็บที่ตรวจอยู่ล่ม
        ตรวจการเชื่อมต่อ Supabase และค่า Environment ตาม .env.example
      </p>
      {/* `retry` re-fetches the segment's server data; `reset` would only re-render it. */}
      <Button variant="primary" onClick={() => retry()}>
        Try again
      </Button>
      {error.digest && (
        <code className="rounded-sm border border-(--border-subtle) bg-(--surface-sunken) px-2 py-1 font-mono text-xs text-(--text-muted)">
          digest {error.digest}
        </code>
      )}
    </main>
  )
}
