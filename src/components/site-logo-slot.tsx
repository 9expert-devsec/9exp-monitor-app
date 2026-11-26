'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'

import { siteInitials } from '@/lib/site-logo'

/**
 * The square logo slot (TV tiles, TV mobile rows, the site drawer's preview):
 * raised surface, subtle border, the logo at ~70 % — or two-letter initials
 * when there is no logo or it fails to load.
 *
 * Logos are ALWAYS drawn with <img>, never inlined (no dangerouslySetInnerHTML):
 * an SVG loaded as an image cannot run scripts or reach the page.
 *
 * `size` / `radius` / `fontSize` are CSS lengths; on the TV they are em of the
 * tile (so the slot scales with the tile's type), elsewhere plain px.
 */
export function SiteLogoSlot({
  url,
  mono,
  name,
  size,
  radius,
  fontSize,
  className,
}: {
  url: string | null
  mono: boolean
  name: string
  size: string
  radius: string
  fontSize: string
  className?: string
}) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const showImage = url !== null && failedUrl !== url

  // A server-rendered <img> can fail before hydration, when onError is not
  // attached yet; decode() rejects for an image that did not load.
  useEffect(() => {
    if (!url) return
    imgRef.current?.decode().catch(() => setFailedUrl(url))
  }, [url])

  const slot: CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    background: 'var(--surface-raised)',
    boxShadow: 'inset 0 0 0 1px var(--border-subtle)',
  }

  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center overflow-hidden ${className ?? ''}`} style={slot}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- Storage URL, tiny image; next/image adds nothing here.
        <img
          ref={imgRef}
          src={url}
          alt=""
          draggable={false}
          onError={() => setFailedUrl(url)}
          style={{
            width: '70%',
            height: '70%',
            objectFit: 'contain',
            ...(mono ? { filter: 'brightness(0) invert(1)', opacity: 0.85 } : {}),
          }}
        />
      ) : (
        <span className="font-semibold tracking-wide text-(--text-secondary)" style={{ fontSize, lineHeight: 1 }}>
          {siteInitials(name)}
        </span>
      )}
    </span>
  )
}
