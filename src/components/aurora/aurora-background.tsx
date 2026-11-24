'use client'

import dynamic from 'next/dynamic'

/**
 * Loaded client-side only: the WebGL code never runs in (or ships with) the
 * server render. `ssr: false` has to live in a Client Component in Next 16.
 * Until it mounts — or for good, if WebGL2 is unavailable — the page's static
 * radial gradient is what shows.
 */
const Aurora = dynamic(() => import('@/components/aurora/aurora'), { ssr: false })

export function AuroraBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0">
      <Aurora
        colorStops={['#005CFF', '#48B0FF', '#0AF574']}
        amplitude={1}
        blend={0.5}
        speed={0.5}
        layers={2}
        mouseInteraction={false}
      />
      {/* Fade the lower ~45% back into the page surface. */}
      <div className="absolute inset-x-0 bottom-0 h-[45%] bg-linear-to-b from-transparent to-(--surface-sunken)" />
    </div>
  )
}
