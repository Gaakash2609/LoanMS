import { describe, it, expect } from 'vitest'
import {
  computeBundledAmount, flatRateFromReducing, emiReducing,
  buildFlatAmortSchedule, reverseEmi, calcPrepayment,
} from './emi'

// Parity with legacy laAutoCalc (efin-app.js:31848):
//   pf = amt * pf% / 100 ; pfWithGst = pf * (1 + gst/100)
//   bundled = round(amt + (pfInBundled ? pfWithGst : 0) + (insInBundled ? insurance : 0))
describe('computeBundledAmount', () => {
  const base = { amount: 500000, pfPercent: 1.5, gstPercent: 18, insurance: 20000 }

  it('computes the raw PF and PF+GST regardless of toggles', () => {
    const r = computeBundledAmount({ ...base, pfInBundled: false, insuranceInBundled: false })
    expect(r.pf).toBe(7500)          // 500000 * 1.5%
    expect(r.pfWithGst).toBe(8850)   // 7500 * 1.18
  })

  it('adds nothing to principal when neither add-on is financed', () => {
    expect(computeBundledAmount({ ...base, pfInBundled: false, insuranceInBundled: false }).bundled).toBe(500000)
  })

  it('folds only the PF+GST when just the PF toggle is on', () => {
    expect(computeBundledAmount({ ...base, pfInBundled: true, insuranceInBundled: false }).bundled).toBe(508850)
  })

  it('folds only the insurance when just the insurance toggle is on', () => {
    expect(computeBundledAmount({ ...base, pfInBundled: false, insuranceInBundled: true }).bundled).toBe(520000)
  })

  it('folds both when both toggles are on', () => {
    expect(computeBundledAmount({ ...base, pfInBundled: true, insuranceInBundled: true }).bundled).toBe(528850)
  })

  it('defaults GST to 18% when unset (legacy `|| 18`)', () => {
    const withDefault = computeBundledAmount({ amount: 500000, pfPercent: 1.5, insurance: 0, pfInBundled: true, insuranceInBundled: false })
    const explicit18 = computeBundledAmount({ amount: 500000, pfPercent: 1.5, gstPercent: 18, insurance: 0, pfInBundled: true, insuranceInBundled: false })
    expect(withDefault.bundled).toBe(explicit18.bundled)
  })

  it('bundled EMI (via emiReducing) exceeds the un-bundled EMI', () => {
    const { bundled } = computeBundledAmount({ ...base, pfInBundled: true, insuranceInBundled: true })
    const plain = emiReducing(base.amount, 12, 36).emi
    const withAddons = emiReducing(bundled, 12, 36).emi
    expect(withAddons).toBeGreaterThan(plain)
  })
})

describe('flatRateFromReducing', () => {
  it('is 0 when the reducing rate is 0', () => {
    expect(flatRateFromReducing(0, 12)).toBe(0)
  })

  it('matches the legacy tenure-aware conversion (12% / 12mo → 6.62%)', () => {
    expect(flatRateFromReducing(12, 12)).toBe(6.62)
  })

  it('falls back to a 36-month tenure when months is 0 (legacy `months || 36`)', () => {
    expect(flatRateFromReducing(12, 0)).toBe(flatRateFromReducing(12, 36))
  })
})

// Parity with legacy calcEmi's flat-mode schedule (efin-app.js:11338-11349):
// equal principal every month, interest on the straight-line-reducing balance.
describe('buildFlatAmortSchedule', () => {
  const rows = buildFlatAmortSchedule(500000, 12, 12)

  it('has equal principal every month (500000 / 12)', () => {
    rows.forEach(r => expect(r.prin).toBeCloseTo(500000 / 12, 6))
  })

  it('month 1 interest is on the full principal (5000)', () => {
    expect(rows[0].int).toBeCloseTo(5000, 6)
  })

  it('principal repays in full and the balance closes at 0', () => {
    expect(rows.reduce((s, r) => s + r.prin, 0)).toBeCloseTo(500000, 4)
    expect(rows[11].balance).toBeCloseTo(0, 6)
  })

  it('differs from the reducing schedule (the migration bug)', () => {
    // Reducing month-1 principal is smaller because more of the EMI is interest.
    expect(rows[0].prin).not.toBeCloseTo(39424.39, 1)
  })

  it('returns [] for non-positive amount or tenure', () => {
    expect(buildFlatAmortSchedule(0, 12, 12)).toEqual([])
    expect(buildFlatAmortSchedule(500000, 12, 0)).toEqual([])
  })
})

// Parity with legacy _reverseLoanReducing / _reverseLoanFlat (efin-app.js:
// 11565-11583). The migration had dropped the Flat method.
describe('reverseEmi', () => {
  it('reducing: 15000 EMI / 12% / 60mo → ~674326 principal', () => {
    expect(reverseEmi(15000, 12, 60, 'reducing').principal).toBeCloseTo(674326, 0)
  })

  it('flat: 15000 EMI / 12% / 60mo → exactly 562500 (EMI·n / (1+R·n/12))', () => {
    expect(reverseEmi(15000, 12, 60, 'flat').principal).toBeCloseTo(562500, 6)
  })

  it('flat principal is lower than reducing for the same EMI', () => {
    expect(reverseEmi(15000, 12, 60, 'flat').principal)
      .toBeLessThan(reverseEmi(15000, 12, 60, 'reducing').principal)
  })

  it('defaults to reducing when no method is given', () => {
    expect(reverseEmi(15000, 12, 60).principal).toBeCloseTo(reverseEmi(15000, 12, 60, 'reducing').principal, 6)
  })
})

// Parity with legacy calcPrepay's loop (efin-app.js:11530-11545): threshold
// 0.5, bound 3×tenure, extra added to principal from startMonth.
describe('calcPrepayment', () => {
  it('₹5000/mo extra from month 1 on 500000/12%/60mo closes at month 38', () => {
    const p = calcPrepayment(500000, 12, 60, 5000, 1)
    expect(p.newMonths).toBe(38)
    expect(p.monthsSaved).toBe(22)
    expect(Math.round(p.newTotalInt)).toBe(101548)
  })

  it('no extra payment saves nothing', () => {
    const p = calcPrepayment(500000, 12, 60, 0, 1)
    expect(p.monthsSaved).toBe(0)
    expect(p.newTotalInt).toBeCloseTo(p.totalInt, 6)
  })

  it('a larger extra always closes the loan earlier and saves interest', () => {
    const p = calcPrepayment(500000, 12, 60, 100000, 1)
    expect(p.newMonths).toBeLessThan(60)
    expect(p.interestSaved).toBeGreaterThan(0)
  })
})
