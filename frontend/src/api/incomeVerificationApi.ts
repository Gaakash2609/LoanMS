import api from './axios'
import type { ApiResponse } from '@/types'

// ── Income Verification API (Phase 6) ──────────────────────────────────────────
// Talks to the authoritative backend engine (IncomeVerificationController). The
// client can TRIGGER a run and READ the result, but never computes the outcome
// itself — the state/verified income/month evidence all come from the backend.

export interface IncomeVerificationMonth {
  year: number
  month: number
  monthLabel: string
  salarySlipExtractionId?: number | null
  originalExtractedSalary?: number | null
  effectiveSalary?: number | null
  matchStatus: string
  reasonCode?: string | null
  matchedTransactionRef?: string | null
  matchedTransactionDate?: string | null
  matchedAmount?: number | null
  windowStart: string
  windowEnd: string
  verificationMethod?: string | null
  bankAccountRef?: string | null
}

export interface IncomeVerificationReason {
  code: string
  monthLabel?: string | null
  detail: string
}

export interface IncomeVerificationResult {
  id: number
  loanId: number
  applicantRole: string
  applicantKey?: string | null
  state: string
  requiredMonthsReferenceDate: string
  declaredIncome?: number | null
  extractedIncome?: number | null
  verifiedIncome?: number | null
  perfiosReportId?: number | null
  sourceReportHash?: string | null
  runByUserId: number
  runAt: string
  reviewedByUserId?: number | null
  reviewedAt?: string | null
  reviewDecision?: string | null
  reviewReason?: string | null
  reasons: IncomeVerificationReason[]
  months: IncomeVerificationMonth[]
}

export interface RunIncomeVerificationBody {
  applicantRole?: string
  applicantKey?: string | null
  idempotencyKey?: string | null
}

export interface ManualReviewBody {
  decision: 'Approved' | 'Rejected'
  reason: string
}

export interface SalaryOverrideBody {
  userEditedSalary: number
  reason: string
}

export const incomeVerificationApi = {
  run: (loanId: number, body?: RunIncomeVerificationBody) =>
    api.post<ApiResponse<IncomeVerificationResult>>(`/api/loans/${loanId}/income-verification/run`, body ?? {}),

  getLatest: (loanId: number, applicantRole = 'Applicant', applicantKey?: string | null) =>
    api.get<ApiResponse<IncomeVerificationResult | null>>(`/api/loans/${loanId}/income-verification`, {
      params: { applicantRole, applicantKey },
    }),

  history: (loanId: number) =>
    api.get<ApiResponse<IncomeVerificationResult[]>>(`/api/loans/${loanId}/income-verification/history`),

  manualReview: (loanId: number, verificationId: number, body: ManualReviewBody) =>
    api.post<ApiResponse<IncomeVerificationResult>>(
      `/api/loans/${loanId}/income-verification/${verificationId}/manual-review`, body),

  setOverride: (loanId: number, extractionId: number, body: SalaryOverrideBody) =>
    api.put<ApiResponse<unknown>>(
      `/api/loans/${loanId}/income-verification/salary-slip/${extractionId}/override`, body),
}
