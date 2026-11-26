'use client'

import { ImageUp, Trash2, X } from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react'

import {
  createSiteAction,
  deleteSiteAction,
  removeSiteLogoAction,
  setSiteLogoMonoAction,
  testConnectionAction,
  uploadSiteLogoAction,
  updateSiteAction,
  type TestConnectionResult,
} from '@/app/sites/actions'
import { Button } from '@/components/button'
import { Field, INPUT_CLASS } from '@/components/field'
import { Modal } from '@/components/modal'
import { SiteLogoSlot } from '@/components/site-logo-slot'
import { Switch } from '@/components/switch'
import { toast } from '@/components/toaster'
import { DELETE_SITE_WARNING } from '@/lib/messages'
import {
  DEFAULT_EXPECTED_MS,
  DEFAULT_GROUP,
  MAX_EXPECTED_MS,
  MIN_EXPECTED_MS,
  SITE_GROUPS,
  validateSiteInput,
  type SiteFieldErrors,
  type SiteGroup,
} from '@/lib/site-form'
import { LOGO_ACCEPT, validateLogoFile } from '@/lib/site-logo'
import type { SiteLogo } from '@/lib/site-logo-url'
import type { Site } from '@/lib/types'

/**
 * Opens from the URL — `?new=1` or `?edit=<slug>` — read straight from the
 * search params on every render, never copied into state. Closing rewrites the
 * URL with `history.replaceState`, which Next.js syncs into `useSearchParams`.
 */
export function SiteDrawer({ sites, logos }: { sites: Site[]; logos: Record<string, SiteLogo> }) {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const isNew = searchParams.get('new') === '1'
  const editSlug = searchParams.get('edit')
  const site = editSlug ? (sites.find((candidate) => candidate.slug === editSlug) ?? null) : null

  if (!isNew && !site) return null

  function close() {
    window.history.replaceState(null, '', pathname)
  }

  // Keyed so switching between sites (or to "new") starts from a fresh form.
  return (
    <DrawerPanel
      key={site?.id ?? 'new'}
      site={site}
      logo={site ? (logos[site.id] ?? { url: null, mono: true }) : null}
      onClose={close}
    />
  )
}

type TestState = Extract<TestConnectionResult, { ok: true }> | null

const TEST_TONE: Record<'up' | 'degraded' | 'down', string> = {
  up: 'bg-(--status-up-soft) text-(--status-up)',
  degraded: 'bg-(--status-degraded-soft) text-(--status-degraded)',
  down: 'bg-(--status-down-soft) text-(--status-down)',
}

function DrawerPanel({ site, logo, onClose }: { site: Site | null; logo: SiteLogo | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const isNew = site === null

  const [name, setName] = useState(site?.name ?? '')
  const [url, setUrl] = useState(site?.url ?? 'https://')
  const [healthUrl, setHealthUrl] = useState(site?.health_url ?? '')
  const [group, setGroup] = useState<string>(site?.group_name ?? DEFAULT_GROUP)
  const [expectedMs, setExpectedMs] = useState(String(site?.expected_ms ?? DEFAULT_EXPECTED_MS[DEFAULT_GROUP]))
  const [enabled, setEnabled] = useState(site?.enabled ?? true)
  const [alertEnabled, setAlertEnabled] = useState(site?.alert_enabled ?? true)

  const [fieldErrors, setFieldErrors] = useState<SiteFieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [test, setTest] = useState<TestState>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const [saving, startSave] = useTransition()
  const [testing, startTest] = useTransition()

  // A legacy group (e.g. sample rows) stays selectable for the site that has it.
  const groups: string[] =
    site?.group_name && !SITE_GROUPS.includes(site.group_name as SiteGroup)
      ? [...SITE_GROUPS, site.group_name]
      : [...SITE_GROUPS]

  // Modal dialog: the browser traps focus and turns the page inert. Focus goes
  // back to whatever opened the drawer (the "Add site" / "Edit" link).
  useEffect(() => {
    const dialog = dialogRef.current
    const trigger = document.activeElement as HTMLElement | null
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      dialog?.close()
      if (trigger?.isConnected) trigger.focus()
    }
  }, [])

  function formDataNow(): FormData {
    const formData = new FormData(formRef.current ?? undefined)
    // Unchecked checkboxes are absent from FormData; send both flags explicitly.
    formData.set('enabled', String(enabled))
    formData.set('alert_enabled', String(alertEnabled))
    return formData
  }

  function clientErrors(): SiteFieldErrors {
    const result = validateSiteInput(
      {
        name,
        url,
        health_url: healthUrl,
        group_name: group,
        expected_ms: expectedMs,
        enabled,
        alert_enabled: alertEnabled,
      },
      groups,
    )
    return result.ok ? {} : result.errors
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    const errors = clientErrors()
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    const formData = formDataNow()
    startSave(async () => {
      const result = isNew ? await createSiteAction(formData) : await updateSiteAction(formData)
      if (result.ok) {
        toast(isNew ? `Added ${name.trim()}` : `Saved ${name.trim()}`)
        onClose()
      } else {
        setFieldErrors(result.fieldErrors)
        setFormError(result.error)
      }
    })
  }

  function runTest() {
    setTest(null)
    setFormError(null)
    const errors = clientErrors()
    const relevant: SiteFieldErrors = {
      url: errors.url,
      health_url: errors.health_url,
      expected_ms: errors.expected_ms,
    }
    setFieldErrors(relevant)
    if (relevant.url || relevant.health_url || relevant.expected_ms) return

    const formData = formDataNow()
    startTest(async () => {
      const result = await testConnectionAction(formData)
      if (result.ok) setTest(result)
      else {
        setFieldErrors(result.fieldErrors)
        setFormError(result.error)
      }
    })
  }

  function changeGroup(next: string) {
    setGroup(next)
    // Only a NEW site follows the group's default threshold.
    if (isNew && next in DEFAULT_EXPECTED_MS) {
      setExpectedMs(String(DEFAULT_EXPECTED_MS[next as SiteGroup]))
    }
  }

  const errorProps = (field: keyof SiteFieldErrors) =>
    fieldErrors[field]
      ? { 'aria-invalid': true as const, 'aria-describedby': `site-${field}-error` }
      : {}

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="site-drawer-title"
      // Escape: let the URL drive closing instead of the browser.
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      // A click on the scrim lands on the <dialog> element itself.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-130 border-l border-(--border-strong) bg-(--surface-card) p-0 text-(--text-primary) backdrop:bg-[#060E18]/72"
    >
      <form ref={formRef} onSubmit={save} noValidate className="flex h-full flex-col">
        {site && <input type="hidden" name="id" value={site.id} />}

        <header className="flex items-start justify-between gap-4 border-b border-(--border-subtle) px-6 py-5">
          <div>
            <h2 id="site-drawer-title" className="text-xl font-semibold">
              {isNew ? 'Add site' : 'Edit site'}
            </h2>
            <p className="mt-1 text-sm text-(--text-secondary)">
              Every site gets a page check (HTTP status + response time) every 5 min
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-1 rounded-sm p-1 text-(--text-muted) hover:text-(--text-primary)"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
          <Field label="Site name" htmlFor="site-name" error={fieldErrors.name} errorId="site-name-error">
            <input
              id="site-name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              autoComplete="off"
              className={INPUT_CLASS}
              {...errorProps('name')}
            />
          </Field>

          <Field label="Page URL *" htmlFor="site-url" error={fieldErrors.url} errorId="site-url-error">
            <input
              id="site-url"
              name="url"
              type="url"
              inputMode="url"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value)
                setTest(null)
              }}
              required
              autoComplete="off"
              spellCheck={false}
              className={`${INPUT_CLASS} font-mono`}
              {...errorProps('url')}
            />
          </Field>

          <Field
            label="Health check URL (optional)"
            htmlFor="site-health-url"
            hint="In-house projects only. The endpoint must return the JSON contract from the README and check DB connectivity. Leave empty for a page check only."
            error={fieldErrors.health_url}
            errorId="site-health_url-error"
          >
            <input
              id="site-health-url"
              name="health_url"
              type="url"
              inputMode="url"
              value={healthUrl}
              onChange={(event) => {
                setHealthUrl(event.target.value)
                setTest(null)
              }}
              placeholder="https://…/api/health"
              autoComplete="off"
              spellCheck={false}
              className={`${INPUT_CLASS} font-mono`}
              {...errorProps('health_url')}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Group" htmlFor="site-group" error={fieldErrors.group_name} errorId="site-group_name-error">
              <select
                id="site-group"
                name="group_name"
                value={group}
                onChange={(event) => changeGroup(event.target.value)}
                className={INPUT_CLASS}
                {...errorProps('group_name')}
              >
                {groups.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Degraded above (ms)"
              htmlFor="site-expected-ms"
              error={fieldErrors.expected_ms}
              errorId="site-expected_ms-error"
            >
              <input
                id="site-expected-ms"
                name="expected_ms"
                type="number"
                inputMode="numeric"
                min={MIN_EXPECTED_MS}
                max={MAX_EXPECTED_MS}
                step={50}
                value={expectedMs}
                onChange={(event) => setExpectedMs(event.target.value)}
                className={`${INPUT_CLASS} font-mono`}
                {...errorProps('expected_ms')}
              />
            </Field>
          </div>

          {site && logo ? (
            <LogoField site={site} name={name.trim() || site.name} initial={logo} />
          ) : (
            <p className="text-sm text-(--text-muted)">Logo: save the site first, then add its logo here.</p>
          )}

          <div className="flex flex-col gap-4 rounded-md border border-(--border-subtle) p-4">
            <Switch
              id="site-enabled"
              label="Monitoring enabled"
              description="Pause during maintenance without deleting the site"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <Switch
              id="site-alert-enabled"
              label="Alert when this site goes down"
              description="Sent to the channels on the Notifications page"
              checked={alertEnabled}
              onChange={(event) => setAlertEnabled(event.target.checked)}
            />
          </div>

          {test && (
            <p role="status" className={`rounded-md px-3 py-2.5 font-sans text-sm ${TEST_TONE[test.tone]}`}>
              {test.text}
            </p>
          )}
          {formError && (
            <p role="alert" className="rounded-md bg-(--status-down-soft) px-3 py-2.5 text-sm text-(--status-down)">
              {formError}
            </p>
          )}

          {site && (
            <div className="mt-auto pt-2">
              <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
                <Trash2 size={16} aria-hidden="true" />
                Delete site
              </Button>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-(--border-subtle) px-6 py-4">
          <Button variant="secondary" onClick={runTest} disabled={testing || saving}>
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </footer>
      </form>

      {site && confirmingDelete && (
        <DeleteSiteDialog
          site={site}
          onCancel={() => setConfirmingDelete(false)}
          onDeleted={onClose}
        />
      )}
    </dialog>
  )
}

/**
 * Logo for the TV wall. Each change saves immediately (its own Server Action),
 * separate from the form's Save. The preview is the TV tile header on the dark
 * surface, with the silhouette setting applied.
 */
function LogoField({ site, name, initial }: { site: Site; name: string; initial: SiteLogo }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [logo, setLogo] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run(action: () => Promise<{ ok: true; url: string | null; mono: boolean } | { ok: false; error: string }>) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (result.ok) setLogo({ url: result.url, mono: result.mono })
      else setError(result.error)
    })
  }

  async function upload(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    // Same rule as the server (which checks again): content, not the file name.
    const checked = validateLogoFile(new Uint8Array(await file.arrayBuffer()))
    if (!checked.ok) {
      setError(checked.error)
      return
    }
    const formData = new FormData()
    formData.set('id', site.id)
    formData.set('logo', file)
    run(() => uploadSiteLogoAction(formData))
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-medium text-(--text-primary)">Logo</span>
      <div className="flex items-center gap-3 rounded-md bg-(--surface-page) px-4 py-3">
        <SiteLogoSlot url={logo.url} mono={logo.mono} name={name} size="36px" radius="10px" fontSize="13px" />
        <span className="font-heading min-w-0 truncate text-lg font-semibold">{name}</span>
        <span className="ml-auto text-xs text-(--text-muted)">TV preview</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept={LOGO_ACCEPT}
          className="sr-only"
          id="site-logo-file"
          onChange={(event) => void upload(event.target.files?.[0])}
        />
        <Button variant="secondary" disabled={pending} onClick={() => fileRef.current?.click()}>
          <ImageUp size={16} aria-hidden="true" />
          {pending ? 'Saving…' : logo.url ? 'Replace logo' : 'Upload logo'}
        </Button>
        {logo.url && (
          <Button variant="ghost" disabled={pending} onClick={() => run(() => removeSiteLogoAction(site.id))}>
            Remove
          </Button>
        )}
        <span className="text-xs text-(--text-muted)">PNG, WebP or SVG · max 256 KB</span>
      </div>
      <Switch
        id="site-logo-mono"
        label="Show as white silhouette"
        description="Keeps brand colours from competing with status colours. Turn off for a logo that turns into a blob."
        checked={logo.mono}
        disabled={pending}
        onChange={(event) => {
          const mono = event.target.checked
          run(() => setSiteLogoMonoAction(site.id, mono))
        }}
      />
      {error && (
        <p role="alert" className="text-sm text-(--status-down)">
          {error}
        </p>
      )}
    </div>
  )
}

/** Type-the-name confirmation. Deleting cascades away the site's whole history. */
function DeleteSiteDialog({
  site,
  onCancel,
  onDeleted,
}: {
  site: Site
  onCancel: () => void
  onDeleted: () => void
}) {
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const matches = typed.trim() === site.name

  return (
    <Modal title="Delete site" onClose={onCancel}>
      <p className="rounded-md bg-(--status-down-soft) px-3 py-2.5 font-sans text-sm text-(--status-down)">
        {DELETE_SITE_WARNING}
      </p>
      <Field label={`Type “${site.name}” to confirm`} htmlFor="delete-confirm">
        <input
          id="delete-confirm"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          className={INPUT_CLASS}
        />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-(--status-down)">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="danger"
          disabled={!matches || pending}
          onClick={() =>
            startTransition(async () => {
              const result = await deleteSiteAction(site.id, typed)
              if (result.ok) {
                toast(`Deleted ${site.name}`)
                onDeleted()
              } else {
                setError(result.error)
              }
            })
          }
        >
          {pending ? 'Deleting…' : 'Delete'}
        </Button>
      </div>
    </Modal>
  )
}
