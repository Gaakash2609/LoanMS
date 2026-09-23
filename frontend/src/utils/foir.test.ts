import { describe, it, expect } from 'vitest'
import {
  computeFoirEligibility,
  suggestedFoirFor,
  suggestedRoiFor,
  isSelfEmployed,
} from './foir'

// Regression lock for the FOIR / Loan-Eligibility engine (parity with legacy
// renderFoirPanel, efin-app.js:23458). The primary scenario below is the exact
// case that was browser-verified live on loan #4.

describe('suggestedFoirFor (verbatim port of legacy getSuggestedFOIR)', () => {
  it('personal loan, mid income, prime CIBIL → 50 base +5 income +2 CIBIL = 57', () => {
    expect(suggestedFoirFor('personal_loan', false, 80000, 750)).toBe(57)
  })
  it('home loan base is 60; high income + top CIBIL clamps at 75', () => {
    expect(suggestedFoirFor('home_loan', false, 250000, 810)).toBe(75)
  })
  it('self-employed takes a 3-point haircut', () => {
    expect(suggestedFoirFor('personal_loan', true, 80000, 750)).toBe(54)
  })
  it('low income and weak CIBIL are pushed down but never below the 40 floor', () => {
    expect(suggestedFoirFor('personal_loan', true, 20000, 600)).toBe(40)
  })
  it('unknown loan type falls back to the personal/others base of 50', () => {
    // 50 base, income 60k (no uplift, ≥25k so no cut), CIBIL 700 (no adj) → 50
    expect(suggestedFoirFor('something_else', false, 60000, 700)).toBe(50)
  })
})

describe('isSelfEmployed (matches legacy classification across spellings)', () => {
  it.each([
    ['', false],
    ['SALARIED', false],
    ['Salaried', false],
    [null, false],
    ['SELFEMP', true],
    ['Self Employed', true],
    ['SENP', true],
    ['Business', true],
    ['Professional', true],
  ])('%s → %s', (value, expected) => {
    expect(isSelfEmployed(value as string | null)).toBe(expected)
  })
})

describe('suggestedRoiFor (verbatim port of legacy ROI_MATRIX)', () => {
  it('personal loan at prime CIBIL', () => {
    expect(suggestedRoiFor('personal_loan', 760)).toBe(11.5)
  })
  it('home loan at 800+ takes the lowest band', () => {
    expect(suggestedRoiFor('home_loan', 810)).toBe(8.4)
  })
  it('unknown loan type falls back to the personal matrix', () => {
    expect(suggestedRoiFor('mystery', 600)).toBe(21.0)
  })
})

describe('computeFoirEligibility — the browser-verified loan #4 scenario', () => {
  // income ₹80,000 · CIBIL 750 · personal · 12% · 36 mo · requested ₹5,50,000
  // one running obligation EMI ₹15,000 (non-BT). FOIR left at suggested (57%).
  const base = {
    grossIncome: 80000,
    employmentType: null,
    loanType: 'Personal',
    cibil: 750,
    tenureMonths: 36,
    interestRate: 12,
    requestedAmount: 550000,
    obligations: [{ loanEmi: 15000, selectBT: false }],
  }

  it('reproduces every headline figure exactly as rendered', () => {
    const r = computeFoirEligibility(base)
    expect(r.suggestedFoir).toBe(57)
    expect(r.effFoir).toBe(57)
    expect(r.rate).toBe(12)
    expect(r.combinedIncome).toBe(80000)
    expect(Math.round(r.eligibleEmi)).toBe(45600)
    expect(r.goingEmi).toBe(15000)
    expect(r.btEmi).toBe(0)
    expect(Math.round(r.netEligibleEmi)).toBe(30600)
    expect(r.utilisationPct).toBe(33)
    expect(r.eligibleLoan).toBe(921290)
    expect(r.maxPossible).toBe(1372902)
    expect(r.loanDiff).toBe(371290) // eligible − requested → surplus
    expect(r.actualFoirPct).toBeCloseTo(18.75, 2)
    expect(r.totalFoirAfter).toBeCloseTo(57, 5)
    expect(r.dscr).toBe('5.33')
  })

  it('a manual FOIR override changes the affordable EMI (what-if slider)', () => {
    const r = computeFoirEligibility({ ...base, foirOverride: 70 })
    expect(r.effFoir).toBe(70)
    expect(Math.round(r.eligibleEmi)).toBe(56000) // 80000 × 70%
  })

  it('co-applicant income lifts the combined income (what-if input)', () => {
    const r = computeFoirEligibility({ ...base, foirOverride: 70, coAppIncome: 20000 })
    expect(r.combinedIncome).toBe(100000)
    expect(Math.round(r.eligibleEmi)).toBe(70000) // 100000 × 70%
  })

  it('a BT-flagged obligation counts as BT, not as going EMI', () => {
    const r = computeFoirEligibility({
      ...base,
      obligations: [{ loanEmi: 15000, selectBT: true }],
    })
    expect(r.goingEmi).toBe(0)
    expect(r.btEmi).toBe(15000)
    expect(r.btBenefit).toBeGreaterThan(0)
  })

  it('an explicitly self-employed profile nets income to 70% of gross', () => {
    const r = computeFoirEligibility({ ...base, employmentType: 'SELFEMP', obligations: [] })
    expect(r.isSelfEmp).toBe(true)
    expect(r.combinedIncome).toBe(56000) // 80000 × 0.70
  })

  it('an unknown employment type keeps full income (legacy fell through to salaried)', () => {
    const r = computeFoirEligibility({ ...base, employmentType: '', obligations: [] })
    expect(r.isSelfEmp).toBe(false)
    expect(r.combinedIncome).toBe(80000)
  })

  it('falls back to the suggested ROI when the stored rate is out of the 6–36% band', () => {
    const r = computeFoirEligibility({ ...base, interestRate: 0 })
    expect(r.rate).toBe(suggestedRoiFor('Personal', 750)) // matrix fallback, not 0
  })

  it('with no income on record the eligibility collapses to zero (guarded UI case)', () => {
    const r = computeFoirEligibility({ ...base, grossIncome: 0, obligations: [] })
    expect(r.combinedIncome).toBe(0)
    expect(r.eligibleEmi).toBe(0)
    expect(r.eligibleLoan).toBe(0)
  })
})
