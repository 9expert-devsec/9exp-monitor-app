'use client'

import { Hash, Mail, Monitor, Send } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition, type FormEvent, type ReactNode } from 'react'

import { saveNotificationSettingsAction, sendSlackTestAction } from '@/app/notifications/actions'
import { Button } from '@/components/button'
import { INPUT_CLASS } from '@/components/field'
import { Switch } from '@/components/switch'
import { toast } from '@/components/toaster'
import type { PublicNotificationSettings } from '@/lib/notify/page-data'

const SMALL_INPUT =
  'w-16 rounded-sm border border-(--border-strong) bg-(--surface-sunken) px-1.5 py-0.5 text-center font-mono text-xs text-(--text-primary)'
const TIME_INPUT =
  'rounded-sm border border-(--border-strong) bg-(--surface-sunken) px-1.5 py-0.5 font-mono text-xs text-(--text-primary) [color-scheme:dark]'

function clockOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function Card({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="flex flex-col rounded-lg border border-(--border-subtle) bg-(--surface-card)">
      <div className="border-b border-(--border-subtle) px-6 py-5">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-(--text-secondary)">{subtitle}</p>
      </div>
      <div className="flex flex-col divide-y divide-(--border-subtle)">{children}</div>
    </section>
  )
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-pill bg-(--surface-raised) px-2 py-0.5 text-[11px] font-semibold text-(--text-secondary)">
      {children}
    </span>
  )
}

function RuleRow({
  id,
  title,
  description,
  checked,
  onChange,
}: {
  id: string
  title: ReactNode
  description: ReactNode
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-4">
      <div className="min-w-0">
        <p className="text-sm font-medium" id={`${id}-title`}>
          {title}
        </p>
        <div className="mt-0.5 text-xs text-(--text-muted)">{description}</div>
      </div>
      <Switch
        id={id}
        label={typeof title === 'string' ? title : id}
        labelHidden
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </div>
  )
}

/** Channels + Alert rules. One Save for everything; "Send test" works on its own. */
export function NotificationsForm({ settings }: { settings: PublicNotificationSettings }) {
  const router = useRouter()
  const [saving, startSave] = useTransition()
  const [testing, startTest] = useTransition()

  const [slackEnabled, setSlackEnabled] = useState(settings.slackEnabled)
  // Empty = keep the saved webhook. The saved one is only ever shown masked.
  const [webhook, setWebhook] = useState('')
  const [ruleDown, setRuleDown] = useState(settings.ruleDown)
  const [ruleRecover, setRuleRecover] = useState(settings.ruleRecover)
  const [ruleDegraded, setRuleDegraded] = useState(settings.ruleDegraded)
  const [degradedMinutes, setDegradedMinutes] = useState(String(settings.degradedMinutes))
  const [ruleStalled, setRuleStalled] = useState(settings.ruleCheckerStalled)
  const [stalledMinutes, setStalledMinutes] = useState(String(settings.stalledMinutes))
  const [quietEnabled, setQuietEnabled] = useState(settings.quietEnabled)
  const [quietStart, setQuietStart] = useState(settings.quietStart)
  const [quietEnd, setQuietEnd] = useState(settings.quietEnd)
  const [overrideMinutes, setOverrideMinutes] = useState(String(settings.quietOverrideMinutes))

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData()
    formData.set('slack_enabled', String(slackEnabled))
    formData.set('slack_webhook_url', webhook)
    formData.set('rule_down', String(ruleDown))
    formData.set('rule_recover', String(ruleRecover))
    formData.set('rule_degraded', String(ruleDegraded))
    formData.set('degraded_minutes', degradedMinutes)
    formData.set('rule_checker_stalled', String(ruleStalled))
    formData.set('stalled_minutes', stalledMinutes)
    formData.set('quiet_enabled', String(quietEnabled))
    formData.set('quiet_start', quietStart)
    formData.set('quiet_end', quietEnd)
    formData.set('quiet_override_minutes', overrideMinutes)
    startSave(async () => {
      const result = await saveNotificationSettingsAction(formData)
      if (result.ok) {
        setWebhook('')
        toast('Notification settings saved')
        router.refresh()
      } else {
        toast(result.error, 'error')
      }
    })
  }

  function sendTest() {
    startTest(async () => {
      const result = await sendSlackTestAction(webhook || null)
      if (result.ok) toast('Test message sent to Slack')
      else toast(`Slack test failed: ${result.error}`, 'error')
      router.refresh()
    })
  }

  const lastTest =
    settings.lastTestAt === null
      ? null
      : settings.lastTestOk
        ? { ok: true, text: `Last test succeeded at ${clockOf(settings.lastTestAt)}` }
        : { ok: false, text: `Last test failed at ${clockOf(settings.lastTestAt)}${settings.lastTestError ? ` — ${settings.lastTestError}` : ''}` }

  return (
    <form onSubmit={save} className="flex flex-col gap-6">
      <Card title="Channels" subtitle="Alerts go to every enabled channel">
        <div className="flex items-start gap-4 px-6 py-4">
          <Monitor size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-(--text-secondary)" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm font-medium">
              On-screen <Badge>Always on</Badge>
            </p>
            <p className="mt-0.5 text-xs text-(--text-muted)">Banner and red border on the dashboard, instantly</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 px-6 py-4">
          <div className="flex items-start gap-4">
            <Hash size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-(--text-secondary)" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Slack</p>
              <p className="mt-0.5 text-xs text-(--text-muted)">Post to a team channel via Incoming Webhook</p>
            </div>
            <Switch
              id="slack-enabled"
              label="Slack"
              labelHidden
              checked={slackEnabled}
              onChange={(event) => setSlackEnabled(event.target.checked)}
            />
          </div>
          <div className="flex flex-col gap-2 pl-9 sm:flex-row">
            <label htmlFor="slack-webhook" className="sr-only">
              Slack webhook URL
            </label>
            <input
              id="slack-webhook"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={webhook}
              onChange={(event) => setWebhook(event.target.value)}
              placeholder={settings.webhookMasked ?? 'https://hooks.slack.com/services/…'}
              className={`${INPUT_CLASS} min-w-0 font-mono text-xs`}
            />
            <Button variant="secondary" onClick={sendTest} disabled={testing} className="shrink-0">
              <Send size={14} aria-hidden="true" />
              {testing ? 'Sending…' : 'Send test'}
            </Button>
          </div>
          <p className="pl-9 text-xs text-(--text-muted)">
            {settings.webhookMasked
              ? 'Saved webhook shown masked. Leave the field empty to keep it; type a new URL to replace it.'
              : 'Paste the Incoming Webhook URL from your Slack app.'}
          </p>
          {lastTest && (
            <p className="flex items-center gap-2 pl-9 text-xs" role="status">
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ background: lastTest.ok ? 'var(--status-up)' : 'var(--status-down)' }}
              />
              <span style={{ color: lastTest.ok ? 'var(--text-secondary)' : 'var(--status-down)' }}>{lastTest.text}</span>
            </p>
          )}
        </div>

        <div className="flex items-start gap-4 px-6 py-4 opacity-55">
          <Mail size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-(--text-secondary)" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm font-medium">
              Email <Badge>Coming soon</Badge>
            </p>
            <p className="mt-0.5 text-xs text-(--text-muted)">Incident summary to the team inbox</p>
          </div>
        </div>
      </Card>

      <Card title="Alert rules" subtitle={'Applies to every site with "Alert when this site goes down" on'}>
        <RuleRow
          id="rule-down"
          title="Site goes down"
          description="After a retry confirms it (no false alarms)"
          checked={ruleDown}
          onChange={setRuleDown}
        />
        <RuleRow
          id="rule-recover"
          title="Site recovers"
          description="Includes total downtime"
          checked={ruleRecover}
          onChange={setRuleRecover}
        />
        <RuleRow
          id="rule-degraded"
          title={`Degraded for more than ${degradedMinutes || '…'} min`}
          description={
            <span className="flex flex-wrap items-center gap-1.5">
              Useful for customer-facing sites such as Genesis Lab · after
              <input
                aria-label="Degraded minutes"
                type="number"
                min={1}
                max={1440}
                value={degradedMinutes}
                onChange={(event) => setDegradedMinutes(event.target.value)}
                className={SMALL_INPUT}
              />
              min
            </span>
          }
          checked={ruleDegraded}
          onChange={setRuleDegraded}
        />
        <RuleRow
          id="rule-stalled"
          title="Checker stopped"
          description={
            <span className="flex flex-wrap items-center gap-1.5">
              No results for
              <input
                aria-label="Checker-stopped minutes"
                type="number"
                min={5}
                max={1440}
                value={stalledMinutes}
                onChange={(event) => setStalledMinutes(event.target.value)}
                className={SMALL_INPUT}
              />
              + min (the Supabase cron job may have stopped)
            </span>
          }
          checked={ruleStalled}
          onChange={setRuleStalled}
        />
        <RuleRow
          id="rule-quiet"
          title={
            <span className="flex flex-wrap items-center gap-1.5">
              Quiet hours
              <input
                aria-label="Quiet hours start"
                type="time"
                value={quietStart}
                onChange={(event) => setQuietStart(event.target.value)}
                className={TIME_INPUT}
              />
              –
              <input
                aria-label="Quiet hours end"
                type="time"
                value={quietEnd}
                onChange={(event) => setQuietEnd(event.target.value)}
                className={TIME_INPUT}
              />
            </span>
          }
          description={
            <span className="flex flex-wrap items-center gap-1.5">
              Incidents are still recorded but not posted, unless a site is down for
              <input
                aria-label="Quiet hours override minutes"
                type="number"
                min={5}
                max={1440}
                value={overrideMinutes}
                onChange={(event) => setOverrideMinutes(event.target.value)}
                className={SMALL_INPUT}
              />
              + min · Bangkok time
            </span>
          }
          checked={quietEnabled}
          onChange={setQuietEnabled}
        />
      </Card>

      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </form>
  )
}
