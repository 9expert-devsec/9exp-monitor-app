/**
 * Site logos: upload rules and the initials fallback. Pure — no I/O, no
 * `server-only` — so the drawer, the TV and a plain script can all use it.
 */

export const LOGO_BUCKET = 'site-logos'
export const LOGO_MAX_BYTES = 256 * 1024

export type LogoKind = { ext: 'png' | 'webp' | 'svg'; contentType: 'image/png' | 'image/webp' | 'image/svg+xml' }

export const LOGO_ACCEPT = 'image/png,image/webp,image/svg+xml,.png,.webp,.svg'

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function startsWith(bytes: Uint8Array, magic: number[], offset = 0): boolean {
  return magic.every((byte, index) => bytes[offset + index] === byte)
}

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0))

/**
 * Accepts PNG, WebP and SVG up to 256 KB, judged by the bytes (magic numbers /
 * an `<svg` root), never by the file name or the browser-declared type.
 */
export function validateLogoFile(bytes: Uint8Array): { ok: true; kind: LogoKind } | { ok: false; error: string } {
  if (bytes.byteLength === 0) return { ok: false, error: 'The file is empty.' }
  if (bytes.byteLength > LOGO_MAX_BYTES) {
    return { ok: false, error: `The logo is ${Math.ceil(bytes.byteLength / 1024)} KB; the limit is 256 KB.` }
  }
  if (startsWith(bytes, PNG_MAGIC)) return { ok: true, kind: { ext: 'png', contentType: 'image/png' } }
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) {
    return { ok: true, kind: { ext: 'webp', contentType: 'image/webp' } }
  }
  // SVG is text: an optional BOM, XML declaration, comments and doctype, then an <svg> root.
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 4096)).replace(/^﻿/, '')
  if (/^\s*(<\?xml[^>]*\?>\s*)?((<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)\s*)*<svg[\s>]/i.test(head)) {
    return { ok: true, kind: { ext: 'svg', contentType: 'image/svg+xml' } }
  }
  return { ok: false, error: 'Use a PNG, WebP or SVG image.' }
}

/**
 * Two letters for the logo slot when there is no logo: skip a leading
 * "9Expert ", then the first letters of the first two words ("Master Data" →
 * "MD"); one word → its first two capitals ("WordPress" → "WP", "HRMS" → "HR"),
 * else its first letter and the next consonant ("Reviews" → "RV").
 */
export function siteInitials(name: string): string {
  const words = name.replace(/^9\s*expert\s+/i, '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  const word = words[0]
  const capitals = word.match(/[A-Z]/g) ?? []
  if (capitals.length >= 2) return capitals.slice(0, 2).join('')
  const consonant = word.slice(1).match(/[b-df-hj-np-tv-z]/i)?.[0] ?? word[1] ?? ''
  return (word[0] + consonant).toUpperCase()
}
