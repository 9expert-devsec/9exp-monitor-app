'use client'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4 px-4 py-20">
      <h1 className="text-2xl font-extrabold">The monitor itself is broken</h1>
      <p style={{ color: 'var(--text-secondary)' }}>
        The dashboard could not load its data. This is a fault in the monitor, not
        necessarily in the sites it watches — check the Supabase connection and the
        environment variables listed in <code>.env.example</code>.
      </p>
      {error.digest && (
        <p className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
          digest {error.digest}
        </p>
      )}
      <button
        type="button"
        onClick={reset}
        className="rounded-lg px-3.5 py-2 text-sm font-bold"
        style={{ background: 'var(--color-brand-lime)', color: '#0a1834' }}
      >
        Try again
      </button>
    </main>
  )
}
