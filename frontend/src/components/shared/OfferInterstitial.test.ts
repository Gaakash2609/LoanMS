import { describe, it, expect } from 'vitest'
import {
  OFFER_INTERSTITIAL_DURATION_MS,
  OFFER_INTERSTITIAL_HINT_TICK_MS,
  OFFER_INTERSTITIAL_HINT_FADE_MS,
  LOAN_OFFER_HINTS,
  INSURANCE_OFFER_HINTS,
  OFFER_TITLE_LOAN,
  OFFER_TITLE_INSURANCE,
  OFFER_SUB_LOAN,
  OFFER_SUB_INSURANCE,
} from './OfferInterstitial'

// ── OfferInterstitial: React port of Vanilla's showOfferInterstitial()
// Source: efin-app.js:8198 (Vanilla), index.html markup (hints/title/sub).
// Copy (hints/title/sub) matches Vanilla exactly. Timing was intentionally
// shortened from Vanilla's 3000ms/620ms to a 2–3s window (2500ms/500ms).

describe('OfferInterstitial — Vanilla parity', () => {
  // ── Timing constants (efin-app.js:8292, 8267, 8262-8265) ──
  it('total duration is 2500ms (within the requested 2–3s window)', () => {
    expect(OFFER_INTERSTITIAL_DURATION_MS).toBe(2500)
    expect(OFFER_INTERSTITIAL_DURATION_MS).toBeGreaterThanOrEqual(2000)
    expect(OFFER_INTERSTITIAL_DURATION_MS).toBeLessThanOrEqual(3000)
  })
  it('hint cycle tick is 500ms so all 5 hints fit inside the duration', () => {
    expect(OFFER_INTERSTITIAL_HINT_TICK_MS).toBe(500)
    expect(OFFER_INTERSTITIAL_HINT_TICK_MS * (LOAN_OFFER_HINTS.length - 1)).toBeLessThan(OFFER_INTERSTITIAL_DURATION_MS)
  })
  it('hint fade-in/out gap is 220ms and shorter than the tick', () => {
    expect(OFFER_INTERSTITIAL_HINT_FADE_MS).toBe(220)
    expect(OFFER_INTERSTITIAL_HINT_FADE_MS).toBeLessThan(OFFER_INTERSTITIAL_HINT_TICK_MS)
  })

  // ── Hint copy — verbatim from efin-app.js:8208-8220
  // (Loan product hints)
  it('loan offer hints match Vanilla exactly (5 stages)', () => {
    expect(LOAN_OFFER_HINTS.length).toBe(5)
    expect(LOAN_OFFER_HINTS[0]).toBe('Fetching salary & obligations…')
    expect(LOAN_OFFER_HINTS[1]).toBe('Matching CAM matrix parameters…')
    expect(LOAN_OFFER_HINTS[2]).toBe('Computing eligible loan amount…')
    expect(LOAN_OFFER_HINTS[3]).toBe('Finalising interest rate & tenure…')
    expect(LOAN_OFFER_HINTS[4]).toBe('Your offer is ready ✨')
  })

  // (Insurance product hints — dead code path in Vanilla but reproduced for exact parity)
  it('insurance offer hints match Vanilla exactly (5 stages)', () => {
    expect(INSURANCE_OFFER_HINTS.length).toBe(5)
    expect(INSURANCE_OFFER_HINTS[0]).toBe('Reading proposer details & sum assured…')
    expect(INSURANCE_OFFER_HINTS[1]).toBe('Matching insurer eligibility criteria…')
    expect(INSURANCE_OFFER_HINTS[2]).toBe('Calculating premium & policy term…')
    expect(INSURANCE_OFFER_HINTS[3]).toBe('Preparing coverage summary…')
    expect(INSURANCE_OFFER_HINTS[4]).toBe('Your premium summary is ready ✨')
  })

  // ── Title & subtitle copy (efin-app.js:8225-8228)
  it('loan offer title/subtitle match Vanilla exactly', () => {
    expect(OFFER_TITLE_LOAN).toBe('Generating Your Offer')
    expect(OFFER_SUB_LOAN[0]).toBe('Analysing eligibility, income & credit profile')
    expect(OFFER_SUB_LOAN[1]).toBe('to compute the best loan offer for you…')
  })

  it('insurance offer title/subtitle match Vanilla exactly', () => {
    expect(OFFER_TITLE_INSURANCE).toBe('Generating Premium Summary')
    expect(OFFER_SUB_INSURANCE[0]).toBe('Analysing proposer details, sum assured & coverage type')
    expect(OFFER_SUB_INSURANCE[1]).toBe('to prepare your insurance summary…')
  })
})
