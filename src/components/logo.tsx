import Image from 'next/image'

/** The system logo. Every place the monitor shows its own mark uses this. */
export function Logo({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/logo.svg"
      alt="9Expert Monitor"
      width={size}
      height={size}
      // An SVG gains nothing from the image optimizer.
      unoptimized
      priority
      className={className}
    />
  )
}
