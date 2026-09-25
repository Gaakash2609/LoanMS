# LoanMS — Offer → Deviation → Credit Approval → Sanction → Disbursement
## Phase 0 Gap Audit & Design Decisions (2026-09-25)

Source inspected: `LoanMS.zip` (2026-09-24 20:40) — React (`frontend/src`), ASP.NET Core .NET 10 API
(`LoanMS.API`, `LoanMS.Application`, `LoanMS.Infrastructure`, `LoanMS.Domain`), EF migrations, legacy
`wwwroot/js/efin-app.js` + `api-bridge.js`.

Baseline before any change (run in this session): backend `dotnet test` **566/566 passed**;
frontend `npm ci → tsc -b → vitest` **315/315 passed**.

---

### 1. What existed (as found)

| Area | Found | Gap |
|---|---|---|
| Application stages (`LoanStatus`) | Draft, Submitted, UnderReview, Approved, Rejected, Disbursed, Closed, OnHold, Decision, Acceptance (string-persisted, `text` column, no CHECK) | No `Offer` stage although legacy has it (`STATUSES.offer`, `'EFIN-Final Offer Check' → 'offer'`, every product workflow `wip→login→underwriting→offer→approved→acceptance→disbursed`). |
| NI / Cancelled | **Not present** in backend enum, React types, DTOs, API, reports, seeds, migrations. Only in legacy `efin-app.js`/`ai-agent.js`/`efin-improvements.js` (unused legacy shell) and 3 comments. | DB had no CHECK constraint, so a raw `'NI'`/`'Cancelled'` status could still be written. |
| Offers | `LoanOffer` entity = **InCred API offer mirror** (PREAPPROVED/BANKING), not application lender offers. `LoanBankLine` = per-bank processing lines (Lender Details tab). | No application-level multi-lender offer entity, no revision history, no final selection. |
| Deviation | `DeviationEvaluator` = **hard-coded global thresholds** (verbatim port of legacy `laCheckDeviations`: CIBIL-band ROI, FOIR caps by loan type, 24x/36x/72x income, tenure caps, CIBIL<650). Raise/Decide/Skip move the **whole loan** UnderReview→Decision→Approved/Rejected, type/reason only in a history comment, Admin exempt from self-approval, decide-reject **rejects the application**. | Violates "no global hard-coded rule", no lender specificity, no rule versioning/snapshot, no idempotency, Admin self-approval allowed, deviation approval == credit approval (legacy conflated them). |
| Credit approval | `PATCH /approve` (UnderReview→Approved, roles Admin/Manager/LoginTeam/TeamLeader/LocationHead/OperationManager) + editable `LoanSanctionDetail` (CAM panel; PUT allowed even for Sales/Partner/Dsa). | Not separate from deviation, no offer/revision reference, no immutable record, wrong role set vs. the new 4-role rule. |
| Sanction | `LoanSanctionDetail` — one mutable row per loan, freely editable. | No immutable sanction, no sanction number, no one-active constraint, no cancel/revoke. |
| Disbursement | `PATCH /disburse` flips status (gates: NACH + Customer Agreement, verified InCred callback). | No disbursement record (amount/date/account/UTR/mode), no reversal, 6 roles instead of 4. |
| CIBIL | `Customer.CibilScore` = operator-entered in wizard. `BureauReport` tables exist, but **nothing in the codebase writes a BureauReport** (no upload/pull endpoint). `CibilController` returns a PAN-derived **estimate** flagged `isEstimated`, never persisted. `ObligationFoirEngine` defaults CIBIL to 700 when missing (suggestion heuristic only). | **No verified bureau source exists.** |
| Locking helper | Final-stage lock: backend `LoanService._holdableStates` / `GetAllowedTransitions`; React `FINAL_LOCK_STATUSES = Disbursed/Rejected/Closed/OnHold` (LoanVerificationChecks, LoanDetailPage `locked`). | Reused (see §4). |
| Permissions | `RolePermissionService` (fail-closed defaults generated from `frontend/src/constants/permissions.ts`). | Needs `canTabOffers`. |
| Role titles | Admin=Chief Administrator, Manager=Business Development Manager, TeamLeader=Deputy Sales Manager, LoginTeam=Credit Evaluation Officer, OperationManager=Credit Evaluation Manager, LocationHead=Zonal Manager, Sales=Business Development Executive, Dsa=Mass Channel Partner, Partner=Channel Partner, Accounts=Payout & Reconciliation Officer, ProductTeam=Product & Risk Officer. | **The 4 authority roles = `Admin, LocationHead, OperationManager, LoginTeam`.** |

### 2. CIBIL — Open / Gap / **Blocker**

* **Gap:** the system does not pull CIBIL; no code path creates a `BureauReport`.
* `Customer.CibilScore` is **declared (operator-entered)**, not bureau-verified. The estimated score from
  `CibilController` is a local heuristic — never treated as bureau data.
* **Decision (implemented):** the deviation engine reads CIBIL **only** from an active `BureauReport`.
  Declared/estimated scores are shown in the snapshot as `declared`, but never used to pass a CIBIL rule.
  With no bureau report, a CIBIL rule evaluates to **MissingData → Manual Review required** (fail-closed).
* ~~**Blocker for business:** until a real bureau integration or a controlled bureau-report upload exists,
  every offer under a lender that has a CIBIL rule will require a manual deviation decision (or an audited Skip).~~
* **Resolved 2026-09-25 (owner decision: "Bureau report upload"):** the 4 credit authority roles upload the bureau
  report file (PDF/PNG/JPG ≤ 10 MB, content-checked) with provider, score (300–900) and report date. It becomes the
  active `BureauReport` (previous one deactivated, uploader recorded), the file is stored as Loan Document
  "Bureau Report", and every live offer of the application is re-checked. Still no automatic bureau pull.

### 3. Missing-data behaviour — Open Decision, safe default implemented

Existing code/legacy do not define it (legacy used `|| 0` defaults, which silently passes/fails).
**Implemented safe default (fail-closed):** when a configured rule needs a value that is missing
(CIBIL without bureau report, income unavailable for FOIR/amount-multiple, etc.) the offer's deviation
status becomes **Required (Manual Review)**. Credit Approval is blocked until an authorized
Deviation decision (Approve) or an audited Skip. No default/assumed value is ever substituted.
If **no rule at all** is configured for the lender + product + loan type, the outcome is also
**Manual Review** (cannot assert "within policy" without a policy). Flagged for owner confirmation.

### 4. Final stage model (backend is the authority)

`Offer = 10` is **restored** (legacy stage). NI / Cancelled are not stages. Sanction Cancel/Revoke is a
**sanction-entity** state, never an application status.

| Stage | Entry condition | Allowed actions (roles) | Next | Back | Hold | Reject |
|---|---|---|---|---|---|---|
| Submitted (Login) | Draft submitted | CPA checks, move to Underwriting | UnderReview | — | ✓ | ✓ |
| UnderReview (Underwriting + Verification) | ≥1 complete bank line (existing gate) | FI, checks, **Move to Offer** (status roles + `canChangeStatus`) | Offer | — | ✓ | ✓ |
| **Offer** | UnderReview **and** Doc/Income/Bank/ECS checks done **and** FI done when the product workflow has FI (Personal, Business, Home, LAP, Education, Vehicle) | Create/revise/withdraw offers (status roles + `canChangeStatus`), **Select/Confirm final** (anyone with application access), Raise deviation (`canDeviation` roles), Skip deviation (4 roles), **Credit Approval** (4 roles) | Decision (raise) / Approved (credit approval) | UnderReview (reason; final selection cleared, open deviation requests Closed) | ✓ | ✓ |
| Decision (Deviation pending) | A deviation request raised on the final offer | Decide deviation (4 roles, never the raiser) | Offer (approved or rejected — deviation reject does **not** reject the application) | — | ✓ | ✓ |
| Approved (Credit approved → Sanction) | Credit Approval recorded | Generate sanction (4 roles), Cancel/Revoke sanction (4 roles), Deal confirmation (existing) | Acceptance (needs active sanction) / Disbursed (via disbursement record) | Offer (only by sanction cancel / approval reset) | ✓ | ✓ (active sanction auto-cancelled) |
| Acceptance | Deal confirmation sent (needs active sanction) | NACH, Agreement, Disburse (4 roles + `canDisburse`) | Disbursed | Offer (sanction cancel) | ✓ | ✓ |
| Disbursed | Disbursement record + NACH + Agreement + verified InCred (InCred loans) | Reversal (4 roles, reason) → back to Approved/Acceptance | Closed | — | ✗ (final lock) | ✗ |
| Rejected / Closed / OnHold | — | Reopen (Admin, reason, 45-day window — existing) / Un-hold | — | — | — | — |

* **Skip vs Not Required:** `NotRequired` = engine result (all rules within limits). `Skipped` = human
  bypass by one of the 4 roles, reason mandatory, actor + timestamp stored on the deviation record and in
  Timeline/Audit. Distinct status values, labels and Timeline entries.
* **Back (Offer → UnderReview):** final selection cleared (Final → Available, NotSelected → Available
  when not expired), open (Raised) deviation requests → Closed, approval status reset to Pending.
* **Reject:** open deviation requests → Closed; active sanction → Cancelled (system, reason = rejection);
  offers are **frozen** (every offer action is refused outside Offer/Decision/Approved/Acceptance) and
  history kept. **Reopen** (existing, Admin): if the pre-rejection stage was Decision/Approved/Acceptance
  the application resumes at **Offer** (downstream revalidation — credit approval & sanction must be redone).
* **Hold:** Offer and Decision are now holdable; while OnHold every offer/deviation/approval/sanction/
  disbursement action is refused by the backend (reuses the existing final-stage lock sets).
* **Admin Override** can no longer force Offer/Decision/Approved/Acceptance/Disbursed (those require the
  chain's records); it can still force the other stages.
* Old generic paths `PATCH /approve`, `PATCH /disburse`, `PATCH /status → Approved|Disbursed|Acceptance|Decision|Offer`,
  bulk status and `/deviation/raise|decide|skip` are **retired** with an explicit 409 message pointing to the
  Offers flow (no silent parallel path).

### 5. Offer status (simplified) — decision

`Available`, `Final`, `NotSelected` (live — count toward the 3-offer limit and one-per-lender rule, because a
NotSelected offer returns to Available when the final selection is cleared) · `Withdrawn`, `Expired` (history — never
block a new offer). No Draft (an offer is saved
complete), no Superseded status (revision supersession is tracked on revisions, not offers), no Closed
(Withdrawn/NotSelected/Expired already cover it).

Transitions: Available→Final (select), Available/Final→Withdrawn (before credit approval), Available/Final→Expired
(validity passed, before sanction), Final→Available (unselect/back, before credit approval), others→NotSelected on
select, NotSelected→Available on unselect/back. All others refused (409).

Separate per-offer columns: `DeviationStatus` (NotRequired, Required, Raised, Approved, Rejected, Skipped) and
`ApprovalStatus` (Pending, Approved, Rejected).

### 6. Financial calculations — authoritative (backend) decision

| Item | Legacy (`laAutoCalc`) | Backend before | Decision |
|---|---|---|---|
| EMI formula | reducing balance on **bundled** amount, `Math.round` to rupee | `EmiCalculator.ReducingBalance`, rounded to **2 decimals** | Backend formula (`EmiCalculator`, reducing balance, 2-dp) on the financed principal. Legacy whole-rupee rounding was display-only. **Open for owner** if lenders require rupee rounding. |
| Flat vs reducing | reducing EMI; flat rate derived for display | reducing | Reducing balance only (`RateType = Reducing`). |
| Financed principal | `amt + (PF incl. GST if bundled) + (insurance if bundled)` | n/a | Same as legacy. |
| Processing fee | `amt × PF%` | n/a | `round2(Amount × PF%/100)` |
| GST | on PF, default 18% | n/a | `round2(PF × GST%/100)`; GST % entered (no silent default; 0 allowed). |
| Net disbursement | not computed | n/a | `Amount − (PF+GST unless bundled) − (Insurance unless bundled) − StampDuty − BT amount`; must be > 0. |
| Types | — | `numeric(18,2)` money, `numeric(5,2)` rate | Same (`numeric(18,2)`, ROI `numeric(5,2)`). |

### 7. Deviation rule engine — decision

* New `DeviationRules` table (configurable, versioned, immutable per version): Lender (required — no global
  rule), Product key / Loan type (null = any), Deviation type (ROI, FOIR, LoanAmount, Tenure, CIBIL),
  Metric + Unit, Limit, optional Max approvable deviation (authority limit), Conditions JSON (field/op/value,
  AND/OR), Priority, Effective From/To, Active, Version, Approval required.
* Units: ROI `ROI_MIN_PCT` (absolute % p.a.) or `ROI_DISCOUNT_PP` (Base ROI − Offered ROI in **percentage
  points**, Base ROI = the lender's base rate entered on the offer); FOIR `FOIR_MAX_PCT` (post-loan FOIR from
  the existing authoritative `ObligationService` FOIR); Loan amount `AMOUNT_MAX` (₹) or `INCOME_MULTIPLE_MAX`;
  Tenure `TENURE_MAX_MONTHS`/`TENURE_MIN_MONTHS`; CIBIL `CIBIL_MIN` (bureau only).
* Tie-break: Priority (lower number first) → Specificity (more conditions + product/loan-type specific) →
  latest Effective From → exact tie = **Conflict error** (no silent pick).
* Save-time validation: effective-date order, priority range, duplicate/overlapping rule (same lender, product,
  loan type, type, priority, conditions and overlapping dates) refused.
* Maker-checker for rules: **not required by existing policy** — Product & Risk Officer (and Admin) manage rules
  directly; every change is a new version + audit log. Documented, no new approval workflow introduced.
* Simulation/dry run endpoint evaluates rules against an application/offer without writing anything.
* The hard-coded `DeviationEvaluator` and its `GET /deviations` endpoint are removed (no duplicate engine).

### 8. Approval, sanction, disbursement decisions

* **Deviation approval**: 4 roles only; the raiser can never approve (Admin included — previous Admin exemption
  removed). Assignment: loan's Credit Evaluation Manager (OpsManager) → Login user → any active eligible
  approver in scope, never the raiser; none available → `Escalated` (unassigned) + notification to Admin.
  Any eligible in-scope approver (not the raiser) may decide. Authority limits: **none exist in lender policy →
  not invented**; only the rule's optional "max approvable deviation" is enforced when configured.
* **Credit approval**: 4 roles; validates final offer, not expired, deviation resolved on the **current**
  revision (engine re-run), checks complete, revision match, maker-checker (approver ≠ creator of the current
  revision). Term change at approval = new revision → recalculation → deviation re-evaluation → a new approval
  decision is required.
* **Sanction**: 4 roles; immutable snapshot (DB trigger blocks UPDATE of snapshot columns and DELETE on
  PostgreSQL); one Active sanction per application (partial unique index); number `SAN-<LoanNumber>-<vv>`.
  **Correction = Amendment**: cancel the active sanction with type Amendment, revise the offer, pass Credit
  Approval again, generate a new sanction version (linked by `PreviousSanctionId`). The 4 roles cannot edit a
  sanction in place. Cancel/Revoke: reason mandatory, blocked when a completed disbursement exists; application
  returns to Offer stage.
* The editable `LoanSanctionDetail` (CAM panel) is kept for display: it is populated from the sanction snapshot
  and **locked** (409) while an active sanction exists; edits limited to the 4 roles.
* **Disbursement**: single disbursement (legacy + backend have one Disburse action; tranche = Open decision,
  schema supports multiple rows). Amount ≤ sanctioned net disbursement, account no. + IFSC + UTR + mode + date
  required; existing NACH/Agreement/InCred gates reused. Reversal = new reversal row + reason, original row marked
  Reversed (never deleted/updated in money columns), application back to its pre-disbursement stage.

### 9. api-bridge.js decision

The legacy Vanilla shell (`/index.html` + `api-bridge.js`) is confirmed unused (React at `/` is the only UI).
The new endpoints are **not** exposed through the bridge (no legacy file modified). The bridge's
`approve`/`disburse` calls now receive an explicit **409 with a message** pointing to the Offers flow — a
visible failure, not a silent break.

### 10. Notifications / email decision

The existing stage-notification email (`LoanService.SendStageNotificationEmailAsync`, customer-facing
approval/disburse templates) keeps firing for the status changes it already covered (Approved via credit
approval, Disbursed via disbursement). Internal events (deviation raised/decided, escalation) use the existing
in-app `AppNotification` + `LoanTask` infrastructure. The Lender Email workflow is lender-RM enquiry
correspondence — not reused for internal approvals (no parallel email engine created).

### 11. Implementation-level decisions (non-business)

* New tables: `ApplicationOffers`, `ApplicationOfferRevisions`, `DeviationRules`, `OfferDeviations`,
  `CreditApprovals`, `Sanctions`, `Disbursements` (named to avoid the InCred `LoanOffers` table).
* Service in `LoanMS.Infrastructure/Services/OfferWorkflowService.cs` (same pattern as `ObligationService`),
  controllers `OfferWorkflowController` and `DeviationRulesController`.
* Idempotency via `Idempotency-Key` request header stored on the created record (unique index).
* Timeline = `TrackingEntries` rows written server-side (`EFIN-Offer Created`, … ) + `LoanStatusHistory` for
  stage changes + `AuditLogs` before/after.

### 12. Owner decisions of 2026-09-25 (completion pass) — implemented

| Question | Owner's answer | Implementation |
|---|---|---|
| CIBIL source | Bureau report upload | §2 above; `POST /api/loans/{id}/workflow/bureau-report` |
| EMI rounding | To the paisa (2 decimals) | Reducing balance, stored at 2 dp, shown as stored (`fmtEmi`) |
| Missing data / no rule for lender-product | Manual review | Fail-closed `MissingData` / `ManualReview` → deviation Required |
| Offer validity | Days configured per lender | `Banks.OfferValidityDays` (1–365), pre-fills "Valid until", editable per offer |

Also closed in the same pass: rule changes re-check live offers of that lender; approver reassignment with an
eligible-approver list; tasks paused on Hold / closed on Reject; disbursement gated on a matching "Okay to Process"
Bank Details Check.
