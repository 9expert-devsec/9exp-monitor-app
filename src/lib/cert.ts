import { isIP } from 'node:net'
import tls from 'node:tls'

/**
 * Reads a site's TLS certificate with node:tls — `fetch` cannot see it. Network
 * I/O only; never throws (a failure comes back as `error`). No `server-only`
 * import, so a script can load it outside Next.js, like classify.ts.
 *
 * Caveat: a site behind the Cloudflare proxy presents Cloudflare's edge
 * certificate (auto-renewed), not its origin's. The reading is still right for
 * what browsers see — it just rarely warns for those sites.
 */

export const CERT_TIMEOUT_MS = 10_000

export interface CertReading {
  /** ISO timestamp of notAfter, or null when no certificate was read. */
  validTo: string | null
  /** "R11 · Let's Encrypt" (issuer CN · O). */
  issuer: string | null
  /** Subject CN, e.g. "register.9expert.app" or "*.9expert.app". */
  subject: string | null
  /** Whether the chain verified for this host (read with rejectUnauthorized: false). */
  authorized: boolean | null
  error: string | null
}

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function failure(error: string): CertReading {
  return { validTo: null, issuer: null, subject: null, authorized: null, error }
}

function describe(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DNS lookup failed'
  if (code === 'ECONNREFUSED') return 'Connection refused'
  if (code === 'ECONNRESET') return 'Connection reset'
  if (code === 'ETIMEDOUT') return `Timeout after ${CERT_TIMEOUT_MS / 1000} s`
  return error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)
}

/** Host and port to probe from a site URL (https only; http sites have no certificate). */
export function certTargetOf(url: string): { host: string; port: number } | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return null
    return { host: parsed.hostname, port: parsed.port ? Number(parsed.port) : 443 }
  } catch {
    return null
  }
}

export function probeCertificate(host: string, port = 443, timeoutMs = CERT_TIMEOUT_MS): Promise<CertReading> {
  return new Promise((resolve) => {
    let settled = false
    let socket: tls.TLSSocket | null = null
    const finish = (reading: CertReading) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket?.destroy()
      resolve(reading)
    }
    const timer = setTimeout(() => finish(failure(`Timeout after ${timeoutMs / 1000} s`)), timeoutMs)

    try {
      socket = tls.connect(
        {
          host,
          port,
          // SNI: without it a shared host may answer with the wrong certificate.
          servername: isIP(host) ? undefined : host,
          // Read expired / invalid certificates too — that is the point.
          rejectUnauthorized: false,
        },
        () => {
          const cert = socket!.getPeerCertificate()
          if (!cert || Object.keys(cert).length === 0) return finish(failure('No certificate presented'))
          const validMs = Date.parse(cert.valid_to)
          const issuerParts = [first(cert.issuer?.CN), first(cert.issuer?.O)].filter((part): part is string => Boolean(part))
          finish({
            validTo: Number.isNaN(validMs) ? null : new Date(validMs).toISOString(),
            issuer: issuerParts.length ? issuerParts.join(' · ') : null,
            subject: first(cert.subject?.CN),
            authorized: socket!.authorized,
            error: Number.isNaN(validMs) ? 'Certificate has no readable expiry date' : null,
          })
        },
      )
      socket.on('error', (error) => finish(failure(describe(error))))
    } catch (error) {
      finish(failure(describe(error)))
    }
  })
}
