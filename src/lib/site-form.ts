import { URL_MUST_BE_HTTPS_MESSAGE } from './messages'

/**
 * Site form rules, shared by the drawer (instant feedback) and the Server
 * Actions (the real check). Isomorphic, no I/O.
 */

export const SITE_GROUPS = ['In-house', 'Outsourced'] as const
export type SiteGroup = (typeof SITE_GROUPS)[number]

export const DEFAULT_GROUP: SiteGroup = 'Outsourced'
/** Default "Degraded above" for a new site, per group. */
export const DEFAULT_EXPECTED_MS: Record<SiteGroup, number> = {
  'In-house': 800,
  Outsourced: 1500,
}

export const MIN_EXPECTED_MS = 100
export const MAX_EXPECTED_MS = 30_000

export interface SiteInput {
  name: string
  url: string
  health_url: string | null
  group_name: string
  expected_ms: number
  enabled: boolean
  alert_enabled: boolean
}

export type SiteField = 'name' | 'url' | 'health_url' | 'group_name' | 'expected_ms'
export type SiteFieldErrors = Partial<Record<SiteField, string>>

function httpsUrlError(value: string): string | null {
  if (!/^https:\/\//i.test(value)) return URL_MUST_BE_HTTPS_MESSAGE
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' || !parsed.hostname.includes('.')) return 'Enter a full URL, e.g. https://www.example.com'
  } catch {
    return 'Enter a full URL, e.g. https://www.example.com'
  }
  return null
}

/**
 * Validates and normalises raw form values. `knownGroups` lets an existing
 * site keep a group outside SITE_GROUPS (e.g. legacy sample rows) on save.
 */
export function validateSiteInput(
  raw: {
    name: unknown
    url: unknown
    health_url: unknown
    group_name: unknown
    expected_ms: unknown
    enabled: unknown
    alert_enabled: unknown
  },
  knownGroups: readonly string[] = SITE_GROUPS,
): { ok: true; value: SiteInput } | { ok: false; errors: SiteFieldErrors } {
  const errors: SiteFieldErrors = {}

  const name = String(raw.name ?? '').trim()
  if (!name) errors.name = 'Enter a site name.'
  else if (name.length > 120) errors.name = 'Keep the name under 120 characters.'

  const url = String(raw.url ?? '').trim()
  const urlError = url ? httpsUrlError(url) : 'Enter the page URL.'
  if (urlError) errors.url = urlError

  const healthRaw = String(raw.health_url ?? '').trim()
  const health_url = healthRaw === '' ? null : healthRaw
  if (health_url) {
    const healthError = httpsUrlError(health_url)
    if (healthError) errors.health_url = healthError
  }

  const group_name = String(raw.group_name ?? '').trim()
  if (!knownGroups.includes(group_name)) errors.group_name = 'Pick a group.'

  const expected_ms = Number(raw.expected_ms)
  if (!Number.isInteger(expected_ms) || expected_ms < MIN_EXPECTED_MS || expected_ms > MAX_EXPECTED_MS) {
    errors.expected_ms = `Use a whole number from ${MIN_EXPECTED_MS} to ${MAX_EXPECTED_MS}.`
  }

  const flag = (value: unknown) => value === true || value === 'on' || value === 'true'

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      name,
      url,
      health_url,
      group_name,
      expected_ms,
      enabled: flag(raw.enabled),
      alert_enabled: flag(raw.alert_enabled),
    },
  }
}

/** "9Expert Public Website" → "9expert-public-website". Never empty. */
export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return base || 'site'
}

/** `base`, else `base-2`, `base-3`, … — the first not in `taken`. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

/** "/api/health" when it shares the page's host; "host/path" otherwise. */
export function healthPathLabel(pageUrl: string, healthUrl: string): string {
  try {
    const health = new URL(healthUrl)
    const page = new URL(pageUrl)
    const path = `${health.pathname}${health.search}`
    return health.host === page.host ? path : `${health.host}${path}`
  } catch {
    return healthUrl
  }
}
