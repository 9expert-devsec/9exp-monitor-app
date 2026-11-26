import 'server-only'

import { certTargetOf, probeCertificate, CERT_TIMEOUT_MS } from '@/lib/cert'
import { deliver, inQuietHours, type NotificationSettings } from '@/lib/notify/slack'
import { serviceClient } from '@/lib/supabase/server'
import { hostOf } from '@/lib/format'
import { sslDaysLeft, sslThresholdReached } from '@/lib/tv'
import type { Site } from '@/lib/types'

/**
 * SSL expiry, run at the end of each checker run (no cron of its own):
 *  1. probe sites whose certificate was last read > 24 h ago (or never) —
 *     4 at a time, only while the run's deadline leaves room for a full probe;
 *     the rest wait for the next run;
 *  2. post one Slack message per threshold (30 / 14 / 7 / 0 days) per
 *     certificate (`last_notified_threshold`; a renewed cert resets it).
 * Never throws into the run. Before the `site_certificates` migration is
 * applied, the first read fails, is logged once, and nothing else happens.
 */

const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000
const CONCURRENCY = 4

interface CertRow {
  site_id: string
  valid_to: string | null
  issuer: string | null
  subject: string | null
  authorized: boolean | null
  checked_at: string
  last_error: string | null
  failed_days: number
  last_notified_threshold: number | null
}

export async function refreshCertificates(
  sites: Site[],
  settings: NotificationSettings | null,
  deadlineAt: number,
): Promise<void> {
  try {
    const supabase = serviceClient()
    const { data, error } = await supabase.from('site_certificates').select('*').returns<CertRow[]>()
    if (error) {
      console.error('[cert] site_certificates:', error.message)
      return
    }
    const rows = new Map((data ?? []).map((row) => [row.site_id, row]))

    // 1. Probe what is due.
    const now = Date.now()
    const due = sites.filter((site) => {
      if (!certTargetOf(site.url)) return false
      const row = rows.get(site.id)
      return !row || now - Date.parse(row.checked_at) >= REFRESH_AFTER_MS
    })
    let next = 0
    const worker = async () => {
      while (next < due.length && Date.now() + CERT_TIMEOUT_MS + 2_000 < deadlineAt) {
        const site = due[next++]
        const target = certTargetOf(site.url)!
        const reading = await probeCertificate(target.host, target.port)
        const previous = rows.get(site.id)
        const checkedAt = new Date().toISOString()
        const row: CertRow =
          reading.error === null && reading.validTo !== null
            ? {
                site_id: site.id,
                valid_to: reading.validTo,
                issuer: reading.issuer,
                subject: reading.subject,
                authorized: reading.authorized,
                checked_at: checkedAt,
                last_error: null,
                failed_days: 0,
                // Same certificate → keep what was announced; a renewed one starts over.
                last_notified_threshold:
                  previous && previous.valid_to && Date.parse(previous.valid_to) === Date.parse(reading.validTo)
                    ? previous.last_notified_threshold
                    : null,
              }
            : {
                // Keep the last good reading; count failed days (one probe per 24 h → once a day).
                site_id: site.id,
                valid_to: previous?.valid_to ?? null,
                issuer: previous?.issuer ?? null,
                subject: previous?.subject ?? null,
                authorized: previous?.authorized ?? null,
                checked_at: checkedAt,
                last_error: reading.error ?? 'No certificate read',
                failed_days: (previous?.failed_days ?? 0) + 1,
                last_notified_threshold: previous?.last_notified_threshold ?? null,
              }
        const { error: upsertError } = await supabase.from('site_certificates').upsert(row, { onConflict: 'site_id' })
        if (upsertError) console.error(`[cert] could not save ${site.slug}:`, upsertError.message)
        else rows.set(site.id, row)
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))

    // 2. Slack, once per threshold. Quiet hours: not urgent — wait, it goes out after.
    if (!settings?.slack_enabled || !settings.slack_webhook_url || inQuietHours(settings)) return
    for (const site of sites) {
      const row = rows.get(site.id)
      if (!site.alert_enabled || !row?.valid_to) continue
      const at = Date.now()
      const daysLeft = sslDaysLeft(row.valid_to, at)
      const expired = Date.parse(row.valid_to) <= at
      const threshold = sslThresholdReached(daysLeft, expired)
      if (threshold === null) continue
      const previous = row.last_notified_threshold
      if (previous !== null && previous <= threshold) continue

      // Atomic claim, so two overlapping runs cannot both post.
      const claim = supabase
        .from('site_certificates')
        .update({ last_notified_threshold: threshold })
        .eq('site_id', site.id)
        .eq('valid_to', row.valid_to)
      const { data: claimed } = await (previous === null
        ? claim.is('last_notified_threshold', null)
        : claim.eq('last_notified_threshold', previous)
      ).select('site_id')
      if ((claimed ?? []).length !== 1) continue

      const result = await deliver(
        settings,
        {
          kind: 'ssl_expiry',
          siteName: site.name,
          siteSlug: site.slug,
          host: hostOf(site.url),
          validTo: row.valid_to,
          daysLeft,
          expired,
        },
        { siteId: site.id, incidentKey: `ssl:${site.id}:${row.valid_to}:${threshold}` },
      )
      if (!result.ok) {
        await supabase.from('site_certificates').update({ last_notified_threshold: previous }).eq('site_id', site.id)
      }
    }
  } catch (error) {
    console.error('[cert] refresh failed:', error instanceof Error ? error.message : error)
  }
}
