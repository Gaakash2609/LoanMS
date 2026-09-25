import { describe, it, expect } from 'vitest'
import { offerCardActions, deviationActions, type OfferCardAction } from '@/components/shared/offerActions'
import { validUntilFromDays, type ApplicationOffer, type LoanWorkflow, type OfferDeviationRequest, type WorkflowCapabilities } from '@/api/offerWorkflowApi'
import { DEFAULT_ROLES, BACKEND_TO_ROLE_KEY } from '@/constants/permissions'
import type { UserRole } from '@/types'

// Frontend half of the role × action matrix. The backend (RoleActionMatrixTests)
// proves the API allows / refuses each action per role; this proves the Offers
// tab shows exactly the buttons that matrix allows — no dead buttons for a role
// the API refuses, no missing button for a role it allows.

// Same column order and rows as LoanMS.Tests/OfferWorkflow/RoleActionMatrixTests.cs.
const ROLES: UserRole[] = ['Admin', 'Manager', 'TeamLeader', 'LoginTeam', 'OperationManager', 'LocationHead', 'Sales', 'Dsa', 'Partner', 'Accounts', 'ProductTeam']
const MATRIX: Record<string, string> = {
  //                     Adm Mgr DSM CEO CEM ZM  BDE MCP CP  PRO PRK
  ViewOffers:           'A   A   A   A   A   A   A   A   A   F   F',
  ReviseOffer:          'A   A   A   A   A   A   F   F   F   F   F',
  SelectOffer:          'A   A   A   A   A   A   A   A   A   F   F',
  RaiseDeviation:       'A   A   A   A   A   A   F   F   F   F   F',
  ApproveDeviation:     'A   F   F   A   A   A   F   F   F   F   F',
  CreditApproval:       'A   F   F   A   A   A   F   F   F   F   F',
  ReassignDeviation:    'A   F   F   A   A   A   F   F   F   F   F',
  ReEvaluateDeviation:  'A   A   A   A   A   A   F   F   F   F   F',
  UploadBureauReport:   'A   F   F   A   A   A   F   F   F   F   F',
}
const allowed = (row: string, role: UserRole) => MATRIX[row].split(/\s+/)[ROLES.indexOf(role)] === 'A'

// Mirrors OfferWorkflowService.CapabilitiesAsync with the shipped permission defaults.
const AUTHORITY: UserRole[] = ['Admin', 'LocationHead', 'OperationManager', 'LoginTeam']
const MAKERS: UserRole[] = ['Admin', 'Manager', 'TeamLeader', 'LoginTeam', 'OperationManager', 'LocationHead']
function capsFor(role: UserRole, stage: string, finalDeviation?: string): WorkflowCapabilities {
  const perm = DEFAULT_ROLES[BACKEND_TO_ROLE_KEY[role]]
  const maker = MAKERS.includes(role) && !!perm.canChangeStatus
  const authority = AUTHORITY.includes(role)
  const raiser = MAKERS.includes(role) && !!perm.canDeviation
  const atOffer = stage === 'Offer'
  return {
    masked: role === 'Partner' || role === 'Dsa',
    canMoveToOffer: maker && stage === 'UnderReview', canBackToUnderwriting: maker && atOffer, canManageOffers: maker && atOffer,
    canSelectOffer: atOffer,
    canRaiseDeviation: raiser && atOffer && (finalDeviation === 'Required' || finalDeviation === 'NotRequired'),
    canSkipDeviation: authority && atOffer && finalDeviation === 'Required',
    canDecideDeviation: authority && stage === 'Decision', canCreditApprove: authority && atOffer && !!finalDeviation,
    canEditApprovedTerms: false, canGenerateSanction: false, canCancelSanction: false, canDisburse: false, canReverseDisbursement: false,
    canReassignDeviation: authority && stage === 'Decision',
    canUploadBureauReport: authority, canReEvaluate: (maker || authority) && atOffer,
  }
}

const offer = (id: number, status: ApplicationOffer['status'], deviationStatus: ApplicationOffer['deviationStatus'] = 'Required'): ApplicationOffer => ({
  id, bankId: id, lenderName: `Bank ${id}`, productKey: 'personal_loan', loanType: 'Personal', status, isActive: ['Available', 'Final'].includes(status),
  deviationStatus, approvalStatus: 'Pending', currentRevisionNo: 1, isExpired: false, version: 1, createdAt: '2026-09-25', revisions: [],
})
const wfOf = (stage: string, offers: ApplicationOffer[], caps: WorkflowCapabilities, deviations: OfferDeviationRequest[] = []): LoanWorkflow => ({
  loanId: 1, loanNumber: 'EFIN1', loanStatus: stage, productKey: 'personal_loan', maxActiveOffers: 3, moveToOfferBlockers: [],
  offers, deviations, creditApprovals: [], sanctions: [], disbursements: [], eligibleLenders: [], capabilities: caps, manualDeviationCategories: [],
})

const VIEWERS = ROLES.filter(r => allowed('ViewOffers', r))

describe('Offers tab buttons follow the role × action matrix', () => {
  it('no final yet: Select shows for every viewer, Revise / Withdraw only for offer makers', () => {
    for (const role of VIEWERS) {
      const o = offer(1, 'Available')
      const acts = offerCardActions(o, wfOf('Offer', [o, offer(2, 'Available')], capsFor(role, 'Offer')))
      expect(acts.includes('select'), role).toBe(allowed('SelectOffer', role))
      expect(acts.includes('revise'), role).toBe(allowed('ReviseOffer', role))
      expect(acts.includes('withdraw'), role).toBe(allowed('ReviseOffer', role))
      expect(acts.some(a => ['raise', 'skip', 'credit', 'unselect'].includes(a)), role).toBe(false)
    }
  })

  it('final offer with a deviation required: raise / skip / credit approval by role', () => {
    for (const role of VIEWERS) {
      const f = offer(1, 'Final', 'Required')
      const acts = offerCardActions(f, wfOf('Offer', [f, offer(2, 'NotSelected')], capsFor(role, 'Offer', 'Required')))
      expect(acts.includes('unselect'), role).toBe(allowed('SelectOffer', role))
      expect(acts.includes('raise'), role).toBe(allowed('RaiseDeviation', role))
      expect(acts.includes('skip'), role).toBe(allowed('CreditApproval', role))
      expect(acts.includes('credit'), role).toBe(allowed('CreditApproval', role))
    }
  })

  it('a final offer blocks selecting another one; a not-selected offer can only be withdrawn', () => {
    const f = offer(1, 'Final'), ns = offer(2, 'NotSelected')
    const acts = offerCardActions(ns, wfOf('Offer', [f, ns], capsFor('Admin', 'Offer', 'Required')))
    expect(acts).toEqual<OfferCardAction[]>(['withdraw'])
  })

  it('outside the Offer stage no offer-card action is offered', () => {
    for (const stage of ['UnderReview', 'Decision', 'OnHold', 'Rejected', 'Disbursed']) {
      const f = offer(1, 'Final')
      expect(offerCardActions(f, wfOf(stage, [f], capsFor('Admin', stage, 'Required'))), stage).toEqual([])
    }
  })

  it('pending deviation: decide / reassign by role; the raiser sees the self-approval notice instead', () => {
    const raised: OfferDeviationRequest = {
      id: 9, offerId: 1, revisionNo: 1, lenderName: 'Bank 1', deviationType: 'ROI', source: 'Rule', status: 'Raised',
      raisedByUserId: 50, raisedAt: '2026-09-25', assignmentState: 'Assigned', assignedApproverActive: true,
    }
    for (const role of VIEWERS) {
      const wf = wfOf('Decision', [offer(1, 'Final')], capsFor(role, 'Decision'), [raised])
      const other = deviationActions(raised, wf, 77)
      expect(other.includes('decide'), role).toBe(allowed('ApproveDeviation', role))
      expect(other.includes('reassign'), role).toBe(allowed('ReassignDeviation', role))
      const own = deviationActions(raised, wf, 50)
      expect(own.includes('decide'), role).toBe(false)
      expect(own.includes('ownRequest'), role).toBe(allowed('ApproveDeviation', role))
    }
    const decided = { ...raised, status: 'Approved' as const }
    expect(deviationActions(decided, wfOf('Offer', [], capsFor('Admin', 'Decision'), [decided]), 77)).toEqual([])
  })

  it('re-check and bureau upload capabilities match the matrix', () => {
    for (const role of VIEWERS) {
      const caps = capsFor(role, 'Offer', 'Required')
      expect(caps.canReEvaluate, role).toBe(allowed('ReEvaluateDeviation', role))
      expect(caps.canUploadBureauReport, role).toBe(allowed('UploadBureauReport', role))
    }
  })
})

describe('Lender offer validity pre-fill', () => {
  it('adds the lender days to today (local date) and is blank without a configured value', () => {
    const today = new Date(2026, 8, 25)
    expect(validUntilFromDays(30, today)).toBe('2026-10-25')
    expect(validUntilFromDays(7, new Date(2026, 11, 28))).toBe('2027-01-04')
    expect(validUntilFromDays(null, today)).toBe('')
    expect(validUntilFromDays(0, today)).toBe('')
  })
})
