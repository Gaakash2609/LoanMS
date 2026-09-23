# Approval Details (Sanction / CAM) — Vanilla↔React Parity Pass — 2026-09-11

Status legend: ☐ pending · ☑ done+verified

## Audit (Vanilla = source of truth)
- Vanilla `renderDetailApproval` (efin-app.js:7332) edit gate:
  `canEdit = isAdmin || (!isAppFinalLocked(app) && !efinIsAppLocked(app))`
  - `isAppFinalLocked` (:711): status ∈ disbursed/rejected/cancelled/hold → React Disbursed/Rejected/Closed/OnHold.
  - `efinIsAppLocked` (:40228): only gates Sales/TeamLeader/Manager; unlock if
    `app.sales === currentUser.name` (api-bridge.js:192 → `loan.createdBy.fullName`)
    OR an open EAV / "Application Verification" task is assigned to the user.
  - Every OTHER non-admin role (LoginTeam, OpsMgr, LocationHead, **Partner**, DSA…) is ungated → can edit unless final.
- React `SanctionDetailCard`: gated on `canChangeStatus` → blocked Sales & Partner; never applied final-lock.
- Backend `UpdateSanctionDetail` (LoansController:542): `[Authorize(Roles=…)]` excluded Sales/Partner/Dsa AND required `canChangeStatus`; access already scoped by `GetByIdAsync` visibility.

## Plan / checklist
- ☑ Frontend: replaced `canChangeStatus` gate with Vanilla-faithful gate (final-lock + app-access), reuse authStore + tasksApi; added lock-state label.
- ☑ Backend (ANNOUNCED): added Sales,Partner,Dsa to `[Authorize]`; dropped wrong `canChangeStatus` gate (rely on existing visibility scope).
- ☑ tsc clean · vitest 178/178 · vite build ok · SanctionDetailCard lint clean (13 warnings all pre-existing/unrelated).
- ☑ dotnet build LoanMS.API — 0 errors (2 warnings pre-existing/unrelated).
- ☑ E2E on REAL PostgreSQL (WSL API 0.0.0.0:5090, psql :5433): Sales-owner PUT sanction-detail=200 (was 403) → row persisted → GET re-read after refresh; Admin PUT=200; Admin PUT on Rejected loan=200 (final-lock bypass); Partner PUT to out-of-scope loan=404 NotFound (past [Authorize], visibility scope still blocks — NOT over-broadened).
- ☑ Browser role-wise (served from WSL PG API): Admin → editor + "✏️ You can update these details"; Sales-owner (Draft) → editor + label (CORE FIX visible); Sales-owner (Rejected) → read-only + "🔒 View-only — application is Rejected; only Admin can edit now" (editor gone). Console 403s are pre-existing role-scoping fetches (Users/Teams/Settings), unrelated.
- ☑ Regression: only SanctionDetailCard.tsx + LoansController.UpdateSanctionDetail changed; vite build + 178 vitest + dotnet build all green; loan-detail page renders Overview/Personal/Address/Employment/References/Documents/Lender sections (separate components/endpoints, untouched).

## Verdict (permission fix): COMPLETE, verified end-to-end on real PostgreSQL.

---

# Part 2 — Full CAM field/edit-UI/calc parity (follow-up)

## Audit findings (Vanilla renderDetailApproval + dvAutoRecalc/dvAutoFlatRate/dvToggle*)
Vanilla inline-editable fields, per-field auto-save (no button): Loan Amount, Tenure(Months), ROI(annual %),
Flat Reducing Rate (auto-from-ROI + manual override), Processing Fee %, EMI (calculated, editable), EMI Date,
Insurance (+"+Insurance ON/OFF" pill toggle), Bundled Loan Amount (+"+Proc.Fee ON/OFF" pill), BT (NO/YES select),
GST %, Stamp Duty. Math: dvAutoRecalc bundled + dvAutoFlatRate — React utils/emi already MATCH verbatim.
Vanilla persists only stampDuty/gst/insurance/pfPercent/pfInBundled/insInBundled/isBundled/isBt/flatRate/emiDate;
LoanAmt/Tenure/ROI/EMI/Bundled were browser-memory-only (never PUT).

React before this pass: read-only preview tiles + compact editor (PF%, GST, Insurance, EMI Date, Stamp Duty + 3
checkboxes) + a single "Save" button. Gaps: Loan Amount/Tenure/ROI/EMI not editable; Flat Rate not editable/override;
Bundled not shown as editable; BT a checkbox not NO/YES; per-field/individual auto-save missing (had a manual button).

## Plan (retain permission fix)
- ☑ Backend (ANNOUNCED): added SanctionLoanAmt/SanctionTenureMonths/SanctionRoi/SanctionEmi to entity+DTOs+projection+controller; migration `20260911072156_AddSanctionTermsFields` (only those 4 cols, no drift). Real PG persistence.
- ☑ Frontend: rebuilt SanctionDetailCard editor to Vanilla inline grid — all fields editable (Loan Amount/Tenure/ROI/Flat[override]/PF%/EMI[override]/EMI Date/Insurance+pill/Bundled+pill/BT NO-YES/GST/Stamp Duty), live computeBundledAmount+flatRateFromReducing (verbatim match to dvAutoRecalc/dvAutoFlatRate), per-field debounced auto-save (900ms, no button). Kept canEdit gate + lock label; read-only Tile grid for non-editors (now shows the full field set).
- ☑ tsc clean · vitest 178/178 · SanctionDetailCard lint clean · vite build ok · dotnet build 0 errors · migration applied on real PG at startup.
- ☑ E2E on real PG (loan 3, Sales-owner): full CAM PUT=200 → psql shows all 14 fields incl. new sanctioned terms → GET refresh re-read; partial per-field update (only SanctionLoanAmt) left roi/flat/stamp intact; browser pill-toggle → live bundled recalc 731520→715000 → debounced autosave → psql PfInBundled=false persisted.
- ☑ Regression: permission behaviour intact (Rejected loan → read-only tiles + "only Admin can edit now"); previous 7 sections unaffected (separate components/endpoints).

## Verdict (full CAM parity, first pass): needed a deeper re-audit — see Part 3.

---

# Part 3 — Deep re-audit vs EXACT Vanilla (self-critical pass)

Re-audited my own SanctionDetailCard against the literal Vanilla code and found divergences I had introduced:
- **EMI auto-recalc was INVENTED.** Vanilla EMI field (efin-app.js:7411) only calls approvalFieldSave on input — there is NO dvAutoEmi. EMI is the sanctioned EMI captured at approval, editable but never auto-recomputed by the CAM. Removed the auto-EMI effect; EMI is now seeded once (persisted value, else a one-time reducing-balance calc) and static thereafter.
- **Flat-rate trigger:** Vanilla dvAutoFlatRate fires ONLY on ROI change (using current tenure). My version also recomputed on tenure change. Fixed — flat re-fills only in the ROI onChange (unless manually overridden); a tenure-only change leaves it, matching Vanilla.
- **Labels:** corrected to Vanilla's exact text — "EMI (Calculated — Rounded) ₹", "Insurance Amount (₹)".
- **Read-only view:** rebuilt to Vanilla's exact fieldGrid (efin-app.js:7472-7488) — 15 rows incl. Tenure (Years), Tenure (Months), Proc. Fee in Bundled (✅/—), Insurance in Bundled (✅/—); Processing Fee shown as % (not ₹).
- **Bundled** kept read-only computed (documented): legacy dvAutoRecalc overwrites the field on any source change and never persists a manual number (only the bundle flag persists), so it is always the computed amount.

Trigger model now matches Vanilla exactly:
- Bundled ← LoanAmt / PF% / Insurance / GST / toggles (computeBundledAmount).
- Flat ← ROI only (dvAutoFlatRate), manual override sticks.
- EMI ← none (seeded once, manual).

### Verification (real PostgreSQL, fresh loan #4, Sales-owner)
- Fresh open: LoanAmt 300000 / Tenure 12 / ROI 10 → Flat auto **5.5** ("Auto from ROI"), EMI computed once **26375**, labels correct.
- ROI 10→14 (browser): Flat auto-recomputed **7.74**, EMI stayed **26375** → autosave → psql roi=14, flat=7.74, emi=26375. ✓
- Tenure 12→24 (browser): Flat stayed **7.74**, EMI stayed **26375** → autosave → psql tenure=24, flat=7.74, emi=26375. ✓ (exact Vanilla — only ROI moves flat, EMI never auto-recalcs)
- tsc clean · vitest 178/178 · component lint clean · vite build ok.

## Verdict (re-audit pass): still had seed-logic gaps — see Part 4.

---

# Part 4 — Final 100% parity: seed logic (self-critical pass)

Re-checked the literal Vanilla field seeds and found my code STILL calculated on mount where Vanilla does not:
- **Flat rate** was computed on mount (`flatRateFromReducing(seedRoi, seedTenure)`). Vanilla: `value="${app.sanctionFlatRate||''}"` — BLANK until dvAutoFlatRate runs (ROI change). FIXED → flat seeds empty (unless a saved value), fills only on ROI change; hint "Auto from ROI" when blank.
- **EMI** was computed on mount (`emiReducing(...)`). Vanilla: `value="${app.sanctionEMI||''}"` — never computed in the CAM. FIXED → EMI seeds from the persisted sanctioned EMI, else the loan's STORED MonthlyEmi (rounded, a value — not a live recompute); no auto-recalc on any change.
- **Read-only formats**: aligned to Vanilla fmt/pct — unset values render "—" (not "₹0"/"0%"); EMI Date "—" when unset.
- **GST default**: `sd?.gst ? … : '18'` (a 0 falls back to 18, matching Vanilla `app.sanctionGST||18`).

### Verification (real PostgreSQL, browser DOM-read, Sales-owner)
- Fresh loan (no sanction data): Flat **empty** ("Auto from ROI"), EMI **26375** (rounded, bridged from loan MonthlyEmi), Loan Amount/Tenure/ROI bridged, PF/Insurance empty, Bundled computed read-only, GST 18, BT NO, Stamp default.
- ROI 10→15: Flat auto-filled **8.31**, EMI **stayed 26375**. Loan Amount 300000→500000: Bundled→**500000**, Flat & EMI **static**. (Tenure change also leaves flat/EMI — prior pass.) → autosave → psql: loanAmt=500000, roi=15, flat=8.31, emi persisted, tenure=12. ✓
- Read-only (finalised loan, Sales): 15-row Vanilla fieldGrid (Tenure Years/Months, Proc. Fee in Bundled ✅, Insurance in Bundled — Excluded, PF as %) + "View-only — application is Rejected; only Admin can edit now". ✓
- tsc clean · vitest 178/178 · component lint clean · vite build ok.

## Verdict (Part 4): correct in source, but ZIP/bundle consistency needed independent proof — see Part 5.

---

# Part 5 — Source⇄ZIP⇄bundle consistency (the actual reported defect)

The user found a mismatch between a prior report and the actual `SanctionDetailCard.tsx`/bundle in the delivered ZIP. Root-cause class: a delivered ZIP can ship source that says X while the built `wwwroot/react` bundle (what the running app serves) still does Y, if the build/zip ordering slips. Fix = prove it, don't assert it.

This run:
- Confirmed the corrected source is already present (flat seeds blank; EMI bridges to stored MonthlyEmi rounded, no live compute; onRoiChange is the only flat trigger; exact labels; GST 0→18).
- **Clean rebuild** (vite emptyOutDir:true → single chunk, no stale accumulation). Built bundle contains "Calculated — Rounded" / "Auto from ROI".
- Browser (shipped bundle, fresh loan #7): Flat **blank** on mount ("Auto from ROI"), EMI **26375** rounded; ROI 10→15 → flat **8.31**, EMI **static**; LoanAmt→500000 → bundled **500000**, EMI **static**. psql: loanAmt=500000, roi=15, flat=8.31, emi=26375, tenure=12, gst=18.
- Regression: finalised loan → read-only (no editor), 15-row Vanilla grid, "only Admin can edit now".
- **ZIP EXTRACT + independent verify:** ZIP's source has all corrected markers and NO `flatRateFromReducing`/`emiReducing` in any useState seed; ZIP's bundle is a single chunk whose **md5 (f34e9af5…) is byte-identical to the browser-verified project bundle**; 0 artifact dirs; backend cols + migration present.

## Verdict (FINAL, independently verified from the extracted ZIP): COMPLETE — corrected code present in project source AND inside the ZIP (source + byte-identical freshly-built bundle); seed/trigger/field/label parity with Vanilla in edit + view modes; browser + real-PostgreSQL verified; permission fix + sanctioned-terms columns retained.
