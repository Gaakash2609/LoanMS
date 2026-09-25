import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture every request the Offers API client makes (no network, no DOM).
const calls: { method: string; url: string; body?: unknown; config?: { headers?: Record<string, string> } }[] = []
vi.mock('@/api/axios', () => ({
  default: {
    get: (url: string, config?: unknown) => { calls.push({ method: 'GET', url, config: config as never }); return Promise.resolve({ data: {} }) },
    post: (url: string, body?: unknown, config?: unknown) => { calls.push({ method: 'POST', url, body, config: config as never }); return Promise.resolve({ data: {} }) },
  },
}))

import { offerWorkflowApi, newIdempotencyKey, METRIC_OPTIONS, OFFER_STATUS_LABEL, DEVIATION_STATUS_LABEL } from '@/api/offerWorkflowApi'
import { loansApi } from '@/api/loansApi'
import { STATUS_LABELS, STATUS_COLORS } from '@/utils/format'
import { DEFAULT_ROLES, ALL_ROLE_KEYS, BACKEND_TO_ROLE_KEY } from '@/constants/permissions'
import shippedDefaults from '../../../LoanMS.API/Services/RolePermissionDefaults.json?raw'
import { STAGE_ORDER, STAGE_META } from '@/pages/dashboard/dashboardData'
import { LENDER_EMAIL_VISIBLE_STAGES } from '@/utils/lenderEmailTemplates'

beforeEach(() => { calls.length = 0 })

describe('Offers API client — every action goes to the server workflow', () => {
  it('uses the per-application workflow routes', async () => {
    await offerWorkflowApi.get(7)
    await offerWorkflowApi.moveToOffer(7, 'ok')
    await offerWorkflowApi.createOffer(7, {
      bankId: 1, loanAmount: 1, tenureMonths: 1, baseRoi: 0, offeredRoi: 0, processingFeePct: 0, gstPct: 0,
      insuranceAmount: 0, pfInBundled: false, insuranceInBundled: false, btAmount: 0, stampDuty: 0,
    })
    await offerWorkflowApi.selectOffer(7, 3, 2)
    await offerWorkflowApi.generateSanction(7, 'k1')
    expect(calls.map(c => `${c.method} ${c.url}`)).toEqual([
      'GET /api/loans/7/workflow',
      'POST /api/loans/7/workflow/move-to-offer',
      'POST /api/loans/7/workflow/offers',
      'POST /api/loans/7/workflow/offers/3/select',
      'POST /api/loans/7/workflow/sanctions',
    ])
    expect(calls[3].body).toEqual({ expectedVersion: 2 })
  })

  it('sends an Idempotency-Key on raise / decide / credit approval / sanction / disbursement', async () => {
    await offerWorkflowApi.raiseDeviation(1, 2, 'ROI', 'r', 'k-raise')
    await offerWorkflowApi.decideDeviation(1, 9, true, undefined, 'k-dec')
    await offerWorkflowApi.creditApproval(1, 2, 'Approve', 1, undefined, 'k-ca')
    await offerWorkflowApi.generateSanction(1, 'k-san')
    await offerWorkflowApi.disburse(1, { amount: 1, disbursementDate: '2026-09-25', bankAccountNumber: '1', ifsc: 'X', utr: 'U', mode: 'NEFT' }, 'k-dis')
    expect(calls.map(c => c.config?.headers?.['Idempotency-Key'])).toEqual(['k-raise', 'k-dec', 'k-ca', 'k-san', 'k-dis'])
    expect(calls[2].body).toEqual({ decision: 'Approve', revisionNo: 1, comment: undefined })
  })

  it('re-check, bureau upload (multipart) and approver reassignment use the workflow routes', async () => {
    await offerWorkflowApi.reEvaluate(7)
    const file = new File(['%PDF-1.4'], 'cibil.pdf', { type: 'application/pdf' })
    await offerWorkflowApi.uploadBureauReport(7, { file, creditScore: 780, bureauProvider: 'CIBIL', reportDate: '2026-09-20' })
    await offerWorkflowApi.eligibleApprovers(7, 4)
    await offerWorkflowApi.reassignDeviation(7, 4, 12, 'On leave')
    expect(calls.map(c => `${c.method} ${c.url}`)).toEqual([
      'POST /api/loans/7/workflow/re-evaluate',
      'POST /api/loans/7/workflow/bureau-report',
      'GET /api/loans/7/workflow/deviations/4/eligible-approvers',
      'POST /api/loans/7/workflow/deviations/4/reassign',
    ])
    const fd = calls[1].body as FormData
    expect(fd.get('file')).toBe(file)
    expect([fd.get('creditScore'), fd.get('bureauProvider'), fd.get('reportDate')]).toEqual(['780', 'CIBIL', '2026-09-20'])
    expect(calls[3].body).toEqual({ approverUserId: 12, reason: 'On leave' })
  })

  it('generates distinct idempotency keys per user action', () => {
    expect(newIdempotencyKey()).not.toEqual(newIdempotencyKey())
  })

  it('the retired direct approve / disburse / loan-level deviation calls are gone from loansApi', () => {
    const api = loansApi as unknown as Record<string, unknown>
    for (const k of ['approve', 'disburse', 'getDeviations', 'raiseDeviation', 'decideDeviation', 'skipDeviation'])
      expect(api[k], k).toBeUndefined()
  })

  it('rule metrics exist only for the auto-evaluated types (manual-only categories are never computed)', () => {
    expect(Object.keys(METRIC_OPTIONS).sort()).toEqual(['CIBIL', 'FOIR', 'LoanAmount', 'ROI', 'Tenure'])
    expect(METRIC_OPTIONS.ROI.map(m => m.value)).toContain('ROI_DISCOUNT_PP')
  })

  it('Skip and Not Required are different labels', () => {
    expect(DEVIATION_STATUS_LABEL.Skipped).not.toEqual(DEVIATION_STATUS_LABEL.NotRequired)
    expect(OFFER_STATUS_LABEL.Final).toMatch(/Final/)
  })
})

describe('Application stages — Offer restored, NI / Cancelled absent', () => {
  it('Offer has a label, colour, pipeline bar and LEW visibility', () => {
    expect(STATUS_LABELS.Offer).toBe('Offer')
    expect(STATUS_COLORS.Offer).toBeDefined()
    expect(STAGE_META.Offer.label).toBe('Offer')
    expect(STAGE_ORDER.indexOf('Offer')).toBe(STAGE_ORDER.indexOf('UnderReview') + 1)
    expect(LENDER_EMAIL_VISIBLE_STAGES).toContain('Offer')
  })

  it('no NI / Not Interested / Cancelled application status anywhere in the status maps', () => {
    for (const map of [STATUS_LABELS, STATUS_COLORS, STAGE_META] as Record<string, unknown>[])
      for (const bad of ['NI', 'ni', 'NotInterested', 'Cancelled', 'cancelled'])
        expect(Object.keys(map)).not.toContain(bad)
  })
})

describe('Offer-workflow permission defaults (frontend ↔ backend JSON in lock-step)', () => {
  const authority = ['Admin', 'LocationHead', 'OperationManager', 'LoginTeam']
  it('only the 4 authority roles may disburse by default', () => {
    for (const [backend, key] of Object.entries(BACKEND_TO_ROLE_KEY))
      expect(DEFAULT_ROLES[key].canDisburse, backend).toBe(authority.includes(backend))
  })

  it('Offers tab visible to every role that can see applications (not Product & Risk Officer)', () => {
    for (const key of ALL_ROLE_KEYS) expect(DEFAULT_ROLES[key].canTabOffers, key).toBe(key !== 'product_team')
  })

  it('backend fail-closed defaults carry the same flags', () => {
    const roles = (JSON.parse(shippedDefaults) as { roles: Record<string, Record<string, boolean>> }).roles
    for (const key of ALL_ROLE_KEYS) {
      expect(roles[key].canTabOffers, key).toBe(DEFAULT_ROLES[key].canTabOffers)
      expect(roles[key].canDisburse, key).toBe(DEFAULT_ROLES[key].canDisburse)
      expect(roles[key].canDeviation, key).toBe(DEFAULT_ROLES[key].canDeviation)
    }
  })
})
