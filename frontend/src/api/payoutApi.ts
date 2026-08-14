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

// Exact shape of ClaimCreateDto (LoanMS.API/Controllers/PayoutController.cs)
// — claimAmount/claimType are only honored server-side for Admin/Manager
// callers reconciling on another eligible claimant's behalf; for every
// other role the server derives claimType from the caller's own
// authenticated role and computes claimAmount from the configured
// PayoutRule, ignoring whatever is sent.
export interface ClaimCreateRequest {
  loanId: number
  claimAmount?: number
  month?: string
  notes?: string
  claimType?: string
}

export interface ClaimCreateResponse {
  id: number; claimAmount: number; claimType: string
}

// Exact shape of GET /api/payout/my-earnings's response — grouped by the
// caller's own claim-status, server-scoped to ClaimedByUserId == caller
// (confirmed in PayoutController.MyEarnings).
export interface EarningsGroup {
  status: string; total: number; count: number
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
  // Phase 11 Priority-2 — genuine, existing, working backend endpoints
  // (POST /api/payout, GET /api/payout/my-earnings) that had no frontend
  // wiring at all before this fix.
  submitClaim: (data: ClaimCreateRequest) =>
    api.post<ApiResponse<ClaimCreateResponse>>('/api/payout', data),
  getMyEarnings: () =>
    api.get<ApiResponse<EarningsGroup[]>>('/api/payout/my-earnings'),
}
