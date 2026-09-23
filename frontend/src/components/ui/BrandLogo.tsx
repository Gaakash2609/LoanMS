import type { CSSProperties } from 'react'

/**
 * The single source of truth for rendering the MudraHub brand mark.
 *
 * It renders the REAL logo assets — public/assets/logo-004.png for the full
 * "MudraHub · Clarity. Confidence. Capital" wordmark, and
 * public/assets/logo-04-mark.png (the same brand's "M/H" monogram artwork,
 * transparent background) for the collapsed icon-rail slot — rather than
 * re-typing the brand name as text or re-drawing it. `object-fit: contain` +
 * `width: auto` off a fixed height guarantees the artwork is never
 * stretched, squashed or cropped, and its own colours are never filtered or
 * recoloured.
 *
 *   <BrandLogo height={40} />  full wordmark, scaled to 40px tall
 *   <BrandMark size={32} />    compact square app-icon for tight spaces
 *                              (collapsed sidebar rail, favicon-sized slots)
 *                              where the wide wordmark cannot fit legibly.
 *
 * The "mark" is the same monogram used in the legacy vanilla-JS app's
 * collapsed sidebar — never a re-typed letter "M" in a generic badge.
 */

const LOGO_SRC = '/assets/logo-004.png'
const MARK_SRC = '/assets/logo-04-mark.png'

export function BrandLogo({
  height = 36,
  className,
  style,
}: {
  height?: number
  className?: string
  style?: CSSProperties
}) {
  return (
    <img
      src={LOGO_SRC}
      alt="MudraHub"
      draggable={false}
      className={className}
      style={{
        height,
        width: 'auto',
        display: 'block',
        objectFit: 'contain',
        userSelect: 'none',
        ...style,
      }}
    />
  )
}

/** Compact square monogram for icon-sized slots (collapsed rail). */
export function BrandMark({
  size = 32,
  className,
  style,
}: {
  size?: number
  className?: string
  style?: CSSProperties
}) {
  return (
    <img
      src={MARK_SRC}
      alt="MudraHub"
      draggable={false}
      className={className}
      style={{
        width: size,
        height: size,
        display: 'block',
        objectFit: 'contain',
        flexShrink: 0,
        userSelect: 'none',
        ...style,
      }}
    />
  )
}

// ── Branding-aware slots ─────────────────────────────────────────────────────
// Render the admin-configured branding (Settings → Logo & Branding) with a
// single rule shared by the real sidebar, the sign-in page and the Settings
// live preview: an uploaded image OVERRIDES the default MudraHub asset; with no
// image the default asset is used; brand text renders only for a rebrand. Sizes
// come pre-clamped from useBranding so they can never break the layout.

/** Collapsed icon slot: custom square logo, else the default M/H monogram. */
export function SidebarBrandIcon({
  src, size, alt = 'Brand',
}: { src?: string; size: number; alt?: string }) {
  if (src)
    return (
      <img src={src} alt={alt} draggable={false}
        style={{ width: size, height: size, objectFit: 'contain', display: 'block', flexShrink: 0, userSelect: 'none' }} />
    )
  return <BrandMark size={size} />
}

/**
 * Expanded banner slot: custom wide logo, else — for a rebrand (name/sub
 * changed but no banner uploaded) — the brand name + subtitle as text, else the
 * real MudraHub wordmark asset. Never re-types "MudraHub" as text: the typed
 * path is reached only when the admin deliberately set a different brand name.
 */
export function SidebarBrandBanner({
  bannerSrc, height, name, sub, asText, alt = 'MudraHub',
}: {
  bannerSrc?: string
  height: number
  name?: string
  sub?: string
  asText?: boolean
  alt?: string
}) {
  if (bannerSrc)
    return (
      <img src={bannerSrc} alt={alt} draggable={false}
        style={{ height, width: 'auto', maxWidth: '100%', objectFit: 'contain', display: 'block', userSelect: 'none' }} />
    )
  if (asText)
    return (
      <div className="flex flex-col items-start min-w-0" style={{ lineHeight: 1 }}>
        <span style={{
          fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: Math.round(height * 0.5),
          color: 'var(--accent)', whiteSpace: 'nowrap', lineHeight: 1.05,
        }}>{name}</span>
        {sub
          ? <span style={{
              fontSize: Math.max(8, Math.round(height * 0.19)), letterSpacing: '1.3px', fontWeight: 700,
              color: 'var(--text3)', textTransform: 'uppercase', whiteSpace: 'nowrap', marginTop: 3,
            }}>{sub}</span>
          : null}
      </div>
    )
  return <BrandLogo height={height} style={{ maxWidth: '100%' }} />
}
