# LoanMS — End-to-End Audit Progress Tracker

**Started:** 2026-09-23 · **Source:** `LoanMS-Debug.zip` (extracted to `Downloads/LoanMS-Audit/LoanMS`)
**Resume rule:** if a session is cut, continue from the first module below that is not `DONE` — do not restart or skip.
**Full item-level inventory:** [`AUDIT_INVENTORY.md`](AUDIT_INVENTORY.md) — auto-extracted from source by `_scripts/inventory.js`
(274 endpoints / 40 controllers after the Bureau removal and the new filter-options endpoint — originally 287 / 41, 55 tables, 62 migrations, all frontend routes/pages/components/hooks/stores/API clients/types).

Status values: `NOT_STARTED` · `IN_PROGRESS` · `DONE` · `OBSERVED_ONLY` (seen, deliberately not changed — reason given).
⚠️ = touches **money**, **loan status transitions**, **persistence** or **permissions**.

## Verification environment (what "verified" means in this log)

| Check | How | Notes |
|---|---|---|
| Persistence | API run inside WSL against **real PostgreSQL 18** (`loanms_audit` DB, fresh, all 62 migrations applied by `MigrateAsync()`), rows checked with `psql` directly | SQLite is never used as persistence proof |
| Browser UI | Second API instance on Windows (`:5099`, dev SQLite) driven through the in-app browser | UI behaviour only — WSL firewall blocks Windows→WSL PG |
| Frontend | `npm run build` (`tsc -b && vite build`), `vitest run`, `eslint` on touched files | |
| Backend | `dotnet build` | run when backend is touched |
| Version control | git initialised on the extracted source (baseline commit `8484aa8`), one commit per fix | Commits `864c8c4`, `37ba232`, `eaddeea` also re-stored whole files with CRLF line endings (git autocrlf was switched off after the baseline) — content on disk is unchanged; review them with `git show --ignore-cr-at-eol <sha>` |

---

## Module tracker

| # | Module | Status | Commits |
|---|---|---|---|
| C1 | ⚠️ **Critical #1 — Delete not persisting / reappearing on other device** | DONE — React/API/DB path verified; legacy shell (the confirmed source) **retired** after owner confirmed it is unused | `2ba7ab1` (+ related C1-b `864c8c4`) |
| C2 | **Critical #2 — Missing error/success/confirm popups in React** | DONE | `0474cd6`, `839282c`, `43ad8c8` |
| 7B | ⚠️ Wizard Documents / Perfios integration | DONE (real S3 = BLOCKED, no AWS creds) | `ebe9e6d`, `9b2667b` |
| 1 | ⚠️ Core domain / auth / access control (incl. Application View & Control at API level) | DONE · **DECISION NEEDED** (backend permission fail-open) | `37ba232`, `ab52ffd`, `eaddeea`, `ac6749b` |
| 2 | ⚠️ Data persistence layer (repositories, UoW, soft-delete, unique indexes, migrations) | DONE | `eeda15f` (+ C1-b `864c8c4`) |
| 3 | ⚠️ Workflow modules — Loans/status flow, Wizard, Loan detail tabs, Tasks, Tickets, Tracking, Payout, Obligations, Income verification | DONE | `715e610`, `89822c1`, `82b699c`, `ae19c66` |
| 4 | Integrations — Perfios, InCred, S3, Email/SMTP, AI providers, Bureau/CIBIL | DONE (code + API level) — live S3 / SMTP / InCred / AI calls **BLOCKED** (no credentials here) | `ab52ffd`, `948495d` |
| 5 | UI/UX consistency | DONE (functional sweep of all 28 routes + 11 loan-detail tabs; no redesign) | `43ad8c8`, `82fe44b` |
| X | Cross-cutting: security, performance, config/env, concurrency, transactions, audit trail, API contract, failure handling, pagination, background jobs, deployment parity | DONE | `715e610`, `42a3b9c`, `82fe44b` |

---

## C1 — Critical #1: "Admin deletes → not deleted on server → reappears on another device"

**Status:** DONE. React→API→DB delete path **verified correct**; the reported symptom came from the **legacy shell**. The owner confirmed it is unused, so `/index.html` now redirects to the React app (`2ba7ab1`).

### Trace performed (every layer)

1. **Backend delete endpoints (all 26):** every one either soft-deletes (`IsDeleted=true` + `SaveChangesAsync`) or, for Banks, hard-deletes (`Remove` + cascade). Service-layer deletes (Loan, Customer, User, Obligation) all call `_uow.SaveChangesAsync()` after `GenericRepository.DeleteAsync`. No endpoint returns success without persisting.
2. **Read-side filtering:** 53/55 entities with `IsDeleted` carry a global `HasQueryFilter(!IsDeleted)`. The two without (`PayoutRule`, `LoginAttempt`) filter `!IsDeleted` manually in every read (`PayoutRulesController`, `PayoutController:340`, `WizardController:777`). `IgnoreQueryFilters()` is used only for unique-key reactivation look-ups (Settings, Wizard customer, Users by email) — never for lists. No raw-SQL reads.
3. **Caching:** `ICacheService` only caches the InCred auth token. No list/dashboard/response caching; no `ResponseCache`/`OutputCache`. (Loan list/dashboard caches were already removed earlier because of per-replica staleness on ECS.)
4. **Startup seeding:** re-activates only the 3 default seed users (`admin@/manager@/sales@efin.com`) on every restart — deliberate anti-lockout behaviour, logged as a warning. Payout rules re-seed only if the table is empty *including* deleted rows (`PayoutRule` has no query filter), so a deleted rule is never resurrected.
5. **React frontend:** every delete button calls the real `DELETE` endpoint; no optimistic local removal (`setQueryData` is only used for notifications/InCred offer); no persisted React-Query cache; no service worker; wizard drafts are server-only (`draftStorage.ts`).
6. **Legacy shell (`wwwroot/js/api-bridge.js`)** keeps a localStorage mirror of server data and re-syncs it on login/refresh. Two sync functions **add/update but never remove** rows the server no longer returns:
   - `_syncLocations()` (api-bridge.js ~L797) — a location deleted on device A stays in `twLocations` on device B.
   - `_syncPayoutClaimsFromServer()` — a payout claim deleted by Admin stays in `PAYOUT_CLAIMS` on device B **and is re-written to localStorage** by `persistSave()`.
   (`_syncTickets`, `_syncEmailTemplates`, `_syncProductOfferMatrix`, `_syncCamMatrix` also don't prune, but those entities have no delete that a stale copy could resurrect, or are key-based settings.)

### Actual verification (real PostgreSQL, Device A = one login, Device B = a second independent login)

Script `_scripts/delete_matrix.py` + `delete_matrix2.py` (create as A → confirm visible to B → DELETE as A → re-list as B → `psql` the row):

| Entity | DELETE | Visible to B after | DB row |
|---|---|---|---|
| Location | 200 | no | `IsDeleted=true` |
| Rejection reason | 200 | no | `IsDeleted=true` |
| Lender company | 200 | no | `IsDeleted=true` |
| DSA partner | 200 | no | `IsDeleted=true` |
| Team | 200 | no | `IsDeleted=true` |
| User | 200 | no | `IsDeleted=true` |
| Payout rule | 200 | no | `IsDeleted=true` |
| Bank | 200 | no | row physically gone (hard delete by design) |
| Task | 200 | no | (API-verified) |
| Report target | 200 | no | `IsDeleted=true` |
| Draft loan (wizard "Discard") | 200 | no (drafts list) | `IsDeleted=t` |

### Related React defect found and fixed (overlaps C2)
A server-**refused** delete (e.g. "Only Draft loans can be deleted", 403 for non-Admin, location still in use) was **silent** in six React screens that had no `onError` (Teams, Rejection Reasons, Tracking entries, Lender lines, Banks page, Obligations): the admin clicked, nothing happened, and could not tell whether the record was deleted. Fixed app-wide by C2's global error toast.

### ⚠️ C1-b — Found while tracing C1: deleting a USER made all of that user's loans vanish (FIXED, commit `864c8c4`)
- **Symptom (reproduced on real PostgreSQL):** loan created by user X → Admin deletes user X → the loan disappears from `/api/loans`, `GET /api/loans/{id}` returns **404 for Admin**, drafts list, dashboard "recent", reports, payout claims (money), tasks, tickets and status history by that user all vanish. DB rows intact (`IsDeleted=false`).
- **Root cause:** `User` has a soft-delete global query filter; `Loan.CreatedBy`, `LoanStatusHistory.ChangedBy`, `LoanTask.CreatedBy/AssignedTo`, `Ticket.CreatedBy`, `TicketComment.User`, `PayoutClaim.ClaimedBy` are **required** relationships. EF Core translates Include/projection of a required navigation to a filtered principal as an **INNER JOIN**, dropping the dependent rows (EF warning 10622).
- **Fix (no schema change):** User filter became an EF Core 10 *named* filter (`AppDbContext.UserSoftDeleteFilter`); historical-record queries opt out of only that filter with `QueryableExtensions.IncludeDeletedUsers()` — LoanRepository (detail, paged list, export, dashboard, recent-activity), LoanStatusHistoryRepository, ReportsController (all 12 scoped queries), Tasks (list, reassign), Tickets (list, detail, comments), Payout claims list, Wizard ListDrafts. Users list/look-ups/login/team membership still hide deleted users. Tracking entries never traversed `CreatedBy` (unaffected).
- **Verification:** `dotnet test` 369/369 (incl. new regression test that fails without the fix); real PostgreSQL: loan by deleted creator → list ✓, detail 200 with "Audit User" as creator ✓, drafts ✓, `/api/loans/dashboard` recent ✓, `/api/reports/performance` ✓; deleted user absent from `/api/users` ✓, login still refused ✓.
- **Test-suite note:** `LoanMS.Tests` did not compile on arrival (missing `using System.Text.Json;` in WizardControllerTests) — fixed so the suite can run at all; 3 ListDrafts tests seeded FK-impossible data (creator user row missing) — seed corrected.
- ✅ **Customer delete is now a permanent hard delete (`4747212`, owner decision 2026-09-23).** `CustomerDeletionService` removes the customer and every linked record — loans and 18 loan-level tables, bureau data, payout claims, tasks/tickets, notifications, audit entries, InCred webhook-log entries — explicitly, child-first, in one transaction, then deletes the stored document files (failures reported). Admin only; customers with an active (not Closed/Rejected) loan are still refused. Verified: SQLite FK-enforced tests (target vs control, rollback, storage failure, mutation-checked) and PostgreSQL E2E on real data (every table empty, 8/8 files removed, invisible in all lists/searches). The single remaining audit row is the record of the delete itself (entity id only). UI: Admin-only **"Delete customer permanently"** in the loan detail "More" menu with a typed-name confirmation dialog (`07039ad`), browser-verified. Found on the way: the header **global search always returned 500** (parallel queries on one DbContext) — fixed in `16e6111`.

### ✅ Decision taken (2026-09-23): "Legacy use nahi hota"
The legacy shell is unused, so instead of patching it `/index.html` now redirects to the React app (`2ba7ab1`, verified 302 → `/`); its files stay on disk only as the parity reference. The original analysis is kept below for the record.

_Original question:_ Fixing the legacy shell means editing `wwwroot/js/api-bridge.js` (add the same "drop rows whose `_apiId` the server no longer returns" loop that `_syncUsers/_syncTeams/_syncTasks` already use — ~6 lines each for Locations and Payout claims). Legacy is read-only unless it is confirmed actively used. **Is anyone still using `/index.html` in production?** If yes → I'll apply that minimal fix; if no → recommend retiring/redirecting `/index.html` so stale local copies can't be shown at all.

---

## C2 — Critical #2: Missing popups (errors / validation / success / confirm) in React

**Status:** DONE

### Legacy catalogue (reference)
| Kind | Legacy count | Mechanism |
|---|---|---|
| Error toasts | ≈295 | `showToast(msg,'error')` (efin-app.js:15330) |
| Warning toasts | ≈242 | `showToast(msg,'warn')` |
| Success toasts | ≈204 | `showToast(msg,'success')` |
| Info toasts | ≈79 | `showToast(msg,'info')` |
| Confirm-before-action | ≈50 | native `confirm()` (plus 2 inline confirms in efin-improvements.js) |
| Blocking alerts | 9 | native `alert()` |
| GET failures | — | silent (`console.warn` only, api-bridge.js `apiReq`) |

### React state found
- A legacy-matched toast system already existed (`store/toastStore.ts`, `components/ui/Toast.tsx`, mounted in `main.tsx`) — **but nothing in the app ever called it.** 160 mutations, 0 toasts.
- 15 mutations had no `onError` at all; many others set an inline error that is not visible in every context.
- 9 duplicate local `errorMessage()` helpers — all crash (`errors.join` on an object) when ASP.NET returns validation ProblemDetails.
- Confirm dialogs: React already had native `confirm()` for every legacy delete/reset confirm except the 3 listed below (after the fix: 49 `confirm(` call sites).

### Fix (one shared mechanism — not page-by-page, not a legacy port)
- `main.tsx`: `QueryClient` `MutationCache`/`QueryCache` handlers → existing toast store.
  - every failed mutation → error toast (server message → network/timeout/status text → fallback)
  - every successful mutation whose server response carries a message (126 endpoints do, e.g. "User deleted.") → success toast
  - failed reads → toast only when the server is unreachable / timing out / 5xx (legacy was silent on GETs; 4xx reads stay page-level)
  - typed `meta` opt-outs (`types/react-query.d.ts`): `silent`, `errorToast:false`, `successToast:false`, `successMessage`, `errorMessage`
- `utils/apiError.ts`: single message mapper, replaces the 9 duplicates (+ `apiError.test.ts`, 8 tests).
- Removed 2 error `alert()`s that would now double-pop (Loans delete, Bank delete).
- Added the 3 missing legacy confirmations: ticket **Close** / **Reopen** (list + detail modal), payout claim **Reject** ⚠️ money — legacy wording verbatim.

### Silent-failure bugs found while doing C2 (fixed)
| # | Where | Bug | Fix |
|---|---|---|---|
| 1 | ⚠️ Deal Confirmation (`LoanVerificationChecks.tsx`) — **loan status transition** | `/api/email/send` returns HTTP 200 + `success:false` on SMTP failure; React ignored it, then logged "Deal confirmation sent" **and moved the loan to Acceptance** although the customer never got the email | check `success` before tracking/status change (same check `LenderEmailCard`/`useLoans` already do); modal shows the real reason |
| 2 | ⚠️ Login (`useAuth.ts`, `LoginPage.tsx`) — permissions | Account lockout returns 200 + `success:false` ("Too many failed attempts…"); React ignored it → Sign In silently did nothing | throw on `success:false`; login error box shows the server message |
| 3 | Error helpers | `errors.join` TypeError on ProblemDetails | shared `apiErrorMessage` |

### Verification (actually executed this session)
- `npm run build` → PASS (tsc -b + vite). `vitest run` → **24 files / 309 tests PASS** (301 existing + 8 new). ESLint on all touched files → 0 errors (2 pre-existing warnings in PayoutPage, 1 in main.tsx — present before the change).
- Real browser (Windows API :5099), Policy/Product → Rejection Reasons:
  - create → toast **"✅ Reason created."**
  - duplicate key → server 400 → toast **"❌ A reason with this key already exists."**
  - delete → toast **"✅ Reason deleted."**

### OBSERVED_ONLY (C2)
- Branding single-logo removal has no confirm (legacy had one). A code comment records this as a deliberate change (removal is undone by re-uploading); left as is.
- CAM matrix band row delete has no confirm (legacy had one) — React only edits an unsaved local copy until **Save**; left as is.
- ✅ **Brand colours set to the brief (`fd6350d`, `431def5`; owner: "Brand colours brief wale karo, #e31e25 aur #0a589a").** Blue `#085897`→`#0a589a` and reds `#c0392b`/`#d42b2b`→`#e31e25` across 48 frontend files (291 values; tokens + inline); status badge now Approved = green, Disbursed = blue (Approved used to render red, Disbursed green); password-reset/test emails use brand blue. Verified: build, 312/312 + 392/392, browser computed colours and the Approved badge.
- `npm run lint` (whole repo, `--max-warnings 0`) is expected to fail on pre-existing non-null-assertion warnings — not introduced here.

---

## 7B — Wizard Documents / Perfios integration

**Status:** DONE — real S3 **BLOCKED** (no AWS credentials here; storage verified through `LocalFileStorageService`, which implements the same `IFileStorageService` contract and key scheme).

### Flow understood
Step 8 (`NewApplicationPage` + `pages/wizard/wizardDocuments.tsx`) → mandatory docs upload **on select** to the draft loan (`POST /api/loans/{id}/documents`; `docApplicantRole(key)` tags co-applicant items) → bank-statement items are parsed by Perfios **in the browser** (`usePerfiosUpload`, pdf.js) → `POST /api/loans/{id}/perfios-report` (summary + full `ReportDataJson`) → server binds the report to the uploaded statement (`ResolveEvidenceAsync`: explicit id, else file-name match) and hashes its bytes → evidence is always `ClientParsed` (untrusted, cannot auto-verify income). Salary slips feed `IncomeVerificationService` → `TrustedSalaryExtractionService` (reads bytes from storage; images → AI vision, PDFs → client-reported).
Storage key `loans/{loanId}/{guid}.{ext}`; DB `FilePath` = `{loanId}/{guid}.{ext}`. S3 in Production (startup refuses without a bucket), local disk in dev.
Access (all enforced in the API, not just the UI): upload/replace/delete = `canUploadDocs` + loan visibility; view/download = `canViewDocuments` + visibility; verify/reject = fixed internal-role list **and** `canVerifyDocs`.

### Confirmed issues → fixed
| # | Issue | Root cause | Fix | Verification |
|---|---|---|---|---|
| 1 | ⚠️ Salary-slip extraction never read the file (every slip "not found in storage" → untrusted, no `ContentHash`) — credit-decision input | `IncomeVerificationService` passed DB `FilePath` as the storage key (missing `loans/` prefix) | `DocumentStorageKeys.ForLoanDocument()` as the single mapping; misleading interface comment corrected | PG: `ContentHash` NULL before → equals sha256 of the upload after |
| 2 | ⚠️ Perfios evidence hash never computed (`SourcePdfHash` always NULL) | same wrong key in `PerfiosController.ResolveEvidenceAsync` | same helper | PG + unit test (fails without fix) |
| 3 | ⚠️ Wizard / loan-detail Perfios reports never bound to their statement (`BankStatementDocumentId` NULL) | browser sends `X.pdf`, DB stores `DocumentName` = `X` → name match never hit | match name or stem, newest first | PG: name with `.pdf` → bound to doc 9, hash matches; unit test fails without fix |
| 4 | ⚠️ Replacing a **co-applicant** document turned it into a **primary-applicant** document | `ReplaceDocument` did not copy `ApplicantRole/ApplicantKey` | carry both forward | PG: CoApplicant/co1 kept (v2); unit test fails without fix |

### Verified working (PostgreSQL, API level)
own + co-applicant statement uploads persist role/key ✓ · spoofed PDF (EXE bytes) rejected ✓ · invalid doc type rejected ✓ · Perfios save → reload returns full `ReportDataJson` ✓ · byte-identical download ✓ · deleted document no longer downloadable (row soft-deleted + storage object purged) ✓. Backend suite 372/372.

### OBSERVED_ONLY (7B)
- ✅ **Done (`71502e8`, owner: "salary slips reprocess karo")** — rows without `ContentHash` are now re-extracted in place on the next income-verification run (manual overrides kept). Verified on PostgreSQL with a real pre-fix row. In production this happens per loan the next time income verification is run for it. _Original note:_ slips already extracted in production were recorded as "not found in storage"; extraction is de-duplicated per document and **never retried**, so those rows stay untrusted after the fix. A one-off re-extraction (clear those `SalarySlipExtractions` rows or add a retry) needs your go-ahead.
- `PerfiosReport` is keyed by `LoanId` only — `GET perfios-report` returns just the newest report per loan (documented 7B-2 limitation; per-document history needs a schema change).
- `ReplaceDocument` uses two `SaveChanges` (insert new, then supersede old) — a failure between them leaves both rows live. Low risk; not changed.
- `DownloadDocument` buffers the whole file in memory (≤ 20 MB cap) — acceptable at current limits.
- Wizard upload-on-select failure banner doesn't show the server's reason (client-side `validateDocFile` already blocks wrong type/size first).
- The wizard's immediate Perfios save swallows errors by design and retries at submit (submit surfaces a warning).

---

## 1 — Core auth / access control ("Application View & Control" at API level)

**Status:** DONE — one **decision needed** (backend permission fail-open, below).

### How access works (understood)
- **Authentication:** JWT (60 min, `Jwt:ExpiryMinutes`) + rotating refresh token (1 day, stored on `User`). Login rate-limited (5 / 15 min / IP) + DB lockout after 5 failures. Deleted users are hidden by the soft-delete filter; inactive users are refused at login.
- **Roles:** fixed `UserRole` enum (Admin, Manager, Sales, LoginTeam, TeamLeader, LocationHead, OperationManager, Accounts, Partner, Dsa, ProductTeam). Endpoint-level `[Authorize(Roles=…)]` on some controllers/actions.
- **Fine-grained permissions:** `RolePermissionService.IsAllowedAsync(role, key)` reads the Admin-editable `efin_role_permissions` setting (same map the React Roles & Permissions page edits; frontend defaults in `constants/permissions.ts`). Menu access: `IsMenuAllowedAsync`.
- **Record visibility (who sees which application):** `LoanRepository.ApplyVisibilityScope` — Admin all; Sales own created/assigned; Manager/TeamLeader sales-team membership; LoginTeam own queue; OperationManager login-team queue; LocationHead location; Dsa/Partner via linked partner records. Customers are visible if any of their loans is visible.

### Method
Mechanical scan of all 287 endpoints (`_scripts/authz_scan*.js`) for write/read endpoints taking an id with no role/permission/visibility check in the body, then each flagged endpoint read by hand, then **probed for real** on PostgreSQL as the Sales user against an Admin-created loan it cannot see (`GET /api/loans/3` → 404).

### Confirmed issues → fixed (all verified on real PostgreSQL)
| # | Issue | Fix | Verification |
|---|---|---|---|
| 1 | ⚠️ **IDOR (writes):** Sales could rename another customer (`PUT /api/customers/{id}`), complete an Admin task, add a timeline entry, add a lender-email thread entry / AI run, and create/refresh an InCred application (**sends customer PII to the lender**) on a loan it cannot see | `BaseController.CanSeeLoanAsync` (reuses `ApplyVisibilityScope`); customer update reuses `CustomerService.GetByIdAsync` scope; task complete mirrors the task-list rule; InCred create/refresh also require `canViewIncred` | 15 probes → all 403/404, **zero side effects**; Admin + Sales-own-loan still 200 (`37ba232`) |
| 2 | ⚠️ **IDOR (reads):** loan timeline, AI loan/customer insights + notes + underwriting, lender email thread, AI agent runs, InCred loan info for any loan id | same helper | as above |
| 3 | ⚠️ **Credential exposure:** `POST /api/incred/token` returned the live InCred OAuth token to any logged-in user; raw InCred proxies (`application/init`, `offer/*`, `eligibility`, `application/{id}/cancel|document|applicant|repayment-schedule|disbursement`) had no permission check — any user could cancel any InCred application | `canViewIncred` on every proxy (the permission that shows InCred in the UI); `application/{id}` must belong to a visible loan | Sales 403 ×4; Manager 404 for out-of-scope app; Admin passes (`ab52ffd`) |
| 4 | ⚠️ Any logged-in user could list/download any DSA/Partner's **KYC documents** | list rule extracted once (`ScopedPartnersAsync`) and reused by both document endpoints | Admin 200; unrelated Partner user 404 (`eaddeea`) |
| 5 | ⚠️ **Deactivated users kept their session forever** — refresh ignored `IsActive` | refresh applies login's `IsActive` rule | before: refresh 200 + new token; after: 400; unit test fails without fix (`ac6749b`) |

### ❓ Decision needed — backend permission checks fail OPEN
`RolePermissionService.IsAllowedAsync` returns **true for every role** when the `efin_role_permissions` setting has never been saved, or when the saved map lacks a key (e.g. a permission added in a later release). The frontend has full defaults and hides things accordingly, but the backend has **no defaults**. Proven on PostgreSQL: with no saved map, Sales passed the `canViewIncred` gate; after the Admin map was saved (exactly what clicking **Save** on Settings → Roles & Permissions writes), Sales got **403**.
- **Immediate zero-code mitigation:** an Admin opens Settings → Roles & Permissions in production and clicks **Save** once (writes the full map, all roles, all keys). Repeat after any release that adds a permission key.
- **Code options (your call):** (a) backend falls back to the same defaults as `constants/permissions.ts` (needs one shared defaults source to avoid a second copy), or (b) seed the default map at startup when missing. Either changes effective permissions on an install where nobody saved the page.

### OBSERVED_ONLY (module 1)
- ✅ **Bureau API removed (`1ec19c9`, owner: "Bureau dead code hata do").** Proven dead first: `IBureauService` had no implementation (all 14 `/api/bureau/*` returned a DI 500); `BureauAnalysisService` and all 20 Bureau DTO classes had no reference outside the removed files (checked class by class — shared namespace); no route string, DI, config, reflection, test, React or legacy reference. Entities/tables kept (CIBIL + loan risk grade use them). Verified: build, 392/392, EF model unchanged; PostgreSQL `/api/bureau/*` → 404, `/api/cibil/*` 200, `/api/loans` 200.
- `POST /api/email/send` lets any logged-in user send any HTML email to any address via the company SMTP (React uses it for deal confirmation / lender RM mail from internal roles). Restricting roles is a business rule — decision.
- `POST /api/notifications` lets any user create an in-app notification for any role/user (used legitimately by several roles, e.g. payout claim alerts) — design choice, not changed.
- `AssignmentAudit` create: the trusted actor id comes from the JWT; only the display name `AssignedByName` is client-supplied. Low risk.
- A deactivated/deleted user's current access token stays valid until it expires (≤ 60 min) — standard stateless JWT behaviour.
- InCred calls with no configured credentials surface as a generic 500 (`_loadCreds` throws by design) — a clear "InCred not configured" message would be friendlier.

---

## 2 — Data persistence layer

**Status:** DONE

### Understood
EF Core 10 + Npgsql; `GenericRepository<T>` + `UnitOfWork` for services, `AppDbContext` directly in most controllers. Soft delete everywhere (`BaseEntity.IsDeleted` + global query filters on 53 entities; `PayoutRule`/`LoginAttempt` filtered by hand); Banks are the one hard delete (cascade to lines/rules/categories). Production applies migrations with `MigrateAsync()` at startup; dev SQLite uses `EnsureCreated()`.

### Confirmed issues → fixed (verified on real PostgreSQL)
| # | Issue | Root cause | Fix |
|---|---|---|---|
| 1 | ⚠️ Deleting a user hid all their loans/claims/tasks (see C1-b) | required navigation + User filter → INNER JOIN | named filter + `IncludeDeletedUsers()` (`864c8c4`) |
| 2 | Re-assigning a location a user previously had → **500** | `IX_UserLocations_UserId_LocationId` unique, not filtered by `IsDeleted`; code inserted a new row | reactivate the soft-deleted row (`eeda15f`) |
| 3 | Customer create/update with a deleted customer's email → **500**; update to another live customer's PAN → **500** | filtered uniqueness checks vs unfiltered unique indexes; PAN never checked on update | checks include deleted rows + PAN on update → 400 with reason (`eeda15f`) |

### Verified
- `dotnet ef migrations has-pending-model-changes` → **"No changes have been made to the model since the last migration."** (the startup suppression of `PendingModelChangesWarning` is not hiding drift today).
- Fresh PostgreSQL DB → all 62 migrations applied by `MigrateAsync()`; every table exercised in this audit (loans, customers, users, locations, teams, tasks, tracking, documents, Perfios, salary extraction, payout rules, report targets, DSA, settings, obligations) read/wrote correctly.

### OBSERVED_ONLY (module 2)
- Unfiltered unique indexes that remain but are safe today: `Users.Email`/`EmployeeCode` (create path reactivates; generator checks deleted rows), `LoanSanctionDetails.LoanId` (never soft-deleted), `BankProductRules(BankId,ProductKey)` (hard-deleted with the bank), `PasswordResetTokens.TokenHash` (random). Any future "soft-delete then re-create" feature on these must reactivate, not insert.
- `Program.cs` suppresses `PendingModelChangesWarning` for PostgreSQL — no drift today, but a future entity change without a migration would again only fail at runtime. Recommend running `dotnet ef migrations has-pending-model-changes` in CI.

---

## 3 — Workflow modules (IN_PROGRESS)

### Loan status flow (understood)
`Draft → Submitted → UnderReview → Approved → (Acceptance) → Disbursed → Closed`; `Rejected` from any pre-disbursal state (stores `PreRejectedStatus`, reopen window); `OnHold`/unhold restores the pre-hold status; Admin override bypasses the machine with a mandatory reason + structured audit. Gates: UnderReview needs ≥1 complete bank line; Disbursed needs NACH + customer agreement, and for InCred loans a verified DISBURSED/SUCCESS webhook. Approve sets `ApprovedAmount` (default requested) and recomputes EMI.

### Confirmed issues → fixed (verified on real PostgreSQL)
| # | Issue | Fix | Verification |
|---|---|---|---|
| 1 | ⚠️ **Concurrent Approve + Reject both succeeded** (5/5 trials): history recorded both transitions and the final state contradicted it (e.g. last history "→Rejected", loan Approved with ₹4,00,000) | `Loan.Status` is an EF concurrency token (model-only; `has-pending-model-changes` still clean) → loser gets **409** "This record was changed by someone else just now. Refresh and try again." | 3/3 races: exactly one 200, other 409 with message, one history row, state == history (`715e610`) |
| 2 | Every mapped error on an audited write (POST/PUT/PATCH/DELETE `/api/*`) reached the client as a **bodiless 500** | `AuditMiddleware` never restored `Response.Body` when the pipeline threw → `ExceptionMiddleware` wrote into a disposed stream | restore before rethrow; audited 400 keeps its JSON body (`715e610`) |
| 3 | ⚠️ **Payout (commission) claims on any loan:** Sales, for whom loan 3 is 404, filed a ₹6,000 Pending claim on it | `CanSeeLoanAsync` on `POST /api/payout` + `GET suggest` | hidden loan → 404/400, no row; own loan → 200 (`89822c1`) |
| 4 | Manager could delete any customer by id | customer scope check (same as GET/PUT) | out-of-scope 404, Admin 200 (`82b699c`) |

### Verified OK
- Transactions: wizard submit/draft run in an execution-strategy transaction; status change + history is one `SaveChanges`; no money path found that can leave half-written state (`ReplaceDocument` and the InCred create chain save progressively by design — observed).
- Payout claim amount is computed server-side from the rule (Admin-only override within min/max); duplicate claim per loan/claimant/capacity blocked; status changes Admin/Accounts only; delete Admin only.

### ✅ Decision taken — Applications Advanced Filter now server-side (`7415080`)
Owner: "Filter server-side banao". All 18 predicates are `LoanFilterDto` fields applied in `LoanRepository.ApplyListFilters` (list + export share it); dropdown options come from `GET /api/loans/filter-options` (caller's visibility scope). Found and fixed on the way: the **date filter was silently ignored** (client sent `dateFrom/dateTo`, API binds `FromDate/ToDate`), and **Export / Reports export contained only 10 loans** (`pageSize: 5000` is clamped to 10 by the API) — both now fixed (`loansApi.getAll` mapping, `loansApi.getAllPages`). Verified on PostgreSQL (totals across pages, channel, bounds, date, per-role options) and in the browser (Apply sends the params). _Original analysis:_
~20 Advanced Filter predicates (amount, CIBIL, sales person, location, city, state, company, DSA, partner, bank, salary, …) run in `applyClientSideFilters` on **only the current page** (25 rows) returned by the server, while the total and page numbers stay unfiltered — matching applications on other pages are silently not shown (legacy filtered its full in-memory list). Options: (a) move these predicates server-side (`LoanFilterDto` + `LoanRepository`), or (b) when an advanced filter is active, fetch all pages (`utils/fetchAllPages`) and paginate client-side. Not changed.

### OBSERVED_ONLY (module 3)
- **SLA automation across ECS replicas:** `SlaAndTaskAutomationService` selects loans with `SlaBreachNotifiedAt == null`, then marks them at the end of the run; the daily digest checks `report_digest_last_sent` then sends. Two replicas whose runs overlap could both notify / both send. Not reproducible here (needs two instances firing in the same instant). Recommended fix if you run >1 task: claim each loan with an atomic `UPDATE … WHERE "SlaBreachNotifiedAt" IS NULL` (rows-affected = 1 → create its notification/task) inside one transaction, and the same compare-and-set for the digest timestamp.
- `LoanService.UpdateStatusAsync` uses EF `Update()` (marks every column modified); with the new status token a concurrent status change is caught, but concurrent edits to *other* loan fields in the same instant are still last-write-wins.

---

## 4 — Integrations (IN_PROGRESS)

| Integration | Finding | Status |
|---|---|---|
| Perfios | see 7B — 3 persistence/binding bugs fixed | DONE |
| InCred | raw proxies + token exposure fixed (module 1); create/refresh gated | DONE (live API BLOCKED: no credentials) |
| InCred webhook | shared-secret header, constant-time compare — **but only when `incred_webhook_secret` is configured; otherwise unauthenticated calls are accepted (warning logged)**. A DISBURSED/SUCCESS webhook is what allows an InCred loan to be marked Disbursed. | ❓ decision: configure the secret in prod and make it mandatory in Production |
| Secrets at rest | InCred client secret, SMTP password, AI keys encrypted with ASP.NET Data Protection; keys persisted in PostgreSQL (`PostgresXmlRepository`) without a key-encryption certificate ("No XML encryptor configured") — keys live next to the ciphertext | OBSERVED |
| S3 | `S3FileStorageService` private ACL, NotFound→null; Production refuses to start without a bucket | code reviewed; live S3 **BLOCKED** |
| Email/SMTP | `/api/email/send` returns 200 + `success:false` on SMTP failure (React now checks it everywhere) | live SMTP **BLOCKED** |
| Bureau | dead code removed (`1ec19c9`); CIBIL (`CibilController`) is the live credit-report feature | DONE |

---

## X — Cross-cutting (IN_PROGRESS)

### Config / environment / deployment (reviewed)
- No real secrets committed. JWT key and DB connection string come from AWS Secrets Manager in `deploy/aws/ecs-task-def.json`; a dev-only JWT key sits in `launchSettings.json` (fine).
- ⚠️ **❓ Decision — default seed accounts in production:** `Program.cs` creates `admin@efin.com`, `manager@efin.com`, `sales@efin.com` on every startup in **every** environment with fallback passwords `Admin@123` / `Manager@123` / `Sales@123` unless `Seed__AdminPassword` / `Seed__ManagerPassword` / `Seed__SalesPassword` are set — and the production task definition sets none. It also forces them `IsActive = true` and un-deletes them on every restart, so an Admin **cannot permanently disable** these accounts (a deactivation is undone at the next deploy). Existing passwords are never overwritten, so production is only exposed if these accounts still have the defaults. Recommended: rotate these passwords now; then either supply `Seed__*` secrets or stop seeding manager/sales in Production and let deactivation stick.
- Production hides exception details (`ExceptionMiddleware`: generic message unless Development).

### Failure handling
- Fixed: bodiless 500s on audited writes (module 3 #2); concurrency conflicts → 409.
- React now surfaces every mutation failure (C2).

### Pagination
- Server paging correct (count and items from the same scoped query). Client-side Advanced Filter gap → decision (module 3).

### Completed in the continuation pass (2026-09-23)
| # | Area | Finding | Fix / result | Verification |
|---|---|---|---|---|
| 1 | ⚠️ Money (module 3) | Approve accepted `approvedAmount` -5000 (stored with EMI -235.37) and 0; sanction details and bank lines stored negative amounts/rates/tenure | approve needs a positive amount when supplied; sanction/bank-line values cannot be negative (no cap vs requested amount — that would be a new rule) | PG: -5000/0 → 400, loan untouched; 450000 → 200, EMI 21183.06; unit theory fails without fix (`ae19c66`) |
| 2 | ⚠️ Security / audit trail | InCred `clientSecret`, AI `apiKey`, SMTP `smtpPass` (stored encrypted in settings) were copied **in plain text** into `AuditLogs` by `AuditMiddleware` | mask list extended (+ reset token, confirmPassword, secret-looking `{key,value}` settings) | PG probe: 3 leaks before → 0 after; settings still save; 5/6 masking tests fail without fix (`42a3b9c`) |
| 3 | Settings | Saving the email configuration **after "Clear"** → duplicate-key 500 (`IX_AppSettings_Key_OrgWide_Unique`) | reactivate the soft-deleted row (`IgnoreQueryFilters`) | PG: save → clear → save = 200, one row (`948495d`) |
| 4 | Performance (frontend) | global React Query `retry: 1` re-sent every 4xx (e.g. 404 fetched twice) | retry once only for network/timeout/5xx | browser: GET /api/loans/999 → single 404 (`82fe44b`) |
| 5 | Legacy (C1) | legacy shell source of stale "deleted" data | `/index.html` → 302 `/` | `2ba7ab1` |

**Checked and found OK (no change):**
- **Workflow engines:** FOIR/obligations and income-verification engines are covered by the suite (`ObligationFoirEngineTests`, `IncomeVerificationEnginePhase4Tests`, `TrustedIncomePhase7Tests`, …) and were parity-verified against legacy earlier; wizard submit/draft/validate guard amount, tenure (1–360) and rate, so EMI can't divide by zero; obligations reject negative EMI/sanction/outstanding.
- **Committed secrets:** full-repo `git grep` (incl. scripts, compose, markdown) — none; scripts use variables.
- **N+1:** no query-in-loop on any user-facing read path (only a few settings keys and the SLA background job, one lookup per breached loan).
- **API contract:** Loan, LoanListItem, Customer, User, DashboardStats — no field the frontend expects that the API never sends (`_scripts/contract_diff.js`).
- **UI sweep (Admin, in-app browser):** all 28 React routes and all 11 loan-detail tabs rendered with **0 console errors and 0 failed API calls** (404 only for a non-existent loan id, as expected); unknown routes redirect to the dashboard; mobile-width layout renders cleanly.

**OBSERVED_ONLY (continuation):**
- Existing production `AuditLogs` rows may already contain InCred/AI/SMTP secrets in plain text from before `42a3b9c` — ❓ decision: rotate those credentials and/or purge the affected rows (`WHERE "EntityName"='Settings'`).
- Other `AppSettings` upserts (ExpertExport config, TAT targets, notification settings, InCred webhook logs, SLA digest timestamp) have the same soft-delete lookup pattern; they can only fail if their key is removed through the generic `DELETE /api/settings/{key}`, which no React screen calls — not changed.
- Audit trail stores new values only; old (before) values exist just for payout status and Admin overrides.
- Unbounded list reads: Tasks, Tickets, Payout claims (admin/accounts), InCred applications and the report endpoints load all matching rows (reports aggregate in the DB). Fine at current volume; add paging if these tables grow large.
- Advanced Filter decision: done (`7415080`).
