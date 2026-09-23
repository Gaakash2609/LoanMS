# Wizard Module — Vanilla JS → React Parity Verification (2026-09-12)

Scope: ONLY the New Application **Wizard** module and its stages. Nothing outside the wizard.
Reference (source of truth): Vanilla `LoanMS.API/wwwroot/index.html` + `js/efin-app.js` + `css/app.css`.
Target (to fix): React `frontend/src/pages/NewApplicationPage.tsx` (+ `api/wizardApi.ts`).

## Wizard stages (physical steps 1–9)
| # | Vanilla label (default) | React component |
|---|--------------------------|-----------------|
| 1 | Contact & Assignment | `Step1` |
| 2 | KYC Verification | `Step2` |
| 3 | Personal Details | `Step3` (+ `Step3CoApplicant`) |
| 4 | Address | `Step4` |
| 5 | Employment (product-relabelled) | `Step5` |
| 6 | Initial Offer (product-relabelled) | `Step6` |
| 7 | References | `Step7` |
| 8 | Documents | `Step8` |
| 9 | Loan Analytics | `Step9` |

## FOUNDATIONAL FORK — RESOLVED 2026-09-12
User chose: **match Vanilla runtime — 9 steps for ALL products, References mandatory for all.**
Fix applied: `WIZARD_PRODUCT_CONFIG` — restored step 7 (References) for new_car/used_car/education/insurance.
Open follow-up: `over_draft` has no config entry → uses DEFAULT labels; needs OD-specific labels
(Business Address / Business & Income / OD-CC Limit) in the per-product label pass.

## (original fork note)
**Step count / References-skip.** Vanilla `getActiveWizardSteps()` reads `LOAN_PRODUCT_CONFIG[prod].wizardSteps`,
which is **undefined for every product** → always falls back to `[1..9]`. The per-product step arrays
(`[1,2,3,4,5,6,8,9]` etc.) live only in `LOAN_DOCS_MATRIX` (efin-app.js:1502-1785), which the stepper
never reads. `applyProductToWizard` sets heads for all 9 steps and hides no whole step.
→ **Vanilla runtime = all 9 steps for EVERY product; References (step 7) is MANDATORY for all**
(validateStep physStep===7 requires Ref1+Ref2, 10-digit mobiles — efin-app.js:8552-8564).
React `WIZARD_PRODUCT_CONFIG` skips step 7 for new_car/used_car/education/insurance (8 steps).
Decision needed: match Vanilla runtime (9 steps all) vs keep React's product-specific flow.

## Stage status
- [x] Stage 1 — Contact & Assignment — DONE (code-parity + build + unit tests)
  - FIXED: Lead Source Online-only + cleared on channel change; Direct-channel confirmation chip;
    Partner label "Partner / Agent Name".
  - FIXED (user-approved): Sales Person now filtered by selected Location + role (Sales/TeamLeader)
    with Vanilla empty-hint — backend UserLookupDto+GetLookupAsync now return LocationId (additive);
    location change clears salesPerson. DSA "Linked Partner (optional)" added, stored in productData.
  - User declined for now: Searchable dropdowns (WSDD) — would need a new component; left as plain select.
  - Already OK: mobile 10-digit; PAN 60-day blocking dup-check (handleNext 2863-2879); location via
    LocationId FK; channel/DSA/partner conditionals; lead-source options.
  - Kept (stricter, no data lost): PAN format validation (React PAN_RE vs Vanilla length-only).
  - Verify: tsc PASS; dotnet build (App+API) PASS 0-err; wizard tests 14/14 PASS.
  - PENDING: live React→API→Postgres E2E (create app, confirm LocationId/salesPerson persist) — at checkpoint.
- [x] Stage 2 — KYC Verification — DONE (all approved items) except cosmetic ✎ Fix buttons (see note)
  - Phase 2 (user approved all 3): PDF support (client-side render via existing perfios/pdf.ts, lazy-
    loaded — backend accepts image mimes only, so PDF→PNG like Vanilla); Aadhaar Front+Back two uploads;
    single "Extract & Auto-Fill Details" button (both docs); KYC scan-beam animation overlay (CSS ported
    verbatim from efin-improvements.css to globals.css); readiness checklist chips.
  - Deliberately skipped: per-field "✎ Fix" buttons — React fields are already inline-editable (Fix's
    only purpose is to focus a field), and adding them needs a shared FormGroup/TextInput change for
    ~zero functional value. Offered to add if the user wants the visual affordance.
  - Verify: tsc PASS; vite build PASS (pdfjs chunk lazy-loaded); tests 20/20 PASS.
  - PENDING (honest): live OCR E2E needs configured KYC vision provider + running stack; not run here.
  - (superseded) data-parity FIXED earlier: middle-name, street1/street2 split, parser bug.
  - FIXED: PAN middle-name extraction (prompt+parser+field+fill); Aadhaar address now split into
    House/Flat (street1) + Street/Locality (street2) and auto-filled into Address step (Vanilla
    kycSyncAddr parity) + shown as editable fields; parser bug fixed (a "LAST NAME:" line no longer
    clobbers firstName); dash/blank values treated as empty. New unit test kyc-extraction (6 tests).
  - Already OK: AI-OCR extract → fill name/aadhaar/dob/gender/city/state/pin; gender M/F/O sync;
    cross-validate (name + PAN); KYC report/download; step-2 validation gate (aadhaar 12-digit + name).
  - AWAITING DECISION (effortful / rebuild / multi-approach): (a) PDF support (Vanilla accepts
    image+PDF via pdf.js; React images only); (b) KYC scan-beam loading animation (Vanilla overlay vs
    React button spinner); (c) UI-flow rework to Vanilla layout (single "Extract & Auto-Fill" button
    for both docs, Aadhaar front/back two inputs, "✎ Fix" buttons, readiness checklist).
  - Minor (not fixed): Vanilla also auto-fills the PERMANENT address from Aadhaar; React fills current
    only and relies on the "same as current" copy. Flag.
  - Verify: tsc PASS; tests 20/20 PASS (6 new KYC + 14 wizard).
- [x] Stage 3 — Personal Details (+ Co-applicant) — DONE
  - FIXED: Aadhaar, Email, Father's Name, Mother's Name now REQUIRED (Vanilla validateStep(3)
    efin-app.js:8411-8418) — React had left all four optional/format-only; UI marked required + errors +
    touch wired. Test VALID updated (father/mother) + new gate assertion.
  - Already OK: fname/lname/dob/gender required; email/phone format; Co-Applicant block (Step3CoApplicant)
    matches Vanilla wToggleCoApplicantSection — home/lap mandatory, business optional, others hidden.
  - Verify: tsc PASS; tests 21/21 PASS.
- [x] Stage 4 — Address — DONE
  - FIXED: Street & Locality (street2) now required (Vanilla requires it); PERMANENT address now requires
    all 6 fields (House/Flat, Street, City, PIN, State, Home Type) when shown — React had them all
    optional; over_draft now hides the whole permanent block + "same as current" checkbox (Vanilla
    applyProductToWizard toggle w-permanent-addr-block). +3 test assertions.
  - Home Type options match Vanilla labels; State list is a React SUPERSET (37 incl. more UTs vs Vanilla
    31) — acceptable (no data loss). State/HomeType use plain select (WSDD deferred per Stage-1 decision).
  - CROSS-STAGE FLAG (resolve at Stage 9): React stores Home Type as the LABEL ("Owned by Self / Spouse")
    while Vanilla stores the CODE ("OWNED_SELF_SPOUSE"). Lender Config Bank Rules use the codes
    (BL_HOME_TYPES, efin-app.js:22230), so a label-vs-code mismatch could break eligibility matching.
    Needs verification at Stage 9 + a decode-on-display decision (touches detail page) — NOT changed yet.
  - Per-product label "Business Address" (over_draft Step 4 head) → label pass.
  - Verify: tsc PASS; wizard-navigation 13 tests PASS.
- [x] Stage 5 — Employment / product blocks — DONE (largest gap)
  - FIXED (React was FAR more lenient than Vanilla validateStep(5)): added required validation +
    UI markers/errors/touch (~24 fields) matching Vanilla's visibility-aware required set —
    • Salaried/Professional: Company Type, Office Address L1/L2/PIN; Professional: Professional Body.
    • Self-employed: Company/Business Type, Business Vintage, Annual Turnover, Net Profit, ITR Filed,
      Business Type (GST stays optional, matching Vanilla).
    • Property (home/lap): Type, Ownership, Under Construction.
    • Vehicle (car): Make, Model, Price, Dealer; used-car adds Manufacture Year + KMs (hidden for new car).
    • Education: Institution, Course, Duration, Study Location, Admission Status.
  - Education fields render + validate on Step 5 in React (Vanilla shows them in wstep-5 HTML too; it
    validates some at physStep 6, but the field set + requirement match — same net gate).
  - Co-applicant (education Parent/Guardian) already required; matches Vanilla.
  - Tests: +5 assertions; VALID/PRO datasets updated. Verify: tsc PASS; ALL 192 FE tests PASS; build PASS.
- [x] Stage 6 — Initial Offer / Loan / Insurance / CAM — DONE
  - FIXED (Insurance): expanded validation to Vanilla's full policy required set — added Premium
    Frequency, Estimated Premium, Preferred Insurer, Nominee Relationship/DOB/ID, Occupation Hazard,
    Height, Weight, + conditional Existing Policy Number/Cover (when has existing), Condition Details
    (when medical declared). React previously required only 5 of these. UI markers/errors/touch added.
  - Already OK (verified): OfferInterstitial animation (React port of showOfferInterstitial — own parity
    test, titles "Generating Your Offer"/"Generating Premium Summary", 3s) rendered on Step 6 entry;
    CamOfferPanel present; tenure/purpose use per-product option sets (PRODUCT_LOAN_OPTIONS); reducing-
    balance EMI calc; insurance amount↦sum-assured / tenure↦policy-term mapping in buildPayload.
  - Different-but-valid (kept): React allows manual amount/rate/tenure entry (Vanilla forced "Apply CAM
    offer"); React requires purpose+rate (Vanilla validateStep(6) gates on amount+tenure only) — stricter,
    no data loss.
  - Verify: tsc PASS; ALL 192 FE tests PASS; build PASS. INS test dataset expanded.
- [x] Stage 7 — References — DONE
  - FIXED: React required only "at least ONE reference"; Vanilla validateStep(7) requires BOTH references
    fully — Name + Mobile (10-digit) + Relationship each (efin-app.js:8552-8564). Now both required
    (validation + UI required markers). Reference addresses (Line 1/2/City/PIN) stay optional (Vanilla
    doesn't require them). Old "references" aggregate error is now harmless dead code. +1 test.
  - Verify: tsc PASS; wizard-navigation 18 tests PASS.
- [x] Stage 8 — Documents — DONE (both A + B, user approved B)
  - FIXED (A): mandatory income doc is employment-type-aware — Self-Employed → Business Vintage Proof
    (not Salary Slips); Salaried/Professional → Salary Slips; Bank Statement mandatory for all. Added
    bizVintageProof doc (documentType 'business_proof' — free-form column, no backend change).
  - FIXED (B): ported Vanilla LOAN_DOCS_MATRIX → new util `frontend/src/utils/wizardDocs.ts`
    (getWizardDocs + WIZ_MANDATORY_DOC_NAMES, React→Vanilla product-key map). Step 8 now renders the
    product + employment-type-specific checklist (home→property docs, car→RC/insurance/valuation,
    education→admission/marksheets/co-applicant income, etc.). Mandatory = docList ∩ WIZ_MANDATORY_DOC_NAMES
    (Education's list has none → no mandatory Step-8 doc, matching Vanilla + avoiding a dead-end). Submit
    uploads ALL attached docs (mandatory by mapped type, optional by name). Removed the old fixed
    OPTIONAL_DOCS_BEFORE/AFTER + unused Landmark import.
  - Reused existing MandatoryDoc component (no new component). +2 tests (self-emp, education).
  - Verify: tsc PASS; ALL 195 FE tests PASS; build PASS.
- [x] Stage 9 — Loan Analytics (bank eligibility) — DONE
  - FIXED: at-least-1-bank now REQUIRED before final submit (Vanilla validateStep(9), efin-app.js:8594) —
    React marked Step 9 "summary only" and allowed a bank-less submission. Gate added in handleNext.
  - FIXED: max bank selection is now product-aware — Personal Loan → 2, every other product → 3
    (Vanilla laMaxBanks, efin-app.js:15835). Was hard-coded 2 for all in BankEligibilityMatch.
  - RESOLVED Stage-4 cross-stage flag: the eligibility match does NOT use Home Type (LenderMatchRequestDto
    has no HomeType field; the match service ignores it). So React storing Home Type as a LABEL vs
    Vanilla's CODE has NO functional impact on the wizard/eligibility — it is only a detail-page display
    representation (outside wizard scope). Not changed.
  - Already OK: application summary; BankEligibilityMatch runs POST /api/lenderconfig/match with the
    applicant profile; eligible/ineligible bank cards; selection surfaced to submit as bank lines.
  - Verify: tsc PASS; ALL 195 FE tests PASS; build PASS.

## Cross-stage / cosmetic notes
- Stepper LABELS: Vanilla's top progress bar shows DEFAULT labels for every product (getActiveWizardSteps
  falls back — no wizardLabels in LOAN_PRODUCT_CONFIG); product-specific text appears as SECTION HEADS
  inside each step (applyProductToWizard._stepHeads). React shows product-specific labels in the top
  stepper instead. Equivalent info, different placement — minor cosmetic diff (rule 10: lowest priority).
  Corrects the earlier Stage-1 "over_draft labels" note: over_draft's default stepper labels actually
  MATCH Vanilla's default stepper. NOT changed (would need per-step section-heads for byte-exact parity).
- [x] Cross-stage dependencies + API payload + error handling — verified
  - KYC (Step 2) → Personal (Step 3: name/middle/dob/gender/aadhar/father) + Address (Step 4:
    street1/street2/city/state/pin) auto-fill chain works (street + middle added this pass).
  - loanType (Step 1/5/6) → product blocks (Step 5) + doc checklist (Step 8) + eligibility match (Step 9)
    + References presence (all 9 steps). empType (Step 5) → mandatory doc (Step 8). amount/rate/tenure
    (Step 6) → EMI (Step 6/9) + match (Step 9). Location (Step 1) → Sales Person filter.
  - buildPayload: core fields + productData bag (leadsrc, dsaLinkedPartner, mother, reference addresses,
    biz/property/vehicle/education/co-applicant/insurance); location via locationId FK; insurance
    amount↦sumAssured, tenure↦policyTerm; empType via toEmploymentCode. Matches WizardSubmitDto.
  - Error handling: PAN 60-day dup BLOCKS (Step 1); double-submit guard; per-field errors + scroll-to-
    first-invalid on Next; doc-upload best-effort warning; server validate() surfaced before submit.
- [x] Build verify — tsc PASS; ESLint clean on wizard files (1 pre-existing warning in perfios/pdf.ts
  extractText, not introduced here); ALL 195 FE tests PASS; vite build PASS (fresh bundle); backend
  dotnet build PASS (only Stage-1 UserLookupDto/UserService touched).

## Live PostgreSQL E2E — DONE (2026-09-12)
Ran the API in WSL against a real PostgreSQL 18.6 (user-owned cluster, port 5433) — `DB=postgresql`,
migrations already up-to-date (no drift; NachDone/CustomerAgreementDone/LocationId columns present).
- Stage-1 backend change LIVE-verified: `GET /api/users/lookup` returns `locationId` on real Postgres.
- `POST /api/wizard/submit` (salaried personal loan) → Loan (₹600000.00 numeric(18,2), 13.50% numeric(5,2),
  48mo, Status=Submitted, LocationId FK) + Customer (PAN/email/MonthlyIncome) persisted — confirmed by
  direct psql, not just API re-read.
- Found + fixed a real latent backend bug during E2E: `WizardController.Submit`'s fresh-create branch
  (draft-less submit) did NOT call `ApplyMapping`, so `ProductDataJson` (product/co-applicant/reference-
  address/insurance fields incl. dsaLinkedPartner) was dropped. Added `ApplyMapping` to the create branch;
  re-ran E2E → ProductDataJson now persists `{"mother":...,"dsaLinkedPartner":...,"r1Addr1":...}`.
  (Backend change announced; dotnet build 0 errors.) React's own flow always autosaves a draft first so
  it never hit this, but the backend is now correct on both paths.
- Still env-blocked: live KYC OCR extraction (no Gemini vision key configured — AI=OFF).

## Verified ZIP — DONE (2026-09-12)
`Downloads/LoanMS-2026-09-12_wizard-parity-final.zip` (4.88 MB, 760 files; node_modules/bin/obj/logs
excluded). Extracted to scratch + independently verified: source has all fixes (wizardDocs.ts,
WizardController create-fix, UserLookupDto.LocationId, wizard changes) AND the shipped built bundle
`wwwroot/react/assets/NewApplicationPage-BeUik4LW.js` is a SINGLE chunk (no stale dupes), contains the
wizard + doc-matrix markers, and its md5 (4e0b57d7dec1a253184787006f002ba0) matches the source-tree
bundle — so the ZIP ships the exact verified code.

## Correction round (2026-09-12, user pending-list) — match Vanilla EXACTLY, drop extra-strict gates
1. PAN (Step 1): removed strict format regex → length-10 only (Vanilla validateStep(1)); co-applicant
   PAN still uses format (Vanilla does). Input no longer strips non-alnum (just uppercase + maxlength).
2. Step 5: salary NO LONGER required (Vanilla validateStep(5) has no salary check); officeEmail required
   only for SALARIED (Vanilla wValidateOfficeEmail is salaried-only), not professional.
3. Step 6: removed extra rate / purpose / fixed-tenure-set / CIBIL-range gates → only amount>0 + tenure
   (Vanilla validateStep(6) non-insurance). UI: rate/purpose no longer marked required.
4. KYC (Step 2): Aadhaar extraction now also auto-fills the PERMANENT address (pStreet1/2/pCity/pState/
   pZip), matching Vanilla kycSyncAddr which fills both current + permanent.
5. KYC "✎ Fix" buttons: added on every extracted field (PAN + Aadhaar) via an additive optional `id` on
   TextInput/SelectInput + optional `action` slot on FormGroup (reused existing components, no new ones).
6. Searchable dropdowns: VERIFIED no reusable searchable-select/combobox exists (no lib, no component) —
   building one = a NEW component. USER DECIDED (2026-09-12): keep plain <select>s, do NOT build a new
   component. Resolved — no code change. (UI-polish gap only; selects fully functional.)
9 (live): submit + draft-resume persist on real PostgreSQL; found+fixed 3 backend gaps (ApplyMapping in
   Submit AND SaveDraft create branches; GetDraft productData was returned as {valueKind} → now real
   strings). dotnet build 0 errors each time.
10. KYC OCR: API runs AI:Enabled=False, no Gemini vision key → live OCR NOT exercised. Code-level verified
   (flow + parsers + 6 unit tests + PDF render). BLOCKED (env) — reported honestly, no fake pass.
7. Top stepper: now shows Vanilla's DEFAULT labels for every product (was per-product); the product-
   specific label stays in the section HEAD inside the step (matches Vanilla's section heads). NOTE:
   React's stepper renders numbered colored circles (its established design, colors ported from legacy)
   vs Vanilla's per-step icons — left as the existing React design per the "stay in existing design" rule.
8. wizardDocs.ts: INLINED into NewApplicationPage.tsx (only consumer) and the new file DELETED — no new
   file, no duplicate logic.
  Verify: tsc PASS; ESLint clean; ALL 197 FE tests PASS; vite build PASS.

## Honest verification status
- Code-level Vanilla parity fixed + tsc + 195 FE tests + FE build + BE build all GREEN.
- NOT run here (env-blocked): live React→API→PostgreSQL E2E (create/persist/refresh) and live KYC OCR
  extraction (needs configured vision provider). These are the remaining items before a "100%" claim.
