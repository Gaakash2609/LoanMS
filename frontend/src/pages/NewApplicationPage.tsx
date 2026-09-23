import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { type SelectedBank } from '@/components/shared/BankEligibilityMatch'
import { toEmploymentCode } from '@/utils/employmentType'
import OfferInterstitial from '@/components/shared/OfferInterstitial'
import LoanProductSelectorModal from '@/components/shared/LoanProductSelectorModal'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { wizardApi, type WizardSubmitPayload } from '@/api/wizardApi'
import { loansApi } from '@/api/loansApi'
import { useAuthStore } from '@/store/authStore'
import { CheckCircle, ChevronRight, ChevronLeft, AlertCircle, CheckCircle2 } from 'lucide-react'
import { InlineLoader, PageLoader } from '@/components/ui/LoadingSpinner'
import { createDraftId } from '@/utils/draftStorage'
import { LOAN_KEYS } from '@/hooks/useLoans'
// Wizard Step-8 doc-upload extraction — restores legacy's wizard behaviour where
// a Salary Slip upload runs PSE (Net-Pay/Month) extraction and a Bank Statement
// upload runs the Perfios analysis (efin-app.js markDocUploaded / doc-item
// buttons openPerfiosExtractionModal + pfv9Open). Reuses the existing engines.
import { perfiosApi, type PerfiosReport } from '@/api/perfiosApi'
import type { PerfiosUploadResult } from '@/hooks/usePerfiosUpload'

// Static wizard configuration (option lists, field-format regexes, per-step
// stepper labels/colours/icons, the product-driven flow config, product/
// employment normalisation, and the product+employment document matrix) —
// extracted verbatim into wizard/wizardConstants.ts to keep this file focused
// on the wizard's stateful behaviour. No value or logic changed by the move.
import {
  getApiErrorMessage,
  MOBILE_RE, PIN_RE, AADHAR_RE, EMAIL_RE, PAN_RE,
  STEP_LABELS, DEFAULT_WIZARD, WIZARD_PRODUCT_CONFIG,
  WIZ_STEP_COLORS, STEP_ICONS, CHECK_ICON_SVG, STEPPER_LABELS,
  normalizeReactLoanType, normalizeReactEmpType,
  getWizardDocs, WIZ_MANDATORY_DOC_NAMES, MANDATORY_DOC_KEY_BY_NAME, fmtINR,
} from '@/pages/wizard/wizardConstants'
import { type WizardData, emptyData, type UploadedDocInfo } from '@/pages/wizard/wizardTypes'
// Step-8 document machinery — extracted to its own module. Re-exported below so
// the existing tests keep importing these from '@/pages/NewApplicationPage'.
import {
  Step8, MANDATORY_DOC_TYPES, docApplicantRole, validateDocFile,
  mapDocNameToBackendType, perfiosSaveRequest,
} from '@/pages/wizard/wizardDocuments'
export {
  mapDocNameToBackendType, validateDocFile, MANDATORY_DOC_TYPES, isBankStatementDocName,
} from '@/pages/wizard/wizardDocuments'
// Per-step components — each extracted to its own file under wizard/steps.
import { Step1 } from '@/pages/wizard/steps/Step1'
import { Step2 } from '@/pages/wizard/steps/Step2'
import { Step3 } from '@/pages/wizard/steps/Step3'
import { Step4 } from '@/pages/wizard/steps/Step4'
import { Step5 } from '@/pages/wizard/steps/Step5'
import { Step6 } from '@/pages/wizard/steps/Step6'
import { Step7 } from '@/pages/wizard/steps/Step7'
import { Step9 } from '@/pages/wizard/steps/Step9'

function payloadToWizardData(p: Partial<WizardSubmitPayload>, fallback: WizardData): WizardData {
  const nameParts = (p.fullName ?? '').trim().split(/\s+/).filter(Boolean)
  const firstName = nameParts[0] ?? ''
  const lastName  = nameParts.length > 1 ? nameParts[nameParts.length - 1] : ''
  const middleName = nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : ''
  // Product-specific bag (Loan.ProductDataJson) — spread back over the
  // fallback so a resumed draft restores Property/Vehicle/Education/
  // co-applicant/business fields too, not just the core ones.
  const pd = (p.productData ?? {}) as Record<string, string>

  return {
    ...fallback,
    ...pd,
    mobile: p.mobile ?? fallback.mobile,
    pan: p.pan ?? fallback.pan,
    location: p.locationId != null ? String(p.locationId) : fallback.location,
    channel: p.channel ?? fallback.channel,
    dsaName: p.dsaName ?? fallback.dsaName,
    dsaId: p.dsaId != null ? String(p.dsaId) : fallback.dsaId,
    partnerId: p.partnerId != null ? String(p.partnerId) : fallback.partnerId,
    firstName, middleName, lastName,
    dob: p.dob ?? fallback.dob,
    gender: p.gender ?? fallback.gender,
    aadhar: p.aadhar ?? fallback.aadhar,
    email: p.email ?? fallback.email,
    phone: p.mobile ?? fallback.phone,
    father: p.fatherName ?? fallback.father,
    street1: p.street1 ?? fallback.street1,
    street2: p.street2 ?? fallback.street2,
    city: p.city ?? fallback.city,
    state: p.state ?? fallback.state,
    zip: p.zip ?? fallback.zip,
    homeType: p.homeType ?? fallback.homeType,
    // Step 2 (KYC manual-entry) fields are a separate mirror of the Step 3/4
    // fields above (see the onChange handlers below, which always set both
    // together). The server only stores the Step 3/4 side (fullName/aadhar/
    // dob/gender/city/state/zip), so on resume these must be back-filled
    // from the same payload values — otherwise a draft resumed at/after
    // Step 2 shows an empty, re-validation-failing KYC step even though the
    // data already exists on the server.
    kycFirstName: firstName || fallback.kycFirstName,
    kycLastName: lastName || fallback.kycLastName,
    kycFather: p.fatherName ?? fallback.kycFather,
    kycAadhar: p.aadhar ?? fallback.kycAadhar,
    kycDob: p.dob ?? fallback.kycDob,
    kycGender: p.gender ?? fallback.kycGender,
    kycCity: p.city ?? fallback.kycCity,
    kycState: p.state ?? fallback.kycState,
    kycPin: p.zip ?? fallback.kycPin,
    kycStreet1: p.street1 ?? fallback.kycStreet1,
    empType: normalizeReactEmpType(p.empType) ?? fallback.empType,
    compName: p.compName ?? fallback.compName,
    compType: p.compType ?? fallback.compType,
    salary: p.salary != null && p.salary > 0 ? String(p.salary) : fallback.salary,
    obligations: p.obligations != null ? String(p.obligations) : fallback.obligations,
    desig: p.desig ?? fallback.desig,
    officeEmail: p.officeEmail ?? fallback.officeEmail,
    loanType: normalizeReactLoanType(p.loanType) ?? fallback.loanType,
    amount: p.amount != null && p.amount > 0 ? String(p.amount) : fallback.amount,
    loanRate: p.loanRate != null && p.loanRate > 0 ? String(p.loanRate) : fallback.loanRate,
    tenure: p.tenure != null && p.tenure > 0 ? String(p.tenure) : fallback.tenure,
    purpose: p.purpose ?? fallback.purpose,
    cibil: p.cibil != null ? String(p.cibil) : fallback.cibil,
    r1Name: p.r1Name ?? fallback.r1Name,
    r1Mobile: p.r1Mobile ?? fallback.r1Mobile,
    r1Relation: p.r1Relation ?? fallback.r1Relation,
    r2Name: p.r2Name ?? fallback.r2Name,
    r2Mobile: p.r2Mobile ?? fallback.r2Mobile,
    r2Relation: p.r2Relation ?? fallback.r2Relation,
  }
}


// ── Step field validation (single source of truth) ─────────────────────────
// Pure function extracted from the wizard's per-step validation so it can be
// (a) run on every keystroke/blur for real-time inline feedback and
// (b) run once more on Next/Submit to gate progression — both call sites
// share this exact same rule set, so they can never disagree.
export function computeStepErrors(
  step: number,
  data: WizardData,
  documents: Record<string, File | null>,
  uploadedDocKeys?: Record<string, unknown>,
): Record<string, string> {
  const errs: Record<string, string> = {}

  if (step === 1) {
    if (!MOBILE_RE.test(data.mobile)) errs.mobile = 'Enter a valid 10-digit mobile number (numbers only)'
    // PAN — Vanilla validateStep(1) checks ONLY length === 10 (efin-app.js:8332),
    // not a format regex. Match that exactly (the format regex is used only for
    // the CO-APPLICANT PAN, which Vanilla validateStep(3) does check by format).
    if (!data.pan || data.pan.trim().length !== 10) errs.pan = 'Enter valid 10-character PAN'
    if (!data.location) errs.location = 'Please select a Location'
    if (!data.salesPerson) errs.salesPerson = 'Please select a Sales Person'
    if (data.channel === 'dsa' && !data.dsaId) errs.dsaId = 'DSA name is required for DSA channel'
    if (data.channel === 'agent' && !data.partnerId) errs.partnerId = 'Partner name is required for Partner/Agent channel'
  }
  if (step === 2) {
    if (!AADHAR_RE.test(data.kycAadhar)) errs.kycAadhar = 'Enter a valid 12-digit Aadhaar number'
    if (!data.kycFirstName && !data.firstName) errs.kycFirstName = 'Name is required from KYC'
    if (data.kycPin && !PIN_RE.test(data.kycPin)) errs.kycPin = 'Enter a valid 6-digit PIN code'
  }
  if (step === 3) {
    if (!data.firstName) errs.firstName = 'First Name is required'
    if (!data.lastName) errs.lastName = 'Last Name is required'
    if (!data.gender) errs.gender = 'Gender is required'
    if (!data.dob) errs.dob = 'Date of Birth is required'
    // Vanilla validateStep(3) requires Aadhaar, Email, Father's & Mother's Name
    // (efin-app.js:8411-8418 _checkRequiredWizardFields + email format). React
    // previously left all four optional (format-only), so Continue advanced with
    // them blank — a real gate divergence.
    if (!data.aadhar) errs.aadhar = 'Aadhaar Number is required'
    else if (!AADHAR_RE.test(data.aadhar)) errs.aadhar = 'Enter a valid 12-digit Aadhaar number'
    if (!data.email) errs.email = 'Email Address is required'
    else if (!EMAIL_RE.test(data.email)) errs.email = 'Enter a valid email address (e.g. name@example.com)'
    if (!data.father) errs.father = "Father's Name is required"
    if (!data.mother) errs.mother = "Mother's Name is required"
    if (data.phone && !MOBILE_RE.test(data.phone)) errs.phone = 'Enter a valid 10-digit mobile number (numbers only)'
    // Co-Applicant (Step 3 block) — Vanilla: mandatory for Home Loan / LAP,
    // optional for Business Loan (wToggleCoApplicantSection). Format-validate
    // whenever a field is filled (covers the optional Business case too).
    const coApp3Mandatory = ['home_loan', 'lap'].includes(data.loanType)
    if (coApp3Mandatory) {
      if (!data.coAppName)   errs.coAppName   = 'Co-applicant name is required for this loan type'
      if (!data.coAppPan)    errs.coAppPan    = 'Co-applicant PAN is required for this loan type'
      if (!data.coAppAadhar) errs.coAppAadhar = 'Co-applicant Aadhaar is required for this loan type'
      if (!data.coAppMobile) errs.coAppMobile = 'Co-applicant mobile is required for this loan type'
    }
    if (['home_loan', 'lap', 'business_loan'].includes(data.loanType)) {
      if (data.coAppPan && !PAN_RE.test(data.coAppPan)) errs.coAppPan = 'Enter a valid PAN (e.g. ABCDE1234F)'
      if (data.coAppAadhar && !AADHAR_RE.test(data.coAppAadhar)) errs.coAppAadhar = 'Enter a valid 12-digit Aadhaar number'
      if (data.coAppMobile && !MOBILE_RE.test(data.coAppMobile)) errs.coAppMobile = 'Enter a valid 10-digit mobile number'
    }
  }
  if (step === 4) {
    // Current address — Vanilla validateStep(4) requires House/Flat, Street &
    // Locality, City, PIN, State, Home Type (efin-app.js:8438-8452). React had
    // left Street & Locality (street2) optional.
    if (!data.street1) errs.street1 = 'House / Flat No. is required'
    if (!data.street2) errs.street2 = 'Street & Locality is required'
    if (!data.city) errs.city = 'Current city is required'
    if (!data.state) errs.state = 'Current state is required'
    if (!PIN_RE.test(data.zip)) errs.zip = 'Enter a valid 6-digit PIN code (numbers only)'
    if (!data.homeType) errs.homeType = 'Home type is required'
    // Permanent address — Vanilla requires all 6 permanent fields too
    // (efin-app.js:8446-8451), EXCEPT for over_draft, where applyProductToWizard
    // hides the whole permanent block (toggle w-permanent-addr-block). The
    // "Same as current" checkbox copies current→permanent, satisfying them.
    // React previously required NONE of them (only a pZip format check).
    if (data.loanType !== 'over_draft' && !data.sameAddr) {
      if (!data.pStreet1) errs.pStreet1 = 'House / Flat No. is required'
      if (!data.pStreet2) errs.pStreet2 = 'Street & Locality is required'
      if (!data.pCity) errs.pCity = 'City is required'
      if (!data.pState) errs.pState = 'State is required'
      if (!PIN_RE.test(data.pZip)) errs.pZip = 'Enter a valid 6-digit PIN code (numbers only)'
      if (!data.pHomeType) errs.pHomeType = 'Home type is required'
    }
  }
  if (step === 5) {
    if (!data.empType) errs.empType = 'Employment Type is required'
    // Salary / Monthly income — Vanilla validateStep(5) does NOT require it
    // (w-salary is not in its required set), so it is NOT mandatory here either.
    // Only guard against a negative if one is typed.
    if (data.salary && parseFloat(data.salary) < 0) errs.salary = 'Income cannot be negative'
    if (data.obligations && parseFloat(data.obligations) < 0) errs.obligations = 'Obligations cannot be negative'
    // Office / workplace address — Vanilla requires Line 1/2/PIN for EVERY
    // employment type (w-officeaddr-l1/l2/pin for salaried + the -self variants
    // for self-emp/professional; validateStep(5), efin-app.js:8528-8540).
    if (data.empType) {
      if (!data.officeAddr1) errs.officeAddr1 = 'Office address line 1 is required'
      if (!data.officeAddr2) errs.officeAddr2 = 'Office address line 2 is required'
      if (!data.officePin) errs.officePin = 'Office PIN code is required'
      else if (!PIN_RE.test(data.officePin)) errs.officePin = 'Enter a valid 6-digit PIN code'
    }
    if (data.empType !== 'self_employed') {
      // Salaried / Professional
      if (!data.compName) errs.compName = 'Company name is required'
      if (!data.compType) errs.compType = 'Company type is required'
      if (!data.desig) errs.desig = 'Designation is required'
      // Official Email ID — Vanilla wValidateOfficeEmail (efin-app.js:9405) is a
      // SALARIED-ONLY field (inside #w-emp-salaried); it is skipped entirely when
      // hidden (Professional / Self-Employed). So require + format-check it only
      // for Salaried; don't validate it for Professional.
      if (data.empType === 'salaried') {
        if (!data.officeEmail) errs.officeEmail = 'Official Email ID is required'
        else if (!EMAIL_RE.test(data.officeEmail)) errs.officeEmail = 'Enter a valid email address (e.g. name@company.com)'
      }
      // Professional registration body — Vanilla requires w-prof-body for the
      // Professional employment type.
      if (data.empType === 'professional' && !data.professionalBody) errs.professionalBody = 'Professional body / registration is required'
    } else {
      // Self-employed / business — Vanilla requires comptype-self, biz-vintage,
      // turnover, net-profit, itr-filed, biz-type (efin-app.js:8531-8536). GST is
      // optional in Vanilla (no req marker), so it stays optional here too.
      if (!data.compType) errs.compType = 'Company / business type is required'
      if (!data.bizVintage) errs.bizVintage = 'Business vintage is required'
      if (!data.annualTurnover) errs.annualTurnover = 'Annual turnover is required'
      if (!data.netProfit) errs.netProfit = 'Net profit is required'
      if (!data.itrFiled) errs.itrFiled = 'ITR filed status is required'
      if (!data.bizType) errs.bizType = 'Business type is required'
    }
    // Property (Home Loan / LAP) — Vanilla requires Type, Ownership, Under
    // Construction (efin-app.js:8541-8543).
    if (data.loanType === 'home_loan' || data.loanType === 'lap') {
      if (!data.propertyType) errs.propertyType = 'Property type is required'
      if (!data.propertyOwnership) errs.propertyOwnership = 'Ownership type is required'
      if (!data.propertyUnderConstruction) errs.propertyUnderConstruction = 'Select the construction status'
    }
    // Vehicle (Car) — Vanilla requires make/model/year/price/km/dealer, but the
    // Manufacture Year + KMs fields are hidden for a new car (efin-app.js:8544-
    // 8549 + the km-wrap toggle), so they're only enforced for a used car.
    if (data.loanType === 'new_car' || data.loanType === 'used_car') {
      if (!data.vehicleMake) errs.vehicleMake = 'Vehicle make is required'
      if (!data.vehicleModel) errs.vehicleModel = 'Vehicle model is required'
      if (!data.vehiclePrice) errs.vehiclePrice = 'Vehicle price is required'
      if (!data.vehicleDealer) errs.vehicleDealer = 'Dealer name is required'
      if (data.loanType === 'used_car') {
        if (!data.vehicleMfgYear) errs.vehicleMfgYear = 'Manufacture year is required'
        if (!data.vehicleKms) errs.vehicleKms = 'Kilometres driven is required'
      }
    }
    // Education — Vanilla requires Institution, Course, Duration, Study Location,
    // Admission Status (efin-app.js:8481-8487).
    if (data.loanType === 'education') {
      if (!data.instituteName) errs.instituteName = 'Institution name is required'
      if (!data.courseName) errs.courseName = 'Course name is required'
      if (!data.courseDuration) errs.courseDuration = 'Course duration is required'
      if (!data.studyLocation) errs.studyLocation = 'Study location is required'
      if (!data.admissionStatus) errs.admissionStatus = 'Admission status is required'
    }
    // Co-applicant on Step 5 is the Education product's Parent/Guardian block
    // (Vanilla: mandatory for education — every field below carries a `req`
    // span in #w-edu-fields, index.html:2231-2249). Home/LAP/Business
    // co-applicant moved to its Step-3 block (matches Vanilla's
    // #wstep3-coapp-section placement).
    const coAppRequired = data.loanType === 'education'
    if (coAppRequired) {
      if (!data.coAppName) errs.coAppName = 'Co-applicant is required for this loan type'
      if (!data.coAppRelation) errs.coAppRelation = 'Co-applicant relationship is required'
      if (!data.coAppMobile) errs.coAppMobile = 'Co-applicant mobile is required'
      else if (!MOBILE_RE.test(data.coAppMobile)) errs.coAppMobile = 'Enter a valid 10-digit mobile number'
      if (!data.coAppPan) errs.coAppPan = 'Co-applicant PAN is required'
      else if (!PAN_RE.test(data.coAppPan)) errs.coAppPan = 'Enter a valid PAN (e.g. ABCDE1234F)'
      if (!data.coAppEmail) errs.coAppEmail = 'Co-applicant email is required'
      else if (!EMAIL_RE.test(data.coAppEmail)) errs.coAppEmail = 'Enter a valid email address (e.g. name@example.com)'
    } else {
      if (data.coAppPan && !PAN_RE.test(data.coAppPan)) errs.coAppPan = 'Enter a valid PAN (e.g. ABCDE1234F)'
      if (data.coAppMobile && !MOBILE_RE.test(data.coAppMobile)) errs.coAppMobile = 'Enter a valid 10-digit mobile number'
      if (data.coAppEmail && !EMAIL_RE.test(data.coAppEmail)) errs.coAppEmail = 'Enter a valid email address (e.g. name@example.com)'
    }
  }
  if (step === 6) {
    if (!data.loanType) errs.loanType = 'Loan type is required'
    if (data.loanType === 'insurance') {
      // Insurance is a policy application — amount/rate/tenure/purpose do
      // not apply, so they are not required here (legacy swaps the same
      // field set out entirely for this product).
      // Vanilla validateStep(6) requires the full policy field set via
      // _checkRequiredWizardFields (efin-app.js:8461-8490) — every visible
      // field. React previously required only 5 of them.
      if (!data.insType) errs.insType = 'Insurance type is required'
      if (!data.insSumAssured || parseFloat(data.insSumAssured) <= 0)
        errs.insSumAssured = 'Sum assured must be greater than 0'
      if (!data.insPolicyTerm || parseInt(data.insPolicyTerm) <= 0)
        errs.insPolicyTerm = 'Policy term is required'
      if (!data.insPremiumFreq) errs.insPremiumFreq = 'Premium payment frequency is required'
      if (!data.insPremium || parseFloat(data.insPremium) <= 0) errs.insPremium = 'Estimated premium is required'
      if (!data.insInsurer) errs.insInsurer = 'Preferred insurer is required'
      if (!data.insNomineeName) errs.insNomineeName = 'Nominee name is required'
      if (!data.insNomineeRelation) errs.insNomineeRelation = 'Nominee relationship is required'
      if (!data.insNomineeDob) errs.insNomineeDob = 'Nominee date of birth is required'
      if (!data.insNomineeId) errs.insNomineeId = 'Nominee ID (Aadhaar / PAN) is required'
      // Existing policy details — required only when the applicant has one
      // (Vanilla shows + requires w-existing-policy-no / w-existing-coverage).
      if (data.insExistingPolicy === 'yes') {
        if (!data.insExistingPolicyNumber) errs.insExistingPolicyNumber = 'Existing policy number is required'
        if (!data.insExistingCover || parseFloat(data.insExistingCover) <= 0) errs.insExistingCover = 'Existing coverage amount is required'
      }
      // Health declaration — Vanilla requires Tobacco status, Occupation Hazard,
      // Height, Weight, and the condition details when a condition is declared.
      if (!data.insTobaccoStatus) errs.insTobaccoStatus = 'Tobacco / smoker status is required'
      if (!data.insOccupationHazard) errs.insOccupationHazard = 'Occupation hazard is required'
      if (!data.insHeight) errs.insHeight = 'Height is required'
      if (!data.insWeight) errs.insWeight = 'Weight is required'
      if (data.insHealthDeclared === 'yes' && !data.insHealthNotes) errs.insHealthNotes = 'Please describe the medical condition'
    } else {
      // Vanilla validateStep(6) for a loan (non-insurance) gates on EXACTLY two
      // things (efin-app.js:8508-8509): loan amount > 0, and a tenure selected.
      // It does NOT require interest rate, purpose, a fixed-tenure-set match, or
      // a CIBIL range — those were React-only extra gates and are removed so the
      // Continue condition matches Vanilla exactly. (The tenure dropdown still
      // only offers the product's valid options; rate defaults; backend still
      // validates rate>0 at final submit.)
      if (!data.amount || parseFloat(data.amount) <= 0) errs.amount = 'Loan amount must be greater than 0'
      if (!data.tenure) errs.tenure = 'Please select a tenure'
    }
  }
  if (step === 7) {
    // Vanilla validateStep(7) requires BOTH references — Name, Mobile (10-digit)
    // and Relationship for each (efin-app.js:8552-8564). React previously
    // required only "at least one reference", so a single reference (or one with
    // no relationship) could pass. Reference addresses stay optional (Vanilla
    // does not require them).
    if (!data.r1Name) errs.r1Name = 'Reference 1 name is required'
    if (!data.r1Relation) errs.r1Relation = 'Reference 1 relationship is required'
    if (!data.r1Mobile) errs.r1Mobile = 'Reference 1 mobile is required'
    else if (!MOBILE_RE.test(data.r1Mobile)) errs.r1Mobile = 'Enter a valid 10-digit mobile number'
    if (!data.r2Name) errs.r2Name = 'Reference 2 name is required'
    if (!data.r2Relation) errs.r2Relation = 'Reference 2 relationship is required'
    if (!data.r2Mobile) errs.r2Mobile = 'Reference 2 mobile is required'
    else if (!MOBILE_RE.test(data.r2Mobile)) errs.r2Mobile = 'Enter a valid 10-digit mobile number'
  }
  if (step === 8) {
    // Mandatory documents - application cannot proceed/submit without these.
    // Satisfied by either a pending File in this session OR a document already
    // persisted to the draft on the server (uploadedDocKeys) — so a resumed
    // draft with its docs already saved does not fail validation.
    //
    // Mandatory = the intersection of the product+empType doc list with
    // _WIZ_MANDATORY_DOC_NAMES (Vanilla validateStep(8), efin-app.js:8569-8587).
    // So Salaried/Professional → Salary Slips + Bank Statement; Self-Employed →
    // Business Vintage Proof + Bank Statement; and a product whose list omits
    // these entirely (Education uses co-applicant income docs) has NO mandatory
    // Step-8 doc — matching Vanilla, and avoiding a dead-end where React demands
    // a doc it never renders.
    const docList = getWizardDocs(data.loanType, data.empType)
    for (const name of docList) {
      if (!WIZ_MANDATORY_DOC_NAMES.includes(name)) continue
      const key = MANDATORY_DOC_KEY_BY_NAME[name]
      if (key && !documents[key] && !uploadedDocKeys?.[key]) errs[key] = `${name} is required`
    }
  }
  // Step 9 (Loan Analytics) - no validation needed, it's summary only

  return errs
}

// Field keys whose error (if any) should also become visible once the
// person has interacted with any field in the same logical group — used
// only for the Step 7 "at least one reference" aggregate message, which
// isn't tied to a single input.
const REFERENCE_GROUP_FIELDS = ['r1Name', 'r1Mobile', 'r1Relation', 'r2Name', 'r2Mobile', 'r2Relation']

export default function NewApplicationPage() {
  const navigate    = useNavigate()
  const location    = useLocation()
  const qc          = useQueryClient()
  const user        = useAuthStore(s => s.user)
  const [searchParams] = useSearchParams()

  // Set when arriving via the sidebar's Loan Product Selector modal
  // (AppLayout) instead of a bare link click -- pre-fills Step 1's loan
  // type so the person doesn't have to pick it twice.
  const initialLoanType = (location.state as { initialLoanType?: string } | null)?.initialLoanType

  // Resuming only happens when arriving with an explicit ?draftId= from the
  // Applications → Drafts list (see LoansPage) — that value IS the backend
  // Loan id now (the list itself comes from GET /api/wizard/drafts).
  // Visiting the wizard any other way ("Register New" / New Application)
  // always starts a brand-new draft — it never reads, overwrites, or
  // deletes another draft.
  //
  // Nothing about a draft (which id exists, what step it's on, its form
  // data) is read from or written to localStorage anymore — the step
  // starts at 1 here and is corrected once the resumed draft's real data
  // (including its saved step, via Loan.WizardStep) comes back from the
  // server below.
  const resumeDraftId  = searchParams.get('draftId')
  const resumeLoanId   = resumeDraftId ? parseInt(resumeDraftId, 10) : NaN
  const isResumingDraft = resumeDraftId != null && !Number.isNaN(resumeLoanId)

  const [draftId]          = useState<string>(() => createDraftId())
  const [step, setStep]    = useState(1)
  // "Generating offer" interstitial (Vanilla parity: efin-app.js:8185/8198
  // showOfferInterstitial()). Non-null while the ~2.5s screen is running; carries
  // the product variant (loan vs insurance hint/title set) captured at the
  // moment the transition into step 6 was triggered.
  const [offerInterstitial, setOfferInterstitial] = useState<{ isInsurance: boolean } | null>(null)
  const [data, setData]    = useState<WizardData>(() => ({
    ...emptyData,
    salesPerson: user?.fullName ?? '',
    ...(initialLoanType ? { loanType: initialLoanType } : {}),
  }))
  // The loan product is chosen ONCE, up front, before the wizard body — via
  // the sidebar's product picker (arrives as `initialLoanType`) or, when the
  // wizard is reached by a direct link (LoansPage "New Application", the
  // /loans/new route, "Start New Application"), via the same picker shown as
  // an in-wizard gate below. A resumed draft already has its product. This
  // mirrors Vanilla's #loan-product-overlay "front door" and is why no step
  // re-selects the product. Until it's chosen the wizard body is not rendered
  // (and autosave no-ops on empty data), so no default-product draft is created.
  const [productChosen, setProductChosen] = useState<boolean>(!!initialLoanType || isResumingDraft)
  // True while we're fetching a resumed draft's form data back from the
  // server (GET /api/wizard/draft/{loanId}) — gates the wizard body so the
  // person doesn't see a flash of empty fields before their data loads.
  const [isResuming, setIsResuming] = useState(isResumingDraft)
  const [resumeError, setResumeError] = useState('')
  // Which fields the person has actually interacted with (typed into or
  // blurred), keyed by WizardData field name (or document key for Step 8).
  // Drives which real-time validation messages are currently visible —
  // an untouched empty required field doesn't nag the person the instant
  // the step loads, but starts showing feedback the moment they engage
  // with it. Next/Submit force every field in the current step to be
  // touched so nothing stays hidden when they try to move on.
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [submitError, setSubmitError] = useState('')
  const [documents, setDocuments] = useState<Record<string, File | null>>({})
  // Perfios analysis captured on Step 8's bank-statement doc rows — persisted
  // to the loan once its id exists (immediately if a draft already exists,
  // else at submit). Mirrors legacy pfv9ConfirmAttachment's attach-then-save.
  // Keyed per doc-item (own / co-applicant / current-account statement can
  // each be verified independently — legacy scopes this the same way via
  // window._pfv9DocItemId / _BFP_STORE keyed by the doc-item's DOM id), NOT
  // a single shared result, so running Perfios on one statement never
  // overwrites another's pending/unsaved result.
  const [perfiosResults, setPerfiosResults] = useState<Record<string, PerfiosUploadResult>>({})
  const perfiosSavedKeysRef = useRef<Set<string>>(new Set())
  // Perfios verification restored from the server on draft resume (see the
  // resume effect below) — the backend's PerfiosReport is LoanId-only (one
  // most-recent row per loan, unchanged by design — see PerfiosController),
  // so this can only ever recover the single most-recently-verified
  // statement's badge, matched back to its doc-item by file name.
  const [perfiosRestored, setPerfiosRestored] = useState<Record<string, PerfiosReport>>({})
  // Server-persisted mandatory documents (uploaded on select / restored on
  // resume), keyed by wizard doc key → { server document id, file name }.
  // Their presence means the doc is safe on the backend even across a refresh.
  const [uploadedDocs, setUploadedDocs] = useState<Record<string, UploadedDocInfo>>({})
  // Keys of MANDATORY_DOC_TYPES currently mid-flight to the draft loan —
  // drives the "Saving…" badge state on Step 8 so a document that's actively
  // persisting doesn't briefly look identical to "1 document required".
  const [uploadingDocKeys, setUploadingDocKeys] = useState<Record<string, boolean>>({})
  // Banks picked on Step 9's eligibility matcher (max 2, same as legacy).
  // Persisted after submit as the loan's bank lines — see the submit
  // handler below.
  const [selectedBanks, setSelectedBanks] = useState<SelectedBank[]>([])
  const [docUploadWarning, setDocUploadWarning] = useState('')
  // The id of the backend Draft Loan record this wizard session is tied to
  // (see wizardApi.saveDraft). Once set, every subsequent draft-save,
  // validate, and final submit call reuses this same record instead of the
  // final submit accidentally creating a brand-new, duplicate Loan.
  const [serverLoanId, setServerLoanId] = useState<number | undefined>(
    isResumingDraft ? resumeLoanId : undefined
  )
  // Refresh-safety (live-data persistence): surface the autosave state so the
  // user is never told "saved" when the backend write actually failed, and can
  // see when there are unsaved edits. `savingRef` serialises concurrent saves;
  // `dirtyRef` marks that the current in-memory data is ahead of the server.
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const savingRef = useRef(false)
  const dirtyRef = useRef(false)
  // Always points at the newest saveDraftNow. The tab-hide/unload/unmount flush
  // effect and the in-flight re-flush call THROUGH this ref instead of closing
  // over saveDraftNow directly, so neither re-subscribes on every keystroke
  // (which would defeat the 800ms debounce) nor persists stale form state.
  const saveDraftNowRef = useRef<() => Promise<void>>(() => Promise.resolve())

  // Fetch the resumed draft's real form data (and its saved step) from the
  // database. Runs once, only when arriving via a numeric ?draftId=.
  useEffect(() => {
    if (!isResumingDraft) return
    let cancelled = false
    wizardApi.getDraft(resumeLoanId)
      .then(res => {
        if (cancelled) return
        const payload = res.data.data
        if (payload) {
          setData(prev => payloadToWizardData(payload, prev))
          if (payload.step) setStep(payload.step)
        }
      })
      .catch(() => {
        if (!cancelled) setResumeError('Could not load this draft from the server. It may have already been submitted or removed.')
      })
      .finally(() => {
        if (!cancelled) setIsResuming(false)
      })

    // Restore already-uploaded MANDATORY documents from the server so a resumed
    // draft shows them as saved (and satisfies Step-8 validation) instead of
    // asking the user to re-attach files that are already persisted. Also
    // restore the Perfios verification badge (ABB/span/txns/valid) for
    // whichever bank-statement doc-item it belongs to, so "Perfios Verified"
    // doesn't silently disappear on refresh — previously nothing here called
    // perfiosApi.getLatest at all, so a resumed draft always fell back to the
    // generic "Saved to draft ✓" even for an already-verified statement.
    Promise.all([
      loansApi.getDocuments(resumeLoanId),
      perfiosApi.getLatest(resumeLoanId).catch(() => null),
    ])
      .then(([docsRes, perfiosRes]) => {
        if (cancelled) return
        const docs = docsRes.data.data ?? []
        const restored: Record<string, UploadedDocInfo> = {}
        for (const [key, type] of Object.entries(MANDATORY_DOC_TYPES)) {
          const match = docs.find(d => d.documentType === type)
          if (match) restored[key] = { id: match.id, name: match.documentName, fileRef: match.fileRef }
        }
        if (Object.keys(restored).length) setUploadedDocs(prev => ({ ...prev, ...restored }))

        // The backend keeps only the single most-recent PerfiosReport per
        // loan (LoanId-only design — see PerfiosController; deliberately not
        // changed here), so at most one doc-item's status can be recovered:
        // match its persisted file name back to the mandatory bank-statement
        // slot that shares that name. If a different bank-statement doc was
        // verified earlier in an older session, only the newest one's status
        // is recoverable — an existing backend-contract limit, not new here.
        const report = perfiosRes?.data.data
        if (report?.fileName) {
          const matchKey = Object.entries(restored)
            .find(([, info]) => info.name === report.fileName)?.[0]
          if (matchKey) setPerfiosRestored(prev => ({ ...prev, [matchKey]: report }))
        }
      })
      .catch(() => { /* non-fatal — user can re-attach/re-verify if needed */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Set once submission succeeds. Its presence gates the wizard body off the
  // screen in favour of a confirmation screen — which is also what actually
  // prevents a duplicate submission (there's no longer a Submit button to
  // click again).
  const [submissionResult, setSubmissionResult] = useState<{
    applicationId: number; eFinId: string; loanNumber: string; monthlyEmi: number
  } | null>(null)

  // Builds the API payload from the current wizard state. Shared by the
  // backend draft autosave, the pre-submit duplicate-application validation,
  // and the final submit so all three always agree on what "the application"
  // currently looks like.
  const buildPayload = useCallback((): WizardSubmitPayload => ({
    loanId:      serverLoanId,
    step:        step,
    mobile:      data.mobile,
    pan:         data.pan,
    fullName:    [data.firstName, data.middleName, data.lastName].filter(Boolean).join(' '),
    email:       data.email,
    dob:         data.dob,
    gender:      data.gender,
    aadhar:      data.aadhar || data.kycAadhar,
    fatherName:  data.father || data.kycFather,
    street1:     data.street1,
    street2:     data.street2,
    city:        data.city || data.kycCity,
    state:       data.state || data.kycState,
    zip:         data.zip || data.kycPin,
    homeType:    data.homeType,
    empType:     toEmploymentCode(data.empType),
    compName:    data.compName,
    compType:    data.compType,
    salary:      parseFloat(data.salary) || 0,
    obligations: parseFloat(data.obligations) || 0,
    desig:       data.desig,
    officeEmail: data.officeEmail,
    loanType:    data.loanType,
    // Insurance has no loan amount / rate / tenure, but the backend
    // validates all three as > 0 (WizardController: "Loan amount must be
    // greater than 0", tenure 1-360, rate > 0). Map the policy's own
    // equivalents onto them so an insurance application can actually be
    // submitted: Sum Assured is the cover amount, Policy Term is the
    // duration (years → months), and rate falls back to its default. The
    // real policy figures are also kept verbatim in productData below.
    amount:      data.loanType === 'insurance'
                   ? (parseFloat(data.insSumAssured) || 0)
                   : (parseFloat(data.amount) || 0),
    loanRate:    parseFloat(data.loanRate) || 12,
    tenure:      data.loanType === 'insurance'
                   ? Math.min((parseInt(data.insPolicyTerm) || 1) * 12, 360)
                   : (parseInt(data.tenure) || 24),
    purpose:     data.loanType === 'insurance'
                   ? (data.purpose || `${data.insType || 'Insurance'} policy`)
                   : data.purpose,
    cibil:       data.cibil ? parseInt(data.cibil) : undefined,
    r1Name:      data.r1Name,
    r1Mobile:    data.r1Mobile,
    r1Relation:  data.r1Relation,
    r2Name:      data.r2Name,
    r2Mobile:    data.r2Mobile,
    r2Relation:  data.r2Relation,
    salesPerson: data.salesPerson,
    channel:     data.channel,
    dsaName:     data.dsaName,
    location:    data.location,
    dsaId:       data.channel === 'dsa'   && data.dsaId     ? parseInt(data.dsaId)     : undefined,
    partnerId:   data.channel === 'agent' && data.partnerId ? parseInt(data.partnerId) : undefined,
    locationId:  data.location ? parseInt(data.location) : undefined,
    // Product-specific + co-applicant + self-employed detail. These live in
    // Loan.ProductDataJson server-side (a free-form key/value bag), which is
    // exactly what it was added for — no schema change needed. Empty values
    // are stripped so a Personal Loan doesn't persist a bag of blank
    // property/vehicle keys.
    productData: Object.fromEntries(
      Object.entries({
        // Mother's Name (Step 3) + per-reference addresses (Step 7) — Vanilla
        // captures these; the backend payload has no dedicated columns, so they
        // ride the existing ProductDataJson pipe like every other extra field.
        mother: data.mother,
        // Permanent Address (Step 4, second half) — required whenever "Same as
        // current" isn't checked, but was never included in the payload at all
        // (a real data-loss bug: WizardController reads these back out of
        // ProductData onto Customer.Permanent* — see ApplyProductDataCustomerFields).
        pStreet1: data.pStreet1, pStreet2: data.pStreet2, pCity: data.pCity,
        pState: data.pState, pZip: data.pZip, pHomeType: data.pHomeType,
        // Lead Source (Step 1) — Vanilla captures it; no backend column, so it
        // rides ProductDataJson like the other extra fields. Resume restores
        // it via the `...pd` spread in payloadToWizardData.
        leadsrc: data.leadsrc,
        // Optional Partner linked under a DSA (Step 1, DSA channel only).
        dsaLinkedPartner: data.channel === 'dsa' ? data.dsaLinkedPartner : '',
        r1Addr1: data.r1Addr1, r1Addr2: data.r1Addr2, r1City: data.r1City, r1Pin: data.r1Pin,
        r2Addr1: data.r2Addr1, r2Addr2: data.r2Addr2, r2City: data.r2City, r2Pin: data.r2Pin,
        bizVintage: data.bizVintage, annualTurnover: data.annualTurnover,
        netProfit: data.netProfit, gstNumber: data.gstNumber, itrFiled: data.itrFiled,
        officeAddress: data.officeAddress, professionalBody: data.professionalBody,
        bizType: data.bizType,
        officeAddr1: data.officeAddr1, officeAddr2: data.officeAddr2, officePin: data.officePin,
        propertyType: data.propertyType, propertyValue: data.propertyValue,
        propertyAddress: data.propertyAddress, propertyCity: data.propertyCity,
        propertyOwnership: data.propertyOwnership,
        propertyUnderConstruction: data.propertyUnderConstruction, builderSociety: data.builderSociety,
        vehicleMake: data.vehicleMake, vehicleModel: data.vehicleModel,
        vehiclePrice: data.vehiclePrice, vehicleMfgYear: data.vehicleMfgYear,
        vehicleExShowroom: data.vehicleExShowroom, vehicleKms: data.vehicleKms,
        vehicleDealer: data.vehicleDealer,
        courseName: data.courseName, instituteName: data.instituteName,
        courseDuration: data.courseDuration,
        studyLocation: data.studyLocation, admissionStatus: data.admissionStatus,
        coAppName: data.coAppName, coAppRelation: data.coAppRelation,
        coAppPan: data.coAppPan, coAppMobile: data.coAppMobile, coAppAadhar: data.coAppAadhar,
        coAppEmail: data.coAppEmail,
        // Insurance policy fields (Step 6 swaps to these for that product)
        ...(data.loanType === 'insurance' ? {
          insType: data.insType, insSumAssured: data.insSumAssured,
          insPolicyTerm: data.insPolicyTerm, insPremiumFreq: data.insPremiumFreq,
          insPremium: data.insPremium, insInsurer: data.insInsurer,
          insNomineeName: data.insNomineeName, insNomineeRelation: data.insNomineeRelation,
          insNomineeDob: data.insNomineeDob, insNomineeId: data.insNomineeId,
          insExistingPolicy: data.insExistingPolicy,
          insExistingInsurer: data.insExistingInsurer, insExistingCover: data.insExistingCover,
          insExistingPolicyNumber: data.insExistingPolicyNumber,
          insHealthDeclared: data.insHealthDeclared, insHealthNotes: data.insHealthNotes,
          insTobaccoStatus: data.insTobaccoStatus, insHeight: data.insHeight,
          insWeight: data.insWeight, insOccupationHazard: data.insOccupationHazard,
        } : {}),
      }).filter(([, v]) => v !== '' && v != null),
    ),
    // See WizardSubmitPayload.selectedBanks — persisted server-side inside
    // Submit itself so a Sales/Dsa/Partner-submitted application's bank picks
    // aren't lost to the separate bank-lines endpoint's narrower role gate.
    selectedBanks: selectedBanks.length
      ? selectedBanks.map(b => ({
          bankName: b.bankName,
          tempApplicationNumber: '',
          remarks: 'Selected from eligibility match at origination',
        }))
      : undefined,
  }), [data, serverLoanId, step, selectedBanks])

  // Autosave the in-progress wizard so it can be resumed later from
  // Applications → Drafts, on any device. Debounced to avoid writing on
  // every keystroke. File uploads (Step 8) are intentionally excluded —
  // they cannot be serialized and are re-attached on resume.
  //
  // Everything about the draft — form data (business/PII) AND which step
  // it's on (Loan.WizardStep, via the `step` field in buildPayload()) —
  // goes to the backend Draft Loan record in this one call. Nothing is
  // kept in the browser.
  // Scroll to (and shake) the first invalid field when a step fails
  // validation on Next/Submit. Bumping errorNonce runs the effect AFTER the
  // setTouched re-render has committed the [data-field-error] markers, so
  // the DOM query below finds them.
  const stepBodyRef = useRef<HTMLDivElement>(null)
  const [errorNonce, setErrorNonce] = useState(0)
  useEffect(() => {
    if (errorNonce === 0) return
    const bad = stepBodyRef.current?.querySelectorAll<HTMLElement>('[data-field-error="true"]')
    if (!bad || bad.length === 0) return
    bad[0].scrollIntoView({ behavior: 'smooth', block: 'center' })
    bad.forEach(el => {
      el.classList.remove('field-shake')
      // Force reflow so re-adding the class restarts the animation.
      void el.offsetWidth
      el.classList.add('field-shake')
    })
  }, [errorNonce])

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Immediate, awaitable draft flush — the single source of truth for
  // persisting the in-progress wizard to the backend Draft Loan. Used by the
  // debounce, by Next (flush the step's data before advancing), and on
  // tab-hide/close. Reports real state via setSaveState — it NEVER reports
  // "saved" when the backend write failed (refresh-safety requirement).
  const saveDraftNow = useCallback(async (): Promise<void> => {
    const fullName = [data.firstName, data.middleName, data.lastName].filter(Boolean).join(' ')
    if (!data.mobile && !fullName) return   // nothing meaningful to persist yet
    if (savingRef.current) { dirtyRef.current = true; return }  // a save is in flight
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    savingRef.current = true
    setSaveState('saving')
    // Clear the dirty flag BEFORE the await, not after. Any edit that lands
    // while this save is in flight re-marks it (via the in-flight guard above
    // and the debounce effect), and the post-save re-flush below then persists
    // that edit. Clearing it AFTER the await instead clobbered those in-flight
    // edits — a change typed during a save could be silently dropped from the
    // draft and never reach the server.
    dirtyRef.current = false
    let savedOk = false
    try {
      const res = await wizardApi.saveDraft(buildPayload())
      const loanId = res.data.data?.loanId
      if (loanId) setServerLoanId(loanId)
      setSaveState('saved')
      savedOk = true
    } catch {
      // Do NOT fall back to localStorage and do NOT claim success — surface the
      // unsaved state so the user knows this round did not reach the server, and
      // keep the draft marked dirty so the next debounce tick retries it.
      dirtyRef.current = true
      setSaveState('error')
    } finally {
      savingRef.current = false
    }
    // If newer edits arrived while this save was in flight, flush them too —
    // but ONLY after a successful save. Re-flush THROUGH the ref so it runs the
    // latest saveDraftNow (freshest form state), not this now-stale closure. On
    // failure the re-flush is skipped (dirtyRef stays true) so the next edit's
    // 800ms debounce retries with natural spacing — re-flushing on error would
    // recreate the tight zero-delay loop that once hammered /api/wizard/draft
    // into a 429 storm.
    if (savedOk && dirtyRef.current && !savingRef.current) { void saveDraftNowRef.current() }
  }, [data, buildPayload])

  // Keep the ref pointed at the newest saveDraftNow so its through-ref callers
  // (the flush effect and the in-flight re-flush) always run the latest one.
  useEffect(() => { saveDraftNowRef.current = saveDraftNow }, [saveDraftNow])

  // Debounced autosave — marks the draft dirty on every change and flushes
  // 800ms after the last edit. The debounce is only a keystroke throttle now;
  // Next and tab-hide flush immediately, so the 800ms is no longer a data-loss
  // window on navigation.
  useEffect(() => {
    dirtyRef.current = true
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void saveDraftNow() }, 800)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, step, data])

  // Flush pending edits when the tab is hidden or the page is being unloaded
  // (route change away, tab close, browser close) — visibilitychange 'hidden'
  // fires early enough for the request to be sent. No native beforeunload
  // confirm dialog (preserves the existing UX).
  useEffect(() => {
    const flush = () => { if (dirtyRef.current) void saveDraftNowRef.current() }
    const onVis = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', flush)
      // Component unmount (route change within the SPA) — flush the latest.
      flush()
    }
    // Runs ONCE: subscribe on mount, flush + unsubscribe on unmount. It must
    // NOT depend on saveDraftNow — depending on it re-ran this effect (and its
    // flush()-calling cleanup) on every keystroke, defeating the 800ms debounce
    // and turning the autosave into a per-keystroke POST /api/wizard/draft
    // storm. The flush() calls go THROUGH saveDraftNowRef and dirtyRef (both
    // refs), so they always run the newest saveDraftNow despite the empty deps.
  }, [])

  const setDocument = useCallback((key: string, file: File | null) => {
    // Client-side mirror of the backend's extension/size restrictions —
    // reject an invalid file immediately with a clear reason instead of
    // accepting it into state and letting it fail with a 400 later (either
    // silently at the next autosave-triggered upload, or at final submit).
    if (file) {
      const validationError = validateDocFile(file)
      if (validationError) { setDocUploadWarning(validationError); return }
    }
    setDocuments(prev => ({ ...prev, [key]: file }))
    setTouched(prev => (prev[key] ? prev : { ...prev, [key]: true }))

    // Removing a doc: if it was already persisted to the draft on the server
    // (uploaded.id), actually delete it there too (soft-delete + S3 object,
    // same DELETE the Documents tab uses) — previously this only cleared
    // local state, so a removed mandatory document silently reappeared the
    // next time the draft was resumed (getDocuments would restore it again,
    // since the server copy was never told to go away).
    if (file === null) {
      setUploadedDocs(prev => {
        const existing = prev[key]
        if (existing?.id && serverLoanId) {
          loansApi.deleteDocument(serverLoanId, existing.id).catch(() => setDocUploadWarning(
            'Could not remove this document from the server — it may still appear if you resume this draft.'))
        }
        if (!existing) return prev
        const n = { ...prev }; delete n[key]; return n
      })
      return
    }
    // Mandatory docs: persist to the draft loan immediately so a refresh cannot
    // lose them. Requires the draft to exist (serverLoanId, created by the first
    // autosave); if it doesn't yet, the file stays pending and is uploaded at
    // submit (existing fallback path).
    const docType = MANDATORY_DOC_TYPES[key]
    if (docType && serverLoanId) {
      const previousId = uploadedDocs[key]?.id
      setUploadingDocKeys(prev => ({ ...prev, [key]: true }))
      loansApi.uploadDocument(serverLoanId, file, docType, docApplicantRole(key))
        .then(res => {
          const d = res.data.data
          if (d?.id) {
            setUploadedDocs(prev => ({ ...prev, [key]: { id: d.id, name: file.name, fileRef: d.fileRef } }))
            // "Replace File" on an already-saved mandatory doc: remove the
            // superseded row so it can never win a future getDocuments()
            // restore (which matches on documentType, first-hit) and so it
            // doesn't linger as an orphaned duplicate in storage.
            if (previousId && previousId !== d.id) loansApi.deleteDocument(serverLoanId, previousId).catch(() => {})
          }
        })
        .catch(() => setDocUploadWarning(
          'A required document could not be saved to the draft yet — it will be uploaded when you submit.'))
        .finally(() => setUploadingDocKeys(prev => { const n = { ...prev }; delete n[key]; return n }))
    }
  }, [serverLoanId, uploadedDocs])

  // Perfios report captured on a Step 8 bank-statement doc-item. Save it
  // immediately when a draft loan already exists (legacy saved on confirm to
  // app._apiId); otherwise the submit handler saves it once the loan is
  // created. Keyed by docKey so own/co-applicant/current-account statements
  // each track and (re)save independently — this already posts `result` from
  // the closure, not shared state, so concurrent saves for different doc-items
  // were never at risk of clobbering each other's server write; what keying
  // fixes is the local pending/"already saved" bookkeeping and the submit-time
  // fallback below, which previously only remembered the single latest result.
  const handlePerfios = useCallback((docKey: string, result: PerfiosUploadResult) => {
    setPerfiosResults(prev => ({ ...prev, [docKey]: result }))
    perfiosSavedKeysRef.current.delete(docKey)
    if (serverLoanId) {
      perfiosApi.save(serverLoanId, perfiosSaveRequest(result))
        .then(() => { perfiosSavedKeysRef.current.add(docKey) })
        .catch(() => { /* non-fatal — retried at submit */ })
    }
  }, [serverLoanId])

  const update = useCallback((fields: Partial<WizardData>) => {
    setData(prev => ({ ...prev, ...fields }))
    // Real-time validation: mark every changed field touched immediately so
    // its inline message (if any) appears as the person types, not only
    // after they try to move on.
    setTouched(prev => {
      const next = { ...prev }
      Object.keys(fields).forEach(k => { next[k] = true })
      return next
    })
  }, [])

  // A field is marked touched on change/blur (see update/setDocument/touch).
  const touch = useCallback((field: string) => {
    setTouched(prev => (prev[field] ? prev : { ...prev, [field]: true }))
  }, [])

  // ── Step validation (mirrors legacy validateStep) ─────────────────────────
  // Same rule set as before, now factored out into computeStepErrors so it
  // can also drive real-time validation below — this is the only place the
  // rules live, so there's no risk of the two ever disagreeing.

  // Full set of errors for the step currently on screen, recomputed on every
  // keystroke/selection. Used to (a) gate the Next/Submit button in real
  // time and (b) reveal every message at once when the person attempts to
  // proceed with the step still invalid.
  const liveStepErrors = useMemo(
    () => computeStepErrors(step, data, documents, uploadedDocs),
    [step, data, documents, uploadedDocs],
  )

  // Subset of liveStepErrors that's actually visible right now — only for
  // fields the person has touched (typed into or blurred), so a fresh step
  // doesn't greet them with a wall of "required" errors before they've done
  // anything. The Step 7 aggregate "at least one reference is required"
  // message isn't tied to a single input, so it surfaces once any reference
  // field has been touched.
  const stepErrors = useMemo(() => {
    const visible: Record<string, string> = {}
    for (const key of Object.keys(liveStepErrors)) {
      if (key === 'references') {
        if (REFERENCE_GROUP_FIELDS.some(f => touched[f])) visible[key] = liveStepErrors[key]
      } else if (touched[key]) {
        visible[key] = liveStepErrors[key]
      }
    }
    return visible
  }, [liveStepErrors, touched])

  const validateCurrentStep = (): boolean => {
    // Reveal every error for this step's fields, whether or not the person
    // has touched them yet — this is what makes clicking Next/Submit with
    // an untouched required field still show the message immediately.
    setTouched(prev => {
      const next = { ...prev }
      Object.keys(liveStepErrors).forEach(k => {
        if (k === 'references') REFERENCE_GROUP_FIELDS.forEach(f => { next[f] = true })
        else next[k] = true
      })
      return next
    })
    return Object.keys(liveStepErrors).length === 0
  }

  const submit = useMutation({
    mutationFn: async () => {
      const res = await wizardApi.submit(buildPayload())
      const result = res.data.data

      // Upload the mandatory documents now that the loan record exists.
      // Best-effort: the application itself has already been created
      // successfully at this point, so a document upload hiccup is
      // surfaced as a warning rather than failing the whole submission.
      if (result?.loanId) {
        const uploads: Array<Promise<unknown>> = []
        // Upload every attached document that isn't already persisted to the
        // draft (uploadedDocs — the mandatory ones are usually saved on select,
        // so we never double-upload). Mandatory docs use their mapped
        // documentType (salary_slip / bank_statement / income); every other
        // (product-specific / optional) doc is keyed by its own display name,
        // which is NOT a valid backend documentType on its own — it must go
        // through the same whitelist-safe mapper (previously this sent the
        // raw name straight through, so every optional document upload here
        // was rejected with 400 "Invalid document type").
        for (const [key, f] of Object.entries(documents)) {
          if (!f || uploadedDocs[key]) continue
          const type = MANDATORY_DOC_TYPES[key] ?? mapDocNameToBackendType(key)
          uploads.push(loansApi.uploadDocument(result.loanId, f, type, docApplicantRole(key)))
        }

        if (uploads.length) {
          const outcomes = await Promise.allSettled(uploads)
          if (outcomes.some(o => o.status === 'rejected')) {
            setDocUploadWarning(
              'Application submitted, but one or more documents failed to upload. ' +
              'Please retry the upload from the application details page.'
            )
          }
        }

        // Persist every Perfios bank-statement report captured on Step 8 now
        // that the loan exists (the wizard had no loan id at analysis time) —
        // own, co-applicant, and current-account statements are each tracked
        // by their own doc-item key, so all of them are saved here, not just
        // whichever was processed last. Skips any doc-item already saved by
        // the immediate on-confirm save in handlePerfios. Best-effort, same
        // as the docs above.
        const pendingPerfios = Object.entries(perfiosResults)
          .filter(([key]) => !perfiosSavedKeysRef.current.has(key))
        if (pendingPerfios.length) {
          const outcomes = await Promise.allSettled(pendingPerfios.map(([key, r]) =>
            perfiosApi.save(result.loanId, perfiosSaveRequest(r))
              .then(() => { perfiosSavedKeysRef.current.add(key) })
          ))
          if (outcomes.some(o => o.status === 'rejected')) {
            // Non-fatal (the application is already created), but do NOT
            // swallow it silently — tell the user so they can re-run/re-save
            // the Perfios report from the application's Reports tab.
            setDocUploadWarning(
              'Application submitted, but one or more Perfios bank-statement reports could not be saved. ' +
              'Please re-run them from the application details page (Reports → Perfios Report).'
            )
          }
        }

        // Persist the banks picked on Step 9's eligibility matcher as the
        // loan's bank lines (which lenders this application goes to) via
        // the existing PUT /api/loans/{id}/bank-lines — whole-set replace.
        // Best-effort, same as documents above: the application itself is
        // already created, so a failure here is a warning, not a rollback.
        if (selectedBanks.length) {
          try {
            await loansApi.updateBankLines(result.loanId, selectedBanks.map(b => ({
              bankName: b.bankName,
              // No temp application number exists yet at origination — the
              // Lender Details tab fills it in once the case is logged in
              // with the bank.
              tempApplicationNumber: '',
              remarks: 'Selected from eligibility match at origination',
            })))
          } catch {
            setDocUploadWarning(prev => prev ||
              'Application submitted, but the selected banks could not be saved. ' +
              'You can set them from the Lender Details tab.')
          }
        }
      }

      return res
    },
    onSuccess: (res) => {
      const result = res.data.data
      // No draft cleanup call needed here — Submit already moves this Loan's
      // Status off Draft server-side, so GET /api/wizard/drafts stops
      // returning it on its own; there's no separate local index to clear.
      // The backend already invalidates its own cache on submit (WizardController.
      // Submit → ICacheService.RemoveByPrefixAsync), but that doesn't touch this
      // browser tab's React Query cache. Without this, the Applications list /
      // Dashboard can keep showing pre-submission data for up to their staleTime
      // (30s / 60s) if either query was already cached from earlier in the session.
      qc.invalidateQueries({ queryKey: LOAN_KEYS.all })
      if (result) {
        setSubmissionResult({
          applicationId: result.loanId, eFinId: result.eFinId,
          loanNumber: result.loanNumber, monthlyEmi: result.monthlyEmi
        })
      }
    },
    onError: (error) => {
      setSubmitError(getApiErrorMessage(error, 'Failed to submit application. Please check all fields and try again.'))
    },
  })

  // Duplicate-application check — calls the existing /api/wizard/validate
  // endpoint (which flags an existing active application for the same PAN)
  // before the wizard is allowed to submit. Runs as its own step so a
  // rejected duplicate never reaches submit.mutate() at all.
  const validateMutation = useMutation({
    mutationFn: () => wizardApi.validate(buildPayload()),
    onSuccess: () => submit.mutate(),
    onError: (error) => {
      setSubmitError(getApiErrorMessage(error, 'Please review the application before submitting.'))
    },
  })

  // ── Dynamic wizard flow (product-driven) — see WIZARD_PRODUCT_CONFIG.
  // `step` is the PHYSICAL step id; `pos` is its 1-based position within the
  // active product's flow. Navigation walks activeSteps by position so skipped
  // steps (e.g. References for a car loan) are never shown.
  const wizCfg = WIZARD_PRODUCT_CONFIG[data.loanType] ?? DEFAULT_WIZARD
  const activeSteps = wizCfg.steps
  const activeLabels = wizCfg.labels
  const totalSteps = activeSteps.length
  const pos = activeSteps.indexOf(step) + 1               // 1-based; 0 if step not in flow
  const isLastStep = pos === totalSteps
  const currentLabel = pos >= 1 ? activeLabels[pos - 1] : (STEP_LABELS[step - 1] ?? '')

  // If the loan product changed to one whose flow doesn't include the current
  // physical step (e.g. sitting on References=7 then switching to a car loan),
  // snap back to the nearest earlier step that IS in the new flow.
  useEffect(() => {
    if (activeSteps.indexOf(step) === -1) {
      const fallback = [...activeSteps].reverse().find(s => s <= step) ?? activeSteps[0]
      setStep(fallback)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.loanType])

  const handleNext = () => {
    if (isLastStep) {
      if (!validateCurrentStep()) { setErrorNonce(n => n + 1); return }
      // Vanilla validateStep(9) requires at least one bank selected on Loan
      // Analytics before submitting (efin-app.js:8594-8600); the eligibility
      // matcher caps the upper bound at 2, same as legacy. React marked Step 9
      // "summary only" and let a bank-less application through.
      if (selectedBanks.length < 1) {
        setSubmitError('Please select at least 1 bank before submitting. Tap a bank card in the eligibility list to select.')
        setErrorNonce(n => n + 1)
        return
      }
      if (submit.isPending || validateMutation.isPending) return  // ✅ Prevent multiple clicks
      setSubmitError('')
      validateMutation.mutate()
      return
    }
    if (!validateCurrentStep()) { setErrorNonce(n => n + 1); return }
    // PAN 60-day duplicate — Vanilla BLOCKS Continue here (validateStep step 1,
    // efin-app.js:8353 returns false), on top of the advisory wPanCheck warning
    // strip. React had ported only the advisory warning, so a duplicate PAN
    // could still proceed. Restore Vanilla's blocking behaviour on step 1 by
    // reading the same duplicate-check result Step1 already caches
    // (['loan-duplicate-check', PAN]).
    if (step === 1) {
      const panKey = (data.pan || '').trim().toUpperCase()
      const dup = panKey.length === 10
        ? qc.getQueryData<{ hasDuplicate?: boolean; status?: string; loanNumber?: string }>(['loan-duplicate-check', panKey])
        : undefined
      if (dup?.hasDuplicate) {
        setSubmitError(`Customer has a recent ${dup.status} application on this PAN within 60 days${dup.loanNumber ? ` (${dup.loanNumber})` : ''} — cannot proceed with a duplicate.`)
        setErrorNonce(n => n + 1)
        return
      }
    }
    // Persist the current step's data before advancing — removes the debounce
    // window so a refresh right after moving to the next step cannot lose it.
    void saveDraftNow()
    const nextPhysical = activeSteps[pos]  // pos is 1-based → element after current
    if (nextPhysical == null) return
    // Interstitial: show the ~2.5-second "generating offer" screen when the NEXT
    // physical step is 6 (Initial Offer) — Vanilla parity, efin-app.js:8183-8192
    // (`if (dir === 1 && wizPosToStepId(next) === 6) { showOfferInterstitial(...) }`).
    // Products whose flow skips physical step 6 (e.g. Insurance) never hit this
    // branch, since `nextPhysical` can then never equal 6 — same as Vanilla.
    if (nextPhysical === 6) {
      setOfferInterstitial({ isInsurance: data.loanType === 'insurance' })
      return
    }
    setStep(nextPhysical)
  }

  // Fires once the ~2.5s offer interstitial completes — advances to step 6 and
  // scrolls to top, mirroring Vanilla's onComplete callback (efin-app.js:8187-8190).
  const handleOfferInterstitialComplete = useCallback(() => {
    setOfferInterstitial(null)
    setStep(6)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const handleBack = () => {
    const prevPhysical = activeSteps[pos - 2]  // element before current
    if (prevPhysical != null) setStep(prevPhysical)
  }

  const progress = Math.round((pos / totalSteps) * 100)

  // Motivational progress mood — ported verbatim from Vanilla's wizard footer
  // (efin-app.js:8016-8032). Shown above the footer progress bar, keyed on the
  // same pct = currentStep / totalSteps the bar width uses.
  const progressMood = (() => {
    const pct = pos / totalSteps
    const moods: [number, string][] = [
      [0,    "Let's get started 🚀"],
      [0.15, 'Great start! Keep going 💪'],
      [0.35, "You're doing great ✨"],
      [0.50, 'Halfway there! 🎯'],
      [0.65, 'Almost done, stay with it 🌟'],
      [0.80, 'So close now! Nearly there 🏁'],
      [0.95, "Final step — you've got this! 🎉"],
      [1.00, 'All done! Submitting… 🎊'],
    ]
    const found = [...moods].reverse().find(([t]) => pct >= t)
    return found ? found[1] : moods[0][1]
  })()

  // Product gate — the "front door". When the wizard is opened without a
  // product already chosen (direct link, not via the sidebar picker) and we're
  // not resuming an existing draft, show the SAME picker as an overlay before
  // the wizard body. Selecting locks the product for the whole application;
  // Cancel returns to the applications list. Matches Vanilla's product overlay
  // and guarantees the product is set once, never re-picked inside a step.
  if (!productChosen) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="mb-5">
          <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>New Loan Application</h1>
          <p style={{ fontSize: 13, color: 'var(--text3)' }}>Choose a loan product to begin.</p>
        </div>
        <LoanProductSelectorModal
          onSelect={(loanType) => { setData(d => ({ ...d, loanType })); setProductChosen(true) }}
          onClose={() => navigate('/loans')}
        />
      </div>
    )
  }

  if (isResuming) {
    return (
      <PageLoader />
    )
  }

  if (resumeError) {
    return (
      <div className="max-w-2xl mx-auto py-24 text-center">
        <AlertCircle size={28} className="mx-auto text-red-500 mb-4" />
        <p className="text-sm text-gray-700 mb-4">{resumeError}</p>
        <button onClick={() => navigate('/loans')}
          className="px-4 py-2 rounded-lg bg-efin-blue text-white text-sm font-medium hover:opacity-90">
          Back to Applications
        </button>
      </div>
    )
  }

  if (submissionResult) {
    return (
      <div className="max-w-2xl mx-auto py-16">
        <div className="text-center mb-8">
          <CheckCircle2 size={56} className="mx-auto text-green-500 mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-1">Application Submitted Successfully</h1>
          <p className="text-sm text-gray-500">The application has been created and is now in the pipeline.</p>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 mb-6">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Application ID</dt>
              <dd className="text-gray-900 font-semibold mt-0.5">{submissionResult.applicationId || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Loan Number</dt>
              <dd className="text-gray-900 font-semibold mt-0.5">{submissionResult.loanNumber}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-gray-500 uppercase tracking-wide">EFIN ID</dt>
              <dd className="text-gray-900 font-semibold mt-0.5">{submissionResult.eFinId}</dd>
            </div>
            {submissionResult.monthlyEmi > 0 && (
              <div>
                <dt className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Estimated EMI</dt>
                <dd className="text-gray-900 font-semibold mt-0.5">{fmtINR(submissionResult.monthlyEmi)}</dd>
              </div>
            )}
          </dl>
        </div>

        {docUploadWarning && (
          <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700 flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0" />{docUploadWarning}
          </div>
        )}

        <div className="flex items-center justify-center gap-3">
          {submissionResult.applicationId > 0 && (
            <button
              onClick={() => navigate(`/loans/${submissionResult.applicationId}`)}
              className="px-5 py-2.5 rounded-xl bg-efin-blue text-white text-sm font-semibold hover:bg-[#064377] transition-colors"
            >
              View Application
            </button>
          )}
          <button
            onClick={() => navigate('/loans')}
            className={submissionResult.applicationId > 0
              ? 'px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors'
              : 'px-5 py-2.5 rounded-xl bg-efin-blue text-white text-sm font-semibold hover:bg-[#064377] transition-colors'}
          >
            Go to Applications
          </button>
          <button
            onClick={() => { window.location.href = '/loans/new' }}
            className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Start New Application
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header — Vanilla wizard head (index.html:1476): 24px/800 title,
          13px --text3 subtitle. The draft-autosave status (a React persistence
          feature Vanilla has no chip for) sits unobtrusively at the top-right
          so no non-Vanilla progress bar is introduced here; the real progress
          bar lives in the footer, exactly like Vanilla. */}
      <div className="mb-5 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>New Loan Application</h1>
          <p style={{ fontSize: 13, color: 'var(--text3)' }}>A guided process — takes about 5 minutes to complete</p>
        </div>
        <div className="mt-1">
          {saveState === 'saving' && (
            <span className="text-xs flex items-center gap-1 text-gray-400"><InlineLoader size={11} /> Saving draft…</span>
          )}
          {saveState === 'saved' && (
            <span className="text-xs flex items-center gap-1 text-green-600"><CheckCircle size={11} /> Draft saved</span>
          )}
          {saveState === 'error' && (
            <button type="button" onClick={() => void saveDraftNow()}
              className="text-xs flex items-center gap-1 text-red-600 hover:underline">
              <AlertCircle size={11} /> Not saved — retry
            </button>
          )}
        </div>
      </div>

      {/* Step indicators — legacy-style gradient/glow stepper, one hue per step.
          TOP-STEPPER LABELS use Vanilla's DEFAULT set for every product: Vanilla
          getActiveWizardSteps() has no per-product wizardLabels, so its top
          stepper always shows the default labels; the product-specific text
          shows in the section HEAD inside the step (the `{pos}. {currentLabel}`
          h2 below, which keeps the per-product label — matching Vanilla's
          applyProductToWizard section heads). */}
      <div className="wiz-steps">
        {activeSteps.map((physicalId, i) => {
          const label = STEPPER_LABELS[physicalId - 1] ?? activeLabels[i]
          const done   = i + 1 < pos
          const active = physicalId === step
          const c = WIZ_STEP_COLORS[(physicalId - 1) % WIZ_STEP_COLORS.length]
          return (
            <div key={physicalId} className={`wiz-step ${done ? 'done' : ''} ${active ? 'active' : ''} ${!done && !active ? 'locked' : ''}`}>
              <div
                className="wiz-step-num"
                style={{
                  ['--wiz-bg' as string]: c.bg,
                  ['--wiz-border' as string]: active || done ? c.activeBorder : c.border,
                  ['--wiz-fg' as string]: c.fg,
                  ['--wiz-grad' as string]: c.grad,
                  ['--wiz-glow' as string]: c.glow,
                  ['--wiz-glow-lg' as string]: c.glowLg,
                }}
                // Vanilla renders an SVG icon per step (STEP_ICONS), and the
                // done checkmark (CHECK_ICON) once complete — not a number.
                dangerouslySetInnerHTML={{ __html: done ? CHECK_ICON_SVG : (STEP_ICONS[physicalId - 1] ?? '') }}
              />
              <span className="wiz-step-label" style={active ? { color: c.activeBorder } : undefined}>{label}</span>
            </div>
          )
        })}
      </div>

      {/* Employment tip strip — Vanilla shows it on top of the step card on the
          Initial Offer and Loan Analytics stages for salaried applicants. */}
      {(step === 6 || step === 9) && data.empType === 'salaried' && (
        <div
          className="mb-2 rounded-lg px-3 py-1.5 text-[11.5px] font-medium"
          style={{ color: '#085897', background: 'rgba(8, 88, 151, .07)', border: '1px solid rgba(8, 88, 151, .14)' }}
        >
          💡 Salaried: Verify salary slips, Form 16 and employer credentials
        </div>
      )}

      {/* Step body */}
      <div
        ref={stepBodyRef}
        className="p-6 mb-5"
        style={{ background: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: 18, boxShadow: '0 2px 12px rgba(8,88,151,.05)' }}
      >
        {/* Keyed by step so each step change replays a subtle fade+rise.
            Presentation only — step data/validation/flow are untouched. */}
        <div key={step} className="wiz-step-body">
        <h2 className="wiz-section-head">
          {currentLabel}
        </h2>
        {step === 1 && (
          <div className="wiz-required-note"><span className="wiz-req-dot" /> Fields marked with * are required to proceed.</div>
        )}
        {step === 1 && <Step1 data={data} onChange={update} errors={stepErrors} touch={touch} />}
        {step === 2 && <Step2 data={data} onChange={update} errors={stepErrors} touch={touch} touched={touched} />}
        {step === 3 && <Step3 data={data} onChange={update} errors={stepErrors} touch={touch} />}
        {step === 4 && <Step4 data={data} onChange={update} errors={stepErrors} touch={touch} />}
        {step === 5 && <Step5 data={data} onChange={update} errors={stepErrors} touch={touch} />}
        {step === 6 && <Step6 data={data} onChange={update} errors={stepErrors} touch={touch} />}
        {step === 7 && <Step7 data={data} onChange={update} errors={stepErrors} touch={touch} />}
        {step === 8 && <Step8 documents={documents} onDocumentChange={setDocument} errors={stepErrors} uploadedDocs={uploadedDocs} empType={data.empType} loanType={data.loanType}
          onIncome={amount => update({ salary: String(Math.round(amount)) })} onPerfios={handlePerfios} perfiosRestored={perfiosRestored}
          loanId={serverLoanId} uploadingKeys={uploadingDocKeys} onPreviewError={setDocUploadWarning} />}
        {step === 9 && <Step9 data={data} selectedBanks={selectedBanks} onBanksChange={setSelectedBanks} />}
        </div>
      </div>

      {/* Error message */}
      {submitError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
          <AlertCircle size={16} />{submitError}
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleBack}
          disabled={pos <= 1 || offerInterstitial != null}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={16} /> Back
        </button>

        {/* Center progress — Vanilla wizard footer (index.html:2806): mood text
            over an animated gradient bar. The "Step X of Y" counter is present
            in Vanilla but display:none (app.css:3851), so it is not rendered. */}
        <div className="wiz-progress-wrap">
          <div className="wiz-progress-mood">{progressMood}</div>
          <div className="wiz-progress-bar-wrap">
            <div className="wiz-progress-bar-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <button
          onClick={handleNext}
          disabled={submit.isPending || validateMutation.isPending || offerInterstitial != null || (isLastStep && Object.keys(liveStepErrors).length > 0)}
          className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-efin-blue text-white text-sm font-semibold hover:bg-[#064377] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {validateMutation.isPending
            ? <><InlineLoader size={16} /> Checking...</>
            : submit.isPending
              ? <><InlineLoader size={16} /> Submitting...</>
              : isLastStep
                ? <><CheckCircle2 size={16} /> Submit Application</>
                : <>Continue <ChevronRight size={16} /></>
          }
        </button>
      </div>

      <OfferInterstitial
        active={offerInterstitial != null}
        isInsurance={offerInterstitial?.isInsurance ?? false}
        onComplete={handleOfferInterstitialComplete}
      />
    </div>
  )
}
