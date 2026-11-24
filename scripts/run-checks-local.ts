/**
 * Fires the checker against a running dev server.
 *
 *   npm run dev          # in one terminal
 *   npm run check:local  # in another
 *
 * This goes through the HTTP route rather than importing `runChecks()` directly,
 * because the checker's modules are marked `server-only` and only load inside
 * the Next.js server runtime.
 *
 *   npm run check:local -- --prune                 # run the prune job instead
 *   npm run check:local -- --url https://…         # target a deployed instance
 */

import { config as loadEnv } from 'dotenv'

loadEnv({ path: '.env.local', quiet: true })
loadEnv({ path: '.env', quiet: true })

const args = process.argv.slice(2)
const urlFlag = args.indexOf('--url')
const baseUrl = (urlFlag !== -1 ? args[urlFlag + 1] : undefined) ?? 'http://localhost:3000'
const endpoint = args.includes('--prune') ? '/api/checks/prune' : '/api/checks/run'

const secret = process.env.CRON_SECRET
if (!secret) {
  console.error('Missing CRON_SECRET. See .env.example.')
  process.exit(1)
}

async function main() {
  const target = `${baseUrl.replace(/\/$/, '')}${endpoint}`
  console.log(`POST ${target}`)

  const response = await fetch(target, {
    method: 'POST',
    headers: { 'x-cron-secret': secret! },
  })

  const body = await response.text()
  console.log(`HTTP ${response.status}`)
  console.log(body)

  if (!response.ok) process.exit(1)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
