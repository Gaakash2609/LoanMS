import { isAxiosError } from 'axios'
// Static wizard configuration extracted verbatim from NewApplicationPage.tsx
// (code-quality refactor — no value or logic changes). Pure data + pure
// functions only: option lists, field-format regexes, the per-step stepper
// labels/colours/icons, the product-driven flow config, the product/employment
// normalisation helpers, and the product+employment document matrix. Imported
// back into NewApplicationPage.tsx and its Step components unchanged.

// Shared field-format patterns — kept in sync with the backend's
// ValidateFieldFormats so the two never disagree about what's valid.
export const MOBILE_RE = /^\d{10}$/
export const PIN_RE     = /^\d{6}$/
export const AADHAR_RE  = /^\d{12}$/
export const EMAIL_RE   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const PAN_RE     = /^[A-Z]{5}[0-9]{4}[A-Z]$/

// Extracts a human-readable message from a failed API call. The backend
// returns { success: false, errors: string[] } on validation failures (e.g.
// duplicate-application checks) — axios's own error.message is just a
// generic "Request failed with status code 400" and never surfaces that.
export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError(error)) {
    const errors = error.response?.data?.errors as string[] | undefined
    if (errors?.length) return errors.join(' ')
    const message = error.response?.data?.message as string | undefined
    if (message) return message
  }
  if (error instanceof Error && error.message) return error.message
  return fallback
}

// ── Constants matching legacy frontend ────────────────────────────────────────
// (The loan-product option list now lives in LOAN_PRODUCT_META — the single
// source shared with LoanProductSelectorModal — since the product is chosen
// once at the start and only ever displayed inside the wizard, never picked
// from an in-step dropdown.)

// Home Type option set copied verbatim from Vanilla's #w-hometype / permanent
// equivalent (efin-app.js). React previously used a shorter, differently-worded
// set (Owned/Rented/Company Provided/Parental/Other) which did not match.
export const HOME_TYPES = [
  'Owned by Self / Spouse',
  'Owned by Parents',
  'Rented (Self with Family)',
  'Paying Guest',
  'Company Accommodation',
]

export const EMP_TYPES = [
  { value: 'salaried',     label: 'Salaried' },
  { value: 'self_employed',label: 'Self Employed / Business' },
  { value: 'professional', label: 'Professional (CA/Doctor/Lawyer)' },
]

// Company Type option set copied verbatim from Vanilla's #w-comptype (salaried /
// professional). React previously used a shorter, differently-worded list.
export const COMP_TYPES = [
  'Private Limited', 'Public Limited', 'Central Govt.', 'State Govt.',
  'PSU / Public Sector', 'MNC', 'LLP', 'Partnership Firm', 'Proprietorship',
  'NGO / Trust', 'Other',
]
// Self-employed's Company / Business Type uses a different set in Vanilla
// (#w-comptype-self) — legal-structure focused.
export const COMP_TYPES_SELF = [
  'Proprietorship', 'Partnership', 'LLP', 'Private Limited', 'Public Limited',
  'Individual / Freelancer',
]
// Industry "Business Type" — Vanilla's #w-biz-type (self-employed only),
// separate from the legal Company/Business Type above.
export const BIZ_TYPES = ['Manufacturing', 'Trading', 'Services', 'Retail', 'Professional Services']

// Channel option set + order copied verbatim from Vanilla's #w-channel
// (efin-app.js) — DSA / Partner / Direct / Online, default unselected. An
// earlier React pass had reordered these and invented a "Branch Walk-in"
// option that Vanilla does not have; removed for parity.
export const CHANNELS = [
  { value: 'dsa',    label: 'DSA' },
  { value: 'agent',  label: 'Partner / Agent' },
  { value: 'direct', label: 'Direct' },
  { value: 'online', label: 'Online' },
]

// Lead Source option set copied verbatim from Vanilla's #w-leadsrc
// (efin-app.js). Vanilla's Step 1 (Contact & Assignment) captures this
// alongside Channel; React was missing the field entirely.
export const LEAD_SOURCES = [
  { value: 'facebook',   label: 'Facebook' },
  { value: 'whatsapp',   label: 'WhatsApp' },
  { value: 'instagram',  label: 'Instagram' },
  { value: 'reference',  label: 'Reference' },
  { value: 'google_ads', label: 'Google Ads' },
]

export const RELATIONS = ['Father', 'Mother', 'Spouse', 'Sibling', 'Friend', 'Colleague', 'Neighbour', 'Other']

export const STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana',
  'Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya',
  'Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura',
  'Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Chandigarh','Jammu and Kashmir','Ladakh',
  'Puducherry','Lakshadweep','Dadra and Nagar Haveli','Andaman and Nicobar Islands']

// ── Zod schemas per step ──────────────────────────────────────────────────────






export const STEP_LABELS = [
  'Contact & Assignment', 'KYC Verification', 'Personal Details',
  'Address', 'Employment', 'Initial Offer', 'References', 'Documents', 'Loan Analytics',
]

// ── Per-product wizard flow — parity with Vanilla's ACTUAL runtime.
// IMPORTANT: Vanilla `getActiveWizardSteps()` (efin-app.js:6299) reads
// `LOAN_PRODUCT_CONFIG[prod].wizardSteps`, but NO product defines wizardSteps
// in LOAN_PRODUCT_CONFIG (efin-app.js:27533+) — so it ALWAYS falls back to the
// full [1..9] step set for every product. The per-product step arrays that skip
// steps live only in LOAN_DOCS_MATRIX (efin-app.js:1502-1785), which is used
// ONLY for the documents checklist and is never read by the stepper (dead
// config for step flow). `applyProductToWizard` (efin-app.js:28372) relabels
// steps and toggles field BLOCKS within steps, but hides no whole step; and
// validateStep step 7 requires References for all products (efin-app.js:8552).
// => Every product shows all 9 steps and References (step 7) is mandatory for
// all. Only the per-step LABELS change by product. `steps` are PHYSICAL step
// ids (1-9, matching the Step1..9 components); labels[i] is the label for
// steps[i].
export const DEFAULT_WIZARD = { steps: [1, 2, 3, 4, 5, 6, 7, 8, 9], labels: STEP_LABELS }
export const WIZARD_PRODUCT_CONFIG: Record<string, { steps: number[]; labels: string[] }> = {
  personal_loan: DEFAULT_WIZARD,
  business_loan: { steps: [1, 2, 3, 4, 5, 6, 7, 8, 9], labels: ['Contact & Assignment', 'KYC Verification', 'Personal Details', 'Address', 'Business Details', 'Loan Details', 'References', 'Documents', 'Loan Analytics'] },
  home_loan:     { steps: [1, 2, 3, 4, 5, 6, 7, 8, 9], labels: ['Contact & Assignment', 'KYC Verification', 'Personal Details', 'Address', 'Employment & Property', 'Loan Details', 'References', 'Documents', 'Loan Analytics'] },
  lap:           { steps: [1, 2, 3, 4, 5, 6, 7, 8, 9], labels: ['Contact & Assignment', 'KYC Verification', 'Personal Details', 'Address', 'Employment & Property', 'Loan Details', 'References', 'Documents', 'Loan Analytics'] },
  new_car:       { steps: [1, 2, 3, 4, 5, 6, 7, 8, 9], labels: ['Contact & Assignment', 'KYC Verification', 'Personal Details', 'Address', 'Employment', 'Vehicle & Loan', 'References', 'Documents', 'Loan Analytics'] },
  used_car:      { steps: [1, 2, 3, 4, 5, 6, 7, 8, 9], labels: ['Contact & Assignment', 'KYC Verification', 'Personal Details', 'Address', 'Employment', 'Vehicle & Loan', 'References', 'Documents', 'Loan Analytics'] },
  education:     { steps: [1, 2, 3, 4, 5, 6, 7, 8, 9], labels: ['Contact & Assignment', 'KYC Verification', 'Student Details', 'Address', 'Co-applicant', 'Course & Loan', 'References', 'Documents', 'Loan Analytics'] },
  insurance:     { steps: [1, 2, 3, 4, 5, 6, 7, 8, 9], labels: ['Contact & Assignment', 'KYC Verification', 'Personal Details', 'Address', 'Income Declaration', 'Policy Details', 'References', 'Documents', 'Loan Analytics'] },
}

// ── Per-step stepper colors — legacy's nth-child(1..9) palette (app.css
// ~3218-3237): each step gets its own hue instead of one flat brand blue,
// with a matching pending tint, an active gradient + glow, and a done
// state. Values are copied 1:1 from the legacy stylesheet. ───────────────
export const WIZ_STEP_COLORS = [
  { bg: '#ede9fe', border: '#ddd6fe', fg: '#7c3aed', grad: 'linear-gradient(135deg,#a78bfa,#7c3aed)', activeBorder: '#7c3aed', glow: 'rgba(124,58,237,.18)', glowLg: 'rgba(109,40,217,.35)' },
  { bg: '#fce7f3', border: '#fbcfe8', fg: '#db2777', grad: 'linear-gradient(135deg,#f472b6,#be185d)', activeBorder: '#be185d', glow: 'rgba(219,39,119,.18)', glowLg: 'rgba(190,24,93,.35)' },
  { bg: '#dbeafe', border: '#bfdbfe', fg: '#2563eb', grad: 'linear-gradient(135deg,#60a5fa,#1d4ed8)', activeBorder: '#1d4ed8', glow: 'rgba(37,99,235,.18)', glowLg: 'rgba(29,78,216,.35)' },
  { bg: '#d1fae5', border: '#a7f3d0', fg: '#059669', grad: 'linear-gradient(135deg,#34d399,#047857)', activeBorder: '#047857', glow: 'rgba(5,150,105,.18)', glowLg: 'rgba(4,120,87,.35)' },
  { bg: '#fef3c7', border: '#fde68a', fg: '#d97706', grad: 'linear-gradient(135deg,#fbbf24,#b45309)', activeBorder: '#b45309', glow: 'rgba(217,119,6,.18)', glowLg: 'rgba(180,83,9,.35)' },
  { bg: '#fee2e2', border: '#fecaca', fg: '#dc2626', grad: 'linear-gradient(135deg,#f87171,#b91c1c)', activeBorder: '#b91c1c', glow: 'rgba(220,38,38,.18)', glowLg: 'rgba(185,28,28,.35)' },
  { bg: '#e0f2fe', border: '#bae6fd', fg: '#0284c7', grad: 'linear-gradient(135deg,#38bdf8,#0369a1)', activeBorder: '#0369a1', glow: 'rgba(2,132,199,.18)', glowLg: 'rgba(3,105,161,.35)' },
  { bg: '#f3e8ff', border: '#e9d5ff', fg: '#9333ea', grad: 'linear-gradient(135deg,#c084fc,#7e22ce)', activeBorder: '#7e22ce', glow: 'rgba(147,51,234,.18)', glowLg: 'rgba(126,34,206,.35)' },
  { bg: '#fefce8', border: '#fef08a', fg: '#ca8a04', grad: 'linear-gradient(135deg,#fde047,#92400e)', activeBorder: '#92400e', glow: 'rgba(202,138,4,.18)', glowLg: 'rgba(146,64,14,.35)' },
] as const

// Per-step stepper ICONS — ported verbatim from Vanilla STEP_ICONS
// (efin-app.js:6214-6291). Rendered inside the .wiz-step-num circle via
// dangerouslySetInnerHTML (static, trusted markup); stroke="currentColor" so
// each inherits the circle's per-step / active / done color. This replaces the
// plain step number React showed before — matching Vanilla's icon circles.
export const STEP_ICONS = [
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.61 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.59a16 16 0 0 0 5.5 5.5l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 15.26v1.66z"/><path d="M14.5 1a9 9 0 0 1 8.5 8.5" stroke-opacity=".45"/><path d="M14.5 5a5 5 0 0 1 4.5 4.5" stroke-opacity=".45"/></svg>`,
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12C2 6.477 6.477 2 12 2s10 4.477 10 10"/><path d="M5 12a7 7 0 0 1 7-7"/><path d="M12 12a2 2 0 0 1 2-2"/><path d="M12 12v5"/><path d="M9 17.5c0-3.5 3-5.5 3-5.5"/><path d="M15 17c0-3 1-4.5 1-4.5"/><path d="M5.5 17.5c0-6 3-9 6.5-9"/><path d="M18.5 17c0-4-1-6.5-1-6.5"/></svg>`,
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="8" width="20" height="14" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><circle cx="9" cy="15" r="2"/><path d="M13 15h4M13 18h4"/></svg>`,
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/><circle cx="12" cy="7.5" r=".75" fill="currentColor"/></svg>`,
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg>`,
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 8h8M8 12h8M12 12l-4 6"/><path d="M9 8c0 2 1 4 3 4"/><path d="M20 4l1-1M20 20l1 1M4 4L3 3M4 20l-1 1"/></svg>`,
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/><line x1="8" y1="9" x2="10" y2="9"/></svg>`,
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/><circle cx="8.5" cy="10.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="13.5" cy="15.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="22" cy="7" r="1.5" fill="currentColor" stroke="none"/></svg>`,
]
// Done checkmark (Vanilla CHECK_ICON) — bare tick; the circle is the container.
export const CHECK_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
// Top-stepper labels — Vanilla getActiveWizardSteps() fallback (efin-app.js:6305),
// shown for every product. (Distinct from the per-product section-head labels in
// WIZARD_PRODUCT_CONFIG, which feed the `{pos}. {currentLabel}` heading.)
export const STEPPER_LABELS = ['Contact', 'KYC Verify', 'Personal Details', 'Address', 'Employment', 'Initial Offer', 'References', 'Documents', 'Loan Analytics']

// Backend GetDraft (WizardController) emits the loan product in Vanilla-key
// form — its _loanTypeMap lists the Vanilla alias first, so LoanType.Education
// comes back as "education_loan", LAP as "loan_against_property" and Car as
// "new_car_loan". The wizard uses its OWN keys ("education", "lap", "new_car"),
// which drive every product-specific piece (WIZARD_PRODUCT_CONFIG labels, the
// Step-5/6 blocks, getWizardDocs, the eligibility match, the product banner).
// Without normalising, a resumed Education/LAP/Car draft would fall back to the
// personal-loan flow. LoanType.Car cannot distinguish new vs used on the
// backend enum, so a used-car draft resumes as new_car (best-effort).
export const VANILLA_TO_REACT_PRODUCT: Record<string, string> = {
  personal_loan: 'personal_loan', business_loan: 'business_loan', home_loan: 'home_loan',
  loan_against_property: 'lap', new_car_loan: 'new_car', used_car_loan: 'used_car',
  education_loan: 'education', over_draft: 'over_draft', overdraft: 'over_draft', insurance: 'insurance',
}
export function normalizeReactLoanType(v: string | undefined | null): string | undefined {
  if (!v) return undefined
  return VANILLA_TO_REACT_PRODUCT[v] ?? v   // already-React keys pass through unchanged
}

// GetDraft returns Customer.EmploymentType as the stored display value
// ("Salaried" / "Self-Employed" / "Professional"), but the wizard's Employment
// Type <select> uses the codes 'salaried' / 'self_employed' / 'professional'.
// Without mapping, a resumed draft's employment type would show as unselected
// (and Step 5's progressive-disclosure blocks would stay hidden).
export function normalizeReactEmpType(v: string | undefined | null): string | undefined {
  if (!v) return undefined
  const k = v.toLowerCase().replace(/[\s-]+/g, '_')   // "Self-Employed" -> "self_employed"
  if (k === 'salaried') return 'salaried'
  if (k === 'self_employed' || k === 'selfemp') return 'self_employed'
  if (k === 'professional') return 'professional'
  return v   // already a wizard code, or unknown — leave as-is
}

// ── Wizard document checklist — product + employment-type specific ──────────
// Ported VERBATIM from Vanilla LOAN_DOCS_MATRIX / getWizardDocs (efin-app.js:
// 1470-1817). Kept inline here (not a separate util file) because it is used
// only by this wizard — Step 8 render + computeStepErrors + submit upload.
export const DOC_COMMON_KYC = [
  'PAN Card (Self-attested copy)',
  'Aadhaar Card – Front & Back (Self-attested copy)',
  'Passport-size Photograph (2 copies)',
]
export const DOC_MANDATORY_INCOME = [
  'Last 3 Month Salary Slips',
  'Last 6 Month Bank Statement',
]
export const DOC_MANDATORY_INCOME_SELFEMP = [
  'Business Vintage Proof',
  'Last 6 Month Bank Statement',
]
export const WIZ_MANDATORY_DOC_NAMES = [
  'Last 3 Month Salary Slips',
  'Last 6 Month Bank Statement',
  'Business Vintage Proof',
]
export type DocEmpBucket = 'SALARIED' | 'SELFEMP' | 'PROFESSIONAL'
export const LOAN_DOCS_MATRIX: Record<string, Record<DocEmpBucket, string[]>> = {
  personal_loan: {
    SALARIED: [...DOC_COMMON_KYC, ...DOC_MANDATORY_INCOME,
      'Latest Form 16 / ITR (Last 2 years)', 'Office / Employee ID Card (Optional)', 'Appointment Letter / Employment Proof (Optional)'],
    SELFEMP: [...DOC_COMMON_KYC, ...DOC_MANDATORY_INCOME_SELFEMP,
      'Last 3 Years ITR with Computation Sheet', 'Business Registration / Udyam / GST Certificate', 'GST Returns (Last 6 months)', 'Profit & Loss Statement + Balance Sheet (Audited)'],
    PROFESSIONAL: [...DOC_COMMON_KYC, ...DOC_MANDATORY_INCOME,
      'Last 3 Years ITR with Computation Sheet', 'Professional Degree Certificate', 'Professional Registration Certificate (Bar Council / ICAI / MCI etc.)', 'Practice Proof (Chamber / Clinic / Firm)'],
  },
  business_loan: {
    SALARIED: [...DOC_COMMON_KYC, ...DOC_MANDATORY_INCOME, 'Latest Form 16 / ITR'],
    SELFEMP: [...DOC_COMMON_KYC, ...DOC_MANDATORY_INCOME_SELFEMP,
      'Last 3 Years ITR with Profit & Loss + Balance Sheet (Audited)', 'GST Registration Certificate', 'GST Returns (Last 12 months)', 'Business Registration / Udyam Certificate', 'MOA / AOA / Partnership Deed (as applicable)', 'Stock Statement / Book Debt Statement', 'Office Address Proof'],
    PROFESSIONAL: [...DOC_COMMON_KYC, ...DOC_MANDATORY_INCOME,
      'Last 3 Years ITR with Computation Sheet', 'Professional Degree Certificate', 'Professional Registration Certificate', 'Practice Establishment Proof', 'Last 6 Month Gross Receipts / Billing Statements'],
  },
  home_loan: {
    SALARIED: [...DOC_COMMON_KYC, ...DOC_MANDATORY_INCOME,
      'Form 16 / Last 2 Years ITR', 'Sale Agreement / Allotment Letter', 'Property Title Deed / Chain of Documents', 'Approved Building Plan / Layout Plan', 'NOC from Builder / Housing Society', 'Encumbrance Certificate (EC)', 'Property Tax Receipt (Latest)'],
    SELFEMP: [...DOC_COMMON_KYC, ...DOC_MANDATORY_INCOME_SELFEMP,
      'Last 3 Years ITR with P&L + Balance Sheet (Audited)', 'GST Registration Certificate', 'Business Proof / Udyam Certificate', 'Sale Agreement / Allotment Letter', 'Property Title Deed / Chain of Documents', 'Approved Building Plan', 'NOC from Builder / Society', 'Encumbrance Certificate (EC)', 'Property Tax Receipt (Latest)'],
    PROFESSIONAL: [...DOC_COMMON_KYC, ...DOC_MANDATORY_INCOME,
      'Professional Degree & Registration Certificate', 'Sale Agreement / Allotment Letter', 'Property Title Deed / Chain of Documents', 'Approved Building Plan', 'NOC from Builder / Society', 'Encumbrance Certificate (EC)', 'Property Tax Receipt (Latest)'],
  },
  loan_against_property: {
    SALARIED: [...DOC_COMMON_KYC, ...DOC_MANDATORY_INCOME,
      'Latest Form 16 / ITR', 'Property Title Deed / Registry Copy', 'Encumbrance Certificate', 'Chain of Title Documents (last 30 years)', 'Khata / Property Tax Receipts'],
    SELFEMP: [...DOC_COMMON_KYC, ...DOC_MANDATORY_INCOME_SELFEMP,
      'Last 3 Years ITR with P&L + Balance Sheet', 'Business Registration / GST Certificate', 'Property Title Deed / Registry Copy', 'Encumbrance Certificate', 'Chain of Title Documents', 'Khata / Property Tax Receipts'],
    PROFESSIONAL: [...DOC_COMMON_KYC, ...DOC_MANDATORY_INCOME,
      'Professional Registration Certificate', 'Property Title Deed / Registry Copy', 'Encumbrance Certificate', 'Chain of Title Documents', 'Khata / Property Tax Receipts'],
  },
  new_car_loan: {
    SALARIED: [...DOC_COMMON_KYC, ...DOC_MANDATORY_INCOME, 'Form 16 / Latest ITR', 'Vehicle Quotation / Pro-forma Invoice from Dealer', 'Driving Licence'],
    SELFEMP: [...DOC_COMMON_KYC, ...DOC_MANDATORY_INCOME_SELFEMP, 'Last 2 Years ITR with Computation Sheet', 'Business Registration Proof', 'Vehicle Quotation / Pro-forma Invoice from Dealer', 'Driving Licence'],
    PROFESSIONAL: [...DOC_COMMON_KYC, ...DOC_MANDATORY_INCOME, 'Last 2 Years ITR with Computation Sheet', 'Professional Registration Certificate', 'Vehicle Quotation / Pro-forma Invoice from Dealer', 'Driving Licence'],
  },
  used_car_loan: {
    SALARIED: [...DOC_COMMON_KYC, ...DOC_MANDATORY_INCOME, 'RC Book of Vehicle', 'Insurance Copy (current)', 'Form 29 & Form 30 (Transfer of Ownership)', 'Vehicle Valuation / Inspection Report', 'Driving Licence'],
    SELFEMP: [...DOC_COMMON_KYC, ...DOC_MANDATORY_INCOME_SELFEMP, 'Last 2 Years ITR with Computation Sheet', 'Business Registration Proof', 'RC Book of Vehicle', 'Insurance Copy (current)', 'Form 29 & Form 30', 'Vehicle Valuation / Inspection Report', 'Driving Licence'],
    PROFESSIONAL: [...DOC_COMMON_KYC, ...DOC_MANDATORY_INCOME, 'Last 2 Years ITR', 'RC Book of Vehicle', 'Insurance Copy (current)', 'Form 29 & Form 30', 'Vehicle Valuation / Inspection Report', 'Driving Licence'],
  },
  education_loan: {
    SALARIED: ['PAN Card – Student', 'Aadhaar Card – Student', 'PAN Card – Co-applicant (Parent/Guardian)', 'Aadhaar Card – Co-applicant', 'Passport-size Photograph (Student + Co-applicant)', 'Admission Confirmation Letter / Offer Letter', 'Fee Structure from Institution', 'Academic Marksheets (Last 2 completed years)', 'Entrance Exam Scorecard (JEE / NEET / GMAT etc.)', 'Co-applicant Last 3 Month Salary Slips', 'Co-applicant Last 6 Month Bank Statement', 'Form 16 / Co-applicant Latest ITR', 'Passport copy (for abroad studies)'],
    SELFEMP: ['PAN Card – Student', 'Aadhaar Card – Student', 'PAN Card – Co-applicant (Parent/Guardian)', 'Aadhaar Card – Co-applicant', 'Passport-size Photograph (Student + Co-applicant)', 'Admission Confirmation Letter / Offer Letter', 'Fee Structure from Institution', 'Academic Marksheets (Last 2 completed years)', 'Entrance Exam Scorecard', 'Co-applicant Last 2 Years ITR with P&L', 'Co-applicant Last 6 Month Bank Statement', 'Business Registration / Udyam Certificate', 'Passport copy (for abroad studies)'],
    PROFESSIONAL: ['PAN Card – Student', 'Aadhaar Card – Student', 'PAN Card – Co-applicant', 'Aadhaar Card – Co-applicant', 'Passport-size Photograph (Student + Co-applicant)', 'Admission Confirmation Letter / Offer Letter', 'Fee Structure from Institution', 'Academic Marksheets (Last 2 completed years)', 'Entrance Exam Scorecard', 'Co-applicant Last 2 Years ITR', 'Co-applicant Last 6 Month Bank Statement', 'Co-applicant Professional Registration Certificate', 'Passport copy (for abroad studies)'],
  },
  insurance: {
    SALARIED: [...DOC_COMMON_KYC, 'Passport-size Photograph (2 copies)', 'Age Proof — Birth Certificate / Passport / Driving Licence', 'Income Proof — Latest Salary Slip (3 months) or Bank Statement (6 months)', 'Form 16 / ITR Last 1 Year — for income declaration', 'Existing Policy Copy (if any — for portability or top-up)', 'Medical Examination Report (if Sum Assured > ₹50 Lakh)', 'Discharge Summary / Medical Records (if pre-existing condition declared)', 'Nominee Proof of Identity & Relationship'],
    SELFEMP: [...DOC_COMMON_KYC, 'Passport-size Photograph (2 copies)', 'Age Proof — Birth Certificate / Passport / Driving Licence', 'GST Registration Certificate', 'Last 2 Years ITR with Computation Sheet', 'Last 6 Month Current Account Bank Statement', 'Existing Policy Copy (if any)', 'Medical Examination Report (if Sum Assured > ₹50 Lakh)', 'Nominee Proof of Identity & Relationship'],
    PROFESSIONAL: [...DOC_COMMON_KYC, 'Passport-size Photograph (2 copies)', 'Age Proof — Birth Certificate / Passport / Driving Licence', 'Professional Registration Certificate', 'Last 2 Years ITR with Computation Sheet', 'Last 6 Month Bank Statement', 'Existing Policy Copy (if any)', 'Medical Examination Report (if Sum Assured > ₹50 Lakh)', 'Nominee Proof of Identity & Relationship'],
  },
  over_draft: {
    SALARIED: [...DOC_COMMON_KYC, 'Last 3 Month Salary Slips', 'Last 6 Month Bank Statement', 'Latest Form 16 / ITR'],
    SELFEMP: [...DOC_COMMON_KYC, 'Last 3 Years ITR with Financial Statements', 'Last 12 Month Current Account Bank Statement', 'GST Registration Certificate', 'GST Returns (Last 6 months)', 'Business Registration Proof', 'Stock / Book Debt Statement'],
    PROFESSIONAL: [...DOC_COMMON_KYC, 'Last 3 Years ITR with Computation Sheet', 'Last 12 Month Bank Statement', 'Professional Registration Certificate', 'Practice Turnover Proof (Receipts / Billing)'],
  },
}
// React loanType → Vanilla matrix key.
export const REACT_TO_VANILLA_PRODUCT: Record<string, string> = {
  personal_loan: 'personal_loan', business_loan: 'business_loan', home_loan: 'home_loan',
  lap: 'loan_against_property', new_car: 'new_car_loan', used_car: 'used_car_loan',
  education: 'education_loan', over_draft: 'over_draft', insurance: 'insurance',
}
export function getWizardDocs(loanType: string, empType: string): string[] {
  const key = REACT_TO_VANILLA_PRODUCT[loanType] || 'personal_loan'
  const byLoan = LOAN_DOCS_MATRIX[key] || LOAN_DOCS_MATRIX.personal_loan
  const bucket: DocEmpBucket = empType === 'self_employed' ? 'SELFEMP' : empType === 'professional' ? 'PROFESSIONAL' : 'SALARIED'
  return byLoan[bucket] || byLoan.SALARIED || []
}

// Maps a mandatory document NAME (as it appears in the product doc matrix) to
// the stable state key the wizard persists/uploads it under. Vanilla enforces
// the intersection of WIZ_MANDATORY_DOC_NAMES with the product's rendered doc
// list, so a product whose list omits these (e.g. Education) has no mandatory
// Step-8 doc at all — exactly what this map + getWizardDocs reproduce.
export const MANDATORY_DOC_KEY_BY_NAME: Record<string, string> = {
  'Last 3 Month Salary Slips': 'salarySlip3mo',
  'Last 6 Month Bank Statement': 'bankStatement6mo',
  'Business Vintage Proof': 'bizVintageProof',
}

// Money formatter (₹, no decimals) — shared across steps, doc rows and the
// submission summary.
export function fmtINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}
