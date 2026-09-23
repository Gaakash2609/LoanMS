import { describe, it, expect } from 'vitest'
import { computePipelineStages } from '@/pages/DashboardPage'
import type { LoanListItem, LoanStatus } from '@/types'

let nextId = 1
function makeLoan(status: LoanStatus): LoanListItem {
  const id = nextId++
  return {
    id, loanNumber: `EFIN${id}`, loanType: 'Personal', status,
    requestedAmount: 100000, interestRate: 12, tenureMonths: 24,
    customerName: `Customer ${id}`, customerPhone: '9999999999',
    createdByName: 'Tester', createdAt: new Date().toISOString(),
  }
}

// ── Phase 9 code-level audit — Vanilla source of truth: efin-app.js
// PIPELINE_STAGE_META (wip→Personal Details, login→Assign Lender,
// underwriting→Underwriting, offer→Offer, approved→Approved, disbursed→
// Disbursed, hold→Hold, rejected→Rejected) and renderPipeline(), which
// filters drafts out entirely before counting and hides zero-count stages.
describe('computePipelineStages — Vanilla PIPELINE_STAGE_META parity', () => {
  it('never shows a Draft bar (regression: Draft used to be an extra pipeline stage)', () => {
    const loans = [makeLoan('Draft'), makeLoan('Draft'), makeLoan('Submitted')]
    const stages = computePipelineStages(loans)
    expect(stages.find(s => s.status === 'Draft')).toBeUndefined()
  })

  it('maps Submitted to the Vanilla "Assign Lender" label (login stage), not the raw enum name', () => {
    const stages = computePipelineStages([makeLoan('Submitted')])
    expect(stages.find(s => s.status === 'Submitted')?.label).toBe('Assign Lender')
  })

  it('maps UnderReview to the Vanilla "Underwriting" label, not "Under Review"', () => {
    const stages = computePipelineStages([makeLoan('UnderReview')])
    expect(stages.find(s => s.status === 'UnderReview')?.label).toBe('Underwriting')
  })

  it('maps OnHold to the Vanilla "Hold" label, not "On Hold"', () => {
    const stages = computePipelineStages([makeLoan('OnHold')])
    expect(stages.find(s => s.status === 'OnHold')?.label).toBe('Hold')
  })

  it('hides a stage entirely when its count is zero, same as Vanilla', () => {
    const stages = computePipelineStages([makeLoan('Approved')])
    expect(stages.map(s => s.status)).toEqual(['Approved'])
  })

  it('never shows Decision/Acceptance/Closed — absent from Vanilla PIPELINE_STAGE_META', () => {
    const loans = [makeLoan('Decision'), makeLoan('Acceptance'), makeLoan('Closed')]
    const stages = computePipelineStages(loans)
    expect(stages).toHaveLength(0)
  })

  it('orders stages Submitted, UnderReview, Approved, Disbursed, OnHold, Rejected — Vanilla array order', () => {
    const loans: LoanStatus[] = ['Rejected', 'OnHold', 'Disbursed', 'Approved', 'UnderReview', 'Submitted']
    const stages = computePipelineStages(loans.map(makeLoan))
    expect(stages.map(s => s.status)).toEqual(['Submitted', 'UnderReview', 'Approved', 'Disbursed', 'OnHold', 'Rejected'])
  })

  it('counts each stage correctly and excludes drafts from every count', () => {
    const loans = [
      makeLoan('Draft'), makeLoan('Draft'),
      makeLoan('Submitted'), makeLoan('Submitted'), makeLoan('Submitted'),
      makeLoan('Rejected'),
    ]
    const stages = computePipelineStages(loans)
    expect(stages.find(s => s.status === 'Submitted')?.count).toBe(3)
    expect(stages.find(s => s.status === 'Rejected')?.count).toBe(1)
    expect(stages.reduce((sum, s) => sum + s.count, 0)).toBe(4) // 2 drafts excluded
  })
})
