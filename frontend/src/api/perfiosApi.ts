import api from './axios'
import type { ApiResponse } from '@/types'

// ── Perfios bank-statement verification report ─────────────────────────────
// PerfiosController is persistence-only: it stores/returns the FINAL summary
// of a bank-statement verification (produced by the legacy Perfios popup's
// own client-side PDF parsing engine — wwwroot/perfios/js/perfios-core.js,
// an entirely separate, self-contained in-browser parser, not a server
// call). There is no backend endpoint to upload a statement, start
// analysis, or poll status — only to read the latest saved result. See
// handoff note for what that means for this migration.
export interface PerfiosReport {
  id: number
  fileName?: string | null
  averageBankBalance?: string | null
  span?: string | null
  totalTransactions?: number | null
  hasSalary: boolean
  isValid: boolean
  firstTransactionDate?: string | null
  lastTransactionDate?: string | null
  manualReviewRequired: boolean
  staleDays?: number | null
  verifiedAt: string
}

// Matches SavePerfiosReportRequestDto exactly (LoanMS.Application/DTOs/
// PerfiosReportDto.cs) — same 10 fields, same types (AverageBankBalance and
// Span are strings server-side, not numbers; legacy's pfv9ConfirmAttachment
// sends them as `String(data.abb)`/`String(data.span)`, and the dates as
// already-formatted DD/MM/YYYY display strings via fmtDate(), not ISO).
export interface PerfiosReportSaveRequest {
  fileName: string | null
  averageBankBalance: string | null
  span: string | null
  totalTransactions: number | null
  hasSalary: boolean
  isValid: boolean
  firstTransactionDate: string | null
  lastTransactionDate: string | null
  manualReviewRequired: boolean
  staleDays: number | null
}

export const perfiosApi = {
  getLatest: (loanId: number) =>
    api.get<ApiResponse<PerfiosReport | null>>(`/api/loans/${loanId}/perfios-report`),

  save: (loanId: number, data: PerfiosReportSaveRequest) =>
    api.post<ApiResponse<boolean>>(`/api/loans/${loanId}/perfios-report`, data),
}
