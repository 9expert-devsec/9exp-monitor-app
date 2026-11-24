/**
 * Password rules and temporary-password generation. Isomorphic on purpose:
 * the Users page pre-fills a password on the server and regenerates it in the
 * browser, and the create-admin script uses it from Node. All three use Web
 * Crypto, never Math.random.
 */

export const MIN_PASSWORD_LENGTH = 12
export const TEMP_PASSWORD_LENGTH = 16

// No 0/O, 1/l/I — a temporary password gets read aloud or retyped.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_+?'

/** Uniformly random over ALPHABET (rejection sampling, no modulo bias). */
export function generateTemporaryPassword(length = TEMP_PASSWORD_LENGTH): string {
  const limit = 256 - (256 % ALPHABET.length)
  const out: string[] = []
  const buffer = new Uint8Array(length * 2)
  while (out.length < length) {
    globalThis.crypto.getRandomValues(buffer)
    for (const byte of buffer) {
      if (byte < limit) out.push(ALPHABET[byte % ALPHABET.length])
      if (out.length === length) break
    }
  }
  return out.join('')
}
