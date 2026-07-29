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
