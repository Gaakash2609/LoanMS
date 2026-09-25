import api from './axios'
import type { ApiResponse } from '@/types'

// Offer → Deviation → Credit Approval → Sanction → Disbursement.
// Every rule (stage, role, maker-checker, limits, calculations) is enforced by
// the API (OfferWorkflowController / OfferWorkflowService). The UI only shows
// what `capabilities` says the caller may do and renders the server's figures —
// no amount, EMI or deviation outcome is computed or stored in the browser.

export interface OfferTerms {
  loanAmount: number
  tenureMonths: number
  baseRoi: number
  offeredRoi: number
  processingFeePct: number
  gstPct: number
  insuranceAmount: number
  pfInBundled: boolean
  insuranceInBundled: boolean
  btAmount: number
  stampDuty: number
}

export interface OfferRevision extends OfferTerms {
  revisionNo: number
  rateType: string
  processingFeeAmount: number
  gstAmount: number
  financedPrincipal: number
  emi: number
  netDisbursement: number
  changeReason?: string | null
  evaluationOutcome: string
  createdBy?: string | null
  createdByUserId: number
  createdAt: string
  marginPp?: number | null
}

export interface DeviationCheck {
  deviationType: string
  metric: string
  status: 'Within' | 'Breach' | 'MissingData' | 'Conflict' | string
  actual?: number | null
  allowed?: number | null
  difference?: number | null
  unit: string
  approvalRequired: boolean
  exceedsAuthority: boolean
  message: string
  ruleId?: number | null
  ruleKey?: string | null
  ruleVersion?: number | null
  ruleName?: string | null
}

export interface DeviationEvaluation {
  outcome: string
  manualReview: boolean
  manualReviewReason?: string | null
  checks: DeviationCheck[]
  evaluatedAt: string
  factsUsed: Record<string, string | null>
}

export type OfferStatus = 'Available' | 'Final' | 'NotSelected' | 'Withdrawn' | 'Expired'
export type OfferDeviationStatus = 'NotRequired' | 'Required' | 'Raised' | 'Approved' | 'Rejected' | 'Skipped'

export interface ApplicationOffer {
  id: number
  bankId: number
  lenderName: string
  productKey: string
  loanType: string
  status: OfferStatus
  isActive: boolean
  deviationStatus: OfferDeviationStatus
  approvalStatus: 'Pending' | 'Approved' | 'Rejected'
  currentRevisionNo: number
  selectedRevisionNo?: number | null
  validUntil?: string | null
  isExpired: boolean
  version: number
  selectedAt?: string | null
  selectedBy?: string | null
  statusReason?: string | null
  createdBy?: string | null
  createdAt: string
  updatedAt?: string | null
  updatedBy?: string | null
  current?: OfferRevision | null
  revisions: OfferRevision[]
  evaluation?: DeviationEvaluation | null
  /** Set when the deviation was re-checked after the revision was saved (rule change / bureau report / manual). */
  latestEvaluatedAt?: string | null
}

export interface OfferDeviationRequest {
  id: number
  offerId: number
  revisionNo: number
  lenderName: string
  deviationType: string
  source: string
  status: 'Raised' | 'Approved' | 'Rejected' | 'Skipped' | 'Closed'
  reason?: string | null
  raisedBy?: string | null
  raisedByUserId: number
  raisedAt: string
  assignedApprover?: string | null
  assignedApproverId?: number | null
  assignmentState: string
  /** false when the assigned approver's account is inactive — reassign it. */
  assignedApproverActive: boolean
  decidedBy?: string | null
  decidedAt?: string | null
  decisionComment?: string | null
  closedReason?: string | null
  flags?: DeviationCheck[] | null
}

export interface CreditApproval {
  id: number
  offerId: number
  revisionNo: number
  lenderName: string
  decision: 'Approved' | 'Rejected'
  comment?: string | null
  deviationStatusAtApproval: string
  approver?: string | null
  createdAt: string
  isCurrent: boolean
}

export interface Sanction {
  id: number
  sanctionNumber: string
  sanctionVersion: number
  previousSanctionId?: number | null
  offerId: number
  revisionNo: number
  creditApprovalId: number
  lenderName: string
  loanAmount: number
  tenureMonths: number
  roi: number
  emi: number
  processingFeePct: number
  processingFeeAmount: number
  gstPct: number
  gstAmount: number
  insuranceAmount: number
  btAmount: number
  stampDuty: number
  financedPrincipal: number
  netDisbursement: number
  status: 'Active' | 'Cancelled'
  generatedBy?: string | null
  generatedAt: string
  cancellationType?: string | null
  cancelReason?: string | null
  cancelledBy?: string | null
  cancelledAt?: string | null
}

export interface Disbursement {
  id: number
  sanctionId: number
  type: 'Disbursement' | 'Reversal'
  reversalOfId?: number | null
  amount: number
  disbursementDate: string
  bankAccountNumber: string
  ifsc: string
  accountHolderName?: string | null
  utr: string
  lenderReference?: string | null
  mode: string
  status: 'Completed' | 'Reversed'
  reason?: string | null
  createdBy?: string | null
  createdAt: string
}

export interface WorkflowCapabilities {
  canManageOffers: boolean
  canSelectOffer: boolean
  canRaiseDeviation: boolean
  canDecideDeviation: boolean
  canSkipDeviation: boolean
  canCreditApprove: boolean
  canEditApprovedTerms: boolean
  canGenerateSanction: boolean
  canCancelSanction: boolean
  canDisburse: boolean
  canReverseDisbursement: boolean
  canMoveToOffer: boolean
  canBackToUnderwriting: boolean
  canReassignDeviation: boolean
  canUploadBureauReport: boolean
  canReEvaluate: boolean
  masked: boolean
}

/** The active bureau report — the only CIBIL source the deviation rules trust. */
export interface BureauReportSummary {
  id: number
  bureauProvider: string
  creditScore: number
  reportDate: string
  uploadedAt: string
  uploadedBy?: string | null
  fileName?: string | null
}

export interface EligibleApprover { userId: number; name: string; roleTitle: string }

export interface BureauReportInput { file: File; creditScore: number; bureauProvider: string; reportDate: string }

export interface LoanWorkflow {
  loanId: number
  loanNumber: string
  loanStatus: string
  productKey: string
  maxActiveOffers: number
  moveToOfferBlockers: string[]
  offers: ApplicationOffer[]
  deviations: OfferDeviationRequest[]
  creditApprovals: CreditApproval[]
  sanctions: Sanction[]
  disbursements: Disbursement[]
  eligibleLenders: { bankId: number; bankName: string; offerValidityDays?: number | null }[]
  bureauReport?: BureauReportSummary | null
  capabilities: WorkflowCapabilities
  manualDeviationCategories: string[]
}

export interface DisbursementInput {
  amount: number
  disbursementDate: string
  bankAccountNumber: string
  ifsc: string
  accountHolderName?: string
  utr: string
  lenderReference?: string
  mode: string
}

export interface DeviationRuleCondition { field: string; op: string; value: string }

export interface DeviationRule {
  id: number
  ruleKey: string
  version: number
  name: string
  bankId: number
  bankName?: string | null
  productKey?: string | null
  loanType?: string | null
  deviationType: string
  metric: string
  unit: string
  limitValue: number
  maxApprovableDeviation?: number | null
  conditions: DeviationRuleCondition[]
  conditionLogic: 'AND' | 'OR'
  priority: number
  effectiveFrom: string
  effectiveTo?: string | null
  isActive: boolean
  approvalRequired: boolean
  notes?: string | null
  createdBy?: string | null
  createdAt: string
  supersededAt?: string | null
  deactivatedAt?: string | null
  isLatest: boolean
}

export interface DeviationRuleInput {
  name: string
  bankId: number
  productKey?: string | null
  loanType?: string | null
  deviationType: string
  metric: string
  limitValue: number
  maxApprovableDeviation?: number | null
  conditions: DeviationRuleCondition[]
  conditionLogic: 'AND' | 'OR'
  priority: number
  effectiveFrom: string
  effectiveTo?: string | null
  approvalRequired: boolean
  notes?: string | null
  changeReason?: string | null
}

export interface OfferPipelineRow {
  loanId: number
  loanNumber: string
  applicantName: string
  applicationStatus: string
  offerId: number
  lenderName: string
  offerStatus: string
  isFinalLender: boolean
  revisionNo: number
  loanAmount: number
  tenureMonths: number
  baseRoi?: number | null
  offeredRoi: number
  emi: number
  netDisbursement: number
  deviationStatus: string
  deviationTypes?: string | null
  approvalStatus: string
  approvedAt?: string | null
  sanctionNumber?: string | null
  sanctionStatus?: string | null
  sanctionedAt?: string | null
  sanctionAmount?: number | null
  disbursedAmount?: number | null
  disbursedAt?: string | null
  disbursementStatus?: string | null
  offerCreatedAt: string
}

/** One key per user action, so a double click / retried request cannot create a second record. */
export const newIdempotencyKey = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)

const base = (loanId: number) => `/api/loans/${loanId}/workflow`
type R = ApiResponse<LoanWorkflow>
const idem = (key?: string) => (key ? { headers: { 'Idempotency-Key': key } } : undefined)

export const offerWorkflowApi = {
  get: (loanId: number) => api.get<R>(base(loanId)),
  moveToOffer: (loanId: number, reason?: string) => api.post<R>(`${base(loanId)}/move-to-offer`, { reason }),
  backToUnderwriting: (loanId: number, reason: string) => api.post<R>(`${base(loanId)}/back-to-underwriting`, { reason }),
  createOffer: (loanId: number, body: OfferTerms & { bankId: number; validUntil?: string | null }) =>
    api.post<R>(`${base(loanId)}/offers`, body),
  reviseOffer: (loanId: number, offerId: number, body: OfferTerms & { expectedVersion: number; reason: string; validUntil?: string | null }) =>
    api.post<R>(`${base(loanId)}/offers/${offerId}/revisions`, body),
  withdrawOffer: (loanId: number, offerId: number, expectedVersion: number, reason: string) =>
    api.post<R>(`${base(loanId)}/offers/${offerId}/withdraw`, { expectedVersion, reason }),
  selectOffer: (loanId: number, offerId: number, expectedVersion: number) =>
    api.post<R>(`${base(loanId)}/offers/${offerId}/select`, { expectedVersion }),
  unselectOffer: (loanId: number, offerId: number, expectedVersion: number, reason: string) =>
    api.post<R>(`${base(loanId)}/offers/${offerId}/unselect`, { expectedVersion, reason }),
  raiseDeviation: (loanId: number, offerId: number, deviationType: string, reason: string, key: string) =>
    api.post<R>(`${base(loanId)}/offers/${offerId}/deviations`, { deviationType, reason }, idem(key)),
  skipDeviation: (loanId: number, offerId: number, reason: string) =>
    api.post<R>(`${base(loanId)}/offers/${offerId}/deviations/skip`, { reason }),
  decideDeviation: (loanId: number, deviationId: number, approve: boolean, comment: string | undefined, key: string) =>
    api.post<R>(`${base(loanId)}/deviations/${deviationId}/decide`, { approve, comment }, idem(key)),
  creditApproval: (loanId: number, offerId: number, decision: 'Approve' | 'Reject', revisionNo: number, comment: string | undefined, key: string) =>
    api.post<R>(`${base(loanId)}/offers/${offerId}/credit-approval`, { decision, revisionNo, comment }, idem(key)),
  generateSanction: (loanId: number, key: string) => api.post<R>(`${base(loanId)}/sanctions`, undefined, idem(key)),
  cancelSanction: (loanId: number, sanctionId: number, cancellationType: 'Cancel' | 'Revoke' | 'Amendment', reason: string) =>
    api.post<R>(`${base(loanId)}/sanctions/${sanctionId}/cancel`, { cancellationType, reason }),
  disburse: (loanId: number, body: DisbursementInput, key: string) => api.post<R>(`${base(loanId)}/disbursements`, body, idem(key)),
  reverseDisbursement: (loanId: number, disbursementId: number, reason: string) =>
    api.post<R>(`${base(loanId)}/disbursements/${disbursementId}/reverse`, { reason }),
  reEvaluate: (loanId: number) => api.post<R>(`${base(loanId)}/re-evaluate`),
  uploadBureauReport: (loanId: number, b: BureauReportInput) => {
    const fd = new FormData()
    fd.append('file', b.file)
    fd.append('creditScore', String(b.creditScore))
    fd.append('bureauProvider', b.bureauProvider)
    fd.append('reportDate', b.reportDate)
    return api.post<R>(`${base(loanId)}/bureau-report`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  eligibleApprovers: (loanId: number, deviationId: number) =>
    api.get<ApiResponse<EligibleApprover[]>>(`${base(loanId)}/deviations/${deviationId}/eligible-approvers`),
  reassignDeviation: (loanId: number, deviationId: number, approverUserId: number, reason: string) =>
    api.post<R>(`${base(loanId)}/deviations/${deviationId}/reassign`, { approverUserId, reason }),

  listRules: (bankId?: number, includeHistory = false) =>
    api.get<ApiResponse<DeviationRule[]>>('/api/deviation-rules', { params: { bankId, includeHistory } }),
  createRule: (body: DeviationRuleInput) => api.post<ApiResponse<DeviationRule>>('/api/deviation-rules', body),
  newRuleVersion: (ruleId: number, body: DeviationRuleInput) => api.post<ApiResponse<DeviationRule>>(`/api/deviation-rules/${ruleId}/versions`, body),
  setRuleActive: (ruleId: number, active: boolean, reason: string) =>
    api.post<ApiResponse<DeviationRule>>(`/api/deviation-rules/${ruleId}/${active ? 'activate' : 'deactivate'}`, { reason }),
  simulate: (body: OfferTerms & { bankId: number; productKey?: string; loanType?: string; monthlyIncome?: number | null;
    postLoanFoirPct?: number | null; bureauCibil?: number | null; employmentType?: string; draftRule?: DeviationRuleInput | null }) =>
    api.post<ApiResponse<DeviationEvaluation>>('/api/deviation-rules/simulate', body),

  pipelineReport: (params: { from?: string; to?: string; bankId?: number; offerStatus?: string }) =>
    api.get<ApiResponse<OfferPipelineRow[]>>('/api/reports/offer-pipeline', { params }),
}

// Display labels (the stored values stay the API enum strings).
export const OFFER_STATUS_LABEL: Record<string, string> = {
  Available: 'Available', Final: 'Final (selected)', NotSelected: 'Not selected', Withdrawn: 'Withdrawn', Expired: 'Expired',
}
export const DEVIATION_STATUS_LABEL: Record<string, string> = {
  NotRequired: 'Not required', Required: 'Required', Raised: 'Pending decision', Approved: 'Approved',
  Rejected: 'Rejected', Skipped: 'Skipped (authorised bypass)', Closed: 'Closed',
}
export const METRIC_OPTIONS: Record<string, { value: string; label: string }[]> = {
  ROI: [{ value: 'ROI_MIN_PCT', label: 'Minimum offered ROI (% p.a.)' }, { value: 'ROI_DISCOUNT_PP', label: 'Max discount below Base ROI (percentage points)' }],
  FOIR: [{ value: 'FOIR_MAX_PCT', label: 'Max post-loan FOIR (%)' }],
  LoanAmount: [{ value: 'AMOUNT_MAX', label: 'Max loan amount (₹)' }, { value: 'INCOME_MULTIPLE_MAX', label: 'Max multiple of monthly income (×)' }],
  Tenure: [{ value: 'TENURE_MAX_MONTHS', label: 'Max tenure (months)' }, { value: 'TENURE_MIN_MONTHS', label: 'Min tenure (months)' }],
  CIBIL: [{ value: 'CIBIL_MIN', label: 'Min bureau CIBIL (bureau report only)' }],
}
export const CONDITION_FIELDS: { value: string; label: string }[] = [
  { value: 'loanAmount', label: 'Loan amount' }, { value: 'offeredRoi', label: 'Offered ROI' }, { value: 'tenureMonths', label: 'Tenure (months)' },
  { value: 'cibil', label: 'Bureau CIBIL' }, { value: 'income', label: 'Monthly income' }, { value: 'foir', label: 'Post-loan FOIR %' },
  { value: 'loanPurpose', label: 'Fresh / BT (FRESH or BT)' }, { value: 'employmentType', label: 'Employment type' },
  { value: 'customerType', label: 'Customer (company) type' }, { value: 'existingCustomer', label: 'Existing customer (true/false)' },
]
export const CONDITION_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in']
/** Mirrors OfferWorkflowService.BureauProviders. */
export const BUREAU_PROVIDERS = ['CIBIL', 'Experian', 'Equifax', 'CRIF High Mark']

/** yyyy-mm-dd, `days` from today (local date) — the lender's default offer validity. */
export function validUntilFromDays(days: number | null | undefined, today = new Date()): string {
  if (!days || days <= 0) return ''
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
