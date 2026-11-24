/**
 * Runs one check against any URL — the same `checkSite()` the checker, "Check
 * now" and "Test connection" use — and prints the verdict. No database, no env.
 *
 *   npm run probe -- <pageUrl> [healthUrl] [expectedMs]
 *
 *   npm run probe -- https://www.example.com
 *   npm run probe -- https://www.example.com https://www.example.com/api/health 800
 */

import { cannotConnectMessage, healthProblemMessage, slowPageMessage } from '../src/lib/messages'
import { checkSite } from '../src/lib/probe'

const DEFAULT_EXPECTED_MS = 1500

const [pageUrl, healthArg, expectedArg] = process.argv.slice(2)

if (!pageUrl) {
  console.error('Usage: npm run probe -- <pageUrl> [healthUrl] [expectedMs]')
  process.exit(1)
}

// Allow the expected-ms value in the health slot: `probe <url> 800`.
const healthUrl = healthArg && !/^\d+$/.test(healthArg) ? healthArg : null
const expectedMs = Number((healthArg && /^\d+$/.test(healthArg) ? healthArg : expectedArg) ?? DEFAULT_EXPECTED_MS)

if (!Number.isFinite(expectedMs) || expectedMs <= 0) {
  console.error(`Invalid expectedMs: ${expectedArg}`)
  process.exit(1)
}

async function main() {
  const result = await checkSite({ url: pageUrl, health_url: healthUrl, expected_ms: expectedMs })
  const { page, health } = result

  console.log(`status:   ${result.status}`)
  console.log(
    `page:     ${pageUrl} → ` +
      (page.httpStatus !== null
        ? `HTTP ${page.httpStatus}${page.statusText ? ` ${page.statusText}` : ''} in ${page.responseMs} ms (degraded above ${expectedMs} ms)`
        : `no response (${page.networkError})`),
  )
  if (healthUrl) {
    console.log(
      `health:   ${healthUrl} → ` +
        (health === null
          ? 'not run (page failed)'
          : `${health.status}` +
            (health.httpStatus !== null ? `, HTTP ${health.httpStatus} in ${health.responseMs} ms` : '') +
            (health.error ? ` — ${health.error}` : '')),
    )
    if (health?.payload?.checks?.length) {
      console.log(
        `          checks: ${health.payload.checks.map((c) => `${c.name}=${c.status}`).join(', ')}`,
      )
    }
  } else {
    console.log('health:   — page check only')
  }
  console.log(`error:    ${result.error ?? '—'}`)

  const message = result.message
  const text =
    message === null
      ? '— (up)'
      : message.key === 'page_down'
        ? cannotConnectMessage(message.reason)
        : message.key === 'slow_page'
          ? slowPageMessage(message.expectedMs)
          : healthProblemMessage(message.reason)
  console.log(`message:  ${text}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
