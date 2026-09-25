# LoanMS — Customer duplicate / Re-application (45-day) / Application archive

Branch: `feature/customer-dup-reapply-archive` (baseline commit = unmodified
`LoanMS-Deploy-2026-09-24-header-compact.zip`).

Status tracker (updated as work proceeds):

| Phase | State |
|---|---|
| 0 Safety (branch, baseline build+tests) | DONE — build 0 errors, 465 xUnit + 307 Vitest green on baseline |
| 1 Inspect | DONE (findings below) |
| 2 Implement | DONE |
| 3 Verify (build, unit, integration, PG E2E, concurrency, migration) | DONE — see §5 |
| 4 ZIP + report | DONE |

## 1. Inspection findings (from the actual code)

### Status classification (LoanStatus enum, stored as text)
* Active / in-process: `Draft, Submitted, UnderReview, Approved, Acceptance, Disbursed, OnHold, Decision`.
  Disbursed = running loan (only transition left is -> Closed), so it counts as active (conservative;
  it's also what the existing `/wizard/validate` check did: everything except Rejected/Closed).
* Terminal / closed: `Rejected, Closed`. There is no `Cancelled` status in this codebase.

### RejectedAt
* Set in `LoanService.UpdateStatusAsync` (-> Rejected) and `OverrideStatusAsync` (-> Rejected).
* **Gap:** `ApplyDeviationTransition` (Decision -> Rejected via deviation decide) never set it.
* **Gap:** `ReopenAsync` cleared `RejectedAt` (history lost on the loan row; still in LoanStatusHistory).
* No request DTO carries `RejectedAt` (cannot be set from a payload today).

### Customer matching (before)
* `WizardController.FindOrCreateCustomerAsync`: draft's own customer first, then exact PAN
  (incl. soft-deleted -> silently **reactivated**), then exact trimmed phone, then email (incl. deleted).
* Draft resume always trusted the draft's first customer -> a PAN typed later that belongs to another
  customer was silently dropped -> **silent duplicate customer**.
* Update branch overwrote FullName/Phone/etc. of an existing (shared) customer -> **blind overwrite**.
* No normalisation of phone (only Trim); PAN upper/trim and email lower/trim on write only.

### Application duplicate (before)
* Only `/api/wizard/validate` (PAN only, not global identity) — `/api/wizard/submit`, `/api/wizard/draft`,
  `POST /api/loans`, `/submit`, `/status`, `/bulk-status`, `/override-status`, `/reopen` had **no guard**.
* `GET /api/loans/duplicate-check` = legacy 60-day "created within 60 days" warning (not the business rule).
* No DB-level protection (no unique/partial index, no lock) -> concurrent submits create duplicates.

### Archive (before)
* Does not exist for applications (only Teams/DSA/Locations have their own archive).

### All application create / reactivate paths
`POST /api/wizard/submit` (fresh + draft resume), `POST /api/wizard/draft` (creates Draft),
`POST /api/loans`, `PATCH /api/loans/{id}/submit`, `PATCH /{id}/status`, `PATCH /bulk-status`,
`PATCH /{id}/override-status` (Admin, can move Rejected/Closed -> active), `PATCH /{id}/reopen`
(Admin, Rejected -> previous stage). No bulk import / customer-merge endpoint exists.
Loan delete = soft delete of **Draft only**. Customer delete = **permanent** purge (Admin).

### RBAC facts relevant here
* Archive roles requested: Admin, ProductTeam, LocationHead.
* Existing RBAC: ProductTeam has **no loan visibility** (owner decision in `ApplyVisibilityScope`),
  LocationHead sees its Location's loans, Admin sees all.

### Legacy data
Production data was **not** reachable from this machine (and was not touched). Counts for production
must be taken with the read-only `scripts/db/dup-reapply-archive-report.sql`. On a copy of the
local `loanms_audit` DB seeded with legacy-shaped rows the report found, as designed: 1 PAN shared by
2 customers (case variant), 1 phone and 1 email shared (format/case variants), 1 customer with 2 active
applications, 1 rejected application without any rejection date, 4 soft-deleted customers; 1 rejected
application had no RejectedAt but an exact history row and was backfilled from it.

## 2. What changed

**One central guard** — `LoanService.EvaluateApplicationEligibility` (pure rule) /
`CheckApplicationEligibilityAsync` / `GuardApplicationAsync` (lock + rule). Used by: wizard draft save,
wizard submit (fresh + resumed draft), wizard validate, `POST /api/loans`, Draft→Submitted (`/submit`,
`/status`, `/bulk-status`), Admin override from a closed/rejected status back to an active one, Reopen.
**One customer identity rule** — `CustomerService.ResolveIdentityAsync` / `ResolveIdentity`: global
(no user scope, soft-deleted rows included), on normalised PAN / mobile / email. Used by the wizard,
`POST /api/customers`, `GET /api/loans/duplicate-check`, `GET /api/customers/check-pan|check-mobile`.

| Area | Files |
|---|---|
| Domain | `Customer.cs` (identity keys + `Normalize*`), `Loan.cs` (archive fields, RejectedAt doc) |
| Data | `AppDbContext.cs` (keys refreshed on every SaveChanges, indexes, archive FK), `DbConflicts.cs` (23505 → 409) |
| Migration | `20260924143037_AddCustomerIdentityKeysAndApplicationArchive` (+Designer, snapshot) |
| Repositories | `LoanRepository` (eligibility rows incl. deleted + exact history date, advisory lock, `ApplyArchiveScope`/`ApplyOperationalScope`), `CustomerRepository` (identity lookup, provisional check, identity locks, phone-digit search), `UnitOfWork.ExecuteInTransactionAsync` |
| Services | `LoanService` (guard, archive, deviation-reject stamps RejectedAt, reopen keeps RejectedAt, archived loans locked), `CustomerService` (identity, create guard, PAN/Aadhaar masking on search), `CustomerDeletionService` (no purge inside the 45-day window) |
| API | `WizardController`, `LoansController` (`PATCH /{id}/archive`, 409 mapping, blocked-attempt audit, duplicate-check), `CustomersController` (check-pan/check-mobile), `ReportsController` (operational scope), `ExpertExportController` (Archived column), `ExceptionMiddleware`, `BaseController.ApiResult` (ErrorCode → 409/403/404), `MappingProfile` |
| DTOs | `ApiResponseDto.ErrorCode` + `ApiErrorCodes`, `ApplicationEligibilityDto`, `CustomerIdentityMatchDto`, archive fields on `LoanDto`/`LoanListDto`, `LoanFilterDto.Archived` |
| Frontend | `LoansPage` (Archived tab), `LoanDetailPage` (Archive action + reason modal, Archived badge/details, no Re-open on archived), `NewApplicationPage` + `Step1` (server message, draft-refused banner, check keyed on PAN + mobile + own draft), `loansApi`, `types` |
| Scripts | `scripts/db/dup-reapply-archive-report.sql` (read-only), `scripts/db/dup-reapply-archive-apply-constraints.sql` |

**Indexes / constraints:** `UX_Customers_PanNormalized` (unique, PanNormalized not null),
`IX_Customers_PhoneNormalized`, `IX_Customers_EmailNormalized`,
`UX_Loans_CustomerId_ActiveApplication` (unique CustomerId where not deleted and Status not
Rejected/Closed), `IX_Loans_ArchivedByUserId` + FK to Users (SET NULL). Both unique indexes are created
by the migration only if existing data allows; otherwise a WARNING is raised, nothing is merged, and
`apply-constraints.sql` creates them after the reported rows are resolved.

**Concurrency:** PostgreSQL transaction-scoped advisory locks — per normalised identifier (PAN, mobile,
email; fixed order) before customer resolution, and per customer before the eligibility check — plus
the partial unique index as the DB backstop; any lost race surfaces as 409, never 500.

## 3. Decisions taken (defaults / conservative choices)

1. **Active vs terminal:** only `Rejected` and `Closed` are terminal. `Draft`, `Submitted`,
   `UnderReview`, `Approved`, `Acceptance`, **`Disbursed` (running loan)**, `OnHold`, `Decision` are
   active; any future status is active by default. Same set the old `/wizard/validate` used.
2. **A Draft counts as an active application** (existing model; autosave creates it). A second
   parallel draft/application for the same customer is refused. An abandoned draft blocks others until
   its owner or an Admin/Manager discards it (existing Discard action).
3. **Rejection date** = the later of `RejectedAt` and the last history transition *into* Rejected
   (`FromStatus != Rejected`; same-status timeline notes never count). Never CreatedAt/UpdatedAt.
   No date at all → blocked, "Needs admin review". Allowed exactly when `now ≥ date + 45 days` (UTC).
   Latest rejection across all the customer's applications, incl. soft-deleted and archived ones.
4. **RejectedAt** is stamped server-side on every rejection path (incl. the deviation-reject path, which
   previously didn't) and is **no longer cleared on Reopen** (history kept). A re-rejection stamps the
   new, later time. No DTO accepts it.
5. **Reopen / Admin override back to active** run the guard for the *other* applications (own rejection
   excluded — that is what the Admin is reversing). The existing Vanilla 45-day-from-creation Reopen
   window is unchanged. Admin override Rejected→Closed remains possible (existing, audited, reason
   mandatory) — it is the admin route for a "rejection date unknown" row.
6. **Identity:** a match is used only when every supplied identifier points to the same live customer.
   PAN of one + mobile/email of another, a mobile/email whose customer has a *different* PAN, or a draft
   linked to a different existing customer → 409 **needs review**, never merged. A **soft-deleted
   customer** match → 409 needs review for every role (not restored). Mobile-only match to a customer
   without a PAN is accepted (as before) and fills the blank PAN.
7. **"Don't blindly overwrite":** on an existing customer, identity/KYC fields (name, phone, email, PAN,
   Aadhaar, DOB, gender, father's/mother's name) are only filled when blank. Application-time data
   (address, employment, income, obligations, CIBIL) still updates, because the new application's
   underwriting reads it from the customer record. The draft's *own* provisional record keeps being
   refined while typing; if later identifiers belong to an existing customer the draft is re-linked
   and the unused provisional record is removed (only if no other application/bureau report uses it).
8. **Archive** = Rejected/Closed only; reason mandatory (≤500 chars); roles Admin, ProductTeam,
   LocationHead, **within existing visibility scope**. Consequence: ProductTeam has no loan visibility
   today (owner decision in `ApplyVisibilityScope`), so it can archive nothing unless an Admin assigns it
   scope — not widened (owner decision). Archived applications cannot be re-opened/overridden (no
   unarchive). Audit: structured `AuditLog` row (same SaveChanges as the archive) + a `[ARCHIVED]`
   timeline row + ArchivedAt/By/Reason on the loan.
9. **Archive visibility:** one shared scope hides archived applications from the Applications list,
   status filters, search, export, dashboard counts/recent, filter options and all Reports endpoints;
   they appear in *Applications → Archived* (list + export) and still open on the detail page. The
   Expert (full-data) export keeps every row and adds an `Archived` column. Customer "total loans"
   still counts them (history).
10. **Blocked-attempt audit** (existing AuditLog pattern): written for final submits, `POST /api/loans`,
    reopen and override; **not** for draft autosave (fires on every pause in typing).
11. **Messages:** 409 + `errorCode`; wording "Active application exists…", "Re-application allowed
    after <date> IST…", "Needs admin review…". Another user's application number is shown only to
    Admin/Manager or its own creator.
12. **Customer search** (`/api/customers`, `/search`) stays in the caller's visibility scope because it
    returns autofill PII; PAN/Aadhaar are now masked there for non-Admin/Manager (they were not).
    Global identification is served by `check-pan`/`check-mobile` (no PII returned) and duplicate-check.
13. **Permanent customer delete** is refused while a rejection is inside its 45-day window (it would
    erase the evidence), in addition to the existing active-loan rule.
14. The legacy 60-day "created within 60 days" warning on the wizard's PAN field was replaced by the
    central rule (business rules here are final authority; it flagged Closed applications and ignored
    the rejection date).
15. Two existing tests encoded the old behaviour and were updated to the new rules (silent
    reactivation of a deleted customer; a second parallel draft).
16. Migration `Down()` keeps the RejectedAt backfill (exact values, valid for the old code too).

## 4. Genuine limitations / follow-ups

* Production legacy counts unknown here — run `scripts/db/dup-reapply-archive-report.sql` (read-only)
  first; if the migration log shows the WARNINGs, resolve the listed rows and run
  `apply-constraints.sql` so the DB-level unique guarantees exist (the app-level lock + guard protect
  in the meantime).
* A soft-deleted-customer match has no in-app "restore" screen; an Admin resolves it via the DB or the
  existing permanent delete (allowed once no 45-day window is running).
* ProductTeam archive is effectively inactive until the owner decides to give ProductTeam loan scope.
* UI click-through in a real browser was not done by me (it needs a login password to be typed, which
  I don't do). The UI is covered by server-rendered component tests + the API E2E; a quick manual
  check is recommended: Applications → Archived tab; Loan detail → More → Archive; wizard with an
  existing customer's PAN.

## 5. Verification (all run in this session)

See `verification/dup-reapply-archive-2026-09-24/` for scripts and raw outputs.

| Check | Command | Result |
|---|---|---|
| Backend build | `dotnet build LoanMS.slnx` | 0 errors |
| Backend tests | `dotnet test LoanMS.Tests` | **566 passed, 0 failed** (baseline 465; +101 new) |
| Frontend type-check | `npx tsc -b` | exit 0 |
| Frontend lint (changed/new files) | `npx eslint <files> --max-warnings 0` | exit 0 (19 pre-existing warnings elsewhere, untouched) |
| Frontend tests | `npx vitest run` | **315 passed** (baseline 307; +8 new) |
| Frontend build | `npm run build` | built into `LoanMS.API/wwwroot/react` |
| Migration on DB copy with legacy data | `mig_test.sh` (PostgreSQL 18) | UP ok with 3 WARNINGs, report correct, idempotent re-run ok, DOWN ok, UP again ok, constraints refused then created after resolution, DB-level 23505 on 2nd active app / duplicate PAN |
| Full migration chain on empty DB | API startup `MigrateAsync` (PostgreSQL) | 57 migrations, both unique indexes created, no fatal/unhandled errors |
| API end-to-end + concurrency | `e2e.py` against the API on PostgreSQL | **56/56 passed**, 0×5xx; 12 parallel submits → 1×200 + 11×409; 10 parallel POST /api/loans → 1×201 + 9×409; 8 parallel drafts → 1×200 + 7×409 |

Real bug found only by running the API: AutoMapper startup validation failed on the new members →
fixed in `MappingProfile` and covered by `MappingProfileValidationTests`.
