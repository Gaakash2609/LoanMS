import api from './axios'
import type { ApiResponse } from '@/types'

// ── Perfios bank-statement verification report ─────────────────────────────
// PerfiosController is persistence-only: it stores/returns the FINAL summary
// of a bank-statement verification. By design (matching legacy's own
// architecture, not a migration gap) the actual PDF parsing runs entirely
// client-side — in legacy that was wwwroot/perfios/js/perfios-core.js; in
// this app it is the React-native engine under utils/perfios/{pdf,parser,
// categorizer,calculations,analysis}.ts, orchestrated by
// hooks/usePerfiosUpload.ts and rendered via PerfiosWorkflow. `save` below
// is what that flow calls once parsing/analysis finishes; there is no
// endpoint to upload a raw statement or poll status because the backend
// was never meant to do the parsing — only to persist the finished result.
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
  // Complete report payload as JSON (dates epoch-encoded) — lets the whole
  // report be re-hydrated from the backend, not just the summary above.
  // Null on legacy rows saved before full-report persistence existed.
  reportDataJson?: string | null
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
  // Complete report payload as JSON so the entire report (all transactions,
  // ABB/FinOne/Analysis/Breakup/EOD source data, validation checks, account
  // header) can be reloaded later — not just the summary fields above.
  reportDataJson: string | null
}

export const perfiosApi = {
  getLatest: (loanId: number) =>
    api.get<ApiResponse<PerfiosReport | null>>(`/api/loans/${loanId}/perfios-report`),

  save: (loanId: number, data: PerfiosReportSaveRequest) =>
    api.post<ApiResponse<boolean>>(`/api/loans/${loanId}/perfios-report`, data),
}
