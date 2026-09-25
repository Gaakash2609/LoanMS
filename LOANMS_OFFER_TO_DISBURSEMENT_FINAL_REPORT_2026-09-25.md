# LoanMS — Offer → Deviation → Credit Approval → Sanction → Disbursement
## Final Implementation, Test & Audit Report (2026-09-25)

Companion to `LOANMS_OFFER_TO_DISBURSEMENT_PHASE0_2026-09-25.md` (gap audit + every design decision).

### 1. What was built

**Backend (ASP.NET Core .NET 10 + EF Core + PostgreSQL)**

| Piece | File |
|---|---|
| `LoanStatus.Offer` (legacy "offer" stage restored) | `LoanMS.Domain/Enums/LoanStatus.cs` |
| Entities: `ApplicationOffer`, `ApplicationOfferRevision`, `DeviationRule`, `OfferDeviation`, `CreditApproval`, `Sanction`, `Disbursement` + status constants | `LoanMS.Domain/Entities/OfferWorkflow.cs` |
| Authoritative offer maths (reducing-balance EMI via the existing `EmiCalculator`, PF, GST, bundling, BT, stamp duty, net disbursement) | `LoanMS.Application/Services/OfferTermsCalculator.cs` |
| Lender-specific, versioned rule engine (conditions AND/OR, priority → specificity → latest effective → conflict error, fail-closed missing data, bureau-only CIBIL, authority limit, save-time overlap validation) | `LoanMS.Application/Services/DeviationRuleEngine.cs` |
| Workflow service (stage machine, offers, revisions, expiry, selection, deviation raise/decide/skip, escalation, credit approval with maker-checker, sanction + amendment/cancel/revoke, disbursement + reversal, masking, idempotency, row lock, timeline/audit/tasks/notifications, pipeline report) | `LoanMS.API/Services/OfferWorkflowService.cs` |
| API: `/api/loans/{id}/workflow/*`, `/api/deviation-rules/*`, `/api/reports/offer-pipeline` | `LoanMS.API/Controllers/OfferWorkflowController.cs` |
| Cascade hooks (reject → close deviations / invalidate approvals / cancel sanction; reopen → resume at Offer; override cannot fake chain stages; Approved→Acceptance needs sanction) | `LoanMS.Application/Interfaces/IOfferWorkflowHooks.cs`, `LoanService.cs` |
| Retired direct paths (`PATCH /approve`, `/disburse`, `/deviations`, `/deviation/raise|decide|skip` → 409 with directions); hard-coded `DeviationEvaluator` + `LoanDeviationDto` removed | `LoansController.cs`, `LoanService.cs` |
| `sanction-detail` PUT limited to the 4 authority roles, Approved/Acceptance only, 409 while a sanction is active | `LoansController.cs` |
| Customer purge refused when offer/sanction/disbursement records exist | `CustomerDeletionService.cs` |
| Offer stage counted as "in process" (dashboard/report/login workload) | `LoanRepository.cs`, `ReportsController.cs`, `LoginUserAssignmentService.cs` |
| Migration `20260925041918_AddOfferWorkflowAndStatusChecks` (7 tables, partial unique indexes, CHECK constraints incl. `CK_Loans_Status` / `CK_LoanStatusHistories_*` without NI/Cancelled, 13 PostgreSQL triggers, NI/Cancelled guard) | `LoanMS.Infrastructure/Migrations/` |
| **Completion pass (owner decisions of 2026-09-25):** bureau-report upload as the only CIBIL source (4 authority roles; PDF/PNG/JPG ≤ 10 MB, content checked by magic bytes; score 300–900; provider CIBIL/Experian/Equifax/CRIF High Mark; report date not in future; file stored via `IFileStorageService` and registered as Loan Document "Bureau Report"; previous report deactivated; every live offer re-checked) | `OfferWorkflowService.UploadBureauReportAsync`, `POST /workflow/bureau-report` |
| Lender offer validity in days (`Banks.OfferValidityDays`, 1–365, 0 clears) — pre-fills "Valid until" of new offers; explicit date wins | `BankMaster.cs`, `BanksController.cs`, `OfferWorkflowService.CreateOfferAsync` |
| Re-evaluation: rule create/version/activate/deactivate re-checks live offers **of that lender** on Offer-stage applications (each in its own locked transaction); bureau upload re-checks; manual "Re-check deviations"; result stored on the offer (`LatestEvaluationJson/At`), revision snapshot kept; version bumped **only when the outcome changes** | `ReEvaluateLoanOffersAsync`, `ReEvaluateForBankAsync`, `POST /workflow/re-evaluate` |
| Approver reassignment (inactive / unavailable approver): eligible list (active authority users with access, never the raiser), reason required, old task closed + new task, timeline + audit, e-mail to the new approver; inactive approver flagged in the UI; generic Tasks reassign of a pending deviation task refused (409) | `EligibleApproversAsync`, `ReassignDeviationAsync`, `TasksController.cs` |
| Tasks **pause** on Hold (`Tasks.PausedAt/PauseReason`; completing a paused task → 409), resume on Un-hold; Reject closes the application's open tasks; SLA automation skips OnHold | `IOfferWorkflowHooks`, `LoanService.cs`, `TasksController.cs`, `SlaAndTaskAutomationService.cs` |
| Disbursement requires a verified Bank Details Check: the **latest** check of the disbursement account must say "Okay to Process" and the account + IFSC must match | `VerifiedBankDetailsErrorAsync` |
| Migration `20260925091531_AddBureauUploadOfferValidityTaskPause` (6 additive columns) | `LoanMS.Infrastructure/Migrations/` |
| Idempotent SQL script covering **both** migrations (replaces the earlier single-migration script) | `deploy/migrations/20260925_OfferWorkflow_Complete.idempotent.sql` |

**Frontend (React + TypeScript + Vite)**

| Piece | File |
|---|---|
| New **Offers** detail tab (after Lender Details; `canTabOffers`) — offers, revisions, deviation check, deviation requests, credit approval, sanction, disbursement; every button driven by server `capabilities`, every figure from the API | `components/shared/OffersTab.tsx`, `pages/LoanDetailPage.tsx` |
| API client with Idempotency-Key per user action | `api/offerWorkflowApi.ts` |
| Deviation Rules manager (versions, activate/deactivate with reason, dry run) on Policy & Product (Admin + Product & Risk Officer) | `components/shared/DeviationRulesCard.tsx`, `pages/PolicyProductPage.tsx` |
| "Offers, Sanction & Disbursement" report with filters + CSV export | `components/shared/OfferPipelineReport.tsx`, `pages/ReportsPage.tsx` |
| Timeline action bar: Approve/Deviation/Skip/Approved-Deviation/Disburse removed (they called retired endpoints) → single "Offers & Approval" link; Deal Confirmation only with an active sanction | `components/shared/LoanVerificationChecks.tsx` |
| Sanction Details card edit gate = backend rule | `components/shared/SanctionDetailCard.tsx` |
| Completion pass: Bureau report card + upload dialog, "Re-check deviations", "re-checked …" stamp, Reassign-approver dialog + inactive-approver warning, lender-validity pre-fill of "Valid until"; offer/deviation button logic extracted to pure functions | `OffersTab.tsx`, `components/shared/offerActions.ts` |
| Edit Bank dialog: "Offer validity (days)" + server error text | `components/shared/AssignedBanksSection.tsx`, `api/banksApi.ts` |
| Tasks page + loan Tasks tab: "⏸ Paused — reason" badge, complete disabled while paused; Reject/Hold/Un-hold/Re-open refresh tasks + offers immediately | `pages/TasksPage.tsx`, `pages/LoanDetailPage.tsx`, `api/tasksApi.ts` |
| `Offer` status label/colour/pipeline bar/filters/LEW visibility; `canTabOffers`; defaults: `canDeviation` on for Credit Evaluation Officer/Manager, `canDisburse` off for BDM/DSM; role descriptions updated; backend defaults JSON regenerated | `types`, `utils/format.ts`, `dashboardData.ts`, `constants/permissions.ts`, `RolePermissionDefaults.json` |

Legacy Vanilla files (`wwwroot/js/*`, `index.html`, `api-bridge.js`) were **not modified**.

### 2. Tests — exact counts (run in this session)

| Suite | Result |
|---|---|
| Backend `dotnet test` (whole solution suite) | **838 / 838 passed**, 0 failed (baseline 566/566; tests of the removed hard-coded evaluator / loan-level deviation path were removed or rewritten for the new flow) |
| — of which Offer workflow (engine, calculator, relational integration, completion pass, role matrix, timeline guard) | **278 / 278** |
| — of which 11-role × 18-action matrix | **198 cases + 1 structural = 199 / 199** |
| — of which completion pass (bureau upload, validity, re-evaluation scope + version, reassignment, task pause/close) | **8 / 8** |
| Frontend `vitest` | **334 / 334 passed** (31 files; incl. the frontend role × button matrix `offer-actions.test.ts`) |
| Frontend `tsc -b` | 0 errors |
| Frontend ESLint | 0 errors; 19 warnings — all pre-existing in untouched files (baseline was already failing `--max-warnings 0` with the same 19); new/changed files: 0 warnings |
| `vite build` | OK (bundle written to `LoanMS.API/wwwroot/react`) |
| `dotnet build LoanMS.slnx` | 0 errors |
| **Real PostgreSQL 18.6 E2E** (`verification/offer_workflow_pg_e2e.py`) | **107 / 107 passed** — see `verification/offer_workflow_pg_e2e_RESULT_2026-09-25.txt` |
| Idempotent migration script on PostgreSQL | applied on a fresh DB at the previous migration → OK; applied again → no-op; re-applied on the fully migrated E2E DB → no-op; 13 triggers present |
| `dotnet ef migrations has-pending-model-changes` | none |

Integration tests run on a **relational** SQLite in-memory DB (partial unique indexes, CHECK constraints, transactions and the concurrency token really execute); PostgreSQL-only guards (triggers, row lock, retrying execution strategy) are proven by the PostgreSQL E2E.

### 3. Role × action matrix (enforced by the backend; automated in `RoleActionMatrixTests`)

A = allowed, F = refused (403, or 404 where the role cannot see the application at that stage).

| Action | Chief Admin | BDM | DSM | CEO | CEM | Zonal Mgr | BDE | Mass CP | Channel P | Payout & Recon | Product & Risk |
|---|---|---|---|---|---|---|---|---|---|---|---|
| View application / offers | A | A | A | A | A | A | A | A* | A* | F¹ | F² |
| Create / revise offer | A | A | A | A | A | A | F | F | F | F | F |
| Select / confirm final offer | A | A | A | A | A | A | A | A | A | F¹ | F² |
| Raise deviation | A | A | A | A | A | A | F | F | F | F | F |
| Approve / reject / skip deviation | A | F | F | A | A | A | F | F | F | F | F |
| Credit approval | A | F | F | A | A | A | F | F | F | F | F |
| Edit approved terms | A | F | F | A | A | A | F | F | F | F | F |
| Generate / cancel sanction | A | F | F | A | A | A | F | F | F | F | F |
| Disburse / reverse | A | F | F | A | A | A | F | F | F | F | F |
| Deviation rule management | A | F | F | F | F | F | F | F | F | F | A |
| Offer pipeline report | A | A | A | A | A | A | F | F | F | F | F |
| Upload bureau report | A | F | F | A | A | A | F | F | F | F | F |
| Reassign deviation approver | A | F | F | A | A | A | F | F | F | F | F |
| Re-check deviations | A | A | A | A | A | A | F | F | F | F | F |

\* masked: no Base ROI, margin, deviation reasons/flags, approval comments. ¹ Payout & Reconciliation Officer's existing scope is Approved/Disbursed applications only (view there; never write). ² Product & Risk Officer has no application scope (existing rule). On top of the role gate: self-approval of a deviation is refused for everyone (Admin included); the creator of the current offer terms cannot credit-approve them (maker-checker).

### 4. Section 25 scenarios covered (automated)

Multi-lender offers; 4th active blocked (service + DB trigger); duplicate lender blocked (service + unique index); withdrawn history does not block; ineligible/inactive/other-product lender refused; backend maths + persistence + reload; invalid terms / negative net disbursement; revision history + re-evaluation + stale version 409; selection by any user with access; concurrent selection (stale version + DB unique Final + real PG parallel requests); deviation required blocks approval; raise → Decision; idempotent raise; escalation away from an approver-raiser; no alternate → Escalated; self-approval (incl. Admin) 403; non-authority decide 403; deviation approve ≠ credit approval; rejected deviation cannot be re-raised on same terms, new revision → new request; Skip vs Not Required; missing bureau CIBIL fail-closed (declared score ignored); rule change after revision re-evaluated at approval; expired offer invalid; revision mismatch 409; declined terms need a revision; maker-checker; sanction 4 roles, one active (service + unique index + PG), immutable (PG trigger), idempotent; edit approved terms before sanction → back to Offer; amendment → re-approval → sanction v2 linked; disbursement gates (sanction, NACH/agreement, amount ≤ net, IFSC/UTR/mode), idempotent, single, masked account, reversal keeps original; reject cascade; reopen → Offer; hold freezes all actions; back to underwriting clears selection; generic route/override cannot bypass; IDOR 404/403; partner masking; timeline/history/audit rows; rule versioning immutable + dry run writes nothing; NI/Cancelled rejected by DB CHECK.
Completion pass: bureau upload (role gate, score / provider / date / file-content validation, previous report deactivated, file stored, re-check turns a missing-CIBIL "Required" into "NotRequired" and a low score into a breach); lender validity pre-fill + explicit date wins + > 365 refused; rule change re-checks only that lender's live offers (and writes no timeline row when the outcome is unchanged); re-check does not bump the version unless the outcome changes; approver reassignment (raiser / non-authority refused, reason required, task moved, reassigned approver decides); inactive approver flagged; generic task reassign of a pending deviation task refused; hold pauses tasks, completing a paused task refused, un-hold resumes, reject closes tasks; disbursement refused until the Bank Details Check is "Okay to Process" and refused for an account other than the verified one.

### 5. Final report

**Done**
- NI / Cancelled: confirmed absent from React, API, DTOs, reports, seeds and migrations (only in the unused legacy shell, left untouched); stale comments cleaned; DB CHECK constraints now make them impossible; migration refuses to run if any such row exists (DB verified empty of them).
- Offer stage + full state machine (entry, back, hold, reject cascade, reopen revalidation, terminal lock) — backend-authoritative.
- Offers (max 3 active, one per lender, eligible lenders only, immutable revisions, expiry, final selection with row lock + concurrency token).
- Configurable lender-specific deviation rule engine (auto: ROI/FOIR/Loan Amount/Tenure/CIBIL; manual: all 9 categories), versioning, simulation, snapshots on every request.
- Deviation raise/approve/reject/skip with segregation of duties and escalation; credit approval separate, maker-checker, term change = new revision.
- Immutable sanction (unique number `SAN-<LoanNo>-<vv>`, one active, amendment/cancel/revoke), disbursement + reversal (append-only).
- RBAC (4 authority roles, masking, IDOR 404/403), idempotency keys, Timeline/Status history/Audit/Tasks/Notifications, pipeline report + CSV.
- Offers tab, rules manager, report UI; build/test gates green; real PostgreSQL E2E green.

**Browser walk-through (user's Chrome, logged in by the user, API on real PostgreSQL)**
Verified live: Applications list + new "Offer" filter chip; Offers tab (cards, backend figures, rule check, offer history);
Add offer dialog (eligible-lender list excludes live lenders); 3-offer limit message; Change final offer (unselect) +
Select as final; Raise deviation (type auto-filled from the breach, routed away from the raiser, "you raised this"
notice); deviation decided by a different user → back to Offer; Credit approval dialog + maker-checker refusal shown;
credit approval by a different user; Generate sanction; Sanction Details card locked; Timeline rows; Deviation Rules
(list, version history, new rule, dry run within/breach); Offers, Sanction & Disbursement report + filters.
Bugs found in the walk-through and fixed (with regression tests, re-verified live and on PostgreSQL):
1. NotSelected offers were not counted in the 3-offer / one-per-lender limits (offers added after a final selection
   went to "history" and could exceed the limit) — they are now part of the live set (service, unique index, trigger, UI).
2. Workflow Timeline rows could be edited/deleted/fabricated through the generic tracking API — now refused server-side
   (409) and shown with a lock in the UI.
3. Header "Lender" / Overview "Bank/NBFC" showed the first bank line instead of the final/sanctioned lender.
4. Applications page had no "Offer" filter chip; bulk status offered Approved/Disbursed (now workflow-only).
5. Rule-check wording ("12 within allowed 10" for a minimum), EMI shown rounded (now to the paisa), empty stage card
   after credit approval, raw dry-run field labels.

**Completion pass — browser walk-through (same Chrome session, API on real PostgreSQL)**
Verified live: Bureau report card; "Re-check deviations" (success toast); bureau upload dialog (file + Experian + 720)
→ card updated, IDFC offer re-checked to "Required — CIBIL 720 is below the minimum of 750"; raise deviation →
"you raised this" notice + "Reassign approver"; reassign dialog lists only eligible approvers (raiser and current
approver excluded) → reassigned; Add-offer "Valid until" pre-filled +30 days with "Lender default: 30 days", cleared
with a hint for a lender without a default; Put on Hold → task "⏸ Paused — Application on hold: …", checkbox
disabled; Un-hold → task active again; Edit Bank dialog shows "Offer validity (days)".
Bugs found and fixed in this pass: (6) re-check bumped every offer's version even when nothing changed → spurious
"changed by someone else" for a user on a still-valid screen (now only on an outcome change; unit + PG test);
(7) rule-change re-check re-evaluated every lender's offers on the application, not only that lender's;
(8) Hold / Un-hold / Reject / Re-open did not refresh the Tasks and Offers tabs until a reload;
(9) disbursement accepted an earlier "Okay" bank check even if a later check of the same account said otherwise.

**Owner decisions (2026-09-25) — all implemented**
1. CIBIL → **bureau report upload** (the only CIBIL source; declared/estimated scores never used).
2. EMI → **to the paisa (2 decimals)**, reducing balance, stored and shown as stored.
3. Missing data / no rule for the lender-product → **manual review** (fail-closed).
4. Offer validity → **days configured per lender**, pre-filled on new offers, editable per offer.

**Incomplete / not done — stated plainly**
- Not clicked in the browser: the disbursement form (needs a beneficiary **bank account number**, which I may not
  type — enter it yourself; covered by the PostgreSQL E2E incl. the bank-check gate), CSV export (downloads a file),
  and views that need other logins (Channel Partner masking, Payout Officer) — covered by the automated role matrices.
- Tranche disbursement not implemented (legacy + backend have a single Disburse action; the schema allows more rows).
- Not invented (no existing policy): role-wise approval amount/ROI limits (only a rule-level "max approvable breach"),
  maker-checker on rule changes (every change is a new version + audit row).
- **Production database migration has NOT been run** — `deploy/migrations/20260925_OfferWorkflow_Complete.idempotent.sql`
  must be applied by you (or the API applies both migrations on start-up). The first migration refuses to run if any
  application / status-history row still holds NI or Cancelled.
- ESLint: 19 warnings remain, all pre-existing `no-non-null-assertion` in 13 files outside this feature (left
  untouched by the scope rule); every file changed here lints clean.

**Tests:** backend 838/838, frontend 334/334, PostgreSQL E2E 107/107.
**Build:** `dotnet build LoanMS.slnx` 0 errors / 0 warnings; `tsc` 0 errors; `vite build` OK; ESLint 0 errors.
**PostgreSQL:** real PostgreSQL 18.6 (WSL) — both migrations applied by the API, 13 triggers + CHECK constraints live, E2E 107/107, idempotent SQL verified fresh + re-run.
**RBAC:** 4 authority roles enforced server-side; backend 11×18 matrix (199/199) + frontend button matrix; masking + IDOR verified.
**Migrations:** `20260925041918_AddOfferWorkflowAndStatusChecks`, `20260925091531_AddBureauUploadOfferValidityTaskPause`.
**api-bridge.js:** not extended (legacy shell unused); its approve/disburse calls now get an explicit 409.
