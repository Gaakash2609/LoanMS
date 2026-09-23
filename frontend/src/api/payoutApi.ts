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
  // Disbursed/approved loan amount (money lent) — added to GetAll's projection
  // so the payout page can show a real "Total Disbursed" like legacy.
  disbursedAmount?: number | null
  month?: string; notes?: string
  createdAt: string; verifiedAt?: string; paidAt?: string
  // Payment details — real columns on PayoutClaim (added alongside the
  // Claim Status/Payment modal); previously these had no home and were
  // folded into `notes` as free text.
  paymentMode?: string | null
  paymentReference?: string | null
  paymentDate?: string | null
  bankAccountLast4?: string | null
  // Legacy CLAIMS-modal detail fields — now persisted + returned by GetAll
  // (PayoutController). Populated on claims submitted through the rich modal.
  userType?: string | null
  dsaMobile?: string | null
  contests?: string | null
  bankName?: string | null
  productName?: string | null
  firstName?: string | null
  lastName?: string | null
  loanNumberRef?: string | null
  apacRef?: string | null
  companyName?: string | null
  disbursementAmount?: number | null
  disbursementDate?: string | null
  city?: string | null
  businessCategory?: string | null
  confirmationRequired?: boolean
  splitCase?: boolean
  bankerEmail?: string | null
  bankerName?: string | null
  bankerMobile?: string | null
  asmEmail?: string | null
  asmName?: string | null
  asmMobile?: string | null
}

/** Payment details sent when marking a claim Paid. */
export interface ClaimPaymentDetails {
  paymentMode?: string
  paymentReference?: string
  paymentDate?: string
  bankAccountLast4?: string
}

// BUGFIX: this interface did not match any real response. PayoutRulesController.
// GetAll projects MinPayout/MaxPayout out as **MinAmount/MaxAmount**, and
// deliberately omits Notes and IsActive from the list view — so minPayout/
// maxPayout/isActive/notes were always undefined here, and (worse) an update
// built from this shape would have sent field names the model-binder ignores,
// silently nulling the rule's real min/max on the server.
export interface PayoutRule {
  id: number
  loanType: string
  percentage: number
  minAmount?: number | null
  maxAmount?: number | null
}

// Exact shape of PayoutRuleDto (LoanMS.Application/DTOs/Payout/PayoutRuleDto.cs)
// — the write side. LoanType is only read on Create; Update ignores it and
// changes percentage/min/max/notes only.
export interface PayoutRuleWriteRequest {
  loanType: string
  percentage: number
  minAmount?: number | null
  maxAmount?: number | null
  notes?: string | null
}

// GET /api/PayoutRules/calculate response (PayoutAutoCalcDto).
/** Shape of PayoutController.Suggest's response. */
export interface PayoutSuggestion {
  loanId: number
  suggestedAmount: number
  /** false when no PayoutRule exists for this loan's type. */
  ruleConfigured: boolean
  /** true for Admin only — they may adjust within the rule's band. */
  canOverride: boolean
  minPayout?: number | null
  maxPayout?: number | null
}

export interface PayoutCalcResult {
  loanId: number
  loanAmount: number
  loanType: string
  payoutRate: number
  payoutAmount: number
  formula: string
}

// Exact shape of ClaimCreateDto (LoanMS.API/Controllers/PayoutController.cs)
// — claimAmount/claimType are only honored server-side for Admin
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
  // Legacy CLAIMS-modal detail fields — persisted server-side (ClaimCreateDto).
  userType?: string
  dsaMobile?: string
  contests?: string
  bankName?: string
  productName?: string
  firstName?: string
  lastName?: string
  loanNumberRef?: string
  apacRef?: string
  companyName?: string
  disbursementAmount?: number
  disbursementDate?: string
  city?: string
  businessCategory?: string
  confirmationRequired?: boolean
  splitCase?: boolean
  bankerEmail?: string
  bankerName?: string
  bankerMobile?: string
  asmEmail?: string
  asmName?: string
  asmMobile?: string
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
  updateClaimStatus: (id: number, status: string, notes?: string, payment?: ClaimPaymentDetails) =>
    api.patch<ApiResponse<PayoutClaim>>(`/api/payout/${id}/status`, { status, notes, ...payment }),
  // Admin-only server-side (PayoutController.cs:222) — distinct from
  // deleteRule below, which targets the unrelated /api/PayoutRules resource.
  // Soft-delete: the row is flagged IsDeleted and the PayoutClaim query
  // filter then hides it from getClaims/getMyEarnings, so invalidating the
  // ['payouts'] key is enough to make the row disappear.
  deleteClaim: (id: number) =>
    api.delete<ApiResponse<boolean>>(`/api/payout/${id}`),
  // ── Payout Rules engine (PayoutRulesController) ───────────────────────
  // Whole controller is [Authorize(Roles="Admin")] — Manager has Sales-level
  // Payout rights and gets a 403 on every endpoint here (list, calculate and
  // all writes). The UI hides the Payout Rules tab for non-Admin roles.
  getRules: () =>
    api.get<ApiResponse<PayoutRule[]>>('/api/PayoutRules'),
  createRule: (data: PayoutRuleWriteRequest) =>
    api.post<ApiResponse<{ id: number }>>('/api/PayoutRules', data),
  updateRule: (id: number, data: PayoutRuleWriteRequest) =>
    api.put<ApiResponse<boolean>>(`/api/PayoutRules/${id}`, data),
  deleteRule: (id: number) =>
    api.delete<ApiResponse<boolean>>(`/api/PayoutRules/${id}`),
  // Only succeeds when no rules exist at all (server returns 400 otherwise).
  seedDefaultRules: () =>
    api.post<ApiResponse<{ count: number }>>('/api/PayoutRules/seed-defaults'),
  // Dry-run: computes what a claim would be worth without saving anything.
  calculatePayout: (loanType: string, amount: number) =>
    api.get<ApiResponse<PayoutCalcResult>>('/api/PayoutRules/calculate', {
      params: { loanType, amount },
    }),
  // Phase 11 Priority-2 — genuine, existing, working backend endpoints
  // (POST /api/payout, GET /api/payout/my-earnings) that had no frontend
  // wiring at all before this fix.
  submitClaim: (data: ClaimCreateRequest) =>
    api.post<ApiResponse<ClaimCreateResponse>>('/api/payout', data),
  getMyEarnings: () =>
    api.get<ApiResponse<EarningsGroup[]>>('/api/payout/my-earnings'),

  // GET /api/payout/suggest/{loanId} — what the server would compute for this
  // loan from the configured PayoutRule, before anything is submitted.
  // Informational only: PayoutController.Submit recalculates server-side and
  // ignores whatever amount the client sends (except an Admin
  // adjustment inside the rule's own band), so this never decides the claim.
  //
  // The rate/percentage is deliberately not part of the response — same
  // non-disclosure convention GetAll() uses.
  suggestPayout: (loanId: number) =>
    api.get<ApiResponse<PayoutSuggestion>>(`/api/payout/suggest/${loanId}`),
}
