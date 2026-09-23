# Overview cleanup — Vanilla workflow parity (React) — 2026-09-21 (follow-up to OVERVIEW_STAGE_VISIBILITY)

## Audit (Vanilla = source of truth)
- Overview tab = meta grid (Loan Details) always shown + "Approval Details" only once sanction data exists (Approved/Sanction stage).
  Other Info (Team & Assignment) and Bank Eligibility are explicitly hidden from Overview ("visible in Reports > Other Info / Bank Eligibility",
  efin-app.js:2510-2525); Vanilla Reports sub-tabs = CIBIL / Perfios / Bank Eligibility / Other Info / Offer.
- Vanilla has NO Overview side rail. Hold / Un-hold / Reject / Re-open live in the loan HEADER action bar (buildDetailActionBar, efin-app.js:38921)
  under "⋯ More"; workflow moves (Underwriting / Approve with Details / Disburse / Deviation / checks) live in Timeline → Actions.
- Audit finding: Timeline → Actions (LoanVerificationChecks) does NOT contain Reject / Hold / Un-hold / Re-open, and those endpoints had exactly one
  frontend caller (the Overview "Actions" card). Deleting the card outright would have removed those features → they were RELOCATED to the header, not deleted.

## Removed from Overview (all had a single use-site — LoanDetailPage)
- Actions card (comment box, Approved-Amount input, Submit / Review / Approve / Reject / Disburse / Close buttons, Hold, Un-hold) — Approve/Disburse/Underwriting
  are already in Timeline → Actions; Submit/Review/Close had no Vanilla or Timeline counterpart (Vanilla wip drafts continue in the wizard: LoansPage "Continue").
- Admin Stage Override card (React-only), Re-open card (moved, see below), AI Insight panel (React-only), Case Info card (Created By = Loan Details "Sales Person";
  Assigned To = Team & Assignment), Customer card (every field already in Personal / Employment tabs).
- Dead code removed (compiler/eslint-verified unused): TRANSITIONS/STATUS_MAP/ACTION_PERM, disburse-prereq tracking query, override/reopen/comment/approvedAmount state,
  maskPan/maskPersonal, unused icons/types, `features/ai/AIInsightPanel.tsx`, `aiApi.loanInsight`, `loansApi.submit`, `loansApi.overrideStatus` (+ stale comments).
  Backend endpoints (/submit, /override-status, /ai/.../insight) are untouched.

## Relocated (existing components, no duplicates)
- Reject / Hold / Un-hold / Re-open → loan header bar (Un-hold, Re-open buttons + "⋯ More" menu: Put on Hold, Reject) with one shared reason modal calling the SAME
  endpoints (/reject, /hold, /unhold, /reopen) and the SAME gates (role list, canRejectApp/canHoldApp, stage lists, Admin-only + 45-day Re-open, Hold reason required).
- LoanAssignmentCard (Team & Assignment) → Reports → "Other Info" sub-tab. IncomeVerificationPanel → Reports → Perfios Report (still canViewBanks-gated).
- Overview is now: Loan Details → Sanction/Approval Details (stage-gated, previous pass). Single full-width column.

## Untouched (verified by diff vs previous ZIP)
LoanVerificationChecks (comment only), TrackingPage, SanctionDetailCard, LoanAssignmentCard, IncomeVerificationPanel, all backend, DB, routes.

## Verification
- tsc clean · eslint: 0 errors, 0 warnings in touched files (19 pre-existing warnings elsewhere) · vitest 301/301 · vite build ok; built bundles contain no
  "Admin Stage Override / AI Insight / Case Info" strings.
- Temporary jsdom render harness (12 tests, then deleted so package.json/lock are unchanged): Draft shows Loan Details, no Sanction card, none of the removed sections;
  UnderReview/Submitted/pre-approval Rejected hide Sanction; Approved and Approved→Rejected show it; Reject/Hold(reason required)/Un-hold/Re-open call the correct
  endpoint with the loan id; Sales role sees no header actions; non-admin sees no Re-open; Reports → Other Info shows Team & Assignment, Perfios shows income panel;
  Timeline tab still renders Timeline Actions.
- NOT verified here: `dotnet build` / backend guard from the previous pass, real browser + PostgreSQL E2E (no .NET SDK / PG in this environment).
- Not in scope / still missing vs Vanilla Reports: Bank Eligibility and Offer sub-tabs.
