# LoanMS (MudraHub): codebase cleanup audit

**Date:** 2026-09-24
**Source:** `LoanMS-Deploy-2026-09-23 (1).zip`, extracted to `Downloads/LoanMS-Cleanup-2026-09-24/LoanMS`
**Git baseline:** commit `621d9da` (a fresh `git init` of the ZIP exactly as shipped)
**Status:** A1–A11, B1, B3, B4, B5, C7, D3, D6 and N1–N3 were approved and have been applied (see **§8 Execution log**). Every other item is untouched and still waiting for your decision.

---

## 0. How to read this report

| Field | Meaning |
|---|---|
| **ID** | Quote it when you approve, e.g. "A1, A5, B3 approve; C3 no". |
| **Confidence** | How sure I am that the item is really unused or redundant. **High** means verified by a tool (import graph, Roslyn analyzer, route cross-check) and also by a manual grep across frontend, backend, tests and legacy. **Medium** means verified inside the repo, but something outside the repo (an external caller, ops usage) cannot be ruled out. **Low** means a suspicion only. No item is marked "100% dead", because no static check can prove that. |
| **Risk** | The chance that removing it breaks something. **Low**: build and tests will catch any mistake, and runtime behaviour does not change. **Medium**: touches money math, a public API or tests. **High**: could change behaviour. |
| **Verdict** | ✅ Recommend removing · ⚠️ Needs your decision (feature or product question, not a cleanup question) · ⛔ Recommend keeping (reported for information only) |

### Methods used (evidence)

1. **Frontend import graph** (script `fe-graph.mjs`): resolves every `import` / `import()` / `vi.mock` from `src/main.tsx` onward, including the `@/` alias and lazy routes. It gives a list of files the app can reach and a list of files only tests can reach. Every candidate was then confirmed by hand with `grep -rn <name> frontend/src frontend/scripts index.html vite.config.ts vitest.config.ts`.
2. **Unused exports:** for each `export`, whether any other file imports that name.
3. **Unused API-client methods:** for each `xxxApi.method`, whether any `xxxApi.method` reference exists anywhere in `src`.
4. **Backend type references** (script `cs-refs.mjs`): for every class/record/interface/enum, how many times it is referenced outside its own file (production vs tests vs migrations).
5. **Backend method call sites** (script `cs-calls.mjs`): declarations with no usage line in production code.
6. **Roslyn analyzers:** a one-off `dotnet build -p:EnforceCodeStyleInBuild=true` with IDE0051 (unused private member), IDE0052 (assigned but never read), IDE0059 and IDE0060 set to warning. The `.editorconfig` was temporary and was deleted afterwards (`git status` is clean).
7. **Route cross-check** (script `routes.mjs`): every `[Http*]` endpoint in the 41 controllers compared with every `/api/...` string in the React source. Result: 274 endpoints, 238 referenced by React, 36 not referenced.
8. **Duplicate search:** `grep` for EMI formulas (`Math.Pow`/`Math.pow`), INR formatters (`en-IN`), CSV/download helpers (`createObjectURL`, `csvEscape`), role maps, and `cmp` on the scripts.

### Baseline (before any change; all run in this session)

| Check | Result |
|---|---|
| `dotnet build LoanMS.slnx` | ✅ 0 errors, 3 warnings (pre-existing, e.g. EF1002 in a test) |
| `dotnet test` | ✅ **396/396 passed** |
| `npm run build` (tsc -b + vite) | ✅ passed. The output is **byte-identical** to the `wwwroot/react` in the ZIP (`git status` was clean after the build). |
| `vitest run` | ✅ **25 files, 312/312 passed** |
| `npm run lint` | ❌ Exit 1, but only because of the gate: **0 errors, 19 warnings** (`no-non-null-assertion` ×18, `no-explicit-any` ×1) against `--max-warnings 0`. This failure is **pre-existing** and not part of the cleanup scope. It is noted here only. |

---

## 1. Legacy vanilla-JS frontend (`wwwroot`): status (point 6)

**The legacy frontend has not been removed. It is still on disk and it still ships.** I have not touched any of it.

| Item | Current state | Evidence |
|---|---|---|
| `LoanMS.API/wwwroot/index.html` (664 KB) | Still in the repo. **Requests for `/index.html` get a 302 redirect to `/`**, which serves React. | `Program.cs:829-837` |
| `wwwroot/js/` (30 files, 5.0 MB), `wwwroot/css/` (6 files, 372 KB), `wwwroot/perfios/` (248 KB), `elitetru-logo.jpg`, `START_SERVER.bat` | Still in the repo. **They are still publicly served** by `UseStaticFiles` (`Program.cs:840`). Going by the code, `/js/efin-app.js`, `/css/app.css` and `/perfios/index.html` are served directly (I read this from the code; I did not run a live server test). | `Program.cs:839-852` |
| Does React depend on these files? | **No.** `frontend/src` mentions `wwwroot/js`, `/perfios/` etc. only in comments. There are 0 imports or runtime URLs. React's own assets are `wwwroot/react/assets/*`. | grep `elitetru\|/perfios/\|/js/\|/css/\|pdf.worker` over `frontend/src`, `frontend/index.html` |
| Docker image | The whole `LoanMS.API/` tree is copied, so the roughly 6.3 MB of legacy files go into the production image. | `deploy/docker/Dockerfile` |
| Stale comments | `Program.cs:817-822`, `:876-881` and `:915-920` still say "the legacy shell is reachable at `/index.html` (escape hatch)". The code on the very next lines redirects that path, so these comments are now wrong (see D3). | — |

> Removing or blocking legacy files is a separate decision (**L1**, outside this cleanup). I will not touch them until you say so explicitly. Per the earlier decision, legacy is kept only as the parity reference. If you want, blocking only the static serving (not deleting the files) would be one small code change, but that also waits for your approval.

---

## 2. Category A: Dead code

(Code that no one calls, imports or references)

| ID | What | File / location | Evidence | Confidence | Risk | Verdict |
|---|---|---|---|---|---|---|
| **A1** | `ApplyPostgresOptimizationsAsync` (the entire `AppDbContextExtensions` class; it creates 4 `CREATE INDEX CONCURRENTLY` indexes) | `LoanMS.Infrastructure/Data/AppDbContextExtensions.cs` (54 lines, whole file) | `grep -rn ApplyPostgresOptimizationsAsync` over all `*.cs` finds only the declaration. Program.cs never calls it. The analyzer confirms it. **Since it never runs today, deleting it changes nothing.** | High | Low | ✅ |
| **A2** | **Temporary debug endpoint** `GET /api/loans/{id}/debug-permissions` (`DebugPermissions`) | `LoanMS.API/Controllers/LoansController.cs:74-154` | The code's own comment says "TEMPORARY DEBUG ENDPOINT — remove after the Tab Data Access masking issue is diagnosed". There are 0 references in React, legacy JS or tests. The unused `id` parameter is flagged by IDE0060. **Extra concern:** it has no `[Authorize(Roles=...)]`, so any logged-in user can read the raw `efin_role_permissions` JSON. It also contains a hand-made copy of `RoleKeyMap` (see B2). | High (in-repo); Medium (possible manual use from outside) | Low | ✅ (backend change, so it needs your explicit OK) |
| **A3** | Private fields that are assigned but **never read** (plus the constructor injection that feeds them) | `CustomerService._cache` (`Application/Services/CustomerService.cs:10`), `LoanService._cache` (`LoanService.cs:11`), `WizardController._cache` (`API/Controllers/WizardController.cs:21`), `CibilController._cfg` (`:30`), `NotificationsController._cfg` (`:20`), `ObligationService._log` (`Infrastructure/Services/ObligationService.cs:27`), `MemoryCacheService._log` (`Infrastructure/Services/CacheService.cs:75`) | Roslyn IDE0052. `grep "_cache\."` in CustomerService, LoanService and WizardController = 0. The code's own comments say the list caching was removed earlier. | High | Low–Medium: removing the constructor parameters means updating the `new CustomerService(...)`, `new LoanService(...)` and `new WizardController(...)` calls in 4 test files (only the constructor arguments change, no assertions). | ✅ |
| **A4** | Unused constants `EXCELLENT_MIN`, `GOOD_MIN`, `FAIR_MIN`, `POOR_MIN` | `LoanMS.Application/Services/CibilAnalysisService.cs:22-25` | Roslyn IDE0051 | High | Low | ✅ |
| **A5** | `IJwtService.GetUserIdFromToken` and its implementation | `Application/Interfaces/Services/IJwtService.cs:10`, `Application/Services/JwtService.cs:65` | Only the two declarations exist. There are 0 callers in production and 0 in tests. | High | Low | ✅ |
| **A6** | `ILoanRepository.GetLoansByCustomerAsync` and its implementation | `Application/Interfaces/Repositories/ILoanRepository.cs:27`, `Infrastructure/Repositories/LoanRepository.cs:1108` | Only the two declarations. 0 callers. | High | Low | ✅ |
| **A7** | `IGenericRepository.ExistsAsync(int id)` and its implementation | `Application/Interfaces/Repositories/IGenericRepository.cs:13`, `Infrastructure/Repositories/GenericRepository.cs:46` | `grep "\.ExistsAsync("` matches only `LocalFileStorageServiceTests` (a different interface). This one has 0 callers. | High | Low | ✅ |
| **A8** | `ICacheService.RemoveByPrefixAsync` and its 2 implementations, plus the `_keys` HashSet and locks that exist only to support it | `Application/Interfaces/Services/ICacheService.cs:11`, `Infrastructure/Services/CacheService.cs:63,109` (+ `_keys` tracking in `SetAsync`/`RemoveAsync`) | There are **0 production callers**. The only references are the test mocks' `Setup(...)` and `Verify(..., Times.Never)` in `CustomerServiceTests.cs:29,127` and `LoanServiceTests.cs:36,313`. The Redis implementation is already a no-op. | High | Medium: an interface change, and those 4 test lines have to go too. | ✅ (together with A3) |
| **A9** | Frontend unused exports | `hooks/useLoans.ts`: `useCreateLoan` (so `loansApi.create` becomes unused too) · `hooks/usePermissions.ts`: `useHasRole`, `useHasAnyPermission`, `useHasAllPermissions` · `utils/format.ts`: `formatNumber`, `formatRelativeDate`, `PRIORITY_COLORS`, `cibilTierMeta` · `components/ui/Skeleton.tsx`: `CardSkeleton` · `constants/advFilter.ts`: `distinct` · `utils/perfios/types.ts`: `PerfiosSummary` (interface) | Import graph plus `grep -rnw <name> src scripts`: each name appears only at its declaration. | High | Low (tsc/vite will catch any mistake) | ✅ |
| **A10** | Frontend API-client methods that are never called | `aiApi.customerSummary`, `.underwriting`, `.caseInsight`, `.generateNotes` (`api/aiApi.ts:15-27`) · `assignmentAuditApi.createEntry` · `authApi.refresh` (the axios interceptor makes its own raw `axios.post('/api/auth/refresh')` call at `api/axios.ts:61`) · `customersApi.getAll`, `.create` · `dsaApi.downloadDocument` · `incomeVerificationApi.history` · `loansApi.update`, `loansApi.create` · `obligationsApi.getByLoan` · `ticketsApi.update` · `usersApi.getById` | A search for `xxxApi.method` across all of `src` found 0 production references. Only the client wrapper goes; **the backend endpoints stay** (see C5). | High | Low | ✅ |
| **A11** | `utils/foir.ts` (150 lines), the old client-side FOIR engine | `frontend/src/utils/foir.ts` | The import graph shows the app never imports it. Only `foir.test.ts` and `foir.verified-abb.test.ts` do. The backend `ObligationFoirEngine` (ported from this file) is now the FOIR authority. Deleting it removes those 2 test files, **so the vitest count will go down.** | High | Low | ⚠️ (tell me whether you want to keep it as a parity reference) |
| **A12** | `LoansController.CalculateEmi`, `GET /api/loans/calculate-emi` | `LoanMS.API/Controllers/LoansController.cs:861-880` | No React caller. Only legacy `efin-app.js` calls it, and legacy is unused. | Medium (public API) | Medium | ⛔/⚠️ I lean towards keeping it (it is also part of the EMI duplicate in B1) |
| **A13** | `IFileStorageService.ExistsAsync` (Local + S3) | `Application/Interfaces/IFileStorageService.cs:36` | 0 production callers, but `LocalFileStorageServiceTests` use it to verify deletes. | High | Medium | ⛔ Keep (it is useful test infrastructure) |

---

## 3. Category B: Duplicate / redundant logic

| ID | What | Locations | Difference / risk | Confidence | Risk | Verdict |
|---|---|---|---|---|---|---|
| **B1** | **The EMI formula is written 4 times in the backend** | `LoansController.cs:868-871` (CalculateEmi endpoint), `WizardController.cs:59-65` (`CalcEmi`), `LoanService.cs:1013-1020` (`CalculateEmi`), `ObligationFoirEngine.cs:256-264` (`CalculateEmi`, public static) | The formula and the rounding (`Math.Round(…,2)`) are the same. **Difference:** only ObligationFoirEngine guards `months<=0 \|\| principal<=0` and returns 0; the other three would divide by zero. A single shared helper must keep **each caller's current guard as it is**, otherwise the edge-case behaviour changes. | High | **Medium (money math)** | ⚠️ Optional. If approved: one static helper plus a unit test per caller that proves identical output. |
| **B2** | `RoleKeyMap` copied by hand | `RolePermissionService.cs:37` (the real one) and `LoansController.cs:~101` (inside DebugPermissions) | The copy's own comment says "keep in sync". It disappears automatically with A2. | High | Low | ✅ (via A2) |
| **B3** | **Same INR formatter written 3 times** | `pages/wizard/wizardConstants.ts:319` `fmtINR`, `components/shared/PerfiosModal.tsx:14` `fmtINR`, `components/shared/SalarySlipExtractionModal.tsx:19` `fmtINR` | All three are exactly `new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n)`, which is the same as `utils/format.ts` `formatCurrency` (for non-null numbers). Replacing them gives the **same output character for character**. | High | Low | ✅ |
| **B3b** | `'₹' + Math.round(n).toLocaleString('en-IN')` pattern, 5 copies | `BankEligibilityMatch.tsx:136` `inr`, `LoanVerificationChecks.tsx:31` `fmtInr` (+ an inner `fmt` at `:904`), `IncomeVerificationPanel.tsx:23` `fmtInr`, `features/ai/agentLoop.ts:22` `inr` | This is **not the same** as `formatCurrency`: negative numbers print as `₹-500` instead of `-₹500`. So these must not be merged into `formatCurrency`. They could share one helper of their own, `inrRounded()`. The gain is small. | High | Low | ⚠️ Optional (I lean towards skipping it) |
| **B4** | CSV escaping and blob-download code, 2–4 copies | `csvEscape` in `utils/loanExport.ts:39` and `utils/reportExport.ts:33` (same logic). The anchor-download code appears in `loanExport.downloadCsv:144`, `reportExport.downloadBlob:138`, `pages/dashboard/DashboardWidgets.tsx:208-214` (inline) and `pages/DsaPage.tsx:148-152` (inline). | Minor differences: `revokeObjectURL` runs immediately in one place and after 1 s in another. Merging them into `utils/csv.ts` (which already describes itself as "Shared CSV helpers") would not change any file content or filename. | High | Low | ✅ |
| **B5** | **Duplicate migration and start scripts** | `scripts/1-build-and-push-migration-image.ps1`, `2-register…ps1`, `3-RUN-MIGRATION…ps1`, `apply-migrations.sh`, `apply-migrations-cloudshell.sh` are **byte-identical** (`cmp`) to the copies in `scripts/migration/`. `scripts/START.bat` and `scripts/local-dev/START.bat` differ only in the `cd` path. | The scripts' own output text points to `.\scripts\3-RUN-MIGRATION-run-task.ps1`, which is the root copy, so the canonical copy is `scripts/`. Proposal: delete `scripts/migration/{5 duplicates}` and `scripts/local-dev/START.bat`. **`fix_sqlite_schema.py` stays**, because the SQLite dev path still exists (`Program.cs:170`). | High | Low | ✅ |
| **B6** | Intentional mirrors (reported only) | `utils/salarySlipExtraction.ts` ↔ `SalarySlipTextParser.cs`; the Perfios TS engine (`utils/perfios/*`) ↔ `PerfiosNormalizationService.cs` | By design: the client shows a preview and the server is the trusted authority (the C# file's own comment says "FAITHFUL C# port … so backend re-derives"). Removing either one would break a feature. | — | High | ⛔ Keep |

---

## 4. Category C: Unused components / files

> ⚠️ **Important:** the C1–C4 items look like "unused" code, but in reality they are **Vanilla features that were ported to React and never wired into the UI** (orphans). Deleting them means dropping a feature, and wiring them up means adding a feature. **Both are product decisions, not cleanup.** That is why I am only reporting them.

| ID | What | File | Evidence | Confidence (unused) | Risk (if deleted) | Verdict |
|---|---|---|---|---|---|---|
| **C1** | `LiveEligibilityPreview` component (a port of Vanilla `wLiveEligibilityPreview`, `efin-app.js:20059`) | `components/shared/BankEligibilityMatch.tsx:516-569` | Exported but never rendered (0 JSX references). | High | Medium (feature loss) | ⚠️ Wire it into the wizard, or delete it? |
| **C2** | AI Agent "Akshiv" loop: `features/ai/agentLoop.ts` (80 lines) + `api/aiAgentRunsApi.ts` (74 lines), and on the backend `AiAgentRunsController` plus the `AiAgentRuns` table | frontend + `LoanMS.API/Controllers/AiAgentRunsController.cs` | The app imports neither (only `agentLoop.test.ts` does). No component renders the agent panel. | High | Medium | ⚠️ Decision (the migration and table would stay in any case) |
| **C3** | **The automatic lender email on stage change never fires.** `useUpdateLoanStatus()` + `fireLenderEmailOnStageChange()` | `hooks/useLoans.ts:91-145` | No component uses the hook. Status changes go directly through `loansApi.updateStatus` (`LoanVerificationChecks.tsx:605,1164`) and never reach this code. Meanwhile `LenderEmailCard.tsx:66` has a comment claiming that "auto-fire is implemented". **This is a functional gap, not dead code.** | High | High (deleting it would bury a Vanilla feature for good) | ⚠️ **Do not delete.** This belongs in a separate parity fix. |
| **C4** | **CIBIL module:** `CibilController` (12 endpoints), `CibilAnalysisService`, `DTOs/Cibil/*` (18 DTOs) | backend | React calls none of these endpoints. **Related bug:** the "Open CIBIL Check" button at `LoanDetailPage.tsx:469` navigates to `/cibil`, but `AppRoutes.tsx` has **no `/cibil` route**, so the `*` fallback sends the user to the dashboard. | High (unused by React) | High | ⛔ Keep. This is a missing feature or broken link, not dead code (report only). |
| **C5** | Backend endpoints with no React caller (apart from C2/C4/A2/A12) | `AI`: `dashboard/insights`, `document/tag`, `loan/{id}/underwriting`, `case-insight`, `notes`, `customer summary` · `AssignmentLog GET` · `auth/me` · `Customers check-pan`, `search` · `Incred token` · `Loans override-status`, `export` · `Notifications settings` (GET/POST), `webhook`, `test-webhook` · `Reports export` · `Settings batch` · `Users {id}/photo` | Route cross-check. Some of these are called by legacy JS only. **`POST /api/Incred` is InCred's external webhook, so it must be kept.** | Low–Medium (external or ops use cannot be ruled out) | High (public API) | ⛔ Report only, not recommended for deletion |
| **C6** | `api/accountDetailsApi.ts` (28 lines) + `utils/accountExtraction.ts` (109 lines), bank-statement account-detail extraction | frontend | The import graph cannot reach them (not even tests import them). The Vanilla equivalent exists in `efin-app.js`. | High | Low (as code) / Medium (feature) | ⚠️ Delete, or keep as an orphan feature? |
| **C7** | `frontend/dist-node/` (`vite.config.js`, `.d.ts`) | frontend | This is `tsc -b` output from `tsconfig.node.json` (outDir). It is in `.gitignore` but was **included in the ZIP**. It is regenerated on every build. | High | Low | ✅ (only exclude it from the ZIP / delete it) |
| **C8** | `frontend/scripts/__mock.js.disabled`, `perfios-analysis-check.ts`, `perfios-parity-check.ts`, `perfios-upload-check.ts` | frontend/scripts | No `package.json` script and no config references them. They were one-off verification harnesses (their own headers say so). | High | Low | ⚠️ Your call (they may still be useful as verification tools) |
| **C9** | Repo-level artifacts: `design-mockups/` (4), `tools/runtime-verify-harness/` (5), `verification/cross-device-sim/` (2), root dated reports (`APPROVAL_DETAILS_PARITY_2026-09-11.md`, `LOANMS_*_2026-09-1x.md`, `OVERVIEW_*_2026-09-21.md`, `WIZARD_PARITY_VERIFICATION_2026-09-12.md`, `AUDIT_INVENTORY.md`, `AUDIT_PROGRESS.md`) | root | No code, build, Docker or CI references any of these. They are docs and verification history. | High (not part of the build) | Low | ⚠️ Your call: delete, or move to `docs/archive/`? |

---

## 5. Category D: Unnecessary complexity

| ID | What | Location | Suggestion (behaviour unchanged) | Confidence | Risk | Verdict |
|---|---|---|---|---|---|---|
| **D1** | `MemoryCacheService` tracks every key in `_keys` with locks, only so that `RemoveByPrefixAsync` can work, and nothing calls it | `Infrastructure/Services/CacheService.cs:75-120` | Removed together with A8. `GetAsync`/`SetAsync`/`RemoveAsync` behave exactly as before. | High | Low–Medium | ✅ (with A8) |
| **D2** | `ICacheService` injected into 3 classes but never used | CustomerService / LoanService / WizardController | Covered by A3. One less DI dependency each. | High | Low | ✅ (with A3) |
| **D3** | `Program.cs` is 1,040 lines, mostly long historical "ROOT CAUSE FIX" narrative comments. Some comments now **contradict the code** (see §1). | `LoanMS.API/Program.cs:766-781`, `:817-822`, `:876-905`, `:915-938` | **Comment-only change:** fix the stale or contradictory comments and shorten the history to 1–2 lines each. 0 code-line changes. | High | Low | ✅ (optional) |
| **D4** | Controllers use `AppDbContext` directly and skip the Application layer (a Clean Architecture violation). The largest: `IncredController` 1,378 lines, `LoansController` 1,329, `WizardController` 1,311. | API/Controllers | Moving this into services is a large refactor with high behaviour risk. **Not recommended in this cleanup.** | — | High | ⛔ Report only |
| **D5** | About 60 frontend symbols carry `export` although they are used only inside their own file (for example the types in `wizardConstants.ts` and `cam.ts`) | various | Removing the `export` keyword gains little and adds noise to the diff. | High | Low | ⛔ Skip |
| **D6** | devDependencies `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` are not used directly | `frontend/package.json` | `eslint.config.js` uses the `typescript-eslint` meta package, which already includes both. Removing them means regenerating `package-lock.json`. (Meanwhile `@eslint/js` is imported but not declared; it works only as a transitive dependency.) | High | Low | ✅ (optional) |
| **D7** | `TableSkeleton` / `CardSkeleton` are just `LoadingSpinner` wrappers (a comment says the props are "kept for API compat") | `components/ui/Skeleton.tsx` | `CardSkeleton` goes in A9. `TableSkeleton` is in use, so it stays. | High | Low | (via A9) |

---

## 6. Proposed commit plan (only for items you approve)

One commit per category/module. After **each** commit: `dotnet build` + `dotnet test` + `npm run build` + `vitest run`, with the PASS/FAIL result shown to you.

| # | Commit | Items | Touches backend? |
|---|---|---|---|
| 1 | `chore(frontend): remove unused exports & API-client methods` | A9, A10 | No |
| 2 | `chore(frontend): dedupe INR formatter + CSV/download helpers` | B3, B4 | No |
| 3 | `chore(backend): remove temporary debug-permissions endpoint` | A2 (+B2) | **Yes** |
| 4 | `chore(backend): remove dead repo/jwt/db-extension methods & unused constants` | A1, A4, A5, A6, A7 | **Yes** |
| 5 | `chore(backend): drop unused ICacheService injections & RemoveByPrefix` | A3, A8, D1, D2 (+ constructor args in 4 test files) | **Yes** |
| 6 | `chore(repo): remove duplicate scripts & build artifacts` | B5, C7 | No |
| 7 | `docs(program): fix stale legacy comments` | D3 | Comment-only |
| — | Only if you decide | A11, B1, B3b, C1, C2, C6, C8, C9, D6 | — |

**Brand colours (point 7):** none of the items above touches colour tokens, `tailwind.config.js`, `globals.css` or any `#0a589a` / `#e31e25` / `#1a7340` / `#e67e00` value.

---

## 7. Found along the way (outside cleanup scope, not fixed)

1. **C3:** the automatic lender email on stage change is not wired.
2. **C4:** the `/cibil` route is missing, so the "Open CIBIL Check" button lands on the dashboard.
3. **Lint gate:** 19 pre-existing warnings, so `npm run lint` exits 1.
4. **Legacy static files:** still publicly served (§1).
5. `EmailService.SendViaSmtpAsync` (`Infrastructure/Services/EmailService.cs:194`) accepts `toName` but ignores it (IDE0060): the SMTP "To" header carries only the address, not the name. This could be a small bug, so I have **deliberately not listed it as cleanup**.

---

## 8. Execution log (2026-09-24)

**Approved by you:** A1, A2, A9, A10, B3, B4, B5. **Done:** all 7, in 5 commits. Every other item is untouched and still waiting for your decision.

| Commit | Items | Change | Result after the commit (run in this session) |
|---|---|---|---|
| `ca174e1` | A9, A10 | frontend: removed 12 unused exports and 17 unused API-client methods (−171 lines) | FE build ✅ · vitest 312/312 ✅ · BE build 0 errors ✅ · BE tests 396/396 ✅ |
| `a097cf0` | B3, B4 | frontend: 3 `fmtINR` copies → `formatCurrency as fmtINR`; 2 `csvEscape` copies → `utils/csv.ts`; 4 download implementations → `downloadBlob` | FE build ✅ · vitest 312/312 ✅ · BE build ✅ · BE tests 396/396 ✅ |
| `14f66b2` | A2 (+B2) | backend: `GET /api/loans/{id}/debug-permissions` and its `RoleKeyMap` copy removed (−82 lines) | FE build ✅ · vitest 312/312 ✅ · BE build ✅ · BE tests 396/396 ✅ |
| `a7067e0` | A1 | backend: `AppDbContextExtensions.cs` deleted (**4** unused `CREATE INDEX` statements, not 3 as the report first said) | FE build ✅ · vitest 312/312 ✅ · BE build ✅ · BE tests 396/396 ✅ |
| `4da4f16` | B5 | repo: 5 byte-identical scripts in `scripts/migration/` and `scripts/local-dev/START.bat` removed; `fix_sqlite_schema.py` kept | FE build ✅ · vitest 312/312 ✅ · BE build ✅ · BE tests 396/396 ✅ |

**Changes beyond the approved list, and only because they were required:**
- Unused imports left behind by a removal were dropped (`CreateLoanRequest` in `useLoans.ts`/`loansApi.ts`, `AIInsightResponse` in `aiApi.ts`, `PagedResult` in `customersApi.ts`). Without this, `tsc` (`noUnusedLocals`) would fail.
- The private `NUM` formatter in `utils/format.ts` was removed with `formatNumber`, its only user.
- The `dsaApi.ts` comment "All three routes…" became "These routes…", because only two client methods remain.
- `wwwroot/react` was rebuilt from the updated source and committed with the frontend commits.

**Brand colours (point 7), verified:** a diff from baseline to HEAD shows that the only colour-bearing lines removed are inside `PRIORITY_COLORS` and `cibilTierMeta`, and nothing referenced either one. No `tailwind.config.js`, `globals.css` or `.css` file changed, and **the built CSS bundle is byte-identical to the baseline.**

**New findings during execution (not touched; waiting for your decision):**
- **N1:** `cibilTier()` and `type CibilTier` (`utils/format.ts`) are now unused, because `cibilTierMeta` was their only user.
- **N2:** `CreateLoanRequest` and `AIInsightResponse` (`types/index.ts`) are now unused types.
- **N3:** a 5th copy of the anchor-download code exists in the KYC-report download at `pages/wizard/steps/Step2.tsx:330-335`. The audit missed it. It could also use `downloadBlob`.
- The lint gate is unchanged: still 19 warnings, none new.

### Second batch: A3, A8, N1, N2, N3

| Commit | Items | Change | Result after the commit (run in this session) |
|---|---|---|---|
| `797e4ae` | A3, A8 (+D1, D2) | backend: `ICacheService.RemoveByPrefixAsync` removed (interface, both implementations, and the `FakeCacheService` test double); `MemoryCacheService` `_keys` tracking and locks removed; 7 never-read fields and their constructor parameters removed | FE build ✅ · vitest 312/312 ✅ · BE build 0 errors ✅ · BE tests **396/396** ✅ |
| `57cd1eb` | N1, N2, N3 | frontend: `cibilTier`/`CibilTier` and the `CreateLoanRequest`/`AIInsightResponse` types removed; the KYC-report download in `Step2.tsx` now uses `downloadBlob` | FE build ✅ · vitest 312/312 ✅ · BE build ✅ · BE tests 396/396 ✅ |

**A correction to what the report said about A3.** It said "only constructor arguments change, no assertions". That was not fully accurate:
- The "never caches" regression tests in `CustomerServiceTests` and `LoanServiceTests` asserted `Verify(..., Times.Never)` on an `ICacheService` mock. Once the services stop receiving that mock, those asserts can never fail and prove nothing, so I removed them. In their place is a **reflection guard**: it checks that the service constructor has no `ICacheService` parameter, so the test fails if a cache is ever added back. The repository read-through asserts (`Times.Exactly(2)`) are untouched. The test count is unchanged (396).
- In `GetAllAsync_NeverTouchesCache`, the two cache verifies were the **only** asserts, so that test now relies on the reflection guard alone.
- `CibilProvenanceTests` and `CibilPaymentHistoryIncludeTests` also build `CibilController`, with target-typed `new(...)`. My earlier grep missed them; the build caught it. In both files only the `new ConfigurationBuilder().Build()` argument and its now-unused `using` were removed.
- In `ObligationService.cs`, the `using Microsoft.Extensions.Logging;` left unused by removing `_log` was also removed. The comment in `Program.cs` that explained the memory-cache singleton through `_keys`/`RemoveByPrefixAsync` was changed to one line, "Singleton, matching the lifetime of the underlying IMemoryCache". **The registration itself (Singleton) is unchanged.**

**Roslyn re-check after `797e4ae`:** all 7 IDE0052 findings are gone. What remains are only earlier findings that you have not approved: A4 (CIBIL constants), the unused `name`/`dob` parameters of `CibilController.Check`, the unused `toName` in `EmailService`, the IDE0059 in PerfiosNormalizationService, and 4 IDE0059 in tests.

**Historical comments left as they are:** `CustomerService.cs:32-33`, `LoanService.cs:66,978` and two test comments still mention `RemoveByPrefixAsync` in their history notes, which explain why the list cache was removed. They have no effect on code.

**Brand colours:** after the second batch, too, the built CSS bundle is byte-identical to the baseline, and no colour token changed.

### Third batch: A4, A5, A6, A7, D3

| Commit | Items | Change | Result after the commit (run in this session) |
|---|---|---|---|
| `96ed1db` | A4–A7 | backend: 4 unused CIBIL constants; `IJwtService.GetUserIdFromToken`, `ILoanRepository.GetLoansByCustomerAsync` and `IGenericRepository.ExistsAsync(int)` removed together with their implementations (−27 lines). Checked again before removal: 0 callers, 0 mock setups, 0 other implementers. | FE build ✅ · vitest 312/312 ✅ · BE build 0 errors ✅ · BE tests 396/396 ✅ |
| `ebe8865` | D3 | `Program.cs` **comment-only**, 1,040 → 954 lines. Proof: with comment and blank lines stripped, the old and new files are identical (`diff`). | FE build ✅ · vitest 312/312 ✅ · BE build ✅ · BE tests 396/396 ✅ |

**What D3 changed:**
- Every comment claiming that the legacy shell is still reachable at `/index.html` (the "escape hatch") was removed. That covers the static-file block, the React-provider block, and the comments above and inside `MapFallback`. The two MapFallback comments were not in the report's D3 line list, but they made the same wrong claim, so they were corrected too.
- The comments now match the code: `/index.html` redirects to `/`, and legacy `/js`, `/css` and `/perfios` are still served statically.
- The long "ROOT CAUSE FIX" / "ROOT CUTOVER" narratives (UseRouting, the always-registered React provider, the `/app` → root 301 redirect) were cut to 3–6 lines each. What remains is the current reason each line exists.
- Left as they were (accurate, not stale): the "SPA fallback guard" comment and the BUGFIX note inside MapFallback about unmatched `/api/*` paths.
- The line numbers in §1 of this report (`Program.cs:817-822` etc.) point to the pre-D3 file. Those stale comments are now fixed.

### Fourth batch: D6

| Commit | Item | Change | Result after the commit (run in this session) |
|---|---|---|---|
| `9cff905` | D6 | `frontend/package.json`: `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` removed from devDependencies (`npm uninstall`) | FE build ✅ · vitest 312/312 ✅ · BE build 0 errors ✅ · BE tests 396/396 ✅ · lint: 0 errors / 19 warnings (same as the baseline) |

**How D6 was checked:**
- In `package-lock.json` only the 2 root devDependency lines changed.
- The installed package set is **identical** before and after: 378 entries, compared by name@version.
- Both packages still come in as dependencies of the `typescript-eslint` meta package, at 8.60.0. A fresh `npm ci` from the new lockfile installed both at that version.
- The React build output did not change, because these packages are used only for linting.
- **Not done** (it was not in the approval, and adding a dependency is a separate decision): `@eslint/js` is imported by `eslint.config.js` but not declared in `package.json`. It works today only as a transitive dependency of `eslint`.

### C7 + live verification + final ZIP (2026-09-24)

**C7:** `frontend/dist-node/` was deleted from disk. This folder is `tsc -b` output from `tsconfig.node.json`, is gitignored, and comes back on every build. So the real fix is that the final ZIP is built **only from tracked files**, and `dist-node`, `node_modules`, `bin`, `obj` and `.git` can never get into it.

**Live API verification on real PostgreSQL:** the API ran in WSL against a fresh DB `loanms_cleanup_0924`, so every EF migration was applied from zero at startup. Result: **20/20 PASS.**
- Every class whose constructor changed is resolved by DI at runtime: `GET /api/customers`, `/api/loans`, `/api/wizard/drafts`, `/api/notifications`, `/api/cibil/check` and `/api/incred/status` (MemoryCacheService) all returned 200.
- E2E write path: `POST /api/customers` → 201 and `POST /api/loans` → 201. `GET` of both, and `GET /api/loans/{id}/obligations/workspace` (ObligationService), returned 200. **psql read the row directly:** `600000.50 | 11.25 | 36 | Personal | <PAN>`, stored exactly.
- A2: `GET /api/loans/{id}/debug-permissions` → 404 "No API endpoint matches".
- D3 did not change routing behaviour: `/index.html` → 302 `/`; `/app/loans/42?x=1` → 301 `/loans/42?x=1`; `/loans/42` → 200 React shell; a missing asset → 404; legacy `/js/efin-app.js` → 200 (legacy untouched).
- `GET /api/dsa/export` → 200 `text/csv`.

**B3 equivalence on the real source:** the removed `fmtINR` (Intl en-IN INR, 0 decimals) and `utils/format.ts` `formatCurrency` gave **identical output for 20,020 values**, including negatives, decimals and very large numbers.

**Browser click-through (after the user logged in):** these ran in Chrome against the same live API + PostgreSQL. A page hook recorded the blob, MIME type and filename of every download, and blocked the actual save to disk. **All 7 PASS; 0 console errors:**

| Flow (changed in) | Result |
|---|---|
| Dashboard → Expert Export (B4) | `expert-export-2026-09-24.csv`, `text/csv`, 174 bytes, the server CSV including the test loan row |
| DSA → Export CSV (B4) | `dsa_partners_export_20260924_053440.csv` (name from Content-Disposition), `text/csv`, 90 bytes, the same 90 bytes as the API check |
| Banks → Bulk Upload → Template (B4, `buildCsv`/`csvEscape`) | `banks-template.csv`, `text/csv`, every cell quoted, empty cells `""` |
| Applications → Export → CSV (B4, `buildLoansCsv`) | `applications-export-2026-09-24.csv`, `text/csv`, header + test loan row, quoted |
| Reports → Export → CSV (B4, `csvEscape` + `downloadBlob`) | `LoanMS_Report_2026-09-24.csv`, `text/csv;charset=utf-8`, 663 bytes, 29 lines, all 16 data rows well-formed |
| Reports → Export → Excel (B4, `downloadBlob`) | `LoanMS_Report_2026-09-24.xls`, `application/vnd.ms-excel;charset=utf-8`, 2218 bytes |
| Wizard Step 2 → Show KYC Report → Download Report (N3) | `KYC_Report_2026-09-24.txt`, `text/plain`, 256 bytes, 13 lines (header + all 11 fields on screen) |

- The Applications list shows the amount as `₹6,00,001`, from `formatCurrency`.
- Reports PDF and Print were not clicked. Their code did not change, and they open a new window or the print dialog.
- To get the wizard past Step 1, one test Location and a mapping for the seeded Sales user were created, **only in the local test DB** (`loanms_cleanup_0924`).

**Final ZIP:** `LoanMS-Deploy-2026-09-24-cleanup.zip`. The top-level folder is `LoanMS/`, the same structure as the original ZIP. It was made from the **working-tree copy of every tracked file**, so every file untouched since the baseline has the same bytes (and line endings) as in the original ZIP.

### Fifth batch: A11, B1

| Commit | Item | Change | Result after the commit (run in this session) |
|---|---|---|---|
| `54257c7` | A11 | `frontend/src/utils/foir.ts` and its 2 test files removed. Its only importers were its own tests, and it was never in the built bundle, which is unchanged. 4 backend comments that pointed to `utils/foir.ts` now say "former frontend utils/foir.ts" (comment-only, proven with the code-only diff). | FE build ✅ · **vitest 23 files / 282 tests** ✅ (30 foir tests removed, as the report warned) · BE build ✅ · BE tests 396/396 ✅ |
| `8ab2e7b` | B1 | New `LoanMS.Application/Services/EmiCalculator.cs`, the one EMI formula. LoansController (endpoint), WizardController (2 call sites), LoanService (4 call sites) and ObligationFoirEngine now use it. Each caller keeps its own guard. | FE build ✅ · vitest 282/282 ✅ · BE build 0 errors ✅ · **BE tests 401/401** ✅ (5 new) |

**How B1 was checked:**
- **The formula is unchanged:** the helper is the exact expression the copies used (`Math.Round(…, 2)`; a 0% rate gives principal / months). It has no guard on `months`, so months == 0 still throws `DivideByZeroException`, exactly as before. ObligationFoirEngine keeps its own `months<=0 || principal<=0 → 0` guard, and the endpoint still returns 400 for amount, rate or tenure `<= 0`.
- **Tests:** `EmiCalculatorTests` compares the helper with verbatim copies of the removed formulas across 1,820 principal/rate/tenure combinations. It also covers the endpoint's rounding, the zero rate, zero months and the FOIR guard. A deliberate mutation (rounding 2 → 3) made 3 of these tests fail. The helper was then restored.
- **Live check on PostgreSQL (API restarted with the new code):** loan 1's `MonthlyEmi` was stored by the **old** code before B1: 600000.50 @ 11.25% × 36 = **19714.36**. Every EMI path reproduced that same value:
  - `GET /api/loans/calculate-emi`
  - `POST /api/loans` (LoanService; the new loan was read back with psql)
  - `POST /api/wizard/validate`
  - the obligations workspace (ObligationFoirEngine)

**Line endings:** some files in the ZIP use CRLF. Git normalises them in the index, and on disk they keep their original ending, as in the ZIP.

---

## Appendix: full inventory (point 1)

Totals: backend has 51 (API) + 121 (Application) + 57 (Domain) + 29 (Infrastructure) = 258 non-migration `.cs` files, plus 69 migration files. `LoanMS.Tests` has 49 `.cs` files. The frontend has 255 files in `src` (including 25 test files). In total, 376 C# types were checked for references.

### LoanMS.API (51 files)

| Folder | Files |
|---|---|
| `.` | `AssemblyInfo`, `PostgresXmlRepository`, `Program` |
| `Controllers` | `AIController`, `AiAgentRunsController`, `AssignmentAuditController`, `AssignmentLogController`, `AssignmentLogHelper`, `AuditController`, `AuditHelper`, `AuthController`, `BanksController`, `CibilController`, `CustomersController`, `DashboardController`, `DsaController`, `EmailController`, `EmailTemplatesController`, `ExpertExportController`, `IncomeVerificationController`, `IncredController`, `KycController`, `LenderConfigController`, `LenderEmailThreadsController`, `LoansController`, `LocationsController`, `NotificationsController`, `ObligationsController`, `PayoutController`, `PayoutRulesController`, `PerfiosController`, `ProductOfferMatrixController`, `RejectionReasonsController`, `ReportTargetsController`, `ReportsController`, `SearchController`, `SettingsController`, `TasksController`, `TeamsController`, `TicketsController`, `TrackingController`, `UserSettingsController`, `UsersController`, `WizardController` |
| `Middleware` | `AuditMiddleware`, `ExceptionMiddleware`, `SecurityHeadersMiddleware` |
| `Services` | `ILoginUserAssignmentService`, `IRolePermissionService`, `LoginUserAssignmentService`, `RolePermissionService` |

### LoanMS.Application (121 files)

| Folder | Files |
|---|---|
| `AI` | `AIDTOs`, `AIService`, `IAIService`, `IAiKeyStore`, `PromptService` |
| `DTOs` | `PerfiosReportDto`, `RmEmailDto` |
| `DTOs/AssignmentAuditLog` | `AssignmentAuditLogDto`, `CreateAssignmentAuditLogRequestDto` |
| `DTOs/Audit` | `AuditLogDto` |
| `DTOs/Auth` | `LoginRequestDto`, `LoginResponseDto`, `RefreshTokenRequestDto` |
| `DTOs/Cibil` | `CibilAccountDto`, `CibilAccountSummaryDto`, `CibilAddressDto`, `CibilBehaviourAnalysisDto`, `CibilCheckResponseDto`, `CibilCustomerProfileDto`, `CibilDPDHeatmapDto`, `CibilDelinquencyTrackerDto`, `CibilEmploymentDto`, `CibilEnquiryAnalysisDto`, `CibilEnquiryDto`, `CibilMonthlyPaymentStatusDto`, `CibilPaymentHistoryDto`, `CibilReportDetailDto`, `CibilRiskAnalysisDto`, `CibilRiskFactorDto`, `CibilScoreDto`, `CibilScoreFactorDto` |
| `DTOs/Common` | `ApiResponseDto`, `DashboardStatsDto`, `LoanFilterDto`, `PagedResultDto`, `RecentActivityDto` |
| `DTOs/Customer` | `CreateCustomerRequestDto`, `CustomerDto`, `UpdateCustomerRequestDto` |
| `DTOs/IncomeVerification` | `IncomeVerificationDtos` |
| `DTOs/Incred` | `IncredDtos` |
| `DTOs/Loan` | `BulkUpdateStatusRequestDto`, `CreateLoanRequestDto`, `LoanBankLineDto`, `LoanDeviationDto`, `LoanDto`, `LoanFilterOptionsDto`, `LoanListDto`, `LoanReferenceDto`, `LoanStatusHistoryDto`, `UpdateLenderRmRequestDto`, `UpdateLoanAssignmentRequestDto`, `UpdateLoanBankLinesRequestDto`, `UpdateLoanOverviewRequestDto`, `UpdateLoanRequestDto`, `UpdateLoanSanctionDetailRequestDto`, `UpdateLoanStatusRequestDto` |
| `DTOs/Obligation` | `CreateLoanObligationRequestDto`, `LoanObligationDto`, `ObligationWorkspaceDtos`, `UpdateLoanObligationRequestDto` |
| `DTOs/PasswordReset` | `ForgotPasswordRequestDto`, `ResetPasswordRequestDto` |
| `DTOs/Payout` | `PayoutAutoCalcDto`, `PayoutRuleDto` |
| `DTOs/Reports` | `MonthlyReportDto` |
| `DTOs/ReportTarget` | `CreateReportTargetRequestDto`, `ReportTargetDto`, `UpdateReportTargetRequestDto` |
| `DTOs/User` | `AdminResetPasswordRequestDto`, `ChangePasswordRequestDto`, `CreateUserRequestDto`, `UpdateProfileRequestDto`, `UpdateUserRequestDto`, `UserDto`, `UserLookupDto` |
| `DTOs/Wizard` | `WizardSubmitDto`, `WizardSubmitResponseDto` |
| `IncomeVerification` | `IPerfiosNormalizationService`, `ITrustedSalaryExtractionService`, `IncomeVerificationEngine`, `IncomeVerificationEngineInput`, `NormalizedBankStatement`, `PerfiosNormalizationService`, `RequiredMonthsCalculator`, `SalaryMath`, `SalarySlipTextParser` |
| `Interfaces` | `ICustomerDeletionService`, `IFileStorageService`, `IIncomeVerificationService` |
| `Interfaces/Repositories` | `ICustomerRepository`, `IGenericRepository`, `ILoanRepository`, `ILoanStatusHistoryRepository`, `IPasswordResetTokenRepository`, `IUnitOfWork`, `IUserRepository` |
| `Interfaces/Services` | `IAuthService`, `ICacheService`, `ICustomerService`, `IEmailService`, `IEmailTemplateProvider`, `IEmployeeCodeGenerator`, `IJwtService`, `ILoanService`, `IObligationService`, `IPasswordResetService`, `IUserService` |
| `Mappings` | `MappingProfile` |
| `Obligations` | `IObligationDetectionService`, `ObligationDetectionService`, `ObligationFoirEngine` |
| `Services` | `AuthService`, `CibilAnalysisService`, `CustomerService`, `DeviationEvaluator`, `JwtService`, `LoanService`, `PasswordResetService`, `UserService` |
| `Validators` | `LoanValidators` |

### LoanMS.Domain (57 files)

| Folder | Files |
|---|---|
| `Entities` | `AiAgentRun`, `AnalyticCategory`, `AnalyticCompany`, `AppNotification`, `AppSetting`, `AssignmentAuditLog`, `AssignmentLog`, `AuditLog`, `BankEligibilityLine`, `BankMaster`, `BankProductCategory`, `BankProductRule`, `BaseEntity`, `BureauReport`, `Customer`, `DsaDocument`, `DsaPartner`, `EmailTemplate`, `IncomeVerification`, `IncomeVerificationMonth`, `IncredRmEmail`, `LenderEmailThreadEntry`, `Loan`, `LoanBankLine`, `LoanDocument`, `LoanObligation`, `LoanOffer`, `LoanReference`, `LoanSanctionDetail`, `LoanStatusHistory`, `LoanTask`, `Location`, `LoginAttempt`, `PasswordResetToken`, `PayoutClaim`, `PayoutRule`, `PerfiosReport`, `ProductOfferMatrix`, `RejectionReason`, `ReportTarget`, `SalarySlipExtraction`, `Team`, `TeamMember`, `Ticket`, `TicketComment`, `TrackingEntry`, `User`, `UserLocation` |
| `Enums` | `ApplicantRole`, `IncomeVerificationReason`, `IncomeVerificationState`, `LoanStatus`, `LoanType`, `ObligationSource`, `ObligationVerificationStatus`, `PartnerType`, `UserRole` |

### LoanMS.Infrastructure (29 files + 69 migration files)

| Folder | Files |
|---|---|
| `AI` | `AiKeyStore`, `AiResilienceHandler`, `ClaudeAIProvider`, `FailoverAIProvider`, `GeminiAIProvider`, `OpenAIProvider` |
| `Data` | `AppDbContext`, `AppDbContextExtensions`, `AppDbContextFactory`, `QueryableExtensions` |
| `Repositories` | `CustomerRepository`, `GenericRepository`, `LoanRepository`, `LoanStatusHistoryRepository`, `PasswordResetTokenRepository`, `UnitOfWork`, `UserRepository` |
| `Services` | `CacheService`, `CustomerDeletionService`, `EmailConfigStore`, `EmailService`, `EmailTemplateProvider`, `EmployeeCodeGenerator`, `IncomeVerificationService`, `LocalFileStorageService`, `ObligationService`, `S3FileStorageService`, `SlaAndTaskAutomationService`, `TrustedSalaryExtractionService` |

### frontend/src (255 files)

| Folder | Files |
|---|---|
| `.` | `main.tsx` |
| `api` | `accountDetailsApi.ts`, `aiAgentRunsApi.ts`, `aiApi.ts`, `aiKeysApi.ts`, `assignmentAuditApi.ts`, `authApi.ts`, `axios.ts`, `banksApi.test.ts`, `banksApi.ts`, `customersApi.ts`, `dashboardApi.ts`, `dsaApi.ts`, `emailConfigApi.ts`, `emailTemplatesApi.ts`, `expertExportApi.ts`, `filterPresetsApi.ts`, `incomeVerificationApi.ts`, `incredCredentialsApi.ts`, `incredLoanApi.ts`, `incredRmApi.ts`, `kycApi.ts`, `lenderConfigApi.ts`, `lenderEmailApi.ts`, `loansApi.ts`, `masterListsApi.ts`, `notificationsApi.ts`, `obligationsApi.ts`, `payoutApi.ts`, `perfiosApi.ts`, `permissionsApi.ts`, `productOfferMatrixApi.ts`, `rejectionReasonsApi.ts`, `reportTargetsApi.ts`, `reportsApi.ts`, `searchApi.ts`, `settingsApi.ts`, `tasksApi.ts`, `teamsApi.ts`, `ticketsApi.ts`, `userSettingsApi.ts`, `usersApi.ts`, `webhookLogsApi.ts`, `wizardApi.ts` |
| `components/auth` | `AuthShell.tsx` |
| `components/settings` | `AdminMasterControl.tsx`, `AiProviderKeysCard.tsx`, `CamMatrixCard.tsx`, `EmailTemplatesCard.tsx`, `IncredCredentialsCard.tsx`, `MasterListsCard.tsx`, `MenuAccessControl.tsx`, `PayoutRulesTab.tsx`, `PermissionChangeHistory.tsx`, `PermissionMatrix.tsx`, `RoleAccessCards.tsx`, `RolesPermissionsTab.tsx`, `SecurityGroupsReference.tsx`, `WebhookLogsCard.tsx` |
| `components/shared` | `ActionQueueWidget.tsx`, `AddBankModal.tsx`, `AdvancedFilterModal.tsx`, `AssignedBanksSection.tsx`, `AssignmentAuditTab.tsx`, `BankBulkConfigGrids.tsx`, `BankEligibilityMatch.tsx`, `BankProductCategoriesTab.tsx`, `BankProductConfigCard.tsx`, `BrandingCard.tsx`, `BulkUploadBanksModal.tsx`, `CamOfferPanel.tsx`, `ClaimStatusModal.tsx`, `CompareLoansMode.tsx`, `DataTable.tsx`, `DeleteCustomerModal.tsx`, `DsaAppsModal.tsx`, `DsaDocumentsModal.tsx`, `DsaMappingOverviewModal.tsx`, `EmailConfigCard.tsx`, `ExpertExportAccessCard.tsx`, `ExportLoansModal.tsx`, `GlobalSearchResults.tsx`, `ImportLinesModal.tsx`, `IncomeVerificationPanel.tsx`, `IncredAppActionsModal.tsx`, `IncredCommentTemplatesCard.tsx`, `IncredRmTab.tsx`, `LenderEmailCard.tsx`, `LenderQuickSetup.tsx`, `LineModals.tsx`, `LoanApplicantTabs.tsx`, `LoanAssignmentCard.tsx`, `LoanDocumentsCard.tsx`, `LoanProductSelectorModal.tsx`, `LoanVerificationChecks.tsx`, `MonthlyTargetsEditor.tsx`, `MyApplicationsTab.tsx`, `NotificationBell.tsx`, `ObligationsWorkspace.tsx`, `OfferInterstitial.test.ts`, `OfferInterstitial.tsx`, `PageHeader.tsx`, `PerfiosAnalysisResults.tsx`, `PerfiosModal.tsx`, `PerfiosTxnPanels.tsx`, `PerfiosUpload.tsx`, `PerfiosWorkflow.tsx`, `PrepaymentMode.tsx`, `ProductOfferMatrixCard.tsx`, `ReportAnalyticsTabs.tsx`, `ReportFilterBar.tsx`, `RequiredDocumentsChecklist.tsx`, `ReverseEmiMode.tsx`, `SalarySlipExtractionModal.tsx`, `SanctionDetailCard.tsx`, `TeamFormModal.tsx`, `TicketDetailModal.tsx`, `TopbarUserMenu.tsx`, `requiredDocLabel.test.ts` |
| `components/ui` | `Badge.tsx`, `BrandLogo.tsx`, `Button.tsx`, `Card.tsx`, `DetailTabBar.tsx`, `GlobalLoader.tsx`, `Input.tsx`, `LoadingSpinner.tsx`, `Modal.tsx`, `NumberInput.tsx`, `Skeleton.tsx`, `States.tsx`, `SubTabBar.tsx`, `Tabs.tsx`, `Toast.tsx` |
| `constants` | `advFilter.test.ts`, `advFilter.ts`, `cam.ts`, `emailTemplates.ts`, `masterLists.ts`, `permissions.ts` |
| `features/ai` | `agentLoop.test.ts`, `agentLoop.ts` |
| `hooks` | `useAuth.ts`, `useBranding.ts`, `useCountUp.ts`, `useLoans.ts`, `usePerfiosUpload.ts`, `usePermissions.ts`, `useSearch.ts`, `useTableSort.ts` |
| `layouts` | `AppLayout.tsx` |
| `pages` | `AuditLogPage.tsx`, `BanksPage.tsx`, `CalculatorPage.tsx`, `DashboardPage.tsx`, `DsaPage.tsx`, `ForgotPasswordPage.tsx`, `IncredPage.tsx`, `IncredTab.tsx`, `LenderConfigPage.tsx`, `LoanDetailPage.tsx`, `LoansPage.tsx`, `LocationsPage.tsx`, `LoginPage.tsx`, `NewApplicationPage.tsx`, `PartnerPage.tsx`, `PayoutPage.tsx`, `PolicyProductPage.tsx`, `ProfilePage.tsx`, `ReportsPage.tsx`, `ResetPasswordPage.tsx`, `SecurityRolesPage.tsx`, `SettingsPage.tsx`, `TasksPage.tsx`, `TeamsPage.tsx`, `TicketsPage.tsx`, `TrackingPage.tsx`, `UsersPage.tsx` |
| `pages/dashboard` | `DashboardWidgets.tsx`, `dashboardData.ts` |
| `pages/locations` | `locationHelpers.tsx` |
| `pages/teams` | `TeamListTab.tsx`, `teamHelpers.ts` |
| `pages/users` | `UserModals.tsx`, `UserWidgets.tsx`, `userConstants.ts` |
| `pages/wizard` | `WizardFields.tsx`, `wizardConstants.ts`, `wizardDocuments.tsx`, `wizardShared.tsx`, `wizardTypes.ts` |
| `pages/wizard/steps` | `Step1.tsx`, `Step2.tsx`, `Step3.tsx`, `Step4.tsx`, `Step5.tsx`, `Step6.tsx`, `Step7.tsx`, `Step9.tsx` |
| `routes` | `AppRoutes.tsx`, `ProtectedRoute.tsx` |
| `store` | `authStore.ts`, `loaderStore.ts`, `loanStore.ts`, `toastStore.ts` |
| `styles` | `globals.css` |
| `test` | `applications-pagination.test.ts`, `dashboard-pipeline.test.ts`, `dashboard-recent-activity.test.ts`, `kyc-extraction.test.ts`, `numericInput.test.ts`, `rbac.test.ts`, `setup.ts`, `wizard-navigation.test.ts`, `wizard-persistence.test.ts`, `wizard-step8-documents.test.ts` |
| `types` | `index.ts`, `react-query.d.ts` |
| `utils` | `accountExtraction.ts`, `apiError.test.ts`, `apiError.ts`, `assignment.test.ts`, `assignment.ts`, `csv.ts`, `draftStorage.ts`, `emi.bundled.test.ts`, `emi.ts`, `employmentType.test.ts`, `employmentType.ts`, `fetchAllPages.test.ts`, `fetchAllPages.ts`, `foir.test.ts`, `foir.ts`, `foir.verified-abb.test.ts`, `format.ts`, `kycExtraction.ts`, `lenderEmailTemplates.ts`, `loanExport.ts`, `loanStage.test.ts`, `loanStage.ts`, `numericInput.ts`, `reportExport.ts`, `salarySlipExtraction.test.ts`, `salarySlipExtraction.ts`, `timelineFormat.test.ts`, `timelineFormat.ts` |
| `utils/perfios` | `analysis.ts`, `calculations.ts`, `categorizer.ts`, `orchestrate.ts`, `parser.ts`, `pdf.ts`, `persist.test.ts`, `persist.ts`, `types.ts` |
