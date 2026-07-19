import api from './axios'
import type { ApiResponse, PagedResult } from '@/types'

export interface PayoutClaim {
  id: number; loanId: number; loanNumber: string; customerName: string
  claimedByName: string; claimAmount: number; status: string
  month?: string; notes?: string; createdAt: string
}

export interface PayoutRule {
  id: number; loanType: string; percentage: number
  minPayout?: number; maxPayout?: number; isActive: boolean; notes?: string
}

export const payoutApi = {
  getClaims: (params: Record<string, unknown>) =>
    api.get<ApiResponse<PagedResult<PayoutClaim>>>('/api/payout', { params }),
  updateClaimStatus: (id: number, status: string, notes?: string) =>
    api.patch<ApiResponse<PayoutClaim>>(`/api/payout/${id}/status`, { status, notes }),
  getRules: () =>
    api.get<ApiResponse<PayoutRule[]>>('/api/payout-rules'),
  updateRule: (id: number, data: Partial<PayoutRule>) =>
    api.put<ApiResponse<PayoutRule>>(`/api/payout-rules/${id}`, data),
}
