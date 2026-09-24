import { useId, useLayoutEffect, type CSSProperties } from 'react'
import { useLoaderStore } from '@/store/loaderStore'
import { createPortal } from 'react-dom'

/**
 * LoanMS loader components — replaces all old spinner/loader UI across the project.
 *
 * Exports (same names as before, so all existing imports continue to work):
 *   LoadingSpinner  — compact inline section loader (previously: SVG circle spinner)
 *   GlobalLoaderView — the full-screen loader visual. Drawn ONLY by <GlobalLoader/>
 *                     (mounted once in main.tsx), which owns the 2s-min timing.
 *   PageLoader      — page-level "not ready" marker: draws nothing, tells the
 *                     global loader to stay up while mounted (Suspense fallback,
 *                     auth hydration, resume-draft screens)
 *   InlineLoader    — tiny icon-sized spinner (previously: lucide Loader/Loader2
 *                     + Tailwind `animate-spin`, and Button's raw SVG spinner).
 *                     Drop-in replacement: same `size` (px) prop lucide icons take,
 *                     inherits `currentColor` like they did, so any wrapping
 *                     text-color / className is preserved unchanged.
 *   OverlayLoader   — absolute-positioned panel/card overlay (previously: the
 *                     `.kyc-loading-overlay` ID-card scan animation). Keeps the
 *                     same overlay chrome (blurred panel, rounded corners,
 *                     title + optional subtitle) — only the animation swapped.
 *
 * The animation is the brand-matched "dual counter-orbiting rings + logo" from
 * loanms-loader.html (full badge), or a single ring cut from the same
 * lms-spinCW/lms-spinCCW keyframes (InlineLoader), so every loading indicator
 * in the app now shares one animation family. Inline CSS keeps this
 * self-contained and avoids any dependency on globals.css keyframes.
 *
 * Loading LOGIC (isLoading/busy/extracting state, API calls, show/hide
 * triggers) is UNCHANGED everywhere this is used. Only the visual animation
 * has been swapped.
 */

/* ─── Shared keyframe block ────────────────────────────────────────────────
   Injected once into the document head the first time any loader renders.
   All loanms-loader animations live here; nothing else in the app uses these
   names, so there is no risk of collision. */
const KEYFRAMES = `
@keyframes lms-spinCW {
  0%   { transform: rotate(0deg); }
  22%  { transform: rotate(70deg); }
  50%  { transform: rotate(180deg); }
  78%  { transform: rotate(290deg); }
  100% { transform: rotate(360deg); }
}
@keyframes lms-spinCCW {
  0%   { transform: rotate(0deg); }
  24%  { transform: rotate(-82deg); }
  50%  { transform: rotate(-180deg); }
  76%  { transform: rotate(-278deg); }
  100% { transform: rotate(-360deg); }
}
@keyframes lms-breatheBlue {
  0%   { stroke-dasharray: 1 100;  stroke-dashoffset: 0; }
  26%  { stroke-dasharray: 30 100; stroke-dashoffset: -6; }
  42%  { stroke-dasharray: 46 100; stroke-dashoffset: -14; }
  72%  { stroke-dasharray: 26 100; stroke-dashoffset: -34; }
  100% { stroke-dasharray: 1 100;  stroke-dashoffset: -60; }
}
@keyframes lms-breatheOrange {
  0%   { stroke-dasharray: 1 100;  stroke-dashoffset: 0; }
  22%  { stroke-dasharray: 20 100; stroke-dashoffset: -10; }
  38%  { stroke-dasharray: 32 100; stroke-dashoffset: -22; }
  68%  { stroke-dasharray: 18 100; stroke-dashoffset: -40; }
  100% { stroke-dasharray: 1 100;  stroke-dashoffset: -58; }
}
@keyframes lms-haloPulse {
  0%, 100% { transform: scale(.92); opacity: .4; }
  50%       { transform: scale(1.06); opacity: .75; }
}
@keyframes lms-dotPulse {
  0%, 80%, 100% { opacity: .25; transform: translateY(0) scale(.85); }
  40%           { opacity: 1;   transform: translateY(-3px) scale(1.15); }
}
@keyframes lms-logoPulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50%      { transform: scale(1.08); opacity: .85; }
}
@keyframes lms-riseIn {
  from { opacity: 0; transform: translateY(9px); }
  to   { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .lms-ring, .lms-ring-accent,
  .lms-ring__progress, .lms-ring-accent__progress,
  .lms-halo, .lms-logo, .lms-dot { animation: none !important; }
}
`

let keyframesInjected = false
function ensureKeyframes() {
  if (keyframesInjected) return
  keyframesInjected = true
  const style = document.createElement('style')
  style.textContent = KEYFRAMES
  document.head.appendChild(style)
}

/* ─── Shared badge (the spinning rings + logo) ────────────────────────────
   Used by both LoadingSpinner (inside a section) and PageLoader (full page). */
export function LoanMSBadge({ size = 120 }: { size?: number }) {
  // Ensure keyframes are in the DOM on first render
  if (typeof document !== 'undefined') ensureKeyframes()

  // Unique gradient ids per badge instance. Several badges can be mounted at
  // once (e.g. a section spinner + the offer interstitial); with fixed ids
  // `url(#${ringGradId})` resolves to the FIRST match in the document, which
  // may sit inside a `display:none` subtree and then render no stroke at all.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const ringGradId = `lms-ringGrad-${uid}`
  const accentGradId = `lms-accentGrad-${uid}`

  const cx = size / 2
  const cy = size / 2
  const outerR = size * 0.443   // ~62/140 of original
  const innerR = size * 0.329   // ~46/140 of original
  const outerSW = size * 0.043  // 6/140
  const innerSW = size * 0.025  // 3.5/140
  const logoSize = size * 0.371 // 52/140

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
      }}
    >
      {/* Soft halo */}
      <div
        className="lms-halo"
        style={{
          position: 'absolute',
          inset: -size * 0.114,
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(31,118,189,.13) 0%, rgba(245,135,47,.07) 55%, transparent 72%)`,
          filter: 'blur(3px)',
          animation: 'lms-haloPulse 2.6s cubic-bezier(.45,0,.15,1) infinite',
        }}
      />

      {/* Outer ring — brand blue, clockwise */}
      <svg
        className="lms-ring"
        viewBox={`0 0 ${size} ${size}`}
        style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          animation: 'lms-spinCW 2.4s cubic-bezier(.45,.05,.55,.95) infinite',
        }}
      >
        <defs>
          <linearGradient id={ringGradId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={size} y2={size}>
            <stop offset="0%"   stopColor="#4da3e0" stopOpacity=".2" />
            <stop offset="100%" stopColor="#1f76bd" stopOpacity="1" />
          </linearGradient>
        </defs>
        <circle cx={cx} cy={cy} r={outerR} fill="none" stroke="#dde7f0" strokeWidth={outerSW} />
        <circle
          className="lms-ring__progress"
          cx={cx} cy={cy} r={outerR} pathLength="100"
          fill="none" stroke={`url(#${ringGradId})`}
          strokeWidth={outerSW} strokeLinecap="round"
          style={{ animation: 'lms-breatheBlue 1.6s cubic-bezier(.65,0,.35,1) infinite' }}
        />
      </svg>

      {/* Inner ring — brand orange, counter-clockwise */}
      <svg
        className="lms-ring-accent"
        viewBox={`0 0 ${size} ${size}`}
        style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          animation: 'lms-spinCCW 2.9s cubic-bezier(.45,.05,.55,.95) infinite',
        }}
      >
        <defs>
          <linearGradient id={accentGradId} gradientUnits="userSpaceOnUse" x1={size} y1="0" x2="0" y2={size}>
            <stop offset="0%"   stopColor="#f9ab6c" stopOpacity=".25" />
            <stop offset="100%" stopColor="#f5872f" stopOpacity="1" />
          </linearGradient>
        </defs>
        <circle cx={cx} cy={cy} r={innerR} fill="none" stroke="rgba(245,135,47,.16)" strokeWidth={innerSW} />
        <circle
          className="lms-ring-accent__progress"
          cx={cx} cy={cy} r={innerR} pathLength="100"
          fill="none" stroke={`url(#${accentGradId})`}
          strokeWidth={innerSW} strokeLinecap="round"
          style={{ animation: 'lms-breatheOrange 2.05s cubic-bezier(.7,0,.3,1) infinite' }}
        />
      </svg>

      {/* Logo in the center */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {/* LoanMS "M" letter mark — matches brand */}
        <div
          className="lms-logo"
          style={{
            width: logoSize, height: logoSize,
            borderRadius: '50%',
            // MudraHub "Mudra" blue (#0a589a), matching <BrandMark/> so every
            // brand monogram across the app is one colour.
            background: '#0a589a',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 12px rgba(10,88,154,.30)',
            animation: 'lms-logoPulse 2.1s ease-in-out infinite',
          }}
        >
          <span style={{
            color: '#fff',
            fontWeight: 900,
            fontSize: logoSize * 0.46,
            fontFamily: 'var(--font-head, "Plus Jakarta Sans", system-ui, sans-serif)',
            letterSpacing: '-1px',
            lineHeight: 1,
            userSelect: 'none',
          }}>M</span>
        </div>
      </div>
    </div>
  )
}

/* ─── Animated caption dots ───────────────────────────────────────────────*/
function LoadingDots() {
  return (
    <span style={{ display: 'inline-flex', marginLeft: 4 }} aria-hidden>
      {[0, 0.18, 0.36].map((delay, i) => (
        <i key={i} className="lms-dot" style={{
          display: 'inline-block', width: 4, textAlign: 'center',
          fontStyle: 'normal', opacity: .6,
          animation: `lms-dotPulse 1.4s ease-in-out ${delay}s infinite`,
        }}>.</i>
      ))}
    </span>
  )
}

/* ─── LoadingSpinner ──────────────────────────────────────────────────────
   Drop-in replacement for the old SVG circle spinner.
   Accepts the same `size` prop for backward-compat; maps it to badge dimensions.
   Renders as a compact inline section loader centered in its container. */
export function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const badgeSize = { sm: 68, md: 96, lg: 128 }[size]
  return (
    <div
      role="status"
      aria-label="Loading"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        // `width: 100%` — without this a plain block/flex child can
        // shrink-to-fit inside a flex/grid parent (row-flex, grid cell,
        // table cell etc.), which then centers the *shrunk box* instead of
        // the true available width and reads as "drifted off-center".
        // `boxSizing: border-box` keeps the padding from silently growing
        // that width past 100%.
        width: '100%',
        boxSizing: 'border-box',
        // `size="lg"` is used where this is the ENTIRE content of a page/
        // step (ReportsPage, ProfilePage, LoanDetailPage, NewApplicationPage
        // resume screen) — those wrappers (.efin-page etc.) are only as
        // tall as their content, so without a floor here the loader hugs
        // the top of the content pane instead of sitting in the visual
        // middle of the viewport. `sm`/`md` (inline/section use inside
        // cards, tabs, tables) are left exactly as before — unaffected.
        ...(size === 'lg' ? { minHeight: '60vh' } : null),
        padding: '32px 16px',
        gap: 14,
        animation: 'lms-riseIn .4s cubic-bezier(.22,1,.36,1) both',
      }}
    >
      <LoanMSBadge size={badgeSize} />
      <p style={{
        margin: 0,
        fontSize: 14,
        color: 'var(--text3, #5e7793)',
        display: 'flex',
        alignItems: 'baseline',
      }}>
        Loading<LoadingDots />
      </p>
    </div>
  )
}

/* ─── GlobalLoaderView ────────────────────────────────────────────────────
   The full-screen loader visual (badge + "Loading…"). Drawn ONLY by
   <GlobalLoader/> (components/ui/GlobalLoader.tsx), mounted once at the app
   root, which owns the show/hide timing (2s minimum, never hidden by a timer
   while real loading is still running).

   Rendered via a portal straight onto document.body — deliberately. Any
   ancestor with `transform`/`filter`/`contain`/`will-change: transform`
   becomes the containing block for `position: fixed` descendants, and this
   app has one: `.efin-page` animates `transform` on every route mount. A
   portal to <body> guarantees `inset: 0` is the true viewport, so the loader
   is always dead-centre. No `100vw`/`100vh` (100vw includes the scrollbar and
   pushes the box off-centre). Opaque background so no half-loaded page shows
   through. */
export function GlobalLoaderView({ message = 'Loading' }: { message?: string }) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg, #f0f4ff)',
      }}
    >
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        textAlign: 'center', padding: '0 16px', maxWidth: '100%', boxSizing: 'border-box',
      }}>
        <LoanMSBadge size={150} />
        <p style={{
          margin: '26px 0 0',
          fontSize: 15,
          color: 'var(--text3, #7a8aaa)',
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'center',
          flexWrap: 'wrap',
        }}>
          {message}<LoadingDots />
        </p>
      </div>
    </div>,
    document.body,
  )
}

/* ─── PageLoader ──────────────────────────────────────────────────────────
   Kept as the drop-in for `<Suspense fallback={<PageLoader />}>` and the
   auth-hydration guards (ProtectedRoute, LoginPage). It draws nothing itself:
   while mounted it tells the global loader "the page is not ready", so there
   is only ever ONE loader on screen and one place that owns its timing. */
export function PageLoader() {
  const acquire = useLoaderStore((s) => s.acquire)
  const release = useLoaderStore((s) => s.release)
  // Layout effect: registers before paint, so there is no blank frame between
  // a Suspense fallback appearing and the overlay covering it.
  useLayoutEffect(() => {
    acquire()
    return release
  }, [acquire, release])
  return null
}

/* ─── InlineLoader ─────────────────────────────────────────────────────────
   Tiny icon-sized spinner for inline/in-button use — drop-in replacement for
   the old `<Loader2 size={N} className="animate-spin" />` / raw SVG circle
   spinners. Same `size` (px) API those took. Uses `currentColor` for its
   stroke (exactly like the lucide icons it replaces) so any wrapping text
   color (e.g. "text-gray-400" for a muted "Saving…" state, "text-red-600"
   for an error state) still controls the spinner's color — only the motion
   changes, to the same lms-spinCW keyframe used by the full badge above. */
export function InlineLoader({
  size = 16,
  className,
  style,
}: {
  size?: number
  className?: string
  style?: CSSProperties
}) {
  if (typeof document !== 'undefined') ensureKeyframes()
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Loading"
      style={{
        display: 'inline-block',
        verticalAlign: '-0.15em',
        flexShrink: 0,
        animation: 'lms-spinCW 1s cubic-bezier(.45,.05,.55,.95) infinite',
        ...style,
      }}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity=".22" />
      <circle
        cx="12" cy="12" r="10" pathLength="100"
        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
        strokeDasharray="28 100"
      />
    </svg>
  )
}

/* ─── OverlayLoader ────────────────────────────────────────────────────────
   Absolute-positioned overlay for a panel/card mid-loading (previously:
   the `.kyc-loading-overlay` ID-card scan animation used while KYC
   documents are being extracted). Keeps the exact same overlay chrome —
   position:absolute inset:0, blurred panel background, rounded corners,
   a title line and an optional subtitle — so it drops into the same spot
   in the layout; only the loading animation itself has been swapped for
   the brand badge. Caller controls the trigger condition, unchanged. */
export function OverlayLoader({ title = 'Loading', subtitle }: { title?: string; subtitle?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={title}
      style={{
        position: 'absolute', inset: 0, zIndex: 20,
        background: 'rgba(240,244,255,.97)',
        backdropFilter: 'blur(10px)',
        borderRadius: 16,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <LoanMSBadge size={120} />
      <p style={{
        marginTop: 20,
        fontSize: 14.5,
        fontWeight: 700,
        color: 'var(--text)',
        letterSpacing: '-.2px',
        display: 'flex',
        alignItems: 'baseline',
      }}>
        {title}<LoadingDots />
      </p>
      {subtitle && (
        <p style={{ marginTop: 5, fontSize: 11.5, color: 'var(--text3)', fontWeight: 500 }}>{subtitle}</p>
      )}
    </div>
  )
}
