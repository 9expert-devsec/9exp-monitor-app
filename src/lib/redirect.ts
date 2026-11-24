/**
 * The `?next=` target after sign-in, if it is a same-origin path; otherwise
 * `/`. Rejects `//evil.example`, `/\evil.example` and anything not starting
 * with a single `/`, which browsers would treat as another origin.
 */
export function safeNextPath(raw: FormDataEntryValue | string | null | undefined): string {
  if (typeof raw !== 'string') return '/'
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  if (raw.startsWith('/login') || raw.startsWith('/auth/')) return '/'
  try {
    // Resolve against a dummy origin: if the origin changes, it was not a path.
    const url = new URL(raw, 'http://local.invalid')
    if (url.origin !== 'http://local.invalid') return '/'
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/'
  }
}
