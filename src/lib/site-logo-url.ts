import 'server-only'

import { LOGO_BUCKET } from '@/lib/site-logo'
import { serviceClient } from '@/lib/supabase/server'
import type { Site } from '@/lib/types'

/** What a page needs to draw a site's logo slot. */
export interface SiteLogo {
  /** Public URL derived from `logo_path`; null → initials. */
  url: string | null
  /** Render as a white silhouette. */
  mono: boolean
}

/**
 * Public URL for a stored logo path, from the storage helper (no request is
 * made). Only paths are stored; URLs are derived here at read time. Before the
 * logo migration the columns are simply absent → `url: null` (initials).
 */
export function siteLogoOf(site: Pick<Site, 'logo_path' | 'logo_mono'>): SiteLogo {
  const path = site.logo_path ?? null
  return {
    url: path ? serviceClient().storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl : null,
    mono: site.logo_mono ?? true,
  }
}
