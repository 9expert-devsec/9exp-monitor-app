/** "Pirasak S." → "PS"; one word → its first two letters. */
export function initialsOf(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return Array.from(words[0]).slice(0, 2).join('').toUpperCase()
  const first = Array.from(words[0])[0] ?? ''
  const last = Array.from(words[words.length - 1])[0] ?? ''
  return `${first}${last}`.toUpperCase()
}

/** 32 px initials circle on the raised surface. Decorative — callers show the name. */
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-(--surface-raised) text-xs font-semibold text-(--text-primary)"
      style={{ width: size, height: size }}
    >
      {initialsOf(name)}
    </span>
  )
}
