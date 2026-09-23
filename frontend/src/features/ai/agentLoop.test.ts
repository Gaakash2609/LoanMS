import { describe, it, expect } from 'vitest'
import { buildAgentSteps } from './agentLoop'

const R = (steps: ReturnType<typeof buildAgentSteps>, stage: string) => steps.find(s => s.stage === stage)?.result

describe('buildAgentSteps', () => {
  it('marks a fully-ready application READY', () => {
    const steps = buildAgentSteps({
      panNumber: 'ABCDE1234F', monthlyIncome: 80000, cibilScore: 760,
      missingDocTypes: [], bankVerified: true, bankAbb: 90000, status: 'UnderReview',
    })
    expect(R(steps, 'KYC')).toBe('PASS')
    expect(R(steps, 'Income')).toBe('PASS')
    expect(R(steps, 'Banking')).toBe('PASS')
    expect(R(steps, 'CIBIL')).toBe('PASS')
    expect(R(steps, 'Documents')).toBe('PASS')
    expect(R(steps, 'Summary')).toBe('READY')
    expect(steps).toHaveLength(6)
  })

  it('flags missing mandatory items as INCOMPLETE', () => {
    const steps = buildAgentSteps({
      panNumber: null, monthlyIncome: 0, cibilScore: 0,
      missingDocTypes: ['salary_slip'], bankVerified: false, status: 'Submitted',
    })
    expect(R(steps, 'KYC')).toBe('MISSING')
    expect(R(steps, 'Income')).toBe('MISSING')
    expect(R(steps, 'CIBIL')).toBe('MISSING')
    expect(R(steps, 'Documents')).toBe('PENDING')
    expect(R(steps, 'Summary')).toBe('INCOMPLETE')
  })

  it('is READY_WITH_FOLLOWUPS when nothing is missing but items are pending/review', () => {
    const steps = buildAgentSteps({
      panNumber: 'ABCDE1234F', monthlyIncome: 50000, cibilScore: 660, // 660 → REVIEW
      missingDocTypes: [], bankVerified: false, status: 'UnderReview',
    })
    expect(R(steps, 'CIBIL')).toBe('REVIEW')
    expect(R(steps, 'Banking')).toBe('PENDING')
    expect(R(steps, 'Summary')).toBe('READY_WITH_FOLLOWUPS')
  })
})
