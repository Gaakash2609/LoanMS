import api from './axios'
import type { ApiResponse } from '@/types'

// ── Unified Action Queue ────────────────────────────────────────────────
// GET /api/dashboard/action-queue (DashboardController.GetActionQueue) has
// existed since the productivity audit with no React caller at all — the
// legacy dashboard renders it via renderActionQueue() (efin-app.js:15665).
//
// The endpoint does its own role scoping: it derives the caller's visible
// loan set through ILoanService.GetAllAsync → ApplyVisibilityScope, the same
// path every other loan read uses, so there is no second visibility rule to
// mirror on the client. Payout claims are additionally narrowed to the
// caller's own pending claims server-side.

export interface ActionQueueSlaBreach {
  loanId: number
  loanNumber: string
  status: string
  daysOverdue: number
}

export interface ActionQueueStaleDraft {
  loanId: number
  label: string
  daysSinceUpdate: number
}

export interface ActionQueueMissingDocs {
  loanId: number
  loanNumber: string
  missingTypes: string[]
}

export interface ActionQueuePendingClaim {
  claimId: number
  /** Server field name is `loanApac` — it carries the loan number. */
  loanApac: string
  claimAmount: number
  submittedDaysAgo: number
}

export interface ActionQueue {
  slaBreached: ActionQueueSlaBreach[]
  staleDrafts: ActionQueueStaleDraft[]
  missingDocuments: ActionQueueMissingDocs[]
  pendingPayoutClaims: ActionQueuePendingClaim[]
  totalActionItems: number
}

export const dashboardApi = {
  getActionQueue: () =>
    api.get<ApiResponse<ActionQueue>>('/api/dashboard/action-queue'),
}
