# UI changes — 2026-09-26

## 1. Mobile number hidden on Applications list (security / PII)
- `frontend/src/pages/LoansPage.tsx`: applicant cell no longer renders `loan.customerPhone`;
  avatar initials no longer fall back to the phone number (shows `?` if no name).
- Mobile is still visible on the loan detail page.
- NOTE: the `/loans` list API (`LoanListDto.CustomerPhone`) still returns the number
  (visible in browser DevTools). Export's "Mobile" column depends on it.

## 2. Application ID style — "soft round pill"
- `frontend/src/styles/globals.css`: `.apps-page .efin-mono-id` → full-round pill,
  light brand-blue background (#e8f1f9), no border, bold monospace dark-blue text.
- Scoped to the Applications page only; other screens keep the old chip.

## Build / verification
- `LoanMS.API/wwwroot/react` rebuilt with `npm run build` (tsc clean).
- `vitest`: 31 files, 334/334 tests passed.
- No backend or database changes.

## 3. Loan Detail → Documents tab redesign ("modern cards")
- `frontend/src/components/shared/LoanDocumentsCard.tsx` + new `.ldoc-*` styles in `globals.css`.
- Upload controls (document type + Upload button) moved into the card header.
- Each card: status colour strip (orange Pending / green Verified / red Rejected),
  file-type tile, document TYPE as title ("Bank Statement") with the file name below,
  meta strip (size · uploaded at), rejection reason box, Co-Applicant / version tags.
- Actions: Download + Verify buttons; Reject / Replace / Delete moved to a "⋯" menu.
  Same API calls and same permission gating as before.
- Header subtitle shows counts: uploaded · verified · pending · rejected.
- Fix: file-type badge showed "88 KB" / "45 KB (1)" for names like "269.88 Kb";
  `fileVisual()` now only accepts a real extension, otherwise shows "FILE".
- New empty state when no documents are uploaded.
- Rebuilt `LoanMS.API/wwwroot/react`; tsc clean; vitest 334/334 passed.

## 4. Deviation — Approve option missing for the approver (bug fix)
Root cause (backend, `LoanMS.API/Services/OfferWorkflowService.cs`):
- Offer expiry compared the stored valid-until DATE (midnight) with the current
  TIME, so an offer expired at 00:00 of its last valid day, and one entered as
  "valid until today" expired as soon as it was read. Expiry closes any pending
  deviation request — but the application stayed at **Decision**. With no open
  request at Decision, nobody got Approve/Reject and nothing could move it.
Fix:
- Expiry now uses `ValidUntil < today (date)` → an offer is valid for the whole
  valid-until day.
- New `ReconcileDecisionStageAsync` (run on every workflow read): an application
  at Decision with no open deviation request is returned to Offer (status history,
  timeline "EFIN-Deviation Closed" and audit written), and an offer stuck with
  DeviationStatus "Raised" is reset to "Required" so it can be raised again.
  This also repairs applications that are already stuck.
- Tests added: `OfferValidUntilToday_StaysValidForTheWholeDay`,
  `FinalOfferExpiresWhileDeviationPending_ApplicationReturnsToOffer_NotStuckAtDecision`.
  (Backend tests were not run in the build environment — no .NET SDK; please run
  `dotnet test` before deploying.)
UI (`frontend/src/components/shared/OffersTab.tsx`):
- Pending deviation now shows direct **Approve** (green) and **Reject** (red)
  buttons instead of a single "Decide deviation" button.
- If the viewer cannot act, the card says why (on hold / wrong stage / role not
  allowed / raised by you + who must decide).
- Frontend: tsc clean, vitest 334/334 passed, bundle rebuilt.

## 5. Lender Details → Bank Details ("Loan Source") — ported 1:1 from Vanilla
Source of truth: `LoanMS.API/wwwroot/index.html` #lender-panel-banks and
`wwwroot/js/efin-app.js` renderBankBody / bankDetailsSetEditMode / bankDetailsSave /
addBankLine / removeBankLine / generateTempAppNo / _renderDisburseChecklist.
- New `frontend/src/components/shared/BankDetailsPanel.tsx` replaces the old
  `BankLinesCard` in `LoanDetailPage.tsx`; `.bankd-*` styles in `globals.css`.
- Sub-tab label back to Vanilla's **"Bank Details"** (React had renamed it "Loan Source").
- Toolbar (View mode / "Edit mode — changes not yet saved", ✏ Edit / 💾 Save / ✕ Cancel)
  shown only to roles that can edit (canChangeStatus / Admin / LoginTeam, intersected
  with the API's role list + canAddBank). Cancel restores the snapshot.
- Edit mode: Bank = dropdown of configured banks; Temporary Application Number is
  read-only and auto-generated (APP-XXXXXXXX) for new lines; Application Number input;
  Approved Loan numeric; Remarks = Vanilla's fixed status dropdown (18 options);
  ✕ remove only while >1 line ("At least one bank line required"); "＋ Add Bank Line".
- No lines → one default line (APP-<loan no>, IN PROCESS), as in Vanilla.
- Partner never sees the Application Number column; no canViewBanks → restricted row.
- Disbursement Pre-Conditions now inside the panel with Vanilla's look and working
  "▶ Mark NACH Done / ▶ Record Agreement / ▶ Complete Doc Check" buttons
  (same tracking + flag modals as the Timeline actions), "✓ Done", "N Pending" / "✓ All Clear".
- Not ported: Vanilla's auto-advance WIP→Assign Lender on entering an application
  number (React never opens Draft applications in the detail page).
- `SimpleActionModal` in LoanVerificationChecks.tsx is now exported for reuse.
- tsc clean, vitest 334/334, bundle rebuilt.
