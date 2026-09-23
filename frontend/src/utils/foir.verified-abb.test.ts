import { describe, it, expect } from 'vitest'
import { computeFoirEligibility } from './foir'

// F-1 parity: legacy renderFoirPanel used a Perfios-verified statement's ABB as
// the self-employed net income when on file, falling back to 70%-of-gross.
describe('computeFoirEligibility — self-employed net income source', () => {
  const base = {
    grossIncome: 100000,
    employmentType: 'SELFEMP',
    loanType: 'business_loan',
    cibil: 740,
    tenureMonths: 60,
    interestRate: 14,
    requestedAmount: 800000,
    obligations: [],
  }

  it('salaried uses gross as-is', () => {
    const r = computeFoirEligibility({ ...base, employmentType: 'SALARIED' })
    expect(r.netIncomeSource).toBe('salaried')
    expect(r.primaryNetIncome).toBe(100000)
  })

  it('self-employed with no verified figure falls back to 70% of gross', () => {
    const r = computeFoirEligibility(base)
    expect(r.netIncomeSource).toBe('estimated')
    expect(r.primaryNetIncome).toBe(70000)
  })

  it('self-employed prefers a valid verified ABB over the 70% estimate', () => {
    const r = computeFoirEligibility({ ...base, verifiedNetIncome: 85000 })
    expect(r.netIncomeSource).toBe('verified')
    expect(r.primaryNetIncome).toBe(85000)
    expect(r.combinedIncome).toBe(85000)
  })

  it('a zero/blank verified figure is ignored (stays estimated)', () => {
    expect(computeFoirEligibility({ ...base, verifiedNetIncome: 0 }).netIncomeSource).toBe('estimated')
    expect(computeFoirEligibility({ ...base, verifiedNetIncome: null }).netIncomeSource).toBe('estimated')
  })

  it('a verified figure never applies to a salaried profile', () => {
    const r = computeFoirEligibility({ ...base, employmentType: 'SALARIED', verifiedNetIncome: 85000 })
    expect(r.netIncomeSource).toBe('salaried')
    expect(r.primaryNetIncome).toBe(100000)
  })
})
