import Image from 'next/image'

/**
 * The system logo. Every place the monitor shows its own mark uses this.
 *
 * The PNG is not square (1368 × 1150), so it is drawn with `object-fit:
 * contain` inside a `size` × `size` box: letterboxed, never stretched. The
 * corners are transparent, so the letterbox shows the surface behind it.
 * next/image serves a resized copy instead of the full 400 KB source.
 */
export function Logo({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/logo.png"
      alt="9Expert Monitor"
      width={size}
      height={size}
      preload
      className={className}
      style={{ width: size, height: size, objectFit: 'contain' }}
    />
  )
}
