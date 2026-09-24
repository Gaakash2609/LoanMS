import api from './axios'
import type { ApiResponse } from '@/types'

// ── Assignment Audit Trail ──────────────────────────────────────────────
// GET/POST /api/assignment-audit (AssignmentAuditController) records who a
// loan application was assigned to, how that decision was reached, and what
// it was before. It is insert-only by design — the controller deliberately
// exposes no PUT or DELETE, so history can be read but never edited or
// erased.
//
// Legacy writes entries from two places (auto-assignment in
// commitAssignmentDecision, manual reassignment in updateLoginUser) and syncs
// the list back on login, but never renders it anywhere. This client reads
// it; see the note on createEntry below for why nothing here writes yet.

export interface AssignmentAuditLog {
  id: number
  /** Numeric backend loan id, when the entry was raised against a synced loan. */
  loanApplicationId?: number | null
  /** The application id as shown to users, e.g. "EFIN000123". */
  loanFrontendId: string
  location?: string | null
  loanType?: string | null
  salesPerson?: string | null
  salesTeam?: string | null
  assignedToUserId?: number | null
  assignedToUserName?: string | null
  assignedByUserId?: number | null
  /** "System (Auto)" for automatic decisions, otherwise the acting user. */
  assignedByName?: string | null
  /** 'auto' | 'manual' | 'unassigned' — legacy's three methods. */
  method: string
  /** True when the automatic pick came down to a tie-break. */
  tieBreak?: boolean | null
  previousUserName?: string | null
  reason?: string | null
  /** Serialized candidate list the auto-assigner considered. */
  candidatesJson?: string | null
  assignedAt: string
  createdAt?: string | null
}

export interface AssignmentAuditQuery {
  /** Accepts either the numeric loan id or the frontend application id. */
  loanId?: string
  /** Server clamps this to 1–1000; its own default is 200. */
  take?: number
}

export const assignmentAuditApi = {
  // Ordered newest-first by AssignedAt server-side.
  getAll: (params?: AssignmentAuditQuery) =>
    api.get<ApiResponse<AssignmentAuditLog[]>>('/api/assignment-audit', { params }),
}

/** Parses CandidatesJson defensively — a malformed blob must not break the row. */
export function parseCandidates(json?: string | null): string[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.map(c =>
      typeof c === 'string' ? c : (c?.name ?? c?.userName ?? JSON.stringify(c)),
    )
  } catch {
    return []
  }
}
