import Link from 'next/link'

export default function SiteNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4 px-4 py-20">
      <h1 className="text-2xl font-extrabold">Site not found</h1>
      <p style={{ color: 'var(--text-secondary)' }}>
        No monitored site has that slug. Add it to <code>config/sites.ts</code> and run{' '}
        <code>npm run seed</code>.
      </p>
      <Link
        href="/"
        className="text-sm hover:underline"
        style={{ color: 'var(--color-brand-blue)' }}
      >
        ← All sites
      </Link>
    </main>
  )
}
