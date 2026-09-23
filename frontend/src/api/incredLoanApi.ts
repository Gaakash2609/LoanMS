import api from './axios'
import type { ApiResponse, IncredLoanInfo } from '@/types'

export const incredLoanApi = {
  // Current stored InCred state for a loan (application id, offer status, offers…)
  getInfo: (loanId: number) =>
    api.get<ApiResponse<IncredLoanInfo>>(`/api/incred/loan/${loanId}`),

  // "+ Create InCred App" — single click, no form. Runs application/init →
  // offer/request → offer/status using the loan's existing customer data.
  create: (loanId: number) =>
    api.post<ApiResponse<IncredLoanInfo>>(`/api/incred/loan/${loanId}/create`),

  // Re-poll offer status without re-creating the application
  refreshOffer: (loanId: number) =>
    api.post<ApiResponse<IncredLoanInfo>>(`/api/incred/loan/${loanId}/refresh-offer`),
}

// ── Post-creation InCred application actions ────────────────────────────
// IncredController.cs has six more endpoints keyed by the InCred-side
// application id (`incredAppId`, a string — NOT the LoanMS loan id):
// eligibility, document, cancel, repayment-schedule, applicant PATCH,
// disbursement. All six had real onclick-bound buttons in legacy
// (efin-app.js:14623-14995: incredCheckEligibility/incredUploadDocument/
// incredCancelApp/incredGetRepaymentSchedule/incredUpdateApplicant/
// incredGetDisbursement) but, until IncredAppActionsModal, had no React
// caller at all — `incred-apps` only listed applications read-only.
//
// Every controller action here is a raw pass-through proxy: it forwards
// `payload.GetRawText()` verbatim to InCred and returns InCred's own raw
// JSON via `Content(body, "application/json")`, NOT the app's usual
// ApiResponseDto<T> envelope. Callers below therefore type responses as
// `Record<string, any>` and read fields defensively (snake_case, multiple
// possible key names) exactly as legacy's own destructuring did — this is
// a third-party contract we don't control, not our own DTO.
//
// `partner_id` is not a secret: GET /api/incred/status already returns it
// to any authenticated user (IncredPage.tsx's `IncredStatus.partnerId`),
// and legacy itself read it from client-side config the same way.

export interface IncredEligibilityPayload {
  partner_id: string
  pan?: string
  mobile?: string
  monthly_income?: number
  loan_amount: number
  loan_type: string
  cibil_score?: number
  employment_type?: string
}

export interface IncredCancelPayload {
  partner_id: string
  reason: string
  ref_id: number
}

export interface IncredUpdateApplicantPayload {
  partner_id: string
  applicant: { name?: string; pan?: string; mobile?: string; dob?: string; email?: string }
  employment: { type?: string; company?: string; designation?: string; monthly_income?: number }
  cibil_score?: number
}

export interface IncredDocumentUploadPayload {
  partner_id: string
  document_type: string
  file_name: string
  file_data: string // base64, no data: prefix — mirrors legacy's FileReader().result.split(',')[1]
  mime_type: string
}

export const incredAppActionsApi = {
  // No incredAppId in the path -- legacy's own POST /loan/application/eligibility
  // (incredCheckEligibility) is a pre-check callable before an application exists.
  checkEligibility: (payload: IncredEligibilityPayload) =>
    api.post<Record<string, unknown>>('/api/incred/loan/application/eligibility', payload),

  uploadDocument: (incredAppId: string, payload: IncredDocumentUploadPayload) =>
    api.post<Record<string, unknown>>(`/api/incred/loan/application/${incredAppId}/document`, payload),

  cancel: (incredAppId: string, payload: IncredCancelPayload) =>
    api.post<Record<string, unknown>>(`/api/incred/loan/application/${incredAppId}/cancel`, payload),

  getRepaymentSchedule: (incredAppId: string) =>
    api.get<Record<string, unknown>>(`/api/incred/loan/application/${incredAppId}/repayment-schedule`),

  updateApplicant: (incredAppId: string, payload: IncredUpdateApplicantPayload) =>
    api.patch<Record<string, unknown>>(`/api/incred/loan/application/${incredAppId}/applicant`, payload),

  getDisbursement: (incredAppId: string) =>
    api.get<Record<string, unknown>>(`/api/incred/loan/application/${incredAppId}/disbursement`),
}
