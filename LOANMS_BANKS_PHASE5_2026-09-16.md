# Phase 5 — Banks / Lender Configuration Audit

Date: 2026-09-16
Starting state: Phase 4 cumulative (`LoanMS-Phase4-LoginTeams-2026-09-16.zip`)
Source of truth: `LoanMS.API/wwwroot/js/efin-app.js` (vanilla)

## Scope

Audited Banks end-to-end against vanilla: Bank Configuration, Loan Products,
Product–Bank mapping, `LoanTypesJson`, Max Loan, and Wizard Step 9 Lender
Details. DSA, Partner, Locations and Teams were not touched.

## Audit outcome

The React Banks surface was already largely at parity and was **not** rewritten.
Existing components were reused and fixed in place:

| Area | Vanilla | React | Verdict |
|---|---|---|---|
| Banks grid / CRUD | `renderBanksTable`, `saveBank`, `editBank`, `deleteBank` | `BanksPage.tsx` | Present — RBAC/confirm/Remarks gaps fixed |
| Product picker (9 products) | `LC_PRODUCTS`, `lcSelectProduct` | `LOAN_PRODUCTS` (`banksApi.ts`) | Parity |
| Product–Bank mapping | `lcRenderProductBanks`, `lcUnassignBankFromProduct`, `lcSaveProductBanks` | `AssignedBanksSection.tsx` | Parity |
| `LoanTypesJson` | `bank.loanTypes` | `assignedToProduct` / `offersProduct` | Parity |
| Per-product rules | `lcEditBankInline`, `lcSaveBankRule` | `BankProductConfigCard`, `BankBulkConfigGrids` | Written correctly, **never read back** — fixed |
| Step 9 Lender Details | `laLoadEligibility`, `laSaveEligibility` | `BankEligibilityMatch` + `loansApi.updateBankLines` | Parity (selection persists to `LoanBankLine`) |
| Max Loan | `r.maxLoanAmt` gate + score | `MaxLoanAmt` gate + score | Was personal-only — fixed |

## Gaps found and fixed

### 1. Per-product rules had no effect on eligibility (critical)

`LenderConfigController.Match` never loaded `BankProductRule` and read only
`BankMaster`'s base columns. Every per-product override configured on the Lender
Configuration screen — Max Loan, CIBIL, tenure, FOIR, age, employment and
company types — was ignored, so a Business Loan / LAP / Home Loan applicant was
scored against that bank's **Personal Loan** limits.

Fix: `.Include(b => b.ProductRules)` plus per-field effective-rule resolution
(`rule?.X ?? bank.X`). Fallback is per-field, not per-row, so a rule that sets
only Max Loan still inherits the rest — matching the UI, where a blank
per-product field means "no override".

Two deliberate deviations from a plain `??`:

- `PfRequired` is a non-nullable `bool` on `BankProductRule`, so a rule row
  created to override some other field carries `false` and is indistinguishable
  from a deliberate `false`. Resolution is `bank.PfRequired || rule.PfRequired`:
  a product can add a PF requirement, an incidental default can never drop one.
- `EmpTypesJson` / `CompTypesJson` override only when the product list is
  non-empty. An empty list means "not configured" (inherit), never "accept
  nothing", which would otherwise reject every applicant the moment any other
  field on that product was overridden.

Behaviour is unchanged for any bank with no product rule row.

### 2. `ServiceablePinsJson` ignored by the matcher

The matcher derived a bank's serviceable PINs from `Lines[].PinCode`, with a
comment stating no bank-level column existed. That column was added later and is
what the Lender Configuration PIN Codes grid writes to, so configured PINs had
no effect on matching.

Fix: prefer `ServiceablePinsJson`; fall back to the Lines-derived set only when
no bank-level list is configured, so existing Path-A banks keep their behaviour.

### 3. `PUT /api/banks/{id}` rejected partial payloads

Vanilla `lcSaveProductBanks` sends `{ loanTypes: [...] }` with no `bankName`.
The endpoint returned 400 "Bank Name is required" and the bank assignment was
silently lost — directly breaking Product–Bank mapping persistence from the
vanilla app.

Fix: an omitted name now means "leave unchanged"; an explicitly blank name is
still rejected. `BankDto.BankName` became `string?` (it defaulted to
`string.Empty`, which made omitted and blank indistinguishable). Contact fields
moved to the same partial convention so a rules-only PUT cannot blank the RM's
name and number as a side effect. Every other field in the method already
followed this convention.

### 4. `BanksPage` RBAC, delete confirmation, error surfacing, Remarks column

`BanksController` gates all three mutations to Admin + ProductTeam, and vanilla
`saveBank`/`editBank`/`deleteBank` refused non-admins outright, but the React
page showed Add / Edit / Delete / Bulk Upload to every role — a Manager could
fill the whole form and only discover the block as a bare 403 on submit.
Deletes had no confirmation (vanilla uses `confirm()`), mutation errors were
swallowed entirely, and `Remarks` was captured in the form and exported to CSV
but never shown in the grid.

Fixed all four in `BanksPage.tsx`, using the gate expression and `confirm()`
convention already used elsewhere in the app.

## Not changed (deliberate)

- **No schema change / no migration.** Both fields the fixes rely on
  (`BankProductRule`, `ServiceablePinsJson`) already exist.
- `HomeTypesJson` is editable per product but `LenderMatchRequestDto` carries no
  home type, so the matcher cannot use it. Adding a request field would be a new
  feature, not a parity fix — left alone and flagged here.
- `MinExpMonths` / `MinVintage` / `MinTurnover` / `MinAcctVintage` /
  `MinAvgBalance` / `MinCreditScore` / `BankStmtMonths` / `BounceTolerance` are
  persisted but not evaluated by the matcher, in vanilla or React. Same
  reasoning — out of parity scope, flagged.

## Verification

| Check | Result |
|---|---|
| `tsc --noEmit` | Pass, 0 errors |
| `vitest run` | Pass, 212/212 across 16 files |
| `npm run build` | Pass, emits to `LoanMS.API/wwwroot/react` |
| Backend compile | **Blocked** — no .NET SDK in the build container and `packages.microsoft.com` is outside the network allowlist (`host_not_allowed`) |

Backend changes are review-verified only: nullability and numeric types checked
by hand against `BankProductRule` (`int?`/`decimal?` vs `BankMaster`'s non-null
columns), LINQ and EF usings confirmed present, and `TreatWarningsAsErrors` is
not set. They have **not** been compiled or run. That is the one outstanding
item before release.
