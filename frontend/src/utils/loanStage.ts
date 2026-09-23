import type { Loan } from '@/types'

// ── Overview: Approval / Sanction Details visibility ───────────────────────
// Vanilla source of truth: renderDetailApproval (efin-app.js:7332) hides the
// whole "Approval Details" section unless sanction data exists, and that data
// is only ever written by the "Approve with Details" step
// (confirmLenderApproval → laSaveSanctionToApp, efin-app.js:31965) — i.e. the
// section exists only for a loan that has actually reached the Approved /
// Sanction stage. The Overview meta grid ("Loan Details") is NOT stage-gated
// in Vanilla; only this section is.
//
// React: no client-side guess or generated data. The stage comes from what the
// backend persisted on the loan:
//   • approvedAt  — stamped by the API when the loan is approved
//                   (LoanService: Approved / Acceptance / Disbursed paths) and
//                   never cleared, so a loan approved and later Rejected /
//                   OnHold still shows its (now read-only) sanction record,
//                   exactly like Vanilla where the sanction fields persist.
//   • status      — Approved and every later pipeline stage, as a fallback for
//                   rows whose approvedAt predates that stamp.
// Draft / Submitted / UnderReview / Decision / OnHold-or-Rejected-before-
// approval loans have not reached the stage → the section is not rendered.
const SANCTION_STAGE_STATUSES: ReadonlyArray<Loan['status']> = [
  'Approved', 'Acceptance', 'Disbursed', 'Closed',
]

export function hasReachedSanctionStage(
  loan: Pick<Loan, 'status' | 'approvedAt'>,
): boolean {
  return !!loan.approvedAt || SANCTION_STAGE_STATUSES.includes(loan.status)
}
