/**
 * Syncs `monitored_sites` with config/sites.ts.
 *
 *   npm run seed
 *
 * Upserts on `slug`, so it is safe to run repeatedly. Sites that were removed
 * from the config are disabled rather than deleted — deleting would cascade
 * away their entire check history, which is almost never what you want.
 */

import { createClient } from '@supabase/supabase-js'
import { config as loadEnv } from 'dotenv'

import { DEFAULT_EXPECTED_MS, sites } from '../config/sites'

loadEnv({ path: '.env.local', quiet: true })
loadEnv({ path: '.env', quiet: true })

const url = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. See .env.example.')
  process.exit(1)
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main() {
  const rows = sites.map((site, index) => ({
    slug: site.slug,
    name: site.name,
    url: site.url,
    health_url: site.healthUrl,
    group_name: site.group,
    expected_ms: site.expectedMs ?? DEFAULT_EXPECTED_MS,
    enabled: site.enabled ?? true,
    sort_order: index,
  }))

  const { error: upsertError } = await supabase
    .from('monitored_sites')
    .upsert(rows, { onConflict: 'slug' })

  if (upsertError) {
    console.error('Seed failed:', upsertError.message)
    process.exit(1)
  }

  const configuredSlugs = rows.map((row) => row.slug)
  const { data: retired, error: retireError } = await supabase
    .from('monitored_sites')
    .update({ enabled: false })
    .not('slug', 'in', `(${configuredSlugs.map((slug) => `"${slug}"`).join(',')})`)
    .eq('enabled', true)
    .select('slug')

  if (retireError) {
    console.error('Could not disable removed sites:', retireError.message)
    process.exit(1)
  }

  console.log(`Seeded ${rows.length} site(s):`)
  for (const row of rows) {
    console.log(`  ${row.enabled ? '✓' : '·'} ${row.slug} → ${row.health_url}`)
  }

  if (retired && retired.length > 0) {
    console.log(`Disabled ${retired.length} site(s) no longer in config/sites.ts:`)
    for (const row of retired) console.log(`  · ${row.slug}`)
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
