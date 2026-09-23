# Overview — stage-based section visibility (Vanilla ↔ React) — 2026-09-21

## Audit (Vanilla = source of truth)
- `detail-overview-grid` (efin-app.js:2480) — the Overview meta grid is rendered for every stage. Not gated.
- `renderDetailApproval` (efin-app.js:7332) — `hasSanction = sanctionLoanAmt || sanctionEMI || sanctionROI`; if false the whole
  "Approval Details" section is hidden (`display:none`). That data is written ONLY by `confirmLenderApproval → laSaveSanctionToApp`
  (efin-app.js:31965, the "Approve with Details" step, which then sets status = approved). So the section exists only once the loan
  reached the Approved/Sanction stage.
- React BEFORE: `<SanctionDetailCard/>` was mounted unconditionally on every loan. At Draft/Submitted/UnderReview it showed an editor
  pre-filled from `requestedAmount` (generated data) and its debounced auto-save could create a sanction row at the initial stage.

## Changes
- `frontend/src/utils/loanStage.ts` (new) — `hasReachedSanctionStage(loan)`: `approvedAt` (backend-stamped, never cleared) OR status in
  Approved/Acceptance/Disbursed/Closed. No client-side guessing.
- `LoanDetailPage.tsx` — Overview renders `SanctionDetailCard` only when `hasReachedSanctionStage(loan)`. Loan Details card unchanged (always shown, as Vanilla).
- `SanctionDetailCard.tsx` — removed the `requestedAmount` fallback seed (seeds from persisted sanction row / approvedAmount only).
- `LoansController.UpdateSanctionDetail` — server-side stage guard (400 unless ApprovedAt set, or status UnderReview/Decision), so the
  frontend is not the only authority. UnderReview is allowed because the Approve-with-Details modal PUTs the terms just before /approve.
- No DB/migration change, no new endpoint, no route change. Approve flow, permissions/lock logic, Loan Details untouched.

## Verification
- tsc clean · vitest 301/301 (10 new for the stage rule) · eslint clean on touched files · vite build ok (gate confirmed in built bundle).
- NOT verified in this environment: `dotnet build` and the controller guard (no .NET SDK), and browser / real-PostgreSQL E2E (no PG, no running API).
  Must be run locally: Draft loan → no Approval section + PUT /sanction-detail = 400; Approve with Details → section appears, refresh keeps it;
  Rejected-before-approval → hidden; Approved→Rejected → visible read-only.
