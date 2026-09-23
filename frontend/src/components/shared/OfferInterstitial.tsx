import { useEffect, useRef, useState } from 'react'
import { LoanMSBadge } from '@/components/ui/LoadingSpinner'

// ── React port of Vanilla's showOfferInterstitial() ─────────────────────────
// Source: LoanMS.API/wwwroot/js/efin-app.js:8198 (function showOfferInterstitial),
// markup: LoanMS.API/wwwroot/index.html (#offer-interstitial, #oi-bar-fill, #oi-hint).
//
// Vanilla trigger (efin-app.js:8185, wizardNav()):
//   if (dir === 1 && wizPosToStepId(next) === 6) { showOfferInterstitial(...) }
// i.e. the interstitial only ever runs on the transition INTO physical step 6
// (Initial Offer). The parent page (NewApplicationPage.tsx) owns that trigger
// check — this component only owns the 3-second show/hint-cycle/complete
// animation once told to become `active`.
//
// Content (hints / title / sub) is kept verbatim from Vanilla, including the
// otherwise-unreachable "insurance" variant: Vanilla's own insurance product
// config (LOAN_PRODUCT_CONFIG.insurance.wizardSteps = [1,2,3,4,5,8,9]) skips
// physical step 6 entirely, so `isInsurance` is never actually true through
// this trigger today — same as in Vanilla. We reproduce the branch anyway for
// exact parity rather than pruning "dead" Vanilla behaviour.
//
// Timing: deliberately shortened from Vanilla (3000ms / 620ms tick) to a
// 2–3s window — the screen plays ONCE for 2.5s, then hands over to step 6.
//   - total duration: 2500ms
//   - hint cycle tick: 500ms (5 hints → last one shows at 2000ms, holds 500ms)
//   - hint fade-out/in gap: 220ms
// The progress-bar CSS transition (.oi-bar-fill in globals.css) is 2.3s so
// the bar finishes just before the screen closes.
export const OFFER_INTERSTITIAL_DURATION_MS = 2500
export const OFFER_INTERSTITIAL_HINT_TICK_MS = 500
export const OFFER_INTERSTITIAL_HINT_FADE_MS = 220

// Hint copy — verbatim from efin-app.js:8208-8220 (HTML entities decoded: &amp; → &).
export const LOAN_OFFER_HINTS = [
  'Fetching salary & obligations…',
  'Matching CAM matrix parameters…',
  'Computing eligible loan amount…',
  'Finalising interest rate & tenure…',
  'Your offer is ready ✨',
] as const

export const INSURANCE_OFFER_HINTS = [
  'Reading proposer details & sum assured…',
  'Matching insurer eligibility criteria…',
  'Calculating premium & policy term…',
  'Preparing coverage summary…',
  'Your premium summary is ready ✨',
] as const

// Title / sub copy — verbatim from efin-app.js:8225-8228.
export const OFFER_TITLE_LOAN = 'Generating Your Offer'
export const OFFER_TITLE_INSURANCE = 'Generating Premium Summary'
export const OFFER_SUB_LOAN: [string, string] = [
  'Analysing eligibility, income & credit profile',
  'to compute the best loan offer for you…',
]
export const OFFER_SUB_INSURANCE: [string, string] = [
  'Analysing proposer details, sum assured & coverage type',
  'to prepare your insurance summary…',
]

interface OfferInterstitialProps {
  /** True while the ~2.5s "generating" screen should be shown/running. */
  active: boolean
  /** Product variant — loan vs insurance hint/title/sub set (efin-app.js:8205). */
  isInsurance: boolean
  /** Fired exactly once, ~2500ms after `active` turns true. */
  onComplete: () => void
}

export default function OfferInterstitial({ active, isInsurance, onComplete }: OfferInterstitialProps) {
  const [hintIdx, setHintIdx] = useState(0)
  const [hintVisible, setHintVisible] = useState(true)
  const [barFilled, setBarFilled] = useState(false)
  const [content, setContent] = useState({
    title: OFFER_TITLE_LOAN,
    sub: OFFER_SUB_LOAN,
    hints: LOAN_OFFER_HINTS as readonly string[],
  })

  // Read the latest onComplete/isInsurance via refs so the timer effect below
  // only needs to depend on `active` — mirrors Vanilla reading _loanTypeNav
  // once at call time rather than reacting to it mid-animation.
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const isInsuranceRef = useRef(isInsurance)
  isInsuranceRef.current = isInsurance

  useEffect(() => {
    if (!active) return

    const insurance = isInsuranceRef.current
    const hints = insurance ? INSURANCE_OFFER_HINTS : LOAN_OFFER_HINTS
    setContent({
      title: insurance ? OFFER_TITLE_INSURANCE : OFFER_TITLE_LOAN,
      sub: insurance ? OFFER_SUB_INSURANCE : OFFER_SUB_LOAN,
      hints,
    })
    setHintIdx(0)
    setHintVisible(true)
    setBarFilled(false)

    // Kick off progress bar after one paint (efin-app.js:8252-8254: double rAF).
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setBarFilled(true))
    })

    // Cycle hint messages every ~620ms, fading out/in across a 220ms gap
    // (efin-app.js:8258-8267).
    let fadeTimer: ReturnType<typeof setTimeout> | undefined
    const hintTimer = setInterval(() => {
      setHintIdx((prev) => {
        const next = Math.min(prev + 1, hints.length - 1)
        if (next !== prev) {
          setHintVisible(false)
          fadeTimer = setTimeout(() => setHintVisible(true), OFFER_INTERSTITIAL_HINT_FADE_MS)
        }
        return next
      })
    }, OFFER_INTERSTITIAL_HINT_TICK_MS)

    // Hard 2500ms stop — completion does not wait on the CSS transition or
    // the hint cycle; it fires on its own clock (efin-app.js:8272-8292).
    const completeTimer = setTimeout(() => {
      clearInterval(hintTimer)
      if (fadeTimer) clearTimeout(fadeTimer)
      onCompleteRef.current()
    }, OFFER_INTERSTITIAL_DURATION_MS)

    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      clearInterval(hintTimer)
      if (fadeTimer) clearTimeout(fadeTimer)
      clearTimeout(completeTimer)
    }
  }, [active])

  return (
    <div className={`oi-overlay${active ? ' oi-active' : ''}`} role="status" aria-live="polite" aria-hidden={!active}>
      <div className="oi-card">
        <div className="oi-orbital">
          {/* Brand badge (dual counter-orbiting rings + M logo) — same loader
              as PageLoader/LoadingSpinner. Mounted only while active so the
              animation always starts from frame 0 on each run. */}
          {active && <LoanMSBadge size={120} />}
        </div>

        <div className="oi-title">{content.title}</div>
        <div className="oi-sub">
          {content.sub[0]}
          <br />
          {content.sub[1]}
        </div>

        <div className="oi-bar-track">
          <div className="oi-bar-fill" style={{ width: barFilled ? '100%' : '0%' }} />
        </div>

        <div className="oi-hint" style={{ opacity: hintVisible ? 1 : 0 }}>
          {content.hints[hintIdx]}
        </div>
      </div>
    </div>
  )
}
