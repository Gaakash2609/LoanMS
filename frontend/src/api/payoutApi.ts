import api from './axios'
import type { ApiResponse } from '@/types'

export interface PayoutClaim {
  id: number; loanNumber: string; customerName: string
  // BUGFIX (confirmed real, pre-existing gap — Phase 7 audit): field-names
  // corrected to match PayoutController.GetAll's actual Select() shape
  // (LoanMS.API/Controllers/PayoutController.cs) — claimedByName never
  // existed in any real response (the real field is claimedBy), and
  // loanId was never returned at all (only loanNumber is). processedBy
  // and claimType/verifiedAt/paidAt were already in the response but
  // never captured in this type.
  claimedBy: string; processedBy?: string | null
  claimAmount: number; status: string; claimType?: string
  month?: string; notes?: string
  createdAt: string; verifiedAt?: string; paidAt?: string
}

export interface PayoutRule {
  id: number; loanType: string; percentage: number
  minPayout?: number; maxPayout?: number; isActive: boolean; notes?: string
}

export const payoutApi = {
  // BUGFIX (confirmed real, pre-existing gap — Phase 7 audit, same
  // root-cause class as Phase 4 Part C / Phase 5's fixes):
  // PayoutController.GetAll returns a plain ApiResponseDto<object>
  // wrapping a raw array — not a paged shape — so data?.items/totalCount/
  // totalPages were always undefined and the table/KPI-cards showed zero
  // claims regardless of how many actually existed. status IS a real
  // server-side filter this endpoint honors (confirmed in the controller
  // body) and is kept; only the page/pageSize illusion is removed, since
  // the backend never paginates.
  getClaims: (params?: { status?: string; myOnly?: boolean }) =>
    api.get<ApiResponse<PayoutClaim[]>>('/api/payout', { params }),
  updateClaimStatus: (id: number, status: string, notes?: string) =>
    api.patch<ApiResponse<PayoutClaim>>(`/api/payout/${id}/status`, { status, notes }),
  getRules: () =>
    api.get<ApiResponse<PayoutRule[]>>('/api/payout-rules'),
  updateRule: (id: number, data: Partial<PayoutRule>) =>
    api.put<ApiResponse<PayoutRule>>(`/api/payout-rules/${id}`, data),
}
