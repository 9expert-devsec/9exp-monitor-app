'use server'

import { randomUUID } from 'node:crypto'

import { revalidatePath } from 'next/cache'

import {
  URL_ALREADY_USED_MESSAGE,
  cannotConnectMessage,
  healthProblemMessage,
  slowPageMessage,
} from '@/lib/messages'
import { checkSite } from '@/lib/probe'
import { bottomSortOrder } from '@/lib/site-order'
import { authorizeAction } from '@/lib/session'
import {
  SITE_GROUPS,
  slugify,
  uniqueSlug,
  validateSiteInput,
  type SiteFieldErrors,
} from '@/lib/site-form'
import { LOGO_BUCKET, LOGO_MAX_BYTES, validateLogoFile } from '@/lib/site-logo'
import { siteLogoOf } from '@/lib/site-logo-url'
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
  const { data: existingRows, error: slugError } = await admin
    .from('monitored_sites')
    .select('slug, group_name, sort_order')
    .returns<Pick<Site, 'slug' | 'group_name' | 'sort_order'>[]>()
  if (slugError) return { ok: false, error: slugError.message, fieldErrors: {} }
  const taken = new Set((existingRows ?? []).map((row) => row.slug))
  // New sites land at the bottom of their group.
  const sort_order = bottomSortOrder(
    (existingRows ?? []).filter((row) => row.group_name === input.group_name).map((row) => row.sort_order),
  )

  // Retry on a slug race with a concurrent create; the URL race maps to the field error.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = uniqueSlug(slugify(input.name), taken)
    const { error } = await admin.from('monitored_sites').insert({
      ...input,
      slug,
      sort_order,
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

  // Moving to another group puts the site at the bottom of that group.
  let sortOrder = existing.sort_order
  if (input.group_name !== existing.group_name) {
    const { data: groupRows, error: groupError } = await admin
      .from('monitored_sites')
      .select('sort_order')
      .eq('group_name', input.group_name)
      .neq('id', existing.id)
      .returns<{ sort_order: number }[]>()
    if (groupError) return { ok: false, error: groupError.message, fieldErrors: {} }
    sortOrder = bottomSortOrder((groupRows ?? []).map((row) => row.sort_order))
  }

  // The slug is never changed on rename, so detail URLs stay stable.
  const { error } = await admin
    .from('monitored_sites')
    .update({ ...input, sort_order: sortOrder, updated_at: new Date().toISOString() })
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

// --- Reorder -----------------------------------------------------------------

export interface GroupOrder {
  /** The group as stored (`group_name`); null for sites without one. */
  group: string | null
  /** Every site id in that group, in the new order. */
  ids: string[]
}

/**
 * Saves the manual order of one or more groups. Each group must list exactly
 * the sites that are in it — no more, no fewer, no duplicates — so a stale or
 * forged request cannot move a site across groups. Orders become 10, 20, 30, …
 * per group.
 *
 * Writes ONLY `sort_order`, one `update … where id = …` per site, and only for
 * rows whose value actually changes — name, url, slug and updated_at are never
 * touched (there is no updated_at trigger on monitored_sites). On any failure
 * the paths are revalidated so the client re-fetches the real order.
 */
export async function saveSiteOrderAction(groups: GroupOrder[]): Promise<SimpleResult> {
  const caller = await authorizeAction({ admin: true })
  if (!caller) return { ok: false, error: NOT_ALLOWED }
  if (!Array.isArray(groups) || groups.length === 0) return { ok: true }

  const admin = serviceClient()
  const { data: sites, error } = await admin
    .from('monitored_sites')
    .select('id, group_name, sort_order')
    .returns<Pick<Site, 'id' | 'group_name' | 'sort_order'>[]>()
  if (error) return { ok: false, error: error.message }

  const current = new Map((sites ?? []).map((site) => [site.id, site.sort_order]))
  const changes: { id: string; sort_order: number }[] = []
  const seenGroups = new Set<string>()

  for (const { group, ids } of groups) {
    const groupKey = group ?? '\u0000none'
    if (seenGroups.has(groupKey)) return { ok: false, error: 'A group was sent twice.' }
    seenGroups.add(groupKey)

    const expected = (sites ?? []).filter((site) => site.group_name === group).map((site) => site.id)
    const unique = new Set(ids)
    if (
      !Array.isArray(ids) ||
      unique.size !== ids.length ||
      ids.length !== expected.length ||
      !expected.every((id) => unique.has(id))
    ) {
      revalidateSites()
      return { ok: false, error: 'The site list changed meanwhile. The current order has been reloaded.' }
    }

    ids.forEach((id, index) => {
      const sortOrder = (index + 1) * 10
      if (current.get(id) !== sortOrder) changes.push({ id, sort_order: sortOrder })
    })
  }

  for (const change of changes) {
    const { error: updateError } = await admin
      .from('monitored_sites')
      .update({ sort_order: change.sort_order })
      .eq('id', change.id)
    if (updateError) {
      revalidateSites()
      return { ok: false, error: `${updateError.message} — the current order has been reloaded.` }
    }
  }

  revalidateSites()
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

// --- Logo (round 10) ---------------------------------------------------------

export type LogoResult = { ok: true; url: string | null; mono: boolean } | { ok: false; error: string }

const LOGO_NEEDS_MIGRATION = 'Logos need the database update first (migration 20261126140000_site_logos.sql).'

type LogoRow = Pick<Site, 'id' | 'slug' | 'logo_path' | 'logo_mono'>

/** The site's current logo columns; a missing column (migration not applied) → a clear error. */
async function loadLogoRow(id: string): Promise<{ ok: true; row: LogoRow } | { ok: false; error: string }> {
  const { data, error } = await serviceClient()
    .from('monitored_sites')
    .select('id, slug, logo_path, logo_mono')
    .eq('id', id)
    .maybeSingle<LogoRow>()
  if (error) {
    console.error('[logo] could not read logo columns:', error.message)
    return { ok: false, error: /logo_/.test(error.message) ? LOGO_NEEDS_MIGRATION : error.message }
  }
  if (!data) return { ok: false, error: 'That site no longer exists.' }
  return { ok: true, row: data }
}

async function removeLogoObject(path: string | null | undefined) {
  if (!path) return
  const { error } = await serviceClient().storage.from(LOGO_BUCKET).remove([path])
  if (error) console.error('[logo] could not delete old object:', error.message)
}

/**
 * Upload or replace a site's logo. Admin only, like editing a site. The bytes
 * are checked (PNG / WebP / SVG by content, ≤ 256 KB), stored under
 * `<site_id>/<random>.<ext>` so a replacement gets a new URL, and the previous
 * object is deleted only after the row points at the new one.
 */
export async function uploadSiteLogoAction(formData: FormData): Promise<LogoResult> {
  const caller = await authorizeAction({ admin: true })
  if (!caller) return { ok: false, error: NOT_ALLOWED }

  const id = String(formData.get('id') ?? '')
  const file = formData.get('logo')
  if (!(file instanceof File)) return { ok: false, error: 'Choose an image file.' }
  // Cheap early refusal; validateLogoFile() below checks the size again with the bytes.
  if (file.size > LOGO_MAX_BYTES) return { ok: false, error: `The logo is ${Math.ceil(file.size / 1024)} KB; the limit is 256 KB.` }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const checked = validateLogoFile(bytes)
  if (!checked.ok) return { ok: false, error: checked.error }

  const loaded = await loadLogoRow(id)
  if (!loaded.ok) return loaded
  const { row } = loaded

  const admin = serviceClient()
  const path = `${row.id}/${randomUUID()}.${checked.kind.ext}`
  const { error: uploadError } = await admin.storage.from(LOGO_BUCKET).upload(path, bytes, {
    contentType: checked.kind.contentType,
    cacheControl: '31536000',
    upsert: false,
  })
  if (uploadError) {
    console.error('[logo] upload failed:', uploadError.message)
    return { ok: false, error: `Upload failed: ${uploadError.message}` }
  }

  const { error: updateError } = await admin
    .from('monitored_sites')
    .update({ logo_path: path, updated_at: new Date().toISOString() })
    .eq('id', row.id)
  if (updateError) {
    await removeLogoObject(path)
    return { ok: false, error: updateError.message }
  }
  await removeLogoObject(row.logo_path)

  revalidateSites(row.slug)
  revalidatePath('/tv')
  return { ok: true, ...siteLogoOf({ logo_path: path, logo_mono: row.logo_mono }) }
}

export async function removeSiteLogoAction(id: string): Promise<LogoResult> {
  const caller = await authorizeAction({ admin: true })
  if (!caller) return { ok: false, error: NOT_ALLOWED }

  const loaded = await loadLogoRow(id)
  if (!loaded.ok) return loaded
  const { row } = loaded

  const { error } = await serviceClient()
    .from('monitored_sites')
    .update({ logo_path: null, updated_at: new Date().toISOString() })
    .eq('id', row.id)
  if (error) return { ok: false, error: error.message }
  await removeLogoObject(row.logo_path)

  revalidateSites(row.slug)
  revalidatePath('/tv')
  return { ok: true, url: null, mono: row.logo_mono ?? true }
}

export async function setSiteLogoMonoAction(id: string, mono: boolean): Promise<LogoResult> {
  const caller = await authorizeAction({ admin: true })
  if (!caller) return { ok: false, error: NOT_ALLOWED }

  const loaded = await loadLogoRow(id)
  if (!loaded.ok) return loaded
  const { row } = loaded

  const { error } = await serviceClient()
    .from('monitored_sites')
    .update({ logo_mono: mono === true, updated_at: new Date().toISOString() })
    .eq('id', row.id)
  if (error) return { ok: false, error: error.message }

  revalidateSites(row.slug)
  revalidatePath('/tv')
  return { ok: true, ...siteLogoOf({ logo_path: row.logo_path, logo_mono: mono === true }) }
}
