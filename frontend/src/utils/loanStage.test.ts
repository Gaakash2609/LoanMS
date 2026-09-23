import { describe, it, expect } from 'vitest'
import { hasReachedSanctionStage } from './loanStage'
import type { LoanStatus } from '@/types'

// Vanilla renderDetailApproval: the Approval/Sanction section only exists once
// the loan has actually reached the Approved/Sanction stage.
describe('hasReachedSanctionStage', () => {
  const initial: LoanStatus[] = ['Draft', 'Submitted', 'UnderReview', 'Decision']
  it.each(initial)('hides for %s when never approved', status => {
    expect(hasReachedSanctionStage({ status, approvedAt: undefined })).toBe(false)
  })

  const reached: LoanStatus[] = ['Approved', 'Acceptance', 'Disbursed', 'Closed']
  it.each(reached)('shows for %s', status => {
    expect(hasReachedSanctionStage({ status, approvedAt: undefined })).toBe(true)
  })

  it('still shows (read-only) for a loan approved then Rejected / OnHold', () => {
    expect(hasReachedSanctionStage({ status: 'Rejected', approvedAt: '2026-09-01T10:00:00Z' })).toBe(true)
    expect(hasReachedSanctionStage({ status: 'OnHold', approvedAt: '2026-09-01T10:00:00Z' })).toBe(true)
  })

  it('hides for a loan rejected / held BEFORE approval', () => {
    expect(hasReachedSanctionStage({ status: 'Rejected', approvedAt: undefined })).toBe(false)
    expect(hasReachedSanctionStage({ status: 'OnHold', approvedAt: undefined })).toBe(false)
  })
})
