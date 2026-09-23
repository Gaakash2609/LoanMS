import { describe, it, expect } from 'vitest'
import { toEmploymentCode } from './employmentType'

// RA-7: the eligibility match + lender config speak canonical codes
// (SALARIED / SELFEMP / PROFESSIONAL). The wizard's raw values must be mapped
// to these before hitting /api/lenderconfig/match, or self-employed/
// professional applicants are wrongly filtered out.
describe('toEmploymentCode', () => {
  it('maps the wizard select values to canonical backend codes', () => {
    expect(toEmploymentCode('salaried')).toBe('SALARIED')
    expect(toEmploymentCode('self_employed')).toBe('SELFEMP')
    expect(toEmploymentCode('professional')).toBe('PROFESSIONAL')
  })

  it('is the exact mapping used at wizard submit (single source of truth)', () => {
    // self_employed must NOT pass through as SELF_EMPLOYED (the RA-7 bug)
    expect(toEmploymentCode('self_employed')).not.toBe('SELF_EMPLOYED')
  })

  it('passes through an unknown/already-canonical value unchanged', () => {
    expect(toEmploymentCode('SELFEMP')).toBe('SELFEMP')
    expect(toEmploymentCode('')).toBe('')
    expect(toEmploymentCode(undefined)).toBe('')
    expect(toEmploymentCode(null)).toBe('')
  })
})
