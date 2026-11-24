/**
 * The registry of everything the monitor watches.
 *
 * Adding a site is a one-line change here followed by `npm run seed`.
 * Never edit `monitored_sites` by hand in the Supabase dashboard — the seed
 * script upserts on `slug`, so a manual edit will be overwritten on the next run.
 *
 * Removing an entry here does NOT delete the row (that would cascade away its
 * history). The seed script disables it instead; delete it manually if you
 * really want the history gone.
 */

export type SiteGroup = 'Production' | 'Internal' | 'Legacy'

export interface SiteConfig {
  /** Stable identifier — also the URL segment at /sites/[slug]. Never reuse. */
  slug: string
  /** Human-readable name shown on the card. */
  name: string
  /** Homepage, used for the "open site" link. */
  url: string
  /** Full URL of the project's /api/health endpoint. */
  healthUrl: string
  group: SiteGroup
  /** Responses slower than this (ms) are classified `degraded`. */
  expectedMs?: number
  /** Set false to keep the history but stop checking. */
  enabled?: boolean
}

export const DEFAULT_EXPECTED_MS = 1500

export const sites: SiteConfig[] = [
  {
    slug: 'genesis-lab',
    name: '9Expert Public Website',
    url: 'https://www.9expert.co.th',
    healthUrl: 'https://www.9expert.co.th/api/health',
    group: 'Production',
    expectedMs: 1500,
  },
  {
    slug: 'academy-portal',
    name: '9Expert Academy Portal',
    url: 'https://academy.9expert.co.th',
    healthUrl: 'https://academy.9expert.co.th/api/health',
    group: 'Production',
    expectedMs: 2000,
  },
  {
    slug: 'admin-console',
    name: 'Internal Admin Console',
    url: 'https://admin.9expert.co.th',
    healthUrl: 'https://admin.9expert.co.th/api/health',
    group: 'Internal',
    expectedMs: 2500,
  },
]

/** Order shown in the UI is the order declared above. */
export function sortOrderOf(slug: string): number {
  const index = sites.findIndex((site) => site.slug === slug)
  return index === -1 ? 0 : index
}
