'use server'

import { revalidatePath } from 'next/cache'

import {
  URL_ALREADY_USED_MESSAGE,
  cannotConnectMessage,
  healthProblemMessage,
  slowPageMessage,
} from '@/lib/messages'
import { checkSite } from '@/lib/probe'
import { authorizeAction } from '@/lib/session'
import {
  SITE_GROUPS,
  slugify,
  uniqueSlug,
  validateSiteInput,
  type SiteFieldErrors,
} from '@/lib/site-form'
import { serviceClient } from '@/lib/supabase/server'
import type { Site } from '@/lib/types'

/*
 * Site administration. Every action re-checks that the caller is an enabled
 * admin and re-validates its input — these are public POST endpoints whatever
 * the UI shows. Writes go through the service role; `monitored_sites` has no
 * client write policy.
 */

const NOT_ALLOWED = 'Only an admin can do this.'
const UNIQUE_VIOLATION = '23505'

export type SaveSiteResult =
  | { ok: true; slug: string }
  | { ok: false; error: string | null; fieldErrors: SiteFieldErrors }

function rawFromForm(formData: FormData) {
  return {
    name: formData.get('name'),
    url: formData.get('url'),
    health_url: formData.get('health_url'),
    group_name: formData.get('group_name'),
    expected_ms: formData.get('expected_ms'),
    enabled: formData.get('enabled'),
    alert_enabled: formData.get('alert_enabled'),
  }
}

/** True when another site (not `exceptId`) already uses this page URL, case-insensitively. */
async function urlInUse(url: string, exceptId: string | null): Promise<boolean> {
  const { data, error } = await serviceClient()
    .from('monitored_sites')
    .select('id, url')
    .returns<Pick<Site, 'id' | 'url'>[]>()
  if (error) throw new Error(`Could not check URLs: ${error.message}`)
  const wanted = url.toLowerCase()
  return (data ?? []).some((row) => row.id !== exceptId && row.url.toLowerCase() === wanted)
}

function revalidateSites(slug?: string) {
  revalidatePath('/')
  revalidatePath('/sites')
  if (slug) revalidatePath(`/sites/${slug}`)
}

// --- Create ------------------------------------------------------------------

export async function createSiteAction(formData: FormData): Promise<SaveSiteResult> {
  const caller = await authorizeAction({ admin: true })
  if (!caller) return { ok: false, error: NOT_ALLOWED, fieldErrors: {} }

  const parsed = validateSiteInput(rawFromForm(formData))
  if (!parsed.ok) return { ok: false, error: null, fieldErrors: parsed.errors }
  const input = parsed.value

  if (await urlInUse(input.url, null)) {
    return { ok: false, error: null, fieldErrors: { url: URL_ALREADY_USED_MESSAGE } }
  }

  const admin = serviceClient()
  const { data: slugRows, error: slugError } = await admin
    .from('monitored_sites')
    .select('slug')
    .returns<{ slug: string }[]>()
  if (slugError) return { ok: false, error: slugError.message, fieldErrors: {} }
  const taken = new Set((slugRows ?? []).map((row) => row.slug))

  // Retry on a slug race with a concurrent create; the URL race maps to the field error.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = uniqueSlug(slugify(input.name), taken)
    const { error } = await admin.from('monitored_sites').insert({
      ...input,
      slug,
      created_by: caller.userId,
    })

    if (!error) {
      revalidateSites(slug)
      return { ok: true, slug }
    }
    if (error.code === UNIQUE_VIOLATION && error.message.includes('url')) {
      return { ok: false, error: null, fieldErrors: { url: URL_ALREADY_USED_MESSAGE } }
    }
    if (error.code === UNIQUE_VIOLATION && error.message.includes('slug')) {
      taken.add(slug)
      continue
    }
    console.error('[sites] create failed:', error.message)
    return { ok: false, error: error.message, fieldErrors: {} }
  }
  return { ok: false, error: 'Could not pick a unique slug. Try again.', fieldErrors: {} }
}

// --- Update ------------------------------------------------------------------

export async function updateSiteAction(formData: FormData): Promise<SaveSiteResult> {
  const caller = await authorizeAction({ admin: true })
  if (!caller) return { ok: false, error: NOT_ALLOWED, fieldErrors: {} }

  const id = String(formData.get('id') ?? '')
  const admin = serviceClient()
  const { data: existing, error: loadError } = await admin
    .from('monitored_sites')
    .select('*')
    .eq('id', id)
    .maybeSingle<Site>()
  if (loadError) return { ok: false, error: loadError.message, fieldErrors: {} }
  if (!existing) return { ok: false, error: 'That site no longer exists.', fieldErrors: {} }

  // A legacy group (outside SITE_GROUPS) may be kept as it is.
  const groups = existing.group_name ? [...SITE_GROUPS, existing.group_name] : SITE_GROUPS
  const parsed = validateSiteInput(rawFromForm(formData), groups)
  if (!parsed.ok) return { ok: false, error: null, fieldErrors: parsed.errors }
  const input = parsed.value

  if (await urlInUse(input.url, existing.id)) {
    return { ok: false, error: null, fieldErrors: { url: URL_ALREADY_USED_MESSAGE } }
  }

  // The slug is never changed on rename, so detail URLs stay stable.
  const { error } = await admin
    .from('monitored_sites')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', existing.id)

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { ok: false, error: null, fieldErrors: { url: URL_ALREADY_USED_MESSAGE } }
    }
    console.error('[sites] update failed:', error.message)
    return { ok: false, error: error.message, fieldErrors: {} }
  }

  revalidateSites(existing.slug)
  return { ok: true, slug: existing.slug }
}

// --- Enable / pause ----------------------------------------------------------

export type SimpleResult = { ok: true } | { ok: false; error: string }

export async function setSiteEnabledAction(id: string, enabled: boolean): Promise<SimpleResult> {
  const caller = await authorizeAction({ admin: true })
  if (!caller) return { ok: false, error: NOT_ALLOWED }

  const { data, error } = await serviceClient()
    .from('monitored_sites')
    .update({ enabled: enabled === true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('slug')
    .maybeSingle<{ slug: string }>()

  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'That site no longer exists.' }

  revalidateSites(data.slug)
  return { ok: true }
}

// --- Delete ------------------------------------------------------------------

/** Deletes the site and — by cascade — its whole check and incident history. */
export async function deleteSiteAction(id: string, confirmName: string): Promise<SimpleResult> {
  const caller = await authorizeAction({ admin: true })
  if (!caller) return { ok: false, error: NOT_ALLOWED }

  const admin = serviceClient()
  const { data: site, error: loadError } = await admin
    .from('monitored_sites')
    .select('id, name, slug')
    .eq('id', id)
    .maybeSingle<Pick<Site, 'id' | 'name' | 'slug'>>()
  if (loadError) return { ok: false, error: loadError.message }
  if (!site) return { ok: false, error: 'That site no longer exists.' }
  if (confirmName.trim() !== site.name) {
    return { ok: false, error: 'Type the site name exactly to confirm.' }
  }

  const { error } = await admin.from('monitored_sites').delete().eq('id', site.id)
  if (error) return { ok: false, error: error.message }

  revalidateSites(site.slug)
  return { ok: true }
}

// --- Test connection ---------------------------------------------------------

export type TestConnectionResult =
  | { ok: true; tone: 'up' | 'degraded' | 'down'; text: string }
  | { ok: false; error: string | null; fieldErrors: SiteFieldErrors }

/**
 * Runs the exact page + health check the checker runs, once, and records
 * nothing. Admin only — it makes the server send requests on the caller's
 * behalf, and only to https URLs that pass the same validation as Save.
 */
export async function testConnectionAction(formData: FormData): Promise<TestConnectionResult> {
  const caller = await authorizeAction({ admin: true })
  if (!caller) return { ok: false, error: NOT_ALLOWED, fieldErrors: {} }

  // Only the fields the check needs; name and group are irrelevant here.
  const parsed = validateSiteInput({
    ...rawFromForm(formData),
    name: 'test',
    group_name: SITE_GROUPS[0],
  })
  if (!parsed.ok) return { ok: false, error: null, fieldErrors: parsed.errors }
  const { url, health_url, expected_ms } = parsed.value

  const result = await checkSite({ url, health_url, expected_ms })
  const { page, health, message } = result

  if (result.status === 'up') {
    let text = `Test passed · page returned HTTP ${page.httpStatus} in ${page.responseMs} ms`
    if (health) text += ` · health OK in ${health.responseMs} ms`
    return { ok: true, tone: 'up', text }
  }

  const text =
    message?.key === 'slow_page'
      ? `${slowPageMessage(message.expectedMs)} (${message.responseMs} ms)`
      : message?.key === 'health_problem'
        ? healthProblemMessage(message.reason)
        : cannotConnectMessage(message?.key === 'page_down' ? message.reason : (result.error ?? ''))
  return { ok: true, tone: result.status, text }
}
