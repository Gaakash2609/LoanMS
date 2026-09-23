import { describe, it, expect } from 'vitest'
import { normalizeLoanType } from './banksApi'

// normalizeLoanType must collapse every loan-type key scheme to one canonical
// form so per-bank product assignment (loanTypes) matches regardless of which
// caller runs the eligibility Match: the Lender-Config Match tab (React keys),
// the loan wizard (legacy-ish keys), the LoanType enum, and any legacy data.
// This MUST stay in lock-step with the backend NormalizeLoanType
// (LenderConfigController.cs).
describe('normalizeLoanType — cross-caller canonicalisation', () => {
  const cases: [string, string][] = [
    // Personal
    ['personal', 'personal'], ['personal_loan', 'personal'], ['Personal', 'personal'],
    // Business
    ['business', 'business'], ['business_loan', 'business'], ['Business', 'business'],
    // Home
    ['home', 'home'], ['home_loan', 'home'], ['Home', 'home'],
    // Education
    ['education', 'education'], ['education_loan', 'education'],
    // New / Used car (React 'newcar', wizard 'new_car', legacy 'new_car_loan', enum 'NewCar')
    ['newcar', 'newcar'], ['new_car', 'newcar'], ['new_car_loan', 'newcar'], ['NewCar', 'newcar'],
    ['usedcar', 'usedcar'], ['used_car', 'usedcar'], ['used_car_loan', 'usedcar'], ['UsedCar', 'usedcar'],
    // Overdraft (legacy 'over_draft')
    ['overdraft', 'overdraft'], ['over_draft', 'overdraft'], ['Overdraft', 'overdraft'],
    // LAP — the aliased case: React 'lap', legacy 'loan_against_property', enum 'AgainstProperty'/'LAP'
    ['lap', 'lap'], ['LAP', 'lap'], ['loan_against_property', 'lap'], ['AgainstProperty', 'lap'],
    // Insurance
    ['insurance', 'insurance'], ['Insurance', 'insurance'],
  ]
  it.each(cases)('normalizes %s → %s', (input, expected) => {
    expect(normalizeLoanType(input)).toBe(expected)
  })

  it('treats empty / null / undefined as "" (→ caller leaves the bank unfiltered = all products)', () => {
    expect(normalizeLoanType('')).toBe('')
    expect(normalizeLoanType(null)).toBe('')
    expect(normalizeLoanType(undefined)).toBe('')
  })

  it('cross-caller equality: React key, wizard key and enum all agree per product', () => {
    expect(normalizeLoanType('personal')).toBe(normalizeLoanType('personal_loan'))
    expect(normalizeLoanType('newcar')).toBe(normalizeLoanType('new_car'))
    expect(normalizeLoanType('lap')).toBe(normalizeLoanType('loan_against_property'))
    expect(normalizeLoanType('overdraft')).toBe(normalizeLoanType('over_draft'))
  })
})
