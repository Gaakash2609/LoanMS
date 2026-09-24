import api from './axios'
import type { ApiResponse } from '@/types'

// ── Loan Obligations (credit-review workspace) ──────────────────────────────
// Mirrors ObligationsController exactly: reads are authorized via
// canViewObligations + loan visibility scope; writes (create/update/import/verify)
// require canEditObligations + role in Admin,Manager,Sales; Delete is Admin only.
// All obligations, FOIR, detection and reconciliation are computed SERVER-SIDE —
// this client only triggers and renders. It never computes a business decision.
export interface LoanObligation {
  id: number
  loanApplicationId: number
  loanType: string
  sanctionAmount: number
  financerName?: string | null
  loanEmi: number
  amountOutstanding: number
  loanClosureDate?: string | null
  loanAccountNumber?: string | null
  selectBT: boolean

  // Credit-review
  applicantRole: 'Applicant' | 'CoApplicant'
  applicantKey?: string | null
  source: 'Manual' | 'BankStatement' | 'Bureau' | 'Document'
  verificationStatus: 'Unverified' | 'ReviewRequired' | 'Verified' | 'Rejected'
  isClosed: boolean
  interestRate?: number | null
  tenureMonths?: number | null
  startDate?: string | null
  maturityDate?: string | null
  notes?: string | null

  detectedEmi?: number | null
  detectedFinancerName?: string | null
  detectedAccountNumber?: string | null
  sourcePerfiosReportId?: number | null
  detectionEvidenceJson?: string | null

  isManualOverride: boolean
  overrideReason?: string | null
  verifiedByUserId?: number | null
  verifiedAt?: string | null
  verificationNote?: string | null

  countsTowardFoir: boolean
  hasReconciliationMismatch: boolean

  createdAt: string
  updatedAt?: string | null
}

export interface LoanObligationRequest {
  loanApplicationId?: number // required on create only; ignored by Update
  loanType: string
  sanctionAmount: number
  financerName?: string
  loanEmi: number
  amountOutstanding: number
  loanClosureDate?: string | null
  loanAccountNumber?: string
  selectBT: boolean
  applicantRole?: string
  applicantKey?: string | null
  isClosed?: boolean
  interestRate?: number | null
  tenureMonths?: number | null
  startDate?: string | null
  maturityDate?: string | null
  notes?: string | null
  overrideReason?: string // required when editing a detected row's figures
}

export interface ObligationSummary {
  totalCount: number
  activeCount: number
  closedCount: number
  detectedCount: number
  verifiedCount: number
  reviewRequiredCount: number
  mismatchCount: number
  totalActiveMonthlyEmi: number
  applicantMonthlyEmi: number
  coApplicantMonthlyEmi: number
  totalOutstanding: number
  balanceTransferCount: number
  balanceTransferMonthlyEmi: number
  countBySource: Record<string, number>
}

export interface ObligationFoirResult {
  incomeAvailable: boolean
  declaredIncome: number
  verifiedIncome?: number | null
  coApplicantIncome: number
  combinedIncome: number
  incomeBasis: string
  incomeBasisNote: string
  existingActiveEmi: number
  existingNonBtEmi: number
  balanceTransferEmi: number
  activeObligationCount: number
  proposedEmi: number
  proposedEmiSource: string
  proposedRatePct: number
  proposedTenureMonths: number
  currentFoirPct: number
  postLoanFoirPct: number
  totalObligationsAfter: number
  applicableFoirLimitPct?: number | null
  foirLimitSource: string
  lenderName?: string | null
  productKey?: string | null
  passesLenderLimit?: boolean | null
  decisionLabel: string
  capacityFoirPct: number
  eligibleEmiAtCapacity: number
  availableHeadroomEmi: number
  eligibleLoanAmount?: number | null
  suggestedFoirPct: number
  foirOverrideApplied: boolean
  capacityFoirSource: string
  // Vanilla-parity detail metrics
  cibil: number
  primaryNetIncome: number
  requestedAmount: number
  loanDiff: number
  maxEligibleLoanAmount: number
  btBenefitLoanAmount: number
  cibilMultiplier: number
  loanByMultiplier: number
  conservativeEligibleLoanAmount: number
  dscr: string
  nonBtOutstanding: number
  btOutstanding: number
}

export interface ObligationMismatch {
  obligationId: number
  financerName?: string | null
  field: 'emi' | 'financer' | 'accountNumber' | string
  detectedValue: string
  currentValue: string
  note: string
}

export interface ObligationReconciliation {
  mismatchCount: number
  mismatches: ObligationMismatch[]
}

export interface ObligationWorkspace {
  obligations: LoanObligation[]
  summary: ObligationSummary
  foir: ObligationFoirResult
  reconciliation: ObligationReconciliation
}

export interface DetectedObligationCandidate {
  detectionSignature: string
  emi: number
  financerName?: string | null
  accountNumber?: string | null
  channel: string
  occurrenceCount: number
  firstSeen: string
  lastSeen: string
  evidenceJson: string
  alreadyImported: boolean
}

export interface DetectObligationsResult {
  perfiosReportAvailable: boolean
  perfiosReportId?: number | null
  message?: string | null
  candidates: DetectedObligationCandidate[]
}

export interface CalculateFoirRequest {
  proposedEmi?: number | null
  coApplicantIncome?: number | null
  foirOverride?: number | null
  applicantRole?: string
  applicantKey?: string | null
}

export interface VerifyObligationRequest {
  decision: 'Verified' | 'Rejected' | 'ReviewRequired'
  note?: string
}

export const obligationsApi = {
  getWorkspace: (loanId: number, params?: CalculateFoirRequest) =>
    api.get<ApiResponse<ObligationWorkspace>>(`/api/loans/${loanId}/obligations/workspace`, {
      params: {
        proposedEmi: params?.proposedEmi ?? undefined,
        coApplicantIncome: params?.coApplicantIncome ?? undefined,
        foirOverride: params?.foirOverride ?? undefined,
        applicantRole: params?.applicantRole ?? undefined,
        applicantKey: params?.applicantKey ?? undefined,
      },
    }),

  calculateFoir: (loanId: number, body: CalculateFoirRequest) =>
    api.post<ApiResponse<ObligationFoirResult>>(`/api/loans/${loanId}/obligations/calculate-foir`, body),

  detect: (loanId: number) =>
    api.post<ApiResponse<DetectObligationsResult>>(`/api/loans/${loanId}/obligations/detect`, {}),

  importDetected: (loanId: number, signatures: string[], applicantRole?: string, applicantKey?: string | null) =>
    api.post<ApiResponse<LoanObligation[]>>(`/api/loans/${loanId}/obligations/import-detected`, {
      signatures, applicantRole, applicantKey,
    }),

  create: (data: LoanObligationRequest) =>
    api.post<ApiResponse<LoanObligation>>('/api/obligations', data),

  update: (id: number, data: LoanObligationRequest) =>
    api.put<ApiResponse<LoanObligation>>(`/api/obligations/${id}`, data),

  verify: (id: number, body: VerifyObligationRequest) =>
    api.post<ApiResponse<LoanObligation>>(`/api/obligations/${id}/verify`, body),

  delete: (id: number) =>
    api.delete<ApiResponse<boolean>>(`/api/obligations/${id}`),
}
