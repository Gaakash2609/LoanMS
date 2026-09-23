# Phase 6 — Applications Module Audit

Date: 2026-09-16
Starting state: Phase 5 cumulative (`LoanMS-Phase5-Banks-2026-09-16.zip`)
Source of truth: `LoanMS.API/wwwroot/js/efin-app.js` + `wwwroot/index.html`

## Scope

Applications list end-to-end: columns, search, filters, status/stage chips,
pagination, sorting, row actions, role gating, navigation, API/data flow,
loading/error/empty states. DSA, Partner, Locations, Teams and Banks untouched.

## Function-by-function parity check

| Vanilla | React | Verdict |
|---|---|---|
| `renderTable` / `filterTable` row markup (9 cols) | `LoansPage` table | Columns match exactly |
| `filter-chip` row (8 chips) | `STATUS_CHIPS` | Match |
| `a.sales` → `loan.createdBy.fullName` (api-bridge.js:192) | `createdByName` | Correct — not the assignee |
| `_applyRoleFilter` (client-side) | `ApplyVisibilityScope` (server-side) | Server-side is stricter; correct |
| `toggleBulkSelect` / `toggleBulkSelectAll` / `bulkApplyStatus` | `selected` + bulk bar | Match; role list identical to `[Authorize]` |
| Row action: Open (all) | `Open` | Match |
| Row action: Delete (admin only) | `isAdmin` guard + `confirm()` | Match |
| `getActionBtn` (Underwriting/Approve/Disburse/Un-hold) | absent | **Correct** — `getActionBtn` is exported but never called by either vanilla render path; those actions live on the detail page. React is not missing anything |
| Sortable column headers | absent | Correct — vanilla headers are static too. Backend `SortBy` exists but neither UI uses it |
| `_appsPaginate` / `renderAppsPaginationBar` | page bar | **Two defects — fixed** |
| `topbar-search-field` (10 scopes) + indicator | free-text only | **Missing — fixed** |
| Draft row → `resumeDraftFromList` | `Open` → detail page | **Wrong target — fixed** |
| riskGrade chip beside applicant name | absent | **Missing — fixed** |
| Empty state "No applications found" | present | Match |

## Defects found and fixed

### 1. Pagination never worked at all (critical, frontend)

`useLoanStore.setFilter` was:

```ts
set((state) => ({ filter: { ...state.filter, ...partial, page: 1 } }))
```

`page: 1` sits **after** the spread, so it clobbered any page the caller passed.
`setFilter({ page: 2 })` resolved to page 1 — the Applications list could never
leave the first page, and Next/Prev appeared to do nothing on any result set
larger than one page.

Fixed to `page: partial.page ?? 1`: changing a filter still resets to page 1
(otherwise a narrower result set strands the user on a page that no longer
exists), but an explicit page is honoured. Covered by new unit tests.

### 2. Page bar had no page numbers

Vanilla's `renderAppsPaginationBar` draws a windowed set (1 … cp-1, cp, cp+1 …
last) so the first and last page are always one click away. React had prev/next
only, meaning 39 clicks to reach the end of a 40-page result. Added `pageWindow`
mirroring the vanilla algorithm, with elisions marked and page numbers clamped.

### 3. Search covered 4 fields instead of 12 (backend)

`ApplyListFilters` searched only `LoanNumber`, `Customer.FullName`,
`Customer.Phone`, `Customer.Email`. Vanilla's `filterTable` searches App ID,
name, PAN, mobile, sales person, DSA, linked partner, company, loan type,
status, Aadhaar and email — so searching by PAN, DSA or employer returned
nothing in React while working in the legacy app. Broadened to the full vanilla
set. Export uses the same helper, so it inherits the fix.

### 4. Field-scoped search missing (backend + frontend)

Vanilla's topbar has a 10-option scope dropdown (`#topbar-search-field`) with
per-scope placeholders and a "Searching by: X · N results" indicator. React had
only an all-fields box. Added `LoanFilterDto.SearchField` (server-side, because
the list is paged server-side — a client-side scope would only ever see the
current page), the matching scope dropdown with vanilla's exact labels and
placeholders, and the result indicator.

The dropdown sits next to the Applications page's own search box rather than in
the topbar. The topbar search is a pre-existing React control that already
writes the same filter; adding a second scoped control there would have
duplicated it.

### 5. Draft rows opened a detail page instead of resuming the wizard

Vanilla gives a Draft row "▶ Continue" (`resumeDraftFromList`) back into the
wizard. React rendered the generic "Open", landing the user on a read-only
detail page for a half-filled application. Draft rows now link to the existing
`/loans/new?draftId=` route the Drafts tab already uses — no new route, no new
component.

### 6. Bureau risk grade never displayed

`LoanListDto.RiskGrade` was already on the list payload (the Advanced Filter
sorts by it) but nothing rendered it. Vanilla shows a colour-coded chip beside
the applicant name. Added.

Note: vanilla is internally inconsistent here — `filterTable` renders the chip,
`renderTable` does not. React has a single render path, so it shows in both
cases, following the newer vanilla path.

## Not changed (deliberate)

- **No schema change / no migration.** Every field used already exists
  (`Customer.PanNumber`, `AadhaarNumber`, `CompanyName`, `Loan.Dsa`,
  `Loan.Partner`, `LoanListDto.RiskGrade`).
- **No new persistence.** Drafts were already server-backed via
  `GET /api/wizard/drafts` and `Loan.WizardStep`; nothing in this module uses
  localStorage.
- Column sorting is not added — vanilla's headers are static, so adding it would
  be a new feature rather than parity, even though `SortBy` exists server-side.
- `MatchEnumLabel` returns the first enum whose name or business label contains
  the term. A very short term (1–2 chars) can therefore resolve to an arbitrary
  status. Vanilla's substring match over labels is equally loose, so this is
  parity, not an improvement — flagged rather than silently "fixed".

## Verification

| Check | Result |
|---|---|
| `tsc --noEmit` | Pass, 0 errors |
| `vitest run` | Pass, 222/222 across 17 files (10 new) |
| `npm run build` | Pass, emits to `LoanMS.API/wwwroot/react` |
| Backend build | **Blocked** — no .NET SDK in the container, `packages.microsoft.com` outside the network allowlist (`host_not_allowed`) |
| Live API / DB verification | **Blocked** — same reason; no server can be started |

Backend changes are review-verified only. Specific risks checked by hand:

- `typeToken.Value` / `statusToken.Value` were hoisted out of the predicates.
  EF's parameter-extraction pass eagerly evaluates subexpressions that don't
  touch the entity, so leaving `.Value` inside would have thrown
  `InvalidOperationException` on any term matching no enum value.
- `LoanType` / `LoanStatus` are persisted via `HasConversion<string>()` and
  `ToString()` on them is not translatable, so terms are resolved to enum values
  up front and matched by equality.
- `Where(l => false)` as the no-rows predicate is already used by
  `ApplyVisibilityScope` in the same file, so it is proven against this provider.
- `Loan.Dsa` / `Loan.Partner` are null-guarded; `Loan.CreatedBy` is non-nullable
  and already dereferenced by the existing projection.

The SQL these predicates generate has **not** been executed. That is the
outstanding item before release.
