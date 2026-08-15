import api from './axios'
import type { ApiResponse } from '@/types'

// ── Loan Obligations (FOIR tab) ─────────────────────────────────────────────
// Mirrors ObligationsController exactly: GET by loan is authorized via
// canViewObligations + loan visibility scope; Create/Update require
// canEditObligations + role in Admin,Manager,Sales; Delete is Admin only.
// All three additionally 404 if the loan is outside the caller's scope —
// enforced server-side, not duplicated here.
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
  createdAt: string
  updatedAt?: string | null
}

export interface LoanObligationRequest {
  loanApplicationId?: number // required on create only; ignored/unused by Update
  loanType: string
  sanctionAmount: number
  financerName?: string
  loanEmi: number
  amountOutstanding: number
  loanClosureDate?: string | null
  loanAccountNumber?: string
  selectBT: boolean
}

export const obligationsApi = {
  getByLoan: (loanId: number) =>
    api.get<ApiResponse<LoanObligation[]>>(`/api/loans/${loanId}/obligations`),

  create: (data: LoanObligationRequest) =>
    api.post<ApiResponse<LoanObligation>>('/api/obligations', data),

  update: (id: number, data: LoanObligationRequest) =>
    api.put<ApiResponse<LoanObligation>>(`/api/obligations/${id}`, data),

  delete: (id: number) =>
    api.delete<ApiResponse<boolean>>(`/api/obligations/${id}`),
}
