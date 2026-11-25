import Image from 'next/image'
import type { CSSProperties } from 'react'

/**
 * The system logo. Every place the monitor shows its own mark uses this.
 *
 * The PNG is not square (1368 × 1150), so it is drawn with `object-fit:
 * contain` inside a `size` × `size` box: letterboxed, never stretched. The
 * corners are transparent, so the letterbox shows the surface behind it.
 * next/image serves a resized copy instead of the full 400 KB source.
 */
export function Logo({
  size = 36,
  className,
  style,
}: {
  size?: number
  className?: string
  /** Overrides the box size, e.g. a clamp() on the TV wall. `size` still picks the image resolution. */
  style?: CSSProperties
}) {
  return (
    <Image
      src="/logo.png"
      alt="9Expert Monitor"
      width={size}
      height={size}
      preload
      className={className}
      style={{ width: size, height: size, objectFit: 'contain', ...style }}
    />
  )
}
