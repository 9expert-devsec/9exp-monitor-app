import type { Metadata } from 'next'

import { NotificationsForm } from '@/app/notifications/notifications-form'
import { SlackPreview } from '@/app/notifications/slack-preview'
import { getNotificationPageData } from '@/lib/notify/page-data'
import { requireAdminPage } from '@/lib/session'

export const metadata: Metadata = { title: 'Notifications · 9Expert Monitor' }
export const dynamic = 'force-dynamic'

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  sent: { label: 'Sent', className: 'bg-(--status-up-soft) text-(--status-up)' },
  failed: { label: 'Failed', className: 'bg-(--status-down-soft) text-(--status-down)' },
  suppressed_quiet: { label: 'Suppressed (quiet)', className: 'bg-(--status-stale-soft) text-(--status-stale)' },
  skipped_disabled: { label: 'Skipped (alerts off)', className: 'bg-(--surface-raised) text-(--text-muted)' },
}

const EVENT_LABEL: Record<string, string> = {
  down: 'Down',
  recover: 'Recovered',
  degraded: 'Degraded',
  checker_stalled: 'Checker stopped',
  test: 'Test message',
}

/** Admin only (viewers get the plain 404, as on /users). */
export default async function NotificationsPage() {
  await requireAdminPage()
  const { settings, log, preview } = await getNotificationPageData()

  return (
    <main className="mx-auto flex w-full max-w-360 flex-col gap-6 px-4 py-6 sm:p-12">
      <div>
        <h1 className="text-[28px] leading-tight font-bold">Notifications</h1>
        <p className="mt-1 text-sm text-(--text-secondary)">Choose where and when the team gets alerted</p>
      </div>

      {settings === null ? (
        <p className="rounded-lg border border-(--status-degraded) bg-(--status-degraded-soft) p-5 text-sm text-(--status-degraded)">
          Notification settings are not available yet. Apply the migration
          <code className="mx-1 font-mono">20261124180000_notifications.sql</code>
          in the Supabase SQL Editor, then reload.
        </p>
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <NotificationsForm settings={settings} />
          </div>

          <div className="flex w-full flex-col gap-6 lg:w-120 lg:shrink-0">
            <section className="flex flex-col gap-4 rounded-lg border border-(--border-subtle) bg-(--surface-card) p-6">
              <div>
                <h2 className="text-xl font-semibold">Slack message preview</h2>
                <p className="mt-1 text-sm text-(--text-secondary)">
                  Built from the same data as the messages that are sent
                </p>
              </div>
              <SlackPreview messages={preview} />
            </section>

            <section className="flex flex-col gap-4 rounded-lg border border-(--border-subtle) bg-(--surface-card) p-6">
              <h2 className="text-xl font-semibold">Delivery log</h2>
              {log.length === 0 ? (
                <p className="text-sm text-(--text-secondary)">Nothing has been sent yet.</p>
              ) : (
                <ul className="divide-y divide-(--border-subtle)">
                  {log.map((row) => {
                    const status = STATUS_STYLE[row.status] ?? STATUS_STYLE.failed
                    return (
                      <li key={row.id} className="flex items-start gap-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">
                            <span className="font-medium">{EVENT_LABEL[row.event] ?? row.event}</span>
                            {row.siteName && <span className="text-(--text-secondary)"> · {row.siteName}</span>}
                          </p>
                          <p className="font-mono text-xs text-(--text-muted)">
                            {row.when} · Slack
                            {row.httpStatus !== null && ` · HTTP ${row.httpStatus}`}
                          </p>
                          {row.status === 'failed' && row.error && (
                            <p className="mt-0.5 truncate font-mono text-xs text-(--status-down)" title={row.error}>
                              {row.error}
                            </p>
                          )}
                        </div>
                        <span className={`shrink-0 rounded-pill px-2.5 py-1 text-xs font-semibold ${status.className}`}>
                          {status.label}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </main>
  )
}
