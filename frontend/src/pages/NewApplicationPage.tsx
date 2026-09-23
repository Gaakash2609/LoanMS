import { useState, useCallback, useEffect, useMemo, useRef, lazy, Suspense } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import BankEligibilityMatch, { type SelectedBank } from '@/components/shared/BankEligibilityMatch'
import { toEmploymentCode } from '@/utils/employmentType'
import CamOfferPanel from '@/components/shared/CamOfferPanel'
import OfferInterstitial from '@/components/shared/OfferInterstitial'
import LoanProductSelectorModal, { LOAN_PRODUCT_META } from '@/components/shared/LoanProductSelectorModal'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { wizardApi, type WizardSubmitPayload } from '@/api/wizardApi'
import { lenderConfigApi } from '@/api/lenderConfigApi'
import { loansApi } from '@/api/loansApi'
import { kycApi } from '@/api/kycApi'
import { useAuthStore } from '@/store/authStore'
import { CheckCircle, ChevronRight, ChevronLeft, AlertCircle, Upload, CheckCircle2, IdCard, AlertTriangle, FileCheck, X, ShieldCheck, ScanLine, Check, Pencil, FileImage, ListChecks } from 'lucide-react'
import { InlineLoader, OverlayLoader, PageLoader } from '@/components/ui/LoadingSpinner'

import { extractPanData, extractAadhaarData } from '@/utils/kycExtraction'
import { createDraftId } from '@/utils/draftStorage'
import { LOAN_KEYS } from '@/hooks/useLoans'
// Wizard Step-8 doc-upload extraction — restores legacy's wizard behaviour where
// a Salary Slip upload runs PSE (Net-Pay/Month) extraction and a Bank Statement
// upload runs the Perfios analysis (efin-app.js markDocUploaded / doc-item
// buttons openPerfiosExtractionModal + pfv9Open). Reuses the existing engines.
import { perfiosApi, type PerfiosReportSaveRequest, type PerfiosReport } from '@/api/perfiosApi'
import type { PerfiosUploadResult } from '@/hooks/usePerfiosUpload'
import { fmtDate as fmtPerfiosDate } from '@/utils/perfios/analysis'
import { serializePerfiosReport } from '@/utils/perfios/persist'
// The Step-8 salary-slip / bank-statement extraction modals — lazy-loaded so
// pdfjs-dist (pulled in transitively via the Perfios/PDF engine) stays out of
// the wizard's main chunk and only loads when a modal is actually opened, the
// same reason LoanDetailPage lazy-loads PerfiosWorkflow.
const SalarySlipExtractionModal = lazy(() => import('@/components/shared/SalarySlipExtractionModal'))
const PerfiosModal = lazy(() => import('@/components/shared/PerfiosModal'))

function fmtINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

// Read-only "selected product" context chip. The loan product is chosen ONCE
// at the start of the wizard (LoanProductSelectorModal, matching Vanilla's
// #loan-product-overlay) and is never re-selected inside a step — Steps 5, 6
// and 9 show it as fixed context instead of a duplicate dropdown, exactly as
// Vanilla does (its steps 5/6 have no product dropdown; its Step-9 filter is
// hidden and auto-driven). Sourced from LOAN_PRODUCT_META (same list the
// picker uses) so label/emoji never drift.
function ProductContextBanner({ loanType, note }: { loanType: string; note?: string }) {
  const meta = LOAN_PRODUCT_META.find(p => p.value === loanType)
  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg border border-efin-blue/15 bg-efin-blue/5 px-3.5 py-2.5">
      <span className="text-xl leading-none shrink-0" aria-hidden>{meta?.emoji ?? '📄'}</span>
      <div className="min-w-0">
        <div className="text-[10.5px] font-semibold uppercase tracking-wide text-efin-blue/70">Selected Loan Product</div>
        <div className="text-sm font-semibold text-gray-900 truncate">{meta?.label ?? (loanType || '—')}</div>
      </div>
      {meta?.desc && <span className="ml-auto hidden sm:block text-[11px] text-gray-400 truncate">{meta.desc}</span>}
      {note && <span className="ml-auto text-[11px] text-gray-400">{note}</span>}
    </div>
  )
}

// Shared field-format patterns — kept in sync with the backend's
// ValidateFieldFormats so the two never disagree about what's valid.
const MOBILE_RE = /^\d{10}$/
const PIN_RE     = /^\d{6}$/
const AADHAR_RE  = /^\d{12}$/
const EMAIL_RE   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PAN_RE     = /^[A-Z]{5}[0-9]{4}[A-Z]$/

// Extracts a human-readable message from a failed API call. The backend
// returns { success: false, errors: string[] } on validation failures (e.g.
// duplicate-application checks) — axios's own error.message is just a
// generic "Request failed with status code 400" and never surfaces that.
function getApiErrorMessage(error: unknown, fallback: string): string {
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
const HOME_TYPES = [
  'Owned by Self / Spouse',
  'Owned by Parents',
  'Rented (Self with Family)',
  'Paying Guest',
  'Company Accommodation',
]

const EMP_TYPES = [
  { value: 'salaried',     label: 'Salaried' },
  { value: 'self_employed',label: 'Self Employed / Business' },
  { value: 'professional', label: 'Professional (CA/Doctor/Lawyer)' },
]

// Company Type option set copied verbatim from Vanilla's #w-comptype (salaried /
// professional). React previously used a shorter, differently-worded list.
const COMP_TYPES = [
  'Private Limited', 'Public Limited', 'Central Govt.', 'State Govt.',
  'PSU / Public Sector', 'MNC', 'LLP', 'Partnership Firm', 'Proprietorship',
  'NGO / Trust', 'Other',
]
// Self-employed's Company / Business Type uses a different set in Vanilla
// (#w-comptype-self) — legal-structure focused.
const COMP_TYPES_SELF = [
  'Proprietorship', 'Partnership', 'LLP', 'Private Limited', 'Public Limited',
  'Individual / Freelancer',
]
// Industry "Business Type" — Vanilla's #w-biz-type (self-employed only),
// separate from the legal Company/Business Type above.
const BIZ_TYPES = ['Manufacturing', 'Trading', 'Services', 'Retail', 'Professional Services']

// Channel option set + order copied verbatim from Vanilla's #w-channel
// (efin-app.js) — DSA / Partner / Direct / Online, default unselected. An
// earlier React pass had reordered these and invented a "Branch Walk-in"
// option that Vanilla does not have; removed for parity.
const CHANNELS = [
  { value: 'dsa',    label: 'DSA' },
  { value: 'agent',  label: 'Partner / Agent' },
  { value: 'direct', label: 'Direct' },
  { value: 'online', label: 'Online' },
]

// Lead Source option set copied verbatim from Vanilla's #w-leadsrc
// (efin-app.js). Vanilla's Step 1 (Contact & Assignment) captures this
// alongside Channel; React was missing the field entirely.
const LEAD_SOURCES = [
  { value: 'facebook',   label: 'Facebook' },
  { value: 'whatsapp',   label: 'WhatsApp' },
  { value: 'instagram',  label: 'Instagram' },
  { value: 'reference',  label: 'Reference' },
  { value: 'google_ads', label: 'Google Ads' },
]

const RELATIONS = ['Father', 'Mother', 'Spouse', 'Sibling', 'Friend', 'Colleague', 'Neighbour', 'Other']

const STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana',
  'Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya',
  'Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura',
  'Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Chandigarh','Jammu and Kashmir','Ladakh',
  'Puducherry','Lakshadweep','Dadra and Nagar Haveli','Andaman and Nicobar Islands']

// ── Zod schemas per step ──────────────────────────────────────────────────────






const STEP_LABELS = [
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
const DEFAULT_WIZARD = { steps: [1, 2, 3, 4, 5, 6, 7, 8, 9], labels: STEP_LABELS }
const WIZARD_PRODUCT_CONFIG: Record<string, { steps: number[]; labels: string[] }> = {
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
const WIZ_STEP_COLORS = [
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
const STEP_ICONS = [
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
const CHECK_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
// Top-stepper labels — Vanilla getActiveWizardSteps() fallback (efin-app.js:6305),
// shown for every product. (Distinct from the per-product section-head labels in
// WIZARD_PRODUCT_CONFIG, which feed the `{pos}. {currentLabel}` heading.)
const STEPPER_LABELS = ['Contact', 'KYC Verify', 'Personal Details', 'Address', 'Employment', 'Initial Offer', 'References', 'Documents', 'Loan Analytics']

// ── Wizard State ──────────────────────────────────────────────────────────────
interface WizardData {
  // Step 1
  mobile: string; pan: string; location: string; salesPerson: string
  channel: string; leadsrc: string; dsaName: string
  // Phase 2A — actual FK ids selected alongside the display fields above.
  dsaId: string; partnerId: string
  // Optional Partner linked under a DSA — Vanilla's #w-dsa-partner-group
  // "Linked Partner (optional)" (index.html:1538-1542). No dedicated backend
  // column, so it rides productData (stored as the partner id string).
  dsaLinkedPartner: string
  // Step 2 (KYC - manual entry in React version)
  kycFirstName: string; kycLastName: string; kycDob: string
  kycAadhar: string; kycGender: string; kycFather: string
  kycStreet1: string; kycCity: string; kycState: string; kycPin: string
  // Step 3 — Personal
  firstName: string; middleName: string; lastName: string
  dob: string; gender: string; aadhar: string; email: string; phone: string; father: string; mother: string
  // Step 4 — Address
  street1: string; street2: string; city: string; state: string; zip: string; homeType: string; sameAddr: boolean
  pStreet1: string; pStreet2: string; pCity: string; pState: string; pZip: string; pHomeType: string
  // Step 5 — Employment
  empType: string; compName: string; compType: string; salary: string; desig: string; officeEmail: string; obligations: string
  // Step 5 — self-employed / business detail (legacy's SEP/SENP field set)
  bizVintage: string; annualTurnover: string; netProfit: string; gstNumber: string; itrFiled: string
  // Vanilla captures the industry "Business Type" (Manufacturing/Trading/…)
  // separately from the legal Company/Business Type, for self-employed.
  bizType: string
  officeAddress: string
  // Vanilla captures office/workplace address as structured Line 1 / Line 2 /
  // PIN (required for salaried & professional), not one free-text field.
  officeAddr1: string; officeAddr2: string; officePin: string
  // Step 5 — professional registration (legacy shows for professional emp type)
  professionalBody: string
  // Step 5 — product-specific sections (legacy shows these per loan type)
  propertyType: string; propertyValue: string; propertyAddress: string        // Home Loan / LAP
  propertyCity: string; propertyOwnership: string; propertyUnderConstruction: string; builderSociety: string
  vehicleMake: string; vehicleModel: string; vehiclePrice: string             // New / Used Car
  vehicleMfgYear: string; vehicleExShowroom: string; vehicleKms: string; vehicleDealer: string
  courseName: string; instituteName: string; courseDuration: string           // Education
  studyLocation: string; admissionStatus: string
  coAppName: string; coAppRelation: string; coAppPan: string; coAppMobile: string
  // Vanilla's #w-coapplicant-email — Education-only, required (index.html:2249).
  coAppEmail: string
  // Step-3 co-applicant Aadhaar (Home Loan / LAP / Business Loan block).
  coAppAadhar: string
  // Step 6 — Insurance product (legacy replaces the whole loan-offer field
  // set with these when Loan Type = Insurance)
  insType: string; insSumAssured: string; insPolicyTerm: string
  insPremiumFreq: string; insPremium: string; insInsurer: string
  insNomineeName: string; insNomineeRelation: string; insNomineeDob: string; insNomineeId: string
  insExistingPolicy: string; insExistingInsurer: string; insExistingCover: string; insExistingPolicyNumber: string
  insHealthDeclared: string; insHealthNotes: string
  insTobaccoStatus: string; insHeight: string; insWeight: string; insOccupationHazard: string
  // Step 6 — Loan offer
  loanType: string; amount: string; loanRate: string; tenure: string; purpose: string; cibil: string
  // Step 7 — References (Vanilla captures a full address per reference:
  // Address Line 1/2, City, PIN — persisted via productData)
  r1Name: string; r1Mobile: string; r1Relation: string
  r1Addr1: string; r1Addr2: string; r1City: string; r1Pin: string
  r2Name: string; r2Mobile: string; r2Relation: string
  r2Addr1: string; r2Addr2: string; r2City: string; r2Pin: string
}

const emptyData: WizardData = {
  mobile: '', pan: '', location: '', salesPerson: '', channel: '', leadsrc: '', dsaName: '',
  dsaId: '', partnerId: '', dsaLinkedPartner: '',
  kycFirstName: '', kycLastName: '', kycDob: '', kycAadhar: '', kycGender: '', kycFather: '',
  kycStreet1: '', kycCity: '', kycState: '', kycPin: '',
  firstName: '', middleName: '', lastName: '', dob: '', gender: '', aadhar: '', email: '', phone: '', father: '', mother: '',
  street1: '', street2: '', city: '', state: '', zip: '', homeType: '', sameAddr: false,
  pStreet1: '', pStreet2: '', pCity: '', pState: '', pZip: '', pHomeType: '',
  empType: '', compName: '', compType: '', salary: '', desig: '', officeEmail: '', obligations: '0',
  bizVintage: '', annualTurnover: '', netProfit: '', gstNumber: '', itrFiled: '', bizType: '', officeAddress: '',
  officeAddr1: '', officeAddr2: '', officePin: '',
  professionalBody: '',
  propertyType: '', propertyValue: '', propertyAddress: '',
  propertyCity: '', propertyOwnership: '', propertyUnderConstruction: 'no', builderSociety: '',
  vehicleMake: '', vehicleModel: '', vehiclePrice: '',
  vehicleMfgYear: '', vehicleExShowroom: '', vehicleKms: '', vehicleDealer: '',
  courseName: '', instituteName: '', courseDuration: '',
  studyLocation: '', admissionStatus: '',
  coAppName: '', coAppRelation: '', coAppPan: '', coAppMobile: '', coAppAadhar: '', coAppEmail: '',
  insType: '', insSumAssured: '', insPolicyTerm: '', insPremiumFreq: 'Yearly',
  insPremium: '', insInsurer: '', insNomineeName: '', insNomineeRelation: '',
  insNomineeDob: '', insNomineeId: '', insExistingPolicy: 'no', insExistingInsurer: '',
  insExistingCover: '', insExistingPolicyNumber: '', insHealthDeclared: 'no', insHealthNotes: '',
  insTobaccoStatus: '', insHeight: '', insWeight: '', insOccupationHazard: '',
  loanType: 'personal_loan', amount: '', loanRate: '12', tenure: '24', purpose: '', cibil: '',
  r1Name: '', r1Mobile: '', r1Relation: '', r1Addr1: '', r1Addr2: '', r1City: '', r1Pin: '',
  r2Name: '', r2Mobile: '', r2Relation: '', r2Addr1: '', r2Addr2: '', r2City: '', r2Pin: '',
}

// Backend GetDraft (WizardController) emits the loan product in Vanilla-key
// form — its _loanTypeMap lists the Vanilla alias first, so LoanType.Education
// comes back as "education_loan", LAP as "loan_against_property" and Car as
// "new_car_loan". The wizard uses its OWN keys ("education", "lap", "new_car"),
// which drive every product-specific piece (WIZARD_PRODUCT_CONFIG labels, the
// Step-5/6 blocks, getWizardDocs, the eligibility match, the product banner).
// Without normalising, a resumed Education/LAP/Car draft would fall back to the
// personal-loan flow. LoanType.Car cannot distinguish new vs used on the
// backend enum, so a used-car draft resumes as new_car (best-effort).
const VANILLA_TO_REACT_PRODUCT: Record<string, string> = {
  personal_loan: 'personal_loan', business_loan: 'business_loan', home_loan: 'home_loan',
  loan_against_property: 'lap', new_car_loan: 'new_car', used_car_loan: 'used_car',
  education_loan: 'education', over_draft: 'over_draft', overdraft: 'over_draft', insurance: 'insurance',
}
function normalizeReactLoanType(v: string | undefined | null): string | undefined {
  if (!v) return undefined
  return VANILLA_TO_REACT_PRODUCT[v] ?? v   // already-React keys pass through unchanged
}

// GetDraft returns Customer.EmploymentType as the stored display value
// ("Salaried" / "Self-Employed" / "Professional"), but the wizard's Employment
// Type <select> uses the codes 'salaried' / 'self_employed' / 'professional'.
// Without mapping, a resumed draft's employment type would show as unselected
// (and Step 5's progressive-disclosure blocks would stay hidden).
function normalizeReactEmpType(v: string | undefined | null): string | undefined {
  if (!v) return undefined
  const k = v.toLowerCase().replace(/[\s-]+/g, '_')   // "Self-Employed" -> "self_employed"
  if (k === 'salaried') return 'salaried'
  if (k === 'self_employed' || k === 'selfemp') return 'self_employed'
  if (k === 'professional') return 'professional'
  return v   // already a wizard code, or unknown — leave as-is
}

// Reverse of buildPayload() below — used only when resuming a draft, to turn
// the server's response (GET /api/wizard/draft/{loanId}) back into wizard
// form state. FullName is split on the first/last space as a best-effort;
// the person can adjust it on Step 3 if the split isn't exact.
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

// ── Wizard document checklist — product + employment-type specific ──────────
// Ported VERBATIM from Vanilla LOAN_DOCS_MATRIX / getWizardDocs (efin-app.js:
// 1470-1817). Kept inline here (not a separate util file) because it is used
// only by this wizard — Step 8 render + computeStepErrors + submit upload.
const DOC_COMMON_KYC = [
  'PAN Card (Self-attested copy)',
  'Aadhaar Card – Front & Back (Self-attested copy)',
  'Passport-size Photograph (2 copies)',
]
const DOC_MANDATORY_INCOME = [
  'Last 3 Month Salary Slips',
  'Last 6 Month Bank Statement',
]
const DOC_MANDATORY_INCOME_SELFEMP = [
  'Business Vintage Proof',
  'Last 6 Month Bank Statement',
]
const WIZ_MANDATORY_DOC_NAMES = [
  'Last 3 Month Salary Slips',
  'Last 6 Month Bank Statement',
  'Business Vintage Proof',
]
type DocEmpBucket = 'SALARIED' | 'SELFEMP' | 'PROFESSIONAL'
const LOAN_DOCS_MATRIX: Record<string, Record<DocEmpBucket, string[]>> = {
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
const REACT_TO_VANILLA_PRODUCT: Record<string, string> = {
  personal_loan: 'personal_loan', business_loan: 'business_loan', home_loan: 'home_loan',
  lap: 'loan_against_property', new_car: 'new_car_loan', used_car: 'used_car_loan',
  education: 'education_loan', over_draft: 'over_draft', insurance: 'insurance',
}
function getWizardDocs(loanType: string, empType: string): string[] {
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
const MANDATORY_DOC_KEY_BY_NAME: Record<string, string> = {
  'Last 3 Month Salary Slips': 'salarySlip3mo',
  'Last 6 Month Bank Statement': 'bankStatement6mo',
  'Business Vintage Proof': 'bizVintageProof',
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

// ── Sub-components ────────────────────────────────────────────────────────────
function FormGroup({ label, required, error, children, action }: {
  label: string; required?: boolean; error?: string; children: React.ReactNode
  // Optional right-aligned control in the label row — used for the KYC "✎ Fix"
  // buttons (Vanilla kycFocusField affordance). Kept optional so every other
  // FormGroup call is unchanged.
  action?: React.ReactNode
}) {
  return (
    <div className="mb-4" data-field-error={error ? 'true' : undefined}>
      <label className="flex items-center justify-between text-xs font-semibold text-gray-600 mb-1">
        <span>{label}{required && <span className="text-red-500 ml-1">*</span>}</span>
        {action}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600 flex items-center gap-1"><AlertCircle size={11} />{error}</p>}
    </div>
  )
}

function TextInput({
  value, onChange, onBlur, placeholder, type = 'text', inputMode, pattern, maxLength, minLength,
  className = '', digitsOnly, decimalOnly, id, style, readOnly, list,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string
  // Optional <datalist> id — turns the field into a searchable combo (native
  // suggestions) while still allowing free text, e.g. the employer field
  // backed by the lender company master.
  list?: string
  // Optional DOM id so a "✎ Fix" button (KYC step) can focus this field.
  id?: string
  // Fires when the field loses focus — used to mark it "touched" so its
  // real-time validation message becomes visible even if the person never
  // typed anything (e.g. tabbed through a required field and left it blank).
  onBlur?: () => void
  type?: string
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | 'search' | 'url' | 'none'
  pattern?: string; maxLength?: number; minLength?: number; className?: string
  // Filters what can be typed at all — not just what's flagged as an error
  // afterwards. digitsOnly strips anything but 0-9 (mobile/PIN/Aadhaar/
  // tenure/CIBIL). decimalOnly strips anything but 0-9 and a single decimal
  // point (money/rate fields like salary, EMI obligations, loan amount).
  digitsOnly?: boolean
  decimalOnly?: boolean
  // Optional inline style override — used by the KYC step to tint a field
  // green once its value has come from a successful document extraction.
  style?: React.CSSProperties
  // For fields whose value is synthesized from other fields (e.g. the KYC
  // step's combined "Full Address" preview) rather than editable directly.
  readOnly?: boolean
}) {
  const filter = (raw: string): string => {
    let v = raw
    if (digitsOnly) {
      v = v.replace(/\D/g, '')
    } else if (decimalOnly) {
      v = v.replace(/[^0-9.]/g, '')
      const firstDot = v.indexOf('.')
      if (firstDot !== -1) {
        v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '')
      }
    }
    if (maxLength && v.length > maxLength) v = v.slice(0, maxLength)
    return v
  }
  return (
    <input
      id={id}
      type={type}
      inputMode={inputMode}
      pattern={pattern}
      list={list}
      value={value}
      onChange={e => onChange(filter(e.target.value))}
      onBlur={onBlur}
      placeholder={placeholder}
      maxLength={maxLength}
      minLength={minLength}
      readOnly={readOnly}
      style={style}
      className={`w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue focus:border-transparent ${readOnly ? 'cursor-default' : ''} ${className}`}
    />
  )
}

function SelectInput({ value, onChange, onBlur, options, placeholder, id, style }: {
  value: string; onChange: (v: string) => void
  // See TextInput.onBlur — same purpose for dropdowns (e.g. a required
  // Location/State select the person opened and left on the placeholder).
  onBlur?: () => void
  options: Array<{ value: string; label: string } | string>; placeholder?: string
  // Optional DOM id so a "✎ Fix" button (KYC step) can focus this field.
  id?: string
  // See TextInput.style — used by the KYC step's green "extracted" tint.
  style?: React.CSSProperties
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onBlur}
      style={style}
      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue bg-white"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(opt => {
        const v = typeof opt === 'string' ? opt : opt.value
        const l = typeof opt === 'string' ? opt : opt.label
        return <option key={v} value={v}>{l}</option>
      })}
    </select>
  )
}

// ── Step Components ───────────────────────────────────────────────────────────
function Step1({ data, onChange, errors, touch }: {
  data: WizardData
  onChange: (f: Partial<WizardData>) => void
  errors: Record<string, string>
  touch: (field: string) => void
}) {
  const { data: locations } = useQuery({
    queryKey: ['wizard-locations'],
    queryFn: () => wizardApi.getLocations().then(r => r.data.data ?? []),
    staleTime: 300_000,
  })
  const { data: usersResp } = useQuery({
    queryKey: ['wizard-users'],
    queryFn: () => wizardApi.getUsers().then(r => r.data.data ?? []),
    staleTime: 300_000,
  })
  const { data: dsaPartnerList } = useQuery({
    queryKey: ['wizard-dsa'],
    queryFn: () => wizardApi.getDsaPartners().then(r => r.data.data ?? []),
    staleTime: 300_000,
    enabled: data.channel === 'dsa' || data.channel === 'agent',
  })
  const dsaList     = (dsaPartnerList ?? []).filter(d => d.partnerType === 'Dsa')
  const partnerList = (dsaPartnerList ?? []).filter(d => d.partnerType === 'Partner')

  // ── Live PAN duplicate check ────────────────────────────────────────────
  // Ports legacy wPanCheck() (efin-app.js:7155), wired in index.html:1491 on
  // the PAN field's oninput. Legacy checked its own local APPLICATIONS cache
  // first and fell back to the server; there is no such client-side cache
  // here, so it goes straight to the authoritative endpoint — which legacy's
  // own comment calls the reliable one. Warning-only: it must never block
  // submission, exactly like legacy.
  //
  // The query key carries the PAN, so a result for a PAN the user has since
  // typed past can never render — that is legacy's `stillPan !== pan` guard,
  // handled structurally instead of with a manual re-read.
  const panForCheck = (data.pan || '').trim().toUpperCase()
  const { data: panDuplicate } = useQuery({
    queryKey: ['loan-duplicate-check', panForCheck],
    queryFn: () => loansApi.duplicateCheck(panForCheck).then(r => r.data.data),
    enabled: panForCheck.length === 10,
    staleTime: 60_000,
    retry: false,
  })

  // Vanilla parity (wLocationChange, efin-app.js:6937-6962): the Sales Person
  // dropdown lists only users at the SELECTED location whose role is a sales
  // role — Vanilla's 'Sales Person' / 'Team Leader', which map to React's
  // UserRole.Sales / UserRole.TeamLeader. Before a location is chosen the list
  // is empty (Vanilla only populates it on location change). Location match is
  // by LocationId FK (more robust than Vanilla's by-name compare).
  const salesRoleOk = (r: string) => r === 'Sales' || r === 'TeamLeader'
  const salesUsers = data.location
    ? (usersResp ?? []).filter(u => salesRoleOk(u.role) && u.locationId != null && String(u.locationId) === data.location)
    : []
  const noSalesForLocation = !!data.location && salesUsers.length === 0

  return (
    <div className="space-y-6">
      {/* UX grouping only: applicant/lead information is kept visually separate
          from the internal assignment fields. Vanilla mixes all of these in one
          grid — the grouping is a React clarity improvement; no field, option
          or validation rule is changed. */}
      <section>
        <p className="wiz-section-head">Customer &amp; Lead Details</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6">
      <FormGroup label="Mobile Number" required error={errors.mobile}>
        <TextInput value={data.mobile} onChange={v => onChange({ mobile: v })} onBlur={() => touch('mobile')}
          placeholder="10-digit mobile" maxLength={10} minLength={10}
          type="tel" inputMode="numeric" pattern="\d{10}" digitsOnly />
      </FormGroup>

      <FormGroup label="PAN Card Number" required error={errors.pan}>
        {/* Vanilla only uppercases (CSS) + maxlength 10 — no character stripping,
            no format pattern (validateStep(1) checks length === 10 only). */}
        <TextInput value={data.pan} onChange={v => onChange({ pan: v.toUpperCase() })}
          onBlur={() => touch('pan')}
          placeholder="ABCDE1234F" maxLength={10} minLength={10}
          className="uppercase font-mono" />
        {/* Same amber warning-strip legacy shows in #w-pan-dup-alert. Advisory
            only — nothing here disables Next or fails validation. */}
        {panDuplicate?.hasDuplicate && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
            <span>
              Customer has a recent <strong>{panDuplicate.status}</strong> application
              {panDuplicate.loanNumber ? <> (<span className="font-mono">{panDuplicate.loanNumber}</span>
              {panDuplicate.customerName ? ` — ${panDuplicate.customerName}` : ''})</> : null}
              {panDuplicate.daysAgo != null ? `. Created ${panDuplicate.daysAgo} days ago.` : '.'}
            </span>
          </div>
        )}
      </FormGroup>

      <FormGroup label="Channel">
        <SelectInput value={data.channel}
          onChange={v => onChange({ channel: v, dsaName: '', dsaId: '', partnerId: '', dsaLinkedPartner: '', leadsrc: '' })}
          options={CHANNELS} placeholder="— Select Channel —" />
      </FormGroup>

      {data.channel === 'dsa' && (
        <FormGroup label="DSA Name" required error={errors.dsaId}>
          <SelectInput
            value={data.dsaId}
            onChange={v => {
              const selected = dsaList.find(d => String(d.id) === v)
              onChange({ dsaId: v, dsaName: selected?.name ?? '' })
            }}
            onBlur={() => touch('dsaId')}
            options={dsaList.map(d => ({ value: String(d.id), label: `${d.name} (${d.code})` }))}
            placeholder="— Select DSA —"
          />
        </FormGroup>
      )}

      {/* Linked Partner (optional) — Vanilla's #w-dsa-partner-group, shown with
          the DSA Name field for the DSA channel (index.html:1538-1542). Optional;
          value persisted via productData (no dedicated backend column). */}
      {data.channel === 'dsa' && (
        <FormGroup label="Linked Partner (optional)">
          <SelectInput
            value={data.dsaLinkedPartner}
            onChange={v => onChange({ dsaLinkedPartner: v })}
            options={partnerList.map(p => ({ value: String(p.id), label: `${p.name} (${p.code})` }))}
            placeholder="— Select Linked Partner —"
          />
        </FormGroup>
      )}

      {data.channel === 'agent' && (
        <FormGroup label="Partner / Agent Name" required error={errors.partnerId}>
          <SelectInput
            value={data.partnerId}
            onChange={v => onChange({ partnerId: v })}
            onBlur={() => touch('partnerId')}
            options={partnerList.map(p => ({ value: String(p.id), label: `${p.name} (${p.code})` }))}
            placeholder="— Select Partner —"
          />
        </FormGroup>
      )}

      {/* Direct channel — Vanilla shows a read-only confirmation chip of the
          selected Sales Person (#w-direct-sales-group, efin-app.js:6837-6844). */}
      {data.channel === 'direct' && (
        <FormGroup label="Sales Person">
          <div className="flex items-center gap-2.5 rounded-lg border border-efin-blue/20 bg-efin-blue/5 px-3.5 py-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-efin-blue to-[#1a72b8] text-[13px] font-bold text-white">
              {data.salesPerson ? data.salesPerson.charAt(0).toUpperCase() : '—'}
            </span>
            <div>
              <div className="text-[13px] font-semibold text-gray-900">{data.salesPerson || '— Select Sales Person above —'}</div>
              <div className="text-[11px] text-gray-400">Direct Channel</div>
            </div>
            <span className="ml-auto rounded-full bg-efin-blue/10 px-2.5 py-0.5 text-[10.5px] font-semibold text-efin-blue">Direct</span>
          </div>
        </FormGroup>
      )}

      {/* Lead Source — Vanilla shows this ONLY for the Online channel
          (wChannelChange: leadsrcGrp shown only when val==='online', and
          cleared on any other channel — efin-app.js:6835-6836, 6863-6865).
          React previously showed it for every channel. Options copied verbatim;
          persisted via the productData bag (no backend column). */}
      {data.channel === 'online' && (
        <FormGroup label="Lead Source">
          <SelectInput value={data.leadsrc}
            onChange={v => onChange({ leadsrc: v })}
            options={LEAD_SOURCES} placeholder="Select" />
        </FormGroup>
      )}
        </div>
      </section>

      <section>
        <p className="wiz-section-head">Internal Assignment</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6">
          <FormGroup label="Location" required error={errors.location}>
            <SelectInput
              value={data.location}
              onChange={v => onChange({ location: v, salesPerson: '' })}
              onBlur={() => touch('location')}
              options={(locations ?? []).map(l => ({ value: String(l.id), label: `${l.name} — ${l.city}` }))}
              placeholder="— Select Location —"
            />
          </FormGroup>
          <FormGroup label="Sales Person" required error={errors.salesPerson}>
            <SelectInput
              value={data.salesPerson}
              onChange={v => onChange({ salesPerson: v })}
              onBlur={() => touch('salesPerson')}
              options={salesUsers.map(u => ({ value: u.fullName, label: `${u.fullName} (${u.role === 'TeamLeader' ? 'Team Leader' : 'Sales Person'})` }))}
              placeholder={data.location ? '— Select Sales Person —' : '— Select a Location first —'}
            />
            {/* Vanilla hint (efin-app.js:6960) when a location has no sales staff. */}
            {noSalesForLocation && (
              <div className="mt-1 text-[11px] text-gray-400">
                No Sales Person or Team Leader found for this location yet — add one under Users, or pick a different location.
              </div>
            )}
          </FormGroup>
        </div>
      </section>
    </div>
  )
}

function Step2({ data, onChange, errors, touch, touched }: {
  data: WizardData; onChange: (f: Partial<WizardData>) => void; errors: Record<string, string>
  touch: (field: string) => void; touched: Record<string, boolean>
}) {
  const [panImages, setPanImages] = useState<File[]>([])
  // Aadhaar front + back — Vanilla uploads them as two separate files
  // (kyc-aadhar-file / kyc-aadhar-back-file); both are sent for extraction.
  const [aadhaarImages, setAadhaarImages] = useState<File[]>([])       // front
  const [aadhaarBackImages, setAadhaarBackImages] = useState<File[]>([]) // back
  const [showKycReport, setShowKycReport] = useState(false)
  // Live thumbnail for the PAN card tile — mirrors the uploaded file so the
  // person can see what was actually captured, matching the redesigned
  // "PAN Card" tile which shows the scan itself rather than a generic icon.
  // PDFs aren't previewed here (isPdf below) — they fall back to a file icon.
  const [panPreviewUrl, setPanPreviewUrl] = useState<string | null>(null)
  useEffect(() => {
    const f = panImages[0]
    if (f && f.type.startsWith('image/')) {
      const url = URL.createObjectURL(f)
      setPanPreviewUrl(url)
      return () => URL.revokeObjectURL(url)
    }
    setPanPreviewUrl(null)
  }, [panImages])
  // Extra fields used only for Cross-Validate (kycCrossValidate in legacy
  // kyc.js) — not part of WizardData/submission, same as extractionStatus
  // above: purely local, derived from the AI response text.
  const [panNumberExtracted, setPanNumberExtracted] = useState('')
  const [aadhaarFullNameExtracted, setAadhaarFullNameExtracted] = useState('')
  const [extractionStatus, setExtractionStatus] = useState<{
    pan?: { status: 'idle' | 'loading' | 'success' | 'error'; message?: string }
    aadhaar?: { status: 'idle' | 'loading' | 'success' | 'error'; message?: string }
  }>({})

  // Check if KYC vision is available
  const { data: kycStatus } = useQuery({
    queryKey: ['kyc-vision-status'],
    queryFn: () => kycApi.status().then(r => r.data),
    staleTime: 300_000,
  })

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1] || '')
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  // Convert an uploaded file to a vision-API image payload. The backend accepts
  // only image mime types, so a PDF (which Vanilla supports via pdf.js) is
  // rendered to a PNG first — same net behaviour as legacy's KYC upload.
  const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
  const fileToImage = async (f: File): Promise<{ mediaType: string; data: string }> => {
    if (isPdf(f)) {
      // Lazy-load pdfjs only when a PDF is actually processed — keeps the
      // heavy worker out of the initial bundle (and out of the test env's
      // module graph, which can't resolve the Vite `?url` worker import).
      const { renderPdfPageToPngBase64 } = await import('@/utils/perfios/pdf')
      return { mediaType: 'image/png', data: await renderPdfPageToPngBase64(f) }
    }
    return { mediaType: f.type, data: await fileToBase64(f) }
  }

  const extractPan = useMutation({
    mutationFn: async () => {
      if (!panImages.length) throw new Error('No PAN images selected')
      setExtractionStatus(s => ({ ...s, pan: { status: 'loading' } }))

      try {
        const response = await kycApi.extractFromImages({
          documentType: 'PAN',
          images: await Promise.all(panImages.map(fileToImage)),
          prompt: `Extract PAN card information. Return ONLY the following fields in this exact format:
FIRST NAME: <first name>
MIDDLE NAME: <middle name if any, else leave blank>
LAST NAME: <last name>
FATHER'S NAME: <father's name>
PAN NUMBER: <10-character PAN, 5 letters+4 digits+1 letter>

Extract exactly what is on the card. Be accurate.`,
        })

        if (!response.data.success) {
          throw new Error(response.data.error || 'Extraction failed')
        }

        // Parse extracted text
        const panData = extractPanData(response.data.text || '')
        setPanNumberExtracted(panData.panNumber)
        // 🟠 KYC Auto-fill improvement (item #6): only fill a field the user
        // hasn't already deliberately edited themselves (Step2's `touched`
        // prop — set by each field's own onBlur, same mechanism every other
        // field in this wizard already uses for validation timing). kycFirstName/
        // kycLastName/kycFather ("what KYC extracted", shown for reference) are
        // always updated; firstName/lastName/father (the actual submitted
        // values) are only overwritten if not already touched.
        onChange({
          kycFirstName: panData.firstName,
          kycLastName: panData.lastName,
          kycFather: panData.fatherName,
          ...(!touched.firstName ? { firstName: panData.firstName } : {}),
          // Middle name — Vanilla extracts kyc-out-mname from the PAN and fills
          // the Personal step's middle name. Only fill if not user-edited and
          // the model actually returned one (blank must not wipe a typed value).
          ...(!touched.middleName && panData.middleName ? { middleName: panData.middleName } : {}),
          ...(!touched.lastName ? { lastName: panData.lastName } : {}),
          ...(!touched.father ? { father: panData.fatherName } : {}),
        })

        setExtractionStatus(s => ({
          ...s,
          pan: { status: 'success', message: 'PAN data extracted successfully' },
        }))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Extraction failed'
        setExtractionStatus(s => ({
          ...s,
          pan: { status: 'error', message },
        }))
        throw err
      }
    },
  })

  const extractAadhaar = useMutation({
    mutationFn: async () => {
      const aadhaarFiles = [...aadhaarImages, ...aadhaarBackImages]
      if (!aadhaarFiles.length) throw new Error('No Aadhaar images selected')
      setExtractionStatus(s => ({ ...s, aadhaar: { status: 'loading' } }))

      try {
        const response = await kycApi.extractFromImages({
          documentType: 'AADHAAR',
          images: await Promise.all(aadhaarFiles.map(fileToImage)),
          prompt: `Extract Aadhaar card information. Return ONLY the following fields in this exact format:
FULL NAME: <full name as printed>
AADHAAR NUMBER: <12 digit number>
DATE OF BIRTH: <DD/MM/YYYY>
GENDER: <Male/Female/Other>
HOUSE/FLAT NO: <house / flat / building / door number>
STREET/LOCALITY: <street, road, area, locality, nagar>
CITY: <city/district>
STATE: <state>
PIN CODE: <6 digit pin>
FULL ADDRESS: <complete address>

Extract exactly what is on the card. Be accurate.`,
        })

        if (!response.data.success) {
          throw new Error(response.data.error || 'Extraction failed')
        }

        // Parse extracted text
        const aadhaarData = extractAadhaarData(response.data.text || '')
        setAadhaarFullNameExtracted(aadhaarData.fullName)
        // extractAadhaarData produces a capitalized word ("Male"/"Female"),
        // matching legacy's own OCR stage (efin-app.js:29616) exactly -- but
        // legacy has a SECOND stage, kycSyncGender (efin-app.js:30409), that
        // narrows that down to the single-letter code ('M'/'F'/'O') the
        // gender select and the backend (Customers.Gender is varchar(1))
        // actually store, before it ever reaches the form field. React had
        // ported the first stage but not the second, so an Aadhaar-extracted
        // gender that the user didn't touch afterward still carried the full
        // word into submission.
        const genderCode = aadhaarData.gender
          ? (aadhaarData.gender.charAt(0).toUpperCase() === 'M' ? 'M'
             : aadhaarData.gender.charAt(0).toUpperCase() === 'F' ? 'F'
             : 'O')
          : ''
        // Same touched-field precedence as extractPan above.
        onChange({
          kycAadhar: aadhaarData.aadhaarNumber,
          kycDob: aadhaarData.dateOfBirth,
          kycGender: genderCode,
          kycStreet1: aadhaarData.street1,
          kycCity: aadhaarData.city,
          kycState: aadhaarData.state,
          kycPin: aadhaarData.pinCode,
          ...(!touched.aadhar ? { aadhar: aadhaarData.aadhaarNumber } : {}),
          ...(!touched.dob ? { dob: aadhaarData.dateOfBirth } : {}),
          ...(!touched.gender ? { gender: genderCode } : {}),
          // Street address lines — Vanilla splits the Aadhaar address into
          // House/Flat (street1) + Street/Locality (street2) and auto-fills the
          // wizard's Address step (kycSyncAddr). Only fill if not user-edited
          // and the model returned a value (blank must not wipe a typed value).
          ...(!touched.street1 && aadhaarData.street1 ? { street1: aadhaarData.street1 } : {}),
          ...(!touched.street2 && aadhaarData.street2 ? { street2: aadhaarData.street2 } : {}),
          ...(!touched.city ? { city: aadhaarData.city } : {}),
          ...(!touched.state ? { state: aadhaarData.state } : {}),
          ...(!touched.zip ? { zip: aadhaarData.pinCode } : {}),
          // PERMANENT address too — Vanilla kycSyncAddr maps each Aadhaar field
          // onto BOTH the current AND permanent inputs (street1:['w-street1',
          // 'w-pstreet1'], etc. — efin-app.js:1285-1286,1475), so the permanent
          // address auto-fills from the Aadhaar as well. Same touched-guard.
          ...(!touched.pStreet1 && aadhaarData.street1 ? { pStreet1: aadhaarData.street1 } : {}),
          ...(!touched.pStreet2 && aadhaarData.street2 ? { pStreet2: aadhaarData.street2 } : {}),
          ...(!touched.pCity && aadhaarData.city ? { pCity: aadhaarData.city } : {}),
          ...(!touched.pState && aadhaarData.state ? { pState: aadhaarData.state } : {}),
          ...(!touched.pZip && aadhaarData.pinCode ? { pZip: aadhaarData.pinCode } : {}),
        })

        setExtractionStatus(s => ({
          ...s,
          aadhaar: { status: 'success', message: 'Aadhaar data extracted successfully' },
        }))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Extraction failed'
        setExtractionStatus(s => ({
          ...s,
          aadhaar: { status: 'error', message },
        }))
        throw err
      }
    },
  })

  const handlePanFilesSelect = (files: FileList | null) => {
    if (!files) return
    setPanImages(Array.from(files))
    setExtractionStatus(s => ({ ...s, pan: { status: 'idle' } }))
  }

  const handleAadhaarFilesSelect = (files: FileList | null) => {
    if (!files) return
    setAadhaarImages(Array.from(files))
    setExtractionStatus(s => ({ ...s, aadhaar: { status: 'idle' } }))
  }

  const handleAadhaarBackFilesSelect = (files: FileList | null) => {
    if (!files) return
    setAadhaarBackImages(Array.from(files))
    setExtractionStatus(s => ({ ...s, aadhaar: { status: 'idle' } }))
  }

  // Vanilla has ONE "Extract & Auto-Fill Details" button (kycExtractAll) that
  // reads BOTH documents at once. Runs whichever docs have been uploaded; each
  // mutation records its own success/error, so one failing doesn't abort the
  // other.
  const extracting = extractPan.isPending || extractAadhaar.isPending
  const canExtract = (panImages.length > 0 || aadhaarImages.length > 0 || aadhaarBackImages.length > 0) && !!kycStatus?.configured
  const extractAll = async () => {
    const tasks: Promise<unknown>[] = []
    if (panImages.length) tasks.push(extractPan.mutateAsync().catch(() => undefined))
    if (aadhaarImages.length || aadhaarBackImages.length) tasks.push(extractAadhaar.mutateAsync().catch(() => undefined))
    if (tasks.length) await Promise.all(tasks)
  }

  // "Auto" affordance — Vanilla's kycFocusField: clicking it focuses the
  // extracted field so the user can correct it. (React fields are already
  // plain editable inputs; this just adds the same visible shortcut, styled
  // as the small blue pill used throughout the KYC step's extracted grids.)
  const fixBtn = (fieldId: string) => (
    <button type="button" tabIndex={-1} onClick={() => document.getElementById(fieldId)?.focus()}
      className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-[1px] rounded-full normal-case shrink-0"
      style={{ background: 'rgba(8,88,151,.08)', color: 'var(--accent)', border: '1px solid rgba(8,88,151,.22)' }}>
      <Check size={9} /> Auto
    </button>
  )
  // Green "validated" tint applied to a field once it holds a value that
  // came from document extraction — matches the pastel-green inputs in the
  // "Extracted Information" grids of the target design.
  const filledStyle = (ok: boolean): React.CSSProperties | undefined => ok
    ? { borderColor: 'rgba(26,115,64,.35)', background: 'rgba(26,115,64,.05)' }
    : undefined

  // ── Cross-Validate — matches legacy kycCrossValidate exactly: (1) PAN name
  // (composed from the already-extracted first/last name) vs Aadhaar full
  // name, word-subset match either direction; (2) wizard-entered PAN number
  // vs PAN-extracted PAN number, exact match. Runs once both PAN and
  // Aadhaar have been extracted (legacy: `if (panData && aadharData)
  // kycCrossValidate(...)`).
  const crossValidateChecks: { label: string; ok: boolean }[] = []
  if (extractionStatus.pan?.status === 'success' && extractionStatus.aadhaar?.status === 'success') {
    const panName = `${data.kycFirstName} ${data.kycLastName}`.toUpperCase().replace(/\s+/g, ' ').trim()
    const aadhaarName = aadhaarFullNameExtracted.toUpperCase().replace(/\s+/g, ' ').trim()
    if (panName && aadhaarName) {
      const panWords = panName.split(' ')
      const aadhaarWords = aadhaarName.split(' ')
      const nameOk = panWords.every(w => aadhaarName.includes(w)) || aadhaarWords.every(w => panName.includes(w))
      crossValidateChecks.push({ label: `Name ${nameOk ? 'matches' : 'differs'} — PAN: ${panName} | Aadhaar: ${aadhaarName}`, ok: nameOk })
    }
    const wizardPan = (data.pan || '').trim().toUpperCase()
    const extractedPan = panNumberExtracted.replace(/\s/g, '').toUpperCase()
    if (wizardPan && extractedPan) {
      const panOk = wizardPan === extractedPan
      crossValidateChecks.push({ label: `PAN ${panOk ? 'matches' : 'mismatch'} Step 1 entry — entered: ${wizardPan} | extracted: ${extractedPan}`, ok: panOk })
    }
  }
  const crossValidatePassed = crossValidateChecks.length > 0 && crossValidateChecks.every(c => c.ok)

  // ── KYC Report — matches legacy kycBuildReport's row set (upload status +
  // extracted fields), built from data already held in wizard state.
  const kycReportRows: { label: string; value: string; ok: boolean }[] = [
    { label: 'PAN Card Upload', value: panImages[0]?.name || 'Not uploaded', ok: panImages.length > 0 },
    { label: 'Aadhaar Upload', value: aadhaarImages[0]?.name || 'Not uploaded', ok: aadhaarImages.length > 0 },
    { label: 'First Name', value: data.kycFirstName || '—', ok: !!data.kycFirstName },
    { label: 'Last Name', value: data.kycLastName || '—', ok: !!data.kycLastName },
    { label: "Father's Name", value: data.kycFather || '—', ok: !!data.kycFather },
    { label: 'Aadhaar Number', value: data.kycAadhar || '—', ok: !!data.kycAadhar },
    { label: 'Date of Birth', value: data.kycDob || '—', ok: !!data.kycDob },
    { label: 'Gender', value: data.kycGender === 'M' ? 'Male' : data.kycGender === 'F' ? 'Female' : data.kycGender === 'O' ? 'Other' : (data.kycGender || '—'), ok: !!data.kycGender },
    { label: 'City / District', value: data.kycCity || '—', ok: !!data.kycCity },
    { label: 'State', value: data.kycState || '—', ok: !!data.kycState },
    { label: 'PIN Code', value: data.kycPin || '—', ok: !!data.kycPin },
  ]

  function downloadKycReport() {
    const ts = new Date()
    const lines = [
      `KYC Report | Generated: ${ts.toLocaleString('en-IN')}`,
      '---',
      ...kycReportRows.map(r => `${r.label}: ${r.value}`),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `KYC_Report_${ts.toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // Redesigned dropzone tile — replaces the old plain dashed upload row with
  // a card-style tile: icon + label, drag-and-drop support, and a compact
  // file chip (with a "×" to clear and re-pick) once something is uploaded.
  // Same onSelect(FileList|null) contract as before, so nothing downstream
  // (extraction, readiness, KYC report) needs to change.
  const docTile = (opts: {
    heading: string; sub: string; files: File[]
    onSelect: (f: FileList | null) => void; onClear: () => void
    accent: string; accentSoft: string
  }) => {
    const { heading, sub, files, onSelect, onClear, accent, accentSoft } = opts
    const uploaded = files.length > 0
    const file = files[0]
    const sizeKb = file ? Math.max(1, Math.round(file.size / 1024)) : 0
    return (
      <div
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); if (e.dataTransfer.files?.length) onSelect(e.dataTransfer.files) }}
      >
        {uploaded ? (
          <div className="flex items-center gap-2.5 rounded-[10px] px-3.5 py-3" style={{ border: `1.5px solid ${accent}`, background: accentSoft }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: accent }}>
              <FileCheck size={16} color="#fff" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-semibold truncate" style={{ color: 'var(--text)' }}>{file.name}</div>
              <div className="text-[10.5px]" style={{ color: 'var(--text3)' }}>{sizeKb} KB{files.length > 1 ? ` · +${files.length - 1} more` : ''}</div>
            </div>
            <button type="button" onClick={onClear} className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 hover:bg-black/5" title="Remove">
              <X size={14} style={{ color: 'var(--text3)' }} />
            </button>
          </div>
        ) : (
          <label className="block cursor-pointer">
            <div className="flex flex-col items-center justify-center gap-1.5 rounded-[10px] px-3 py-4 text-center transition-colors"
              style={{ border: '1.5px dashed var(--border2)', background: 'var(--surface2)' }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: accentSoft }}>
                <Upload size={15} style={{ color: accent }} />
              </div>
              <span className="text-[12px] font-semibold" style={{ color: 'var(--text2)' }}>{heading}</span>
              <span className="text-[10.5px]" style={{ color: 'var(--text3)' }}>{sub}</span>
            </div>
            <input type="file" multiple accept="image/*,application/pdf" onChange={e => onSelect(e.target.files)} className="hidden" />
          </label>
        )}
      </div>
    )
  }

  const extractedOk = extractionStatus.pan?.status === 'success' || extractionStatus.aadhaar?.status === 'success'
  const aadhaarBothSides = aadhaarImages.length > 0 && aadhaarBackImages.length > 0
  const aadhaarReadyLabel = aadhaarBothSides ? 'Both sides ready' : aadhaarImages.length > 0 ? 'Front side ready' : aadhaarBackImages.length > 0 ? 'Back side ready' : null
  const aadhaarValid = AADHAR_RE.test((data.kycAadhar || '').trim())
  const panValid = PAN_RE.test((panNumberExtracted || '').replace(/\s/g, '').toUpperCase())

  // "Required before proceeding" checklist — Father's Name is called out as
  // optional (matches legacy: it's never a hard KYC-step blocker), so it's
  // excluded from the all-checks-passed gate below even though it still
  // shows its own pill.
  const checklist: { label: string; ok: boolean; optional?: boolean }[] = [
    { label: 'PAN uploaded', ok: panImages.length > 0 },
    { label: 'Aadhaar front uploaded', ok: aadhaarImages.length > 0 },
    { label: 'Aadhaar back uploaded', ok: aadhaarBackImages.length > 0 },
    { label: 'PAN number extracted', ok: !!panNumberExtracted },
    { label: 'Aadhaar number (12 digits)', ok: aadhaarValid },
    { label: 'Name extracted', ok: !!data.kycFirstName },
    { label: 'Date of Birth', ok: !!data.kycDob },
    { label: "Father's Name (optional)", ok: !!data.kycFather, optional: true },
  ]
  const allChecksPassed = checklist.filter(c => !c.optional).every(c => c.ok)

  const fmtKb = (f?: File) => f ? `${Math.max(1, Math.round(f.size / 1024))} KB` : ''

  return (
    <div className="relative">
      {/* Scan overlay during extraction — previously Vanilla's kyc-loading-overlay
          ID-card scan animation; now the shared loanms-loader badge, same
          overlay chrome (position/backdrop/rounded corners) and same
          `extracting` trigger condition. */}
      {extracting && (
        <OverlayLoader title="Processing document" subtitle="AI-powered identity verification" />
      )}

      {/* Intro copy */}
      <p className="text-[13px] leading-relaxed mb-4" style={{ color: 'var(--text3)' }}>
        Upload Aadhaar and PAN card. Details will be automatically extracted and pre-filled into the application. All extracted fields remain editable.
      </p>

      {/* Document cards — PAN on the left, Aadhaar (front + back) on the right */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* PAN Card */}
        <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: `1.5px solid ${panImages.length > 0 ? 'var(--success)' : 'var(--border2)'}` }}>
          <div className="flex items-start gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(212,43,43,.08)' }}>
              <IdCard size={18} style={{ color: 'var(--accent2)' }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>PAN Card</span>
                <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: 'rgba(212,43,43,.08)', color: 'var(--accent2)' }}>Required</span>
              </div>
              <div className="text-[10.5px] leading-snug" style={{ color: 'var(--text3)' }}>Permanent Account Number · JPG / PNG / PDF</div>
            </div>
            {panImages.length > 0 && (
              <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full" style={{ background: 'rgba(26,115,64,.08)', color: 'var(--success)' }}>
                <Check size={10} /> Ready
              </span>
            )}
          </div>

          {panImages.length > 0 ? (
            <>
              <div className="rounded-xl overflow-hidden mb-3 h-[130px] flex items-center justify-center" style={{ background: '#0b1220' }}>
                {panPreviewUrl
                  ? <img src={panPreviewUrl} alt="PAN card preview" className="w-full h-full object-contain" />
                  : <FileImage size={28} style={{ color: '#64748b' }} />}
              </div>
              <label className="block cursor-pointer">
                <div className="flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-[12px] font-semibold transition-colors hover:brightness-95"
                  style={{ border: '1.5px solid var(--success)', color: 'var(--success)', background: 'rgba(26,115,64,.04)' }}>
                  <Upload size={13} /> Change PAN
                </div>
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => handlePanFilesSelect(e.target.files)} />
              </label>
              <div className="text-[10.5px] mt-1.5 truncate" style={{ color: 'var(--text3)' }}>✓ {panImages[0].name}</div>
            </>
          ) : (
            docTile({ heading: 'Upload PAN card', sub: 'JPG, PNG or PDF', files: panImages, onSelect: handlePanFilesSelect, onClear: () => { setPanImages([]); setExtractionStatus(s => ({ ...s, pan: undefined })) }, accent: 'var(--accent2)', accentSoft: 'rgba(212,43,43,.06)' })
          )}
        </div>

        {/* Aadhaar Card — front + back */}
        <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: `1.5px solid ${aadhaarBothSides ? 'var(--success)' : 'var(--border2)'}` }}>
          <div className="flex items-start gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(8,88,151,.08)' }}>
              <ShieldCheck size={18} style={{ color: 'var(--accent)' }} />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>Aadhaar Card</span>
              <div className="text-[10.5px] leading-snug" style={{ color: 'var(--text3)' }}>UIDAI Identity Document · Front &amp; Back required</div>
            </div>
            {aadhaarReadyLabel && (
              <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full" style={{ background: 'rgba(26,115,64,.08)', color: 'var(--success)' }}>
                <Check size={10} /> {aadhaarReadyLabel}
              </span>
            )}
          </div>

          {/* Front side */}
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text3)' }}>
            <span style={{ width: 10, height: 2, borderRadius: 1, background: 'var(--accent)' }} />
            Front Side <span style={{ color: 'var(--accent2)' }}>*</span>
          </div>
          {aadhaarImages.length > 0 ? (
            <>
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 mb-2 text-[11.5px]" style={{ background: 'var(--surface2)', color: 'var(--text2)' }}>
                <FileCheck size={13} style={{ color: 'var(--success)' }} />
                <span className="truncate flex-1">{aadhaarImages[0].name}</span>
                <span style={{ color: 'var(--text3)' }}>({fmtKb(aadhaarImages[0])})</span>
              </div>
              <label className="block cursor-pointer">
                <div className="flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-[12px] font-semibold transition-colors hover:brightness-95"
                  style={{ border: '1.5px solid var(--success)', color: 'var(--success)', background: 'rgba(26,115,64,.04)' }}>
                  <Upload size={13} /> Change Aadhaar
                </div>
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => handleAadhaarFilesSelect(e.target.files)} />
              </label>
              <div className="text-[10.5px] mt-1.5 mb-3 truncate" style={{ color: 'var(--text3)' }}>✓ {aadhaarImages[0].name}</div>
            </>
          ) : (
            <div className="mb-3">
              {docTile({ heading: 'Upload front side', sub: 'JPG, PNG or PDF', files: aadhaarImages, onSelect: handleAadhaarFilesSelect, onClear: () => { setAadhaarImages([]); setExtractionStatus(s => ({ ...s, aadhaar: undefined })) }, accent: 'var(--accent)', accentSoft: 'rgba(8,88,151,.06)' })}
            </div>
          )}

          <div className="h-px my-1" style={{ background: 'var(--border)' }} />

          {/* Back side */}
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide mb-1.5 mt-2" style={{ color: 'var(--text3)' }}>
            <span style={{ width: 10, height: 2, borderRadius: 1, background: 'var(--accent)' }} />
            Back Side <span style={{ color: 'var(--accent2)' }}>*</span>
          </div>
          {aadhaarBackImages.length > 0 ? (
            <>
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 mb-2 text-[11.5px]" style={{ background: 'var(--surface2)', color: 'var(--text2)' }}>
                <FileCheck size={13} style={{ color: 'var(--success)' }} />
                <span className="truncate flex-1">{aadhaarBackImages[0].name}</span>
                <span style={{ color: 'var(--text3)' }}>({fmtKb(aadhaarBackImages[0])})</span>
              </div>
              <label className="block cursor-pointer">
                <div className="flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-[12px] font-semibold transition-colors hover:brightness-95"
                  style={{ border: '1.5px solid var(--success)', color: 'var(--success)', background: 'rgba(26,115,64,.04)' }}>
                  <Upload size={13} /> Change Back Side
                </div>
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => handleAadhaarBackFilesSelect(e.target.files)} />
              </label>
              <div className="text-[10.5px] mt-1.5 truncate" style={{ color: 'var(--text3)' }}>✓ {aadhaarBackImages[0].name}</div>
            </>
          ) : (
            docTile({ heading: 'Upload back side', sub: 'JPG, PNG or PDF', files: aadhaarBackImages, onSelect: handleAadhaarBackFilesSelect, onClear: () => { setAadhaarBackImages([]); setExtractionStatus(s => ({ ...s, aadhaar: undefined })) }, accent: 'var(--accent)', accentSoft: 'rgba(8,88,151,.06)' })
          )}
        </div>
      </div>

      {/* Extract / Re-Extract button */}
      <div className="text-center mt-5">
        <button type="button" onClick={() => void extractAll()} disabled={!canExtract || extracting}
          className="px-8 py-2.5 text-white text-sm font-semibold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 transition-colors hover:brightness-110"
          style={{ background: 'var(--accent)' }}>
          {extracting
            ? (<><InlineLoader size={15} /> Extracting…</>)
            : extractedOk
              ? (<><ScanLine size={15} /> Re-Extract</>)
              : (<><ScanLine size={15} /> Extract &amp; Auto-Fill Details</>)}
        </button>
        <div className="mt-2 text-[11px]" style={{ color: 'var(--text3)' }}>AI-powered OCR · works with images &amp; PDFs</div>
        {!kycStatus?.configured && (
          <div className="mt-2.5 text-[11px] px-3.5 py-2 rounded-lg text-center inline-block" style={{ border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e' }}>
            ⚠️ AI Vision not configured for this workspace — extraction will use basic OCR mode.
          </div>
        )}
      </div>

      {extractionStatus.pan?.message && (
        <div className="mt-4 px-3 py-2 rounded-lg text-xs font-semibold"
          style={extractionStatus.pan.status === 'success' ? { background: 'rgba(26,115,64,.1)', color: 'var(--success)' } : extractionStatus.pan.status === 'error' ? { background: 'rgba(192,57,43,.1)', color: 'var(--danger)' } : { background: 'rgba(8,88,151,.1)', color: 'var(--accent)' }}>
          PAN: {extractionStatus.pan.message}
        </div>
      )}
      {extractionStatus.aadhaar?.message && (
        <div className="mt-2 px-3 py-2 rounded-lg text-xs font-semibold"
          style={extractionStatus.aadhaar.status === 'success' ? { background: 'rgba(26,115,64,.1)', color: 'var(--success)' } : extractionStatus.aadhaar.status === 'error' ? { background: 'rgba(192,57,43,.1)', color: 'var(--danger)' } : { background: 'rgba(8,88,151,.1)', color: 'var(--accent)' }}>
          Aadhaar: {extractionStatus.aadhaar.message}
        </div>
      )}

      {/* Required-before-proceeding checklist */}
      <div className="mt-5 rounded-2xl p-3.5" style={{ background: 'var(--surface2)', border: '1px solid var(--border2)' }}>
        <div className="flex items-center gap-1.5 text-[11.5px] font-bold mb-2.5" style={{ color: 'var(--text2)' }}>
          <ListChecks size={14} style={{ color: 'var(--accent2)' }} /> Required before proceeding to Next step
        </div>
        <div className="flex flex-wrap gap-2">
          {checklist.map(c => (
            <span key={c.label} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
              style={c.ok ? { background: 'rgba(26,115,64,.08)', color: 'var(--success)', border: '1px solid rgba(26,115,64,.2)' } : { background: 'var(--surface)', color: 'var(--text3)', border: '1px solid var(--border2)' }}>
              {c.ok ? <Check size={11} /> : '○'} {c.label}
            </span>
          ))}
        </div>
      </div>

      {/* Extracted Information */}
      {(panImages.length > 0 || aadhaarImages.length > 0 || extractedOk) && (
        <div className="mt-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5 text-[13px] font-bold" style={{ color: 'var(--text)' }}>
              <div className="w-4 h-4 rounded flex items-center justify-center" style={{ background: 'var(--success)' }}>
                <Check size={11} color="#fff" />
              </div>
              Extracted Information
            </div>
            {allChecksPassed && (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-1 rounded-full" style={{ background: 'rgba(26,115,64,.08)', color: 'var(--success)' }}>
                <Check size={11} /> All checks passed
              </span>
            )}
          </div>

          {/* PAN CARD — EXTRACTED DATA */}
          <div className="flex items-center gap-2 mb-2">
            <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--accent)' }} />
            <span className="text-[10.5px] font-bold uppercase tracking-wide" style={{ color: 'var(--text2)' }}>PAN Card — Extracted Data</span>
            {panValid && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(26,115,64,.08)', color: 'var(--success)' }}>
                <Check size={10} /> Valid PAN
              </span>
            )}
          </div>
          <div className="rounded-2xl p-4 mb-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <p className="flex items-center gap-1.5 text-[11px] mb-3.5" style={{ color: 'var(--text3)' }}>
              <Pencil size={11} /> All fields are editable — click any field to correct. Changes sync instantly to the application form.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-3">
              <FormGroup label="First Name (from PAN)" action={fixBtn('kyc-out-fname')}>
                <TextInput id="kyc-out-fname" value={data.kycFirstName} onChange={v => onChange({ kycFirstName: v, firstName: v })}
                  onBlur={() => touch('kycFirstName')} placeholder="—" style={filledStyle(!!data.kycFirstName)} />
              </FormGroup>
              <FormGroup label="Middle Name (from PAN)" action={fixBtn('kyc-out-mname')}>
                <TextInput id="kyc-out-mname" value={data.middleName} onChange={v => onChange({ middleName: v })}
                  onBlur={() => touch('middleName')} placeholder="—" style={filledStyle(!!data.middleName)} />
              </FormGroup>
              <FormGroup label="Last Name (from PAN)" action={fixBtn('kyc-out-lname')}>
                <TextInput id="kyc-out-lname" value={data.kycLastName} onChange={v => onChange({ kycLastName: v, lastName: v })}
                  placeholder="—" style={filledStyle(!!data.kycLastName)} />
              </FormGroup>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-3">
              <FormGroup label="PAN Number">
                <TextInput value={data.pan} onChange={v => onChange({ pan: v })} placeholder="—" className="font-mono" style={filledStyle(!!panNumberExtracted)} />
              </FormGroup>
              <FormGroup label="Date of Birth" action={fixBtn('kyc-out-dob')}>
                <TextInput id="kyc-out-dob" value={data.kycDob} onChange={v => onChange({ kycDob: v, dob: v })} type="date" style={filledStyle(!!data.kycDob)} />
              </FormGroup>
              <FormGroup label="Father's Name" action={fixBtn('kyc-out-father')}>
                <TextInput id="kyc-out-father" value={data.kycFather} onChange={v => onChange({ kycFather: v, father: v })}
                  placeholder="—" style={filledStyle(!!data.kycFather)} />
              </FormGroup>
            </div>
          </div>

          {/* AADHAAR CARD — EXTRACTED DATA */}
          <div className="flex items-center gap-2 mb-2">
            <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--accent)' }} />
            <span className="text-[10.5px] font-bold uppercase tracking-wide" style={{ color: 'var(--text2)' }}>Aadhaar Card — Extracted Data</span>
            {aadhaarValid && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(26,115,64,.08)', color: 'var(--success)' }}>
                <Check size={10} /> Valid Aadhaar
              </span>
            )}
          </div>
          <div className="rounded-2xl p-4 mb-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <p className="flex items-center gap-1.5 text-[11px] mb-3.5" style={{ color: 'var(--text3)' }}>
              <Pencil size={11} /> All fields are editable — click any field or ✎ to correct. Changes sync instantly.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-3">
              <FormGroup label="Aadhaar Number" required error={errors.kycAadhar} action={fixBtn('kyc-out-aadhar')}>
                <TextInput id="kyc-out-aadhar" value={data.kycAadhar} onChange={v => onChange({ kycAadhar: v, aadhar: v })}
                  onBlur={() => touch('kycAadhar')} placeholder="XXXXXXXXXXXX" maxLength={12} minLength={12}
                  inputMode="numeric" pattern="\d{12}" digitsOnly className="font-mono" style={filledStyle(aadhaarValid)} />
              </FormGroup>
              <FormGroup label="Name on Aadhaar" action={fixBtn('kyc-out-aname')}>
                <TextInput id="kyc-out-aname" value={aadhaarFullNameExtracted} onChange={setAadhaarFullNameExtracted} placeholder="—" style={filledStyle(!!aadhaarFullNameExtracted)} />
              </FormGroup>
              <FormGroup label="Gender" action={fixBtn('kyc-out-gender')}>
                <SelectInput id="kyc-out-gender" value={data.kycGender} onChange={v => onChange({ kycGender: v, gender: v })}
                  options={[{ value: 'M', label: 'Male' }, { value: 'F', label: 'Female' }, { value: 'O', label: 'Other' }]} placeholder="—" style={filledStyle(!!data.kycGender)} />
              </FormGroup>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-3">
              <FormGroup label="House / Flat No." action={fixBtn('kyc-out-street1')}>
                <TextInput id="kyc-out-street1" value={data.street1} onChange={v => onChange({ street1: v, kycStreet1: v })}
                  onBlur={() => touch('street1')} placeholder="—" style={filledStyle(!!data.street1)} />
              </FormGroup>
              <FormGroup label="Street & Locality" action={fixBtn('kyc-out-street2')}>
                <TextInput id="kyc-out-street2" value={data.street2} onChange={v => onChange({ street2: v })}
                  onBlur={() => touch('street2')} placeholder="—" style={filledStyle(!!data.street2)} />
              </FormGroup>
              <FormGroup label="City / District" action={fixBtn('kyc-out-city')}>
                <TextInput id="kyc-out-city" value={data.kycCity} onChange={v => onChange({ kycCity: v, city: v })}
                  placeholder="—" style={filledStyle(!!data.kycCity)} />
              </FormGroup>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-3">
              <FormGroup label="Pin Code" error={errors.kycPin} action={fixBtn('kyc-out-pin')}>
                <TextInput id="kyc-out-pin" value={data.kycPin} onChange={v => onChange({ kycPin: v, zip: v })}
                  onBlur={() => touch('kycPin')} placeholder="6-digit" maxLength={6} minLength={6} inputMode="numeric" pattern="\d{6}" digitsOnly style={filledStyle(!!data.kycPin)} />
              </FormGroup>
              <FormGroup label="State" action={fixBtn('kyc-out-state')}>
                <TextInput id="kyc-out-state" value={data.kycState} onChange={v => onChange({ kycState: v, state: v })}
                  placeholder="—" style={filledStyle(!!data.kycState)} />
              </FormGroup>
            </div>
            <FormGroup label="Full Address (as on Aadhaar)" action={fixBtn('kyc-out-address')}>
              <TextInput id="kyc-out-address" value={[data.street1, data.street2, data.kycCity, data.kycState, data.kycPin].filter(Boolean).join(', ')}
                onChange={() => {}} readOnly placeholder="—" style={filledStyle(!!(data.street1 || data.kycCity))} />
            </FormGroup>
          </div>
        </div>
      )}

      {/* Cross-validation — matches legacy kycCrossValidate; shown once both
          documents are extracted. */}
      {crossValidateChecks.length > 0 && (
        <div className="mt-1 p-3.5 rounded-[14px] text-xs flex items-start gap-2.5"
          style={crossValidatePassed
            ? { background: 'rgba(26,115,64,.06)', border: '1px solid rgba(26,115,64,.2)' }
            : { background: 'rgba(230,126,0,.06)', border: '1px solid rgba(230,126,0,.25)' }}>
          {crossValidatePassed
            ? <ShieldCheck size={16} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 1 }} />
            : <AlertTriangle size={16} style={{ color: 'var(--warn)', flexShrink: 0, marginTop: 1 }} />}
          <div>
            <p className="font-semibold mb-1" style={{ color: crossValidatePassed ? 'var(--success)' : 'var(--warn)' }}>
              {crossValidatePassed ? 'Cross-Validation Passed' : 'Review required'}
            </p>
            <div className="space-y-1">
              {crossValidateChecks.map((c, i) => (
                <p key={i} style={{ color: c.ok ? 'var(--success)' : '#92610b' }}>{c.ok ? '✓' : '⚠'} {c.label}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* KYC Report / Download — reproduces legacy kyc.js's kycBuildReport/
          kycDownloadReport: a plain-text summary, downloaded as .txt. */}
      <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
        <button type="button" onClick={() => setShowKycReport(v => !v)}
          className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>
          {showKycReport ? 'Hide' : 'Show'} KYC Report
        </button>
        {showKycReport && (
          <div className="mt-3 p-4 rounded-[14px]" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
            <div className="text-[11px] mb-3" style={{ color: 'var(--text3)' }}>Generated: {new Date().toLocaleString('en-IN')}</div>
            <div className="space-y-1.5 text-xs">
              {kycReportRows.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-3 py-1" style={{ borderBottom: i < kycReportRows.length - 1 ? '1px solid var(--border)' : undefined }}>
                  <span style={{ color: 'var(--text3)' }}>{r.label}</span>
                  <span style={{ color: r.ok ? 'var(--success)' : 'var(--text3)', fontWeight: r.ok ? 600 : 400 }}>{r.value}</span>
                </div>
              ))}
            </div>
            <button type="button" onClick={downloadKycReport}
              className="mt-3 text-xs font-semibold rounded-lg px-3 py-1.5"
              style={{ color: 'var(--accent)', border: '1px solid var(--border2)' }}>
              Download Report
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Step3({ data, onChange, errors, touch }: {
  data: WizardData; onChange: (f: Partial<WizardData>) => void; errors: Record<string, string>
  touch: (field: string) => void
}) {
  return (
    <>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
      <FormGroup label="First Name" required error={errors.firstName}>
        <TextInput value={data.firstName} onChange={v => onChange({ firstName: v })}
          onBlur={() => touch('firstName')} placeholder="First name" />
      </FormGroup>
      <FormGroup label="Middle Name">
        <TextInput value={data.middleName} onChange={v => onChange({ middleName: v })} placeholder="Middle name" />
      </FormGroup>
      <FormGroup label="Last Name" required error={errors.lastName}>
        <TextInput value={data.lastName} onChange={v => onChange({ lastName: v })}
          onBlur={() => touch('lastName')} placeholder="Last name" />
      </FormGroup>
      <FormGroup label="Date of Birth" required error={errors.dob}>
        <TextInput value={data.dob} onChange={v => onChange({ dob: v })} onBlur={() => touch('dob')} type="date" />
      </FormGroup>
      <FormGroup label="Gender" required error={errors.gender}>
        <SelectInput value={data.gender} onChange={v => onChange({ gender: v })} onBlur={() => touch('gender')}
          options={[{ value: 'M', label: 'Male' }, { value: 'F', label: 'Female' }, { value: 'O', label: 'Other' }]} placeholder="— Select —" />
      </FormGroup>
      <FormGroup label="Aadhaar Number" required error={errors.aadhar}>
        <TextInput value={data.aadhar} onChange={v => onChange({ aadhar: v })} onBlur={() => touch('aadhar')}
          placeholder="12-digit Aadhaar" maxLength={12} minLength={12}
          inputMode="numeric" pattern="\d{12}" digitsOnly className="font-mono" />
      </FormGroup>
      <FormGroup label="Email Address" required error={errors.email}>
        <TextInput value={data.email} onChange={v => onChange({ email: v })} onBlur={() => touch('email')}
          type="email" inputMode="email" placeholder="email@example.com" />
      </FormGroup>
      <FormGroup label="Alternate Phone" error={errors.phone}>
        <TextInput value={data.phone} onChange={v => onChange({ phone: v })} onBlur={() => touch('phone')}
          type="tel" inputMode="numeric" pattern="\d{10}" digitsOnly
          placeholder="10-digit alternate number" maxLength={10} minLength={10} />
      </FormGroup>
      <FormGroup label="Father's Name" required error={errors.father}>
        <TextInput value={data.father} onChange={v => onChange({ father: v })}
          onBlur={() => touch('father')} placeholder="Father's name" />
      </FormGroup>
      {/* Mother's Name — Vanilla Step 3 (Personal Details) has this field
          right after Father's Name (index.html wstep-3); required there. */}
      <FormGroup label="Mother's Name" required error={errors.mother}>
        <TextInput value={data.mother} onChange={v => onChange({ mother: v })}
          onBlur={() => touch('mother')} placeholder="Mother's name" />
      </FormGroup>
    </div>
    <Step3CoApplicant data={data} onChange={onChange} errors={errors} touch={touch} />
    </>
  )
}

// Co-Applicant section on Step 3 — Vanilla's #wstep3-coapp-section
// (wToggleCoApplicantSection, efin-app.js:9298): Home Loan / LAP → shown &
// MANDATORY (Name/PAN/Aadhaar/Mobile); Business Loan → shown & optional; all
// other products → hidden. React previously captured a co-applicant only on
// Step 5 for Education, so Home/LAP/Business co-applicant was not captured at
// all. Reuses the existing coApp* WizardData fields (+ coAppAadhar).
const COAPP3_MANDATORY = ['home_loan', 'lap']
const COAPP3_OPTIONAL  = ['business_loan']
function Step3CoApplicant({ data, onChange, errors, touch }: {
  data: WizardData; onChange: (f: Partial<WizardData>) => void; errors: Record<string, string>
  touch: (field: string) => void
}) {
  const mandatory = COAPP3_MANDATORY.includes(data.loanType)
  const optional  = COAPP3_OPTIONAL.includes(data.loanType)
  if (!mandatory && !optional) return null
  return (
    <div className="mt-4">
      <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
        Co-Applicant Details {mandatory ? <span style={{ color: 'var(--danger)' }}>*</span> : <span style={{ color: 'var(--text3)' }}>(Optional)</span>}
      </div>
      {mandatory && (
        <p className="text-xs mt-0.5 mb-1" style={{ color: 'var(--danger)' }}>Co-Applicant is mandatory for this loan type.</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 mt-2">
        <FormGroup label="Full Name" required={mandatory} error={errors.coAppName}>
          <TextInput value={data.coAppName} onChange={v => onChange({ coAppName: v })}
            onBlur={() => touch('coAppName')} placeholder="Co-applicant full name" />
        </FormGroup>
        <FormGroup label="PAN Number" required={mandatory} error={errors.coAppPan}>
          <TextInput value={data.coAppPan} onChange={v => onChange({ coAppPan: v.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
            onBlur={() => touch('coAppPan')} placeholder="ABCDE1234F" maxLength={10} className="uppercase font-mono" />
        </FormGroup>
        <FormGroup label="Aadhaar Number" required={mandatory} error={errors.coAppAadhar}>
          <TextInput value={data.coAppAadhar} onChange={v => onChange({ coAppAadhar: v })}
            onBlur={() => touch('coAppAadhar')} placeholder="12-digit Aadhaar" maxLength={12}
            inputMode="numeric" digitsOnly className="font-mono" />
        </FormGroup>
        <FormGroup label="Mobile Number" required={mandatory} error={errors.coAppMobile}>
          <TextInput value={data.coAppMobile} onChange={v => onChange({ coAppMobile: v })}
            onBlur={() => touch('coAppMobile')} type="tel" inputMode="numeric" digitsOnly
            maxLength={10} placeholder="10-digit mobile" />
        </FormGroup>
      </div>
    </div>
  )
}

function Step4({ data, onChange, errors, touch }: {
  data: WizardData; onChange: (f: Partial<WizardData>) => void; errors: Record<string, string>
  touch: (field: string) => void
}) {
  const handleSameAddr = (checked: boolean) => {
    if (checked) {
      onChange({
        sameAddr: true,
        pStreet1: data.street1, pStreet2: data.street2,
        pCity: data.city, pState: data.state, pZip: data.zip, pHomeType: data.homeType,
      })
    } else {
      onChange({ sameAddr: false })
    }
  }

  return (
    <div>
      <p className="wiz-section-head">Current Address</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
        <FormGroup label="House / Flat No." required error={errors.street1}>
          <TextInput value={data.street1} onChange={v => onChange({ street1: v })}
            onBlur={() => touch('street1')} placeholder="Flat no, Floor" />
        </FormGroup>
        <FormGroup label="Street & Locality" required error={errors.street2}>
          <TextInput value={data.street2} onChange={v => onChange({ street2: v })}
            onBlur={() => touch('street2')} placeholder="Road, Area, Colony" />
        </FormGroup>
        <FormGroup label="City" required error={errors.city}>
          <TextInput value={data.city} onChange={v => onChange({ city: v })}
            onBlur={() => touch('city')} placeholder="City" />
        </FormGroup>
        <FormGroup label="Pin Code" required error={errors.zip}>
          <TextInput value={data.zip} onChange={v => onChange({ zip: v })} onBlur={() => touch('zip')}
            placeholder="6-digit pin" maxLength={6} minLength={6}
            inputMode="numeric" pattern="\d{6}" digitsOnly />
        </FormGroup>
        <FormGroup label="State" required error={errors.state}>
          <SelectInput value={data.state} onChange={v => onChange({ state: v })} onBlur={() => touch('state')}
            options={STATES} placeholder="— Select State —" />
        </FormGroup>
        <FormGroup label="Home Type" required error={errors.homeType}>
          <SelectInput value={data.homeType} onChange={v => onChange({ homeType: v })} onBlur={() => touch('homeType')}
            options={HOME_TYPES} placeholder="— Select —" />
        </FormGroup>
      </div>

      {/* Permanent address block — Vanilla hides it entirely for over_draft
          (applyProductToWizard toggle w-permanent-addr-block), including the
          "Same as current" checkbox, since Step 4 there is the Business Address. */}
      {data.loanType !== 'over_draft' && (
        <>
          <div className="mt-5">
            <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-gray-600">
              <input type="checkbox" checked={data.sameAddr}
                onChange={e => handleSameAddr(e.target.checked)}
                className="w-4 h-4 accent-efin-blue" />
              Same as current address
            </label>
          </div>

          {!data.sameAddr && (
            <>
              <p className="wiz-section-head">Permanent Address</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                <FormGroup label="House / Flat No." required error={errors.pStreet1}>
                  <TextInput value={data.pStreet1} onChange={v => onChange({ pStreet1: v })}
                    onBlur={() => touch('pStreet1')} placeholder="Flat no, Floor" />
                </FormGroup>
                <FormGroup label="Street & Locality" required error={errors.pStreet2}>
                  <TextInput value={data.pStreet2} onChange={v => onChange({ pStreet2: v })}
                    onBlur={() => touch('pStreet2')} placeholder="Road, Area, Colony" />
                </FormGroup>
                <FormGroup label="City" required error={errors.pCity}>
                  <TextInput value={data.pCity} onChange={v => onChange({ pCity: v })}
                    onBlur={() => touch('pCity')} placeholder="City" />
                </FormGroup>
                <FormGroup label="Pin Code" required error={errors.pZip}>
                  <TextInput value={data.pZip} onChange={v => onChange({ pZip: v })} onBlur={() => touch('pZip')}
                    placeholder="6-digit pin" maxLength={6} minLength={6}
                    inputMode="numeric" pattern="\d{6}" digitsOnly />
                </FormGroup>
                <FormGroup label="State" required error={errors.pState}>
                  <SelectInput value={data.pState} onChange={v => onChange({ pState: v })}
                    onBlur={() => touch('pState')} options={STATES} placeholder="— Select State —" />
                </FormGroup>
                <FormGroup label="Home Type" required error={errors.pHomeType}>
                  <SelectInput value={data.pHomeType} onChange={v => onChange({ pHomeType: v })}
                    onBlur={() => touch('pHomeType')} options={HOME_TYPES} placeholder="— Select —" />
                </FormGroup>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

function Step5({ data, onChange, errors, touch }: {
  data: WizardData; onChange: (f: Partial<WizardData>) => void; errors: Record<string, string>
  touch: (field: string) => void
}) {
  // Lender company master (Lender Config → Companies). Backing the employer
  // field with this list is what lets Step 9's matcher resolve the applicant's
  // employer to a bank's approved-company list (Path A). Reuses the same
  // ['lender-companies'] query the Lender Config screen uses — no new endpoint.
  const { data: companies = [] } = useQuery({
    queryKey: ['lender-companies'],
    queryFn: () => lenderConfigApi.getCompanies().then(r => r.data.data ?? []),
    staleTime: 60_000,
  })
  // Whether the typed employer name exactly matches a master company — mirrors
  // Vanilla's master-vs-custom distinction (a match feeds companyId to the
  // matcher; anything else is treated as a custom employer).
  const employerLinked = !!data.compName.trim() &&
    companies.some(c => c.name.trim().toLowerCase() === data.compName.trim().toLowerCase())
  return (
    <div>
      {/* Loan Product is fixed for the whole application — it is chosen once at
          the very start (LoanProductSelectorModal, Vanilla's #loan-product-
          overlay) and shown here read-only, never re-selected. It still drives
          the Property / Vehicle / Education sections below. */}
      <ProductContextBanner loanType={data.loanType} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
        <FormGroup label="Employment Type" required error={errors.empType}>
          <SelectInput value={data.empType} onChange={v => onChange({ empType: v })} onBlur={() => touch('empType')}
            options={EMP_TYPES} placeholder="— Select —" />
        </FormGroup>
        <FormGroup label="Net Monthly Take-Home Salary (₹)" error={errors.salary}>
          <TextInput value={data.salary} onChange={v => onChange({ salary: v })} onBlur={() => touch('salary')}
            inputMode="decimal" decimalOnly placeholder="e.g. 50000" />
        </FormGroup>
        <FormGroup label="Existing Monthly EMI Obligations (₹)" error={errors.obligations}>
          <TextInput value={data.obligations} onChange={v => onChange({ obligations: v })}
            onBlur={() => touch('obligations')}
            inputMode="decimal" decimalOnly placeholder="0 if none" />
        </FormGroup>
        <FormGroup label="Designation" required={data.empType !== 'self_employed'} error={errors.desig}>
          <TextInput value={data.desig} onChange={v => onChange({ desig: v })} onBlur={() => touch('desig')}
            placeholder="e.g. Manager" />
        </FormGroup>
      </div>

      {/* Progressive disclosure: until an Employment Type is picked, none of the
          type-specific field blocks below are shown, so the applicant never
          faces one huge form at once (Step-5 validation only requires those
          fields once empType is set, so hiding them creates no dead-end). */}
      {!data.empType && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3.5 py-3 text-[12.5px] text-gray-500">
          <IdCard size={15} className="shrink-0 text-gray-400" />
          Select an <span className="font-semibold text-gray-600">Employment Type</span> above to reveal the fields that apply to it.
        </div>
      )}

      {/* Company / firm block — shown for Salaried AND Professional. The Step 5
          validation requires compName / desig / officeEmail for every non-
          self-employed type, so this block must render for 'professional' too;
          otherwise a Professional applicant is blocked with required fields that
          have no input (a dead-end state). Label adapts to firm vs employer. */}
      {(data.empType === 'salaried' || data.empType === 'professional') && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 mt-2">
          <FormGroup label={data.empType === 'professional' ? 'Firm / Practice Name' : 'Employer / Company Name'} required error={errors.compName}>
            <TextInput value={data.compName} onChange={v => onChange({ compName: v })}
              onBlur={() => touch('compName')} list="wizard-company-master"
              placeholder={data.empType === 'professional' ? 'e.g. Sharma & Associates' : 'e.g. Tata Consultancy'} />
            {/* Native suggestions from the lender company master. Selecting one
                lets Step 9 evaluate employer-list (Path A) banks; free text is a
                custom employer, exactly like Vanilla's is-custom-company case. */}
            <datalist id="wizard-company-master">
              {companies.map(c => <option key={c.id} value={c.name} />)}
            </datalist>
            {employerLinked
              ? <p className="mt-1 text-[11px] font-medium text-green-600">✓ Linked to lender master — used for employer-list bank matching</p>
              : data.compName.trim() && companies.length > 0
                ? <p className="mt-1 text-[11px] text-gray-400">Custom employer — pick from the list to match employer-list banks</p>
                : null}
          </FormGroup>
          <FormGroup label="Company Type" required error={errors.compType}>
            <SelectInput value={data.compType} onChange={v => onChange({ compType: v })}
              onBlur={() => touch('compType')} options={COMP_TYPES} placeholder="— Select —" />
          </FormGroup>
          <FormGroup label="Official Email ID" required={data.empType === 'salaried'} error={errors.officeEmail}>
            <TextInput value={data.officeEmail} onChange={v => onChange({ officeEmail: v })}
              onBlur={() => touch('officeEmail')}
              type="email" inputMode="email" placeholder="e.g. name@company.com" />
          </FormGroup>
        </div>
      )}

      {data.empType === 'self_employed' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 mt-2">
          <FormGroup label="Business / Firm Name">
            <TextInput value={data.compName} onChange={v => onChange({ compName: v })}
              placeholder="e.g. Sharma Enterprises" />
          </FormGroup>
          <FormGroup label="Company / Business Type" required error={errors.compType}>
            <SelectInput value={data.compType} onChange={v => onChange({ compType: v })}
              onBlur={() => touch('compType')} options={COMP_TYPES_SELF} placeholder="— Select —" />
          </FormGroup>
          {/* Legacy's SEP/SENP field set — none of these existed here before. */}
          <FormGroup label="Business Vintage (years)" required error={errors.bizVintage}>
            <TextInput value={data.bizVintage} onChange={v => onChange({ bizVintage: v })}
              onBlur={() => touch('bizVintage')} inputMode="decimal" decimalOnly placeholder="e.g. 5" />
          </FormGroup>
          <FormGroup label="Annual Turnover (₹)" required error={errors.annualTurnover}>
            <TextInput value={data.annualTurnover} onChange={v => onChange({ annualTurnover: v })}
              onBlur={() => touch('annualTurnover')} inputMode="decimal" decimalOnly placeholder="e.g. 2500000" />
          </FormGroup>
          <FormGroup label="Net Profit (₹)" required error={errors.netProfit}>
            <TextInput value={data.netProfit} onChange={v => onChange({ netProfit: v })}
              onBlur={() => touch('netProfit')} inputMode="decimal" decimalOnly placeholder="e.g. 600000" />
          </FormGroup>
          <FormGroup label="GST Number">
            <TextInput value={data.gstNumber} onChange={v => onChange({ gstNumber: v.toUpperCase() })}
              placeholder="e.g. 27AAAAA0000A1Z5" />
          </FormGroup>
          <FormGroup label="ITR Filed" required error={errors.itrFiled}>
            <SelectInput value={data.itrFiled} onChange={v => onChange({ itrFiled: v })}
              onBlur={() => touch('itrFiled')} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} placeholder="— Select —" />
          </FormGroup>
          {/* Industry Business Type — Vanilla's #w-biz-type, separate from the
              legal Company/Business Type above. */}
          <FormGroup label="Business Type" required error={errors.bizType}>
            <SelectInput value={data.bizType} onChange={v => onChange({ bizType: v })}
              onBlur={() => touch('bizType')} options={BIZ_TYPES} placeholder="— Select —" />
          </FormGroup>
        </div>
      )}

      {/* Professional registration — legacy shows this for the Professional
          employment type (CA / Doctor / Lawyer). */}
      {data.empType === 'professional' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 mt-2">
          <FormGroup label="Professional Body / Registration" required error={errors.professionalBody}>
            <TextInput value={data.professionalBody} onChange={v => onChange({ professionalBody: v })}
              onBlur={() => touch('professionalBody')} placeholder="e.g. ICAI / MCI / Bar Council" />
          </FormGroup>
        </div>
      )}

      {/* Office / workplace address — Vanilla captures this as structured
          Line 1 / Line 2 / PIN (not one free-text field). Label adapts:
          "Office / Practice" for professional, "Business" for self-employed,
          "Office / Workplace" for salaried — matching Vanilla's wording. */}
      {data.empType && (() => {
        const addrPrefix = data.empType === 'professional' ? 'Office / Practice'
          : data.empType === 'self_employed' ? 'Business'
          : 'Office / Workplace'
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 mt-2">
            <FormGroup label={`${addrPrefix} Address Line 1`} required error={errors.officeAddr1}>
              <TextInput value={data.officeAddr1} onChange={v => onChange({ officeAddr1: v })}
                onBlur={() => touch('officeAddr1')} placeholder="Building / Floor / Street" />
            </FormGroup>
            <FormGroup label={`${addrPrefix} Address Line 2`} required error={errors.officeAddr2}>
              <TextInput value={data.officeAddr2} onChange={v => onChange({ officeAddr2: v })}
                onBlur={() => touch('officeAddr2')} placeholder="Area / Locality / Landmark" />
            </FormGroup>
            <FormGroup label={`${addrPrefix} Address PIN Code`} required error={errors.officePin}>
              <TextInput value={data.officePin} onChange={v => onChange({ officePin: v })}
                onBlur={() => touch('officePin')} inputMode="numeric" digitsOnly maxLength={6} placeholder="6-digit PIN" />
            </FormGroup>
          </div>
        )
      })()}

      {/* ── Product-specific sections (legacy shows these per loan type) ── */}
      {(data.loanType === 'home_loan' || data.loanType === 'lap') && (
        <div className="mt-5">
          <p className="wiz-section-head">Property Details</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            <FormGroup label="Property Type" required error={errors.propertyType}>
              <SelectInput value={data.propertyType} onChange={v => onChange({ propertyType: v })}
                onBlur={() => touch('propertyType')}
                options={['Apartment / Flat', 'Independent House', 'Plot / Land', 'Commercial', 'Under Construction']}
                placeholder="— Select —" />
            </FormGroup>
            <FormGroup label="Property Value (₹)">
              <TextInput value={data.propertyValue} onChange={v => onChange({ propertyValue: v })}
                inputMode="decimal" decimalOnly placeholder="e.g. 6500000" />
            </FormGroup>
            <FormGroup label="Property Address">
              <TextInput value={data.propertyAddress} onChange={v => onChange({ propertyAddress: v })}
                placeholder="Full property address" />
            </FormGroup>
            <FormGroup label="Property City">
              <TextInput value={data.propertyCity} onChange={v => onChange({ propertyCity: v })}
                placeholder="e.g. Pune" />
            </FormGroup>
            <FormGroup label="Ownership Type" required error={errors.propertyOwnership}>
              <SelectInput value={data.propertyOwnership} onChange={v => onChange({ propertyOwnership: v })}
                onBlur={() => touch('propertyOwnership')} options={['Owned', 'Rented', 'Self Owned']} placeholder="— Select —" />
            </FormGroup>
            <FormGroup label="Under Construction?" required error={errors.propertyUnderConstruction}>
              <SelectInput value={data.propertyUnderConstruction} onChange={v => onChange({ propertyUnderConstruction: v })}
                onBlur={() => touch('propertyUnderConstruction')} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} />
            </FormGroup>
            {(data.propertyUnderConstruction === 'yes' || data.propertyType === 'Under Construction' || data.propertyType === 'Apartment / Flat') && (
              <FormGroup label="Builder / Society Name">
                <TextInput value={data.builderSociety} onChange={v => onChange({ builderSociety: v })}
                  placeholder="e.g. Green Valley Developers" />
              </FormGroup>
            )}
          </div>
        </div>
      )}

      {(data.loanType === 'new_car' || data.loanType === 'used_car') && (
        <div className="mt-5">
          <p className="wiz-section-head">Vehicle Details</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            <FormGroup label="Make" required error={errors.vehicleMake}>
              <TextInput value={data.vehicleMake} onChange={v => onChange({ vehicleMake: v })}
                onBlur={() => touch('vehicleMake')} placeholder="e.g. Maruti Suzuki" />
            </FormGroup>
            <FormGroup label="Model" required error={errors.vehicleModel}>
              <TextInput value={data.vehicleModel} onChange={v => onChange({ vehicleModel: v })}
                onBlur={() => touch('vehicleModel')} placeholder="e.g. Baleno" />
            </FormGroup>
            <FormGroup label={data.loanType === 'used_car' ? 'Vehicle Value (₹)' : 'On-road Price (₹)'} required error={errors.vehiclePrice}>
              <TextInput value={data.vehiclePrice} onChange={v => onChange({ vehiclePrice: v })}
                onBlur={() => touch('vehiclePrice')} inputMode="decimal" decimalOnly placeholder="e.g. 900000" />
            </FormGroup>
            {data.loanType === 'new_car' && (
              <FormGroup label="Ex-Showroom Price (₹)">
                <TextInput value={data.vehicleExShowroom} onChange={v => onChange({ vehicleExShowroom: v })}
                  inputMode="decimal" decimalOnly placeholder="e.g. 820000" />
              </FormGroup>
            )}
            {data.loanType === 'used_car' && (
              <>
                <FormGroup label="Manufacture Year" required error={errors.vehicleMfgYear}>
                  <TextInput value={data.vehicleMfgYear} onChange={v => onChange({ vehicleMfgYear: v })}
                    onBlur={() => touch('vehicleMfgYear')} inputMode="numeric" digitsOnly maxLength={4} placeholder="e.g. 2019" />
                </FormGroup>
                <FormGroup label="Kilometres Driven" required error={errors.vehicleKms}>
                  <TextInput value={data.vehicleKms} onChange={v => onChange({ vehicleKms: v })}
                    onBlur={() => touch('vehicleKms')} inputMode="numeric" digitsOnly placeholder="e.g. 45000" />
                </FormGroup>
              </>
            )}
            <FormGroup label="Dealer Name" required error={errors.vehicleDealer}>
              <TextInput value={data.vehicleDealer} onChange={v => onChange({ vehicleDealer: v })}
                onBlur={() => touch('vehicleDealer')} placeholder="e.g. City Motors" />
            </FormGroup>
          </div>
        </div>
      )}

      {data.loanType === 'education' && (
        <div className="mt-5">
          <p className="wiz-section-head">Education Details</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            <FormGroup label="Course Name" required error={errors.courseName}>
              <TextInput value={data.courseName} onChange={v => onChange({ courseName: v })}
                onBlur={() => touch('courseName')} placeholder="e.g. MBA" />
            </FormGroup>
            <FormGroup label="Institute / University" required error={errors.instituteName}>
              <TextInput value={data.instituteName} onChange={v => onChange({ instituteName: v })}
                onBlur={() => touch('instituteName')} placeholder="e.g. IIM Bangalore" />
            </FormGroup>
            <FormGroup label="Course Duration (Years)" required error={errors.courseDuration}>
              {/* Vanilla's #w-course-duration is Years (min 1, max 10), not months
                  — efin-app.js index.html:2225. */}
              <TextInput value={data.courseDuration} onChange={v => onChange({ courseDuration: v })}
                onBlur={() => touch('courseDuration')} inputMode="numeric" digitsOnly maxLength={2} placeholder="e.g. 4" />
            </FormGroup>
            <FormGroup label="Study Location" required error={errors.studyLocation}>
              <SelectInput value={data.studyLocation} onChange={v => onChange({ studyLocation: v })}
                onBlur={() => touch('studyLocation')} options={['India', 'Abroad']} placeholder="— Select —" />
            </FormGroup>
            <FormGroup label="Admission Status" required error={errors.admissionStatus}>
              <SelectInput value={data.admissionStatus} onChange={v => onChange({ admissionStatus: v })}
                onBlur={() => touch('admissionStatus')} options={['Confirmed', 'Applied / Waiting', 'Pending']} placeholder="— Select —" />
            </FormGroup>
          </div>
        </div>
      )}

      {/* Co-applicant — legacy makes this mandatory for Home Loan / LAP and
          for Education (every field carries a `req` span in Vanilla's
          #w-edu-fields, index.html:2231-2249); optional for Business Loan. */}
      {['home_loan', 'lap', 'business_loan', 'education'].includes(data.loanType) && (() => {
        const mandatory = ['home_loan', 'lap', 'education'].includes(data.loanType)
        const isEducation = data.loanType === 'education'
        return (
          <div className="mt-5">
            <p className="wiz-section-head">
              {isEducation ? 'Co-Applicant (Parent / Guardian) Details' : 'Co-Applicant Details'}
              {mandatory
                ? <span className="text-red-500 ml-1">*</span>
                : <span className="text-gray-400 font-normal normal-case ml-1">(optional)</span>}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
              <FormGroup label="Co-Applicant Name" required={mandatory} error={errors.coAppName}>
                <TextInput value={data.coAppName} onChange={v => onChange({ coAppName: v })}
                  onBlur={() => touch('coAppName')} placeholder="Full name" />
              </FormGroup>
              <FormGroup label="Relationship" required={mandatory} error={errors.coAppRelation}>
                <SelectInput value={data.coAppRelation} onChange={v => onChange({ coAppRelation: v })}
                  onBlur={() => touch('coAppRelation')} options={RELATIONS} placeholder="— Select —" />
              </FormGroup>
              <FormGroup label="Co-Applicant PAN" required={mandatory} error={errors.coAppPan}>
                <TextInput value={data.coAppPan} onChange={v => onChange({ coAppPan: v.toUpperCase() })}
                  onBlur={() => touch('coAppPan')} maxLength={10} placeholder="ABCDE1234F" />
              </FormGroup>
              <FormGroup label="Co-Applicant Mobile" required={mandatory} error={errors.coAppMobile}>
                <TextInput value={data.coAppMobile} onChange={v => onChange({ coAppMobile: v })}
                  onBlur={() => touch('coAppMobile')} inputMode="numeric" maxLength={10} placeholder="10-digit mobile" />
              </FormGroup>
              {/* Co-Applicant Email — Education-only in Vanilla (#w-coapplicant-email,
                  index.html:2249). Not collected for Home/LAP/Business co-applicants. */}
              {isEducation && (
                <FormGroup label="Co-Applicant Email" required error={errors.coAppEmail}>
                  <TextInput value={data.coAppEmail} onChange={v => onChange({ coAppEmail: v })}
                    onBlur={() => touch('coAppEmail')} type="email" inputMode="email" placeholder="email@example.com" />
                </FormGroup>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function Step6({ data, onChange, errors, touch }: {
  data: WizardData; onChange: (f: Partial<WizardData>) => void; errors: Record<string, string>
  touch: (field: string) => void
}) {
  // Insurance is not a loan — legacy swaps the entire loan-offer field set
  // for a policy field set when this product is chosen. Reproduced here.
  if (data.loanType === 'insurance') {
    return (
      <div>
        <ProductContextBanner loanType={data.loanType} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
          <FormGroup label="Insurance Type" required error={errors.insType}>
            <SelectInput value={data.insType} onChange={v => onChange({ insType: v })} onBlur={() => touch('insType')}
              options={['Term Life', 'Whole Life', 'Endowment', 'ULIP', 'Health', 'Motor', 'Home', 'Travel', 'Personal Accident']}
              placeholder="— Select —" />
          </FormGroup>
          <FormGroup label="Sum Assured (₹)" required error={errors.insSumAssured}>
            <TextInput value={data.insSumAssured} onChange={v => onChange({ insSumAssured: v })}
              onBlur={() => touch('insSumAssured')} inputMode="decimal" decimalOnly placeholder="e.g. 5000000" />
          </FormGroup>
          <FormGroup label="Policy Term (years)" required error={errors.insPolicyTerm}>
            <TextInput value={data.insPolicyTerm} onChange={v => onChange({ insPolicyTerm: v })}
              onBlur={() => touch('insPolicyTerm')} inputMode="numeric" digitsOnly maxLength={2} placeholder="e.g. 20" />
          </FormGroup>
          <FormGroup label="Premium Frequency" required error={errors.insPremiumFreq}>
            <SelectInput value={data.insPremiumFreq} onChange={v => onChange({ insPremiumFreq: v })}
              onBlur={() => touch('insPremiumFreq')}
              options={['Yearly', 'Half-Yearly', 'Quarterly', 'Monthly', 'Single Premium']} />
          </FormGroup>
          <FormGroup label="Estimated Premium (₹)" required error={errors.insPremium}>
            <TextInput value={data.insPremium} onChange={v => onChange({ insPremium: v })}
              onBlur={() => touch('insPremium')} inputMode="decimal" decimalOnly placeholder="e.g. 24000" />
          </FormGroup>
          <FormGroup label="Preferred Insurer" required error={errors.insInsurer}>
            <TextInput value={data.insInsurer} onChange={v => onChange({ insInsurer: v })}
              onBlur={() => touch('insInsurer')} placeholder="e.g. HDFC Life" />
          </FormGroup>
        </div>

        <p className="wiz-section-head">Nominee Details</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
          <FormGroup label="Nominee Name" required error={errors.insNomineeName}>
            <TextInput value={data.insNomineeName} onChange={v => onChange({ insNomineeName: v })}
              onBlur={() => touch('insNomineeName')} placeholder="Full name" />
          </FormGroup>
          <FormGroup label="Relationship" required error={errors.insNomineeRelation}>
            <SelectInput value={data.insNomineeRelation} onChange={v => onChange({ insNomineeRelation: v })}
              onBlur={() => touch('insNomineeRelation')} options={RELATIONS} placeholder="— Select —" />
          </FormGroup>
          <FormGroup label="Nominee Date of Birth" required error={errors.insNomineeDob}>
            <TextInput value={data.insNomineeDob} onChange={v => onChange({ insNomineeDob: v })}
              onBlur={() => touch('insNomineeDob')} type="date" />
          </FormGroup>
          <FormGroup label="Nominee ID (Aadhaar / PAN)" required error={errors.insNomineeId}>
            <TextInput value={data.insNomineeId} onChange={v => onChange({ insNomineeId: v.toUpperCase() })}
              onBlur={() => touch('insNomineeId')} placeholder="Aadhaar or PAN" />
          </FormGroup>
        </div>

        <p className="wiz-section-head">Existing Policy</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
          <FormGroup label="Has an existing policy?">
            <SelectInput value={data.insExistingPolicy} onChange={v => onChange({ insExistingPolicy: v })}
              options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} />
          </FormGroup>
          {data.insExistingPolicy === 'yes' && (
            <>
              <FormGroup label="Existing Insurer">
                <TextInput value={data.insExistingInsurer} onChange={v => onChange({ insExistingInsurer: v })}
                  placeholder="Insurer name" />
              </FormGroup>
              <FormGroup label="Existing Cover (₹)" required error={errors.insExistingCover}>
                <TextInput value={data.insExistingCover} onChange={v => onChange({ insExistingCover: v })}
                  onBlur={() => touch('insExistingCover')} inputMode="decimal" decimalOnly placeholder="e.g. 2000000" />
              </FormGroup>
              <FormGroup label="Existing Policy Number" required error={errors.insExistingPolicyNumber}>
                <TextInput value={data.insExistingPolicyNumber} onChange={v => onChange({ insExistingPolicyNumber: v.toUpperCase() })}
                  onBlur={() => touch('insExistingPolicyNumber')} placeholder="Policy number" />
              </FormGroup>
            </>
          )}
        </div>

        <p className="wiz-section-head">Health Declaration</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
          <FormGroup label="Tobacco / Smoker Status" required error={errors.insTobaccoStatus}>
            <SelectInput value={data.insTobaccoStatus} onChange={v => onChange({ insTobaccoStatus: v })}
              onBlur={() => touch('insTobaccoStatus')}
              options={['Non-Smoker / Non-Tobacco User', 'Smoker', 'Tobacco User (non-smoking)', 'Ex-Smoker (quit > 1 year ago)']}
              placeholder="— Select —" />
          </FormGroup>
          <FormGroup label="Occupation Hazard" required error={errors.insOccupationHazard}>
            <SelectInput value={data.insOccupationHazard} onChange={v => onChange({ insOccupationHazard: v })}
              onBlur={() => touch('insOccupationHazard')}
              options={['Low Risk (Office / Professional)', 'Medium Risk (Field Work / Semi-manual)', 'High Risk (Manual / Industrial / Mining)']}
              placeholder="— Select —" />
          </FormGroup>
          <FormGroup label="Height (cm)" required error={errors.insHeight}>
            <TextInput value={data.insHeight} onChange={v => onChange({ insHeight: v })}
              onBlur={() => touch('insHeight')} inputMode="numeric" digitsOnly maxLength={3} placeholder="e.g. 172" />
          </FormGroup>
          <FormGroup label="Weight (kg)" required error={errors.insWeight}>
            <TextInput value={data.insWeight} onChange={v => onChange({ insWeight: v })}
              onBlur={() => touch('insWeight')} inputMode="numeric" digitsOnly maxLength={3} placeholder="e.g. 70" />
          </FormGroup>
          <FormGroup label="Any existing medical condition?">
            <SelectInput value={data.insHealthDeclared} onChange={v => onChange({ insHealthDeclared: v })}
              options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} />
          </FormGroup>
          {data.insHealthDeclared === 'yes' && (
            <FormGroup label="Details" required error={errors.insHealthNotes}>
              <TextInput value={data.insHealthNotes} onChange={v => onChange({ insHealthNotes: v })}
                onBlur={() => touch('insHealthNotes')} placeholder="Condition / treatment details" />
            </FormGroup>
          )}
        </div>

        <div className="mt-5 p-3 bg-efin-blue/10 border border-efin-blue/12 rounded-lg text-xs text-efin-blue">
          Insurance is a policy application, not a loan — EMI, interest rate and tenure do not apply.
        </div>
      </div>
    )
  }

  return (
    <div>
      <ProductContextBanner loanType={data.loanType} />
      {/* CAM eligibility offer — legacy renders this panel at the top of
          Step 6 (#wstep6-cam-panel) so the offer is worked out before the
          loan fields are filled. Applying it writes into the same three
          fields below, exactly like camApplyToWizard(). */}
      <CamOfferPanel
        salary={data.salary}
        obligations={data.obligations}
        companyName={data.compName}
        applicantName={[data.firstName, data.lastName].filter(Boolean).join(' ')}
        onApply={offer => onChange({
          ...offer,
          // Legacy defaults the product to personal_loan when the offer is
          // applied and nothing has been chosen yet (efin-app.js:17614).
          loanType: data.loanType || 'personal_loan',
        })}
      />

      {/* CIBIL Score / Loan Amount / Interest Rate / Tenure / Purpose fields,
          the standalone EMI Calculator block, and the live lender-eligibility
          preview were removed from this step at the user's request — they
          duplicated what CamOfferPanel above already covers (amount, rate,
          tenure and EMI are set via its own slider + Apply to Application).
          `amount` and `tenure` (the only two fields validateStep(6) actually
          requires for a loan) are still populated by CamOfferPanel's onApply,
          so Continue keeps working the same way. */}
    </div>
  )
}

function Step7({ data, onChange, errors, touch }: {
  data: WizardData; onChange: (f: Partial<WizardData>) => void; errors: Record<string, string>
  touch: (field: string) => void
}) {
  return (
    <div>
      {errors.references && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
          <AlertCircle size={16} />{errors.references}
        </div>
      )}
      <div className="mb-6">
        <p className="wiz-section-head">Reference 1</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4">
          <FormGroup label="Name" required error={errors.r1Name}>
            <TextInput value={data.r1Name} onChange={v => onChange({ r1Name: v })} onBlur={() => touch('r1Name')}
              placeholder="Full name" />
          </FormGroup>
          <FormGroup label="Mobile" required error={errors.r1Mobile}>
            <TextInput value={data.r1Mobile} onChange={v => onChange({ r1Mobile: v })} onBlur={() => touch('r1Mobile')}
              type="tel" inputMode="numeric" pattern="\d{10}" digitsOnly
              placeholder="10-digit mobile" maxLength={10} minLength={10} />
          </FormGroup>
          <FormGroup label="Relationship" required error={errors.r1Relation}>
            <SelectInput value={data.r1Relation} onChange={v => onChange({ r1Relation: v })}
              onBlur={() => touch('r1Relation')}
              options={RELATIONS} placeholder="— Select —" />
          </FormGroup>
        </div>
        {/* Reference address — Vanilla captures Address Line 1/2, City, PIN
            per reference (index.html wstep-7). */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 mt-1">
          <FormGroup label="Address Line 1">
            <TextInput value={data.r1Addr1} onChange={v => onChange({ r1Addr1: v })} placeholder="House / Flat, Street" />
          </FormGroup>
          <FormGroup label="Address Line 2">
            <TextInput value={data.r1Addr2} onChange={v => onChange({ r1Addr2: v })} placeholder="Locality / Landmark" />
          </FormGroup>
          <FormGroup label="City">
            <TextInput value={data.r1City} onChange={v => onChange({ r1City: v })} placeholder="City" />
          </FormGroup>
          <FormGroup label="PIN Code">
            <TextInput value={data.r1Pin} onChange={v => onChange({ r1Pin: v })}
              inputMode="numeric" pattern="\d{6}" digitsOnly placeholder="6-digit PIN" maxLength={6} />
          </FormGroup>
        </div>
      </div>
      <div>
        <p className="wiz-section-head">Reference 2</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4">
          <FormGroup label="Name" required error={errors.r2Name}>
            <TextInput value={data.r2Name} onChange={v => onChange({ r2Name: v })} onBlur={() => touch('r2Name')}
              placeholder="Full name" />
          </FormGroup>
          <FormGroup label="Mobile" required error={errors.r2Mobile}>
            <TextInput value={data.r2Mobile} onChange={v => onChange({ r2Mobile: v })} onBlur={() => touch('r2Mobile')}
              type="tel" inputMode="numeric" pattern="\d{10}" digitsOnly
              placeholder="10-digit mobile" maxLength={10} minLength={10} />
          </FormGroup>
          <FormGroup label="Relationship" required error={errors.r2Relation}>
            <SelectInput value={data.r2Relation} onChange={v => onChange({ r2Relation: v })}
              onBlur={() => touch('r2Relation')}
              options={RELATIONS} placeholder="— Select —" />
          </FormGroup>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 mt-1">
          <FormGroup label="Address Line 1">
            <TextInput value={data.r2Addr1} onChange={v => onChange({ r2Addr1: v })} placeholder="House / Flat, Street" />
          </FormGroup>
          <FormGroup label="Address Line 2">
            <TextInput value={data.r2Addr2} onChange={v => onChange({ r2Addr2: v })} placeholder="Locality / Landmark" />
          </FormGroup>
          <FormGroup label="City">
            <TextInput value={data.r2City} onChange={v => onChange({ r2City: v })} placeholder="City" />
          </FormGroup>
          <FormGroup label="PIN Code">
            <TextInput value={data.r2Pin} onChange={v => onChange({ r2Pin: v })}
              inputMode="numeric" pattern="\d{6}" digitsOnly placeholder="6-digit PIN" maxLength={6} />
          </FormGroup>
        </div>
      </div>
    </div>
  )
}

// LoansController.UploadDocument enforces a fixed documentType whitelist —
// identity/address/income/bank_statement/salary_slip/itr/gst/property/other —
// and returns 400 "Invalid document type" for anything else (see
// LoanDocumentsCard's DOC_TYPE_VALUE, which hit and fixed this exact issue for
// the detail-page upload card). Step 8's document checklist renders ~90 name
// variants across products/employment types (LOAN_DOCS_MATRIX above), so
// rather than hand-maintain a 90-row map this infers the whitelisted type
// from keywords in the doc's display name — same category logic as Vanilla's
// _docInferMeta (efin-app.js:9818), just mapped onto the backend's enum
// instead of a UI icon/category.
export function mapDocNameToBackendType(name: string): string {
  const n = name.toLowerCase()
  if (/pan card|aadhaar|aadhar|passport|voter|driving licence|driving license|photograph|photo/.test(n)) return 'identity'
  if (/address proof/.test(n)) return 'address'
  if (/salary slip/.test(n)) return 'salary_slip'
  if (/bank statement|banking|current account/.test(n)) return 'bank_statement'
  if (/itr|form 16|computation sheet/.test(n)) return 'itr'
  if (/\bgst\b/.test(n)) return 'gst'
  if (/property|title deed|sale agreement|allotment|building plan|noc from|encumbrance|property tax|khata|chain of title/.test(n)) return 'property'
  if (/business vintage proof|employment proof|appointment letter|employee id|gross receipts|billing statements|practice|business registration|udyam|moa \/ aoa|partnership deed|stock statement|book debt/.test(n)) return 'income'
  return 'other'
}

// The three MANDATORY documents and their backend documentType, derived from
// the same whitelist-safe mapper as every other Step-8 doc (see
// mapDocNameToBackendType) so there is one source of truth for what's a valid
// documentType, not a hand-maintained value that can drift out of sync with
// the backend's allowlist. These are the business-critical docs the
// application cannot be submitted without, so they are uploaded to the draft
// loan the moment they are selected (refresh-safe), and restored from the
// server when a draft is resumed. Their types are 1:1 (unambiguous), which is
// what lets a resumed draft map a server document back to its wizard slot.
// Optional docs remain submit-time uploads (unchanged).
export const MANDATORY_DOC_TYPES: Record<string, string> = {
  salarySlip3mo: mapDocNameToBackendType('Last 3 Month Salary Slips'),
  bankStatement6mo: mapDocNameToBackendType('Last 6 Month Bank Statement'),
  // Self-employed applicants upload Business Vintage Proof instead of salary
  // slips (Vanilla DOC_MANDATORY_INCOME_SELFEMP). Previously mapped to
  // 'business_proof', which is NOT in the backend's allowlist — every
  // self-employed applicant's mandatory document upload was silently
  // rejected with 400 "Invalid document type" (both the immediate
  // draft-persist and the submit-time fallback use this same value). Fixed
  // to the whitelisted 'income' type via the shared mapper.
  bizVintageProof: mapDocNameToBackendType('Business Vintage Proof'),
}

// Gap-2: map a doc-item key/label to its applicant. The wizard already labels
// co-applicant documents (e.g. "Co-applicant Last 3 Month Salary Slips"); every
// other document belongs to the primary applicant. Used to tag uploads so the
// backend can isolate applicant vs co-applicant salary evidence.
export function docApplicantRole(key: string): 'Applicant' | 'CoApplicant' {
  return /co[-\s.]?applicant|coapp/i.test(key) ? 'CoApplicant' : 'Applicant'
}

// Client-side mirror of LoansController.UploadDocument's file restrictions
// (extension allowlist + [RequestSizeLimit(20 MB)]) so an invalid file is
// rejected immediately with a clear message instead of always failing with a
// 400 after the user has already picked it and waited on the request.
const ALLOWED_DOC_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.xlsx', '.csv']
const MAX_DOC_SIZE_BYTES = 20 * 1024 * 1024
export function validateDocFile(file: File): string | null {
  const ext = '.' + (file.name.split('.').pop() || '').toLowerCase()
  if (!ALLOWED_DOC_EXTENSIONS.includes(ext)) {
    return `File type '${ext}' is not allowed. Allowed types: PDF, JPG, PNG, XLSX, CSV.`
  }
  if (file.size > MAX_DOC_SIZE_BYTES) {
    return 'File is larger than 20 MB. Please upload a smaller file.'
  }
  return null
}

// Opens an already-uploaded Step-8 document in a new tab for preview — same
// authenticated-blob technique as LoanDocumentsCard's download(), just
// window.open instead of a forced <a download> so it previews rather than
// saves. fileRef is the server storage path ("{loanId}/{guid}.ext"); the
// download route keys off just the file name, so only the last path segment
// is sent.
async function previewLoanDocument(loanId: number, fileRef: string, onError: (msg: string) => void) {
  try {
    const fileName = fileRef.split(/[\\/]/).pop() ?? fileRef
    const res = await loansApi.downloadDocument(loanId, fileName)
    const url = URL.createObjectURL(res.data)
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  } catch {
    onError('Could not open this document for preview.')
  }
}

// NOTE: MandatoryDoc lives at module scope (not nested inside Step8). Defining
// a component inline inside another component's render body gives it a brand
// new identity on every render of the parent, so React treats it as a
// different component type each time and unmounts/remounts its DOM instead of
// reconciling it — that full unmount/remount is exactly what produced the
// blinking/flickering (upload boxes, borders, icons momentarily disappearing
// and reappearing) whenever `documents`/`errors` changed while on Step 8.
// Hoisting it here keeps a stable component identity across re-renders so
// React reconciles in place instead of remounting.
// `required=false` renders the same real upload control without the * or the
// "required" pill — previously every non-mandatory document type was a dead
// row reading "Upload after submit" with no input at all, so only 2 of the
// ~9 legacy document types could be attached during the wizard.
// Shape of a Step-8 mandatory doc already persisted to the draft loan —
// fileRef (the server storage path) is what makes the View/preview action
// possible; older callers that only have {id, name} still work (view button
// just doesn't render without it).
type UploadedDocInfo = { id: number; name: string; fileRef?: string }

function MandatoryDoc({ docKey, label, documents, onDocumentChange, errors, required = true, uploaded, loanId, uploading, onPreviewError }: {
  docKey: string; label: string
  documents: Record<string, File | null>
  onDocumentChange: (key: string, file: File | null) => void
  errors: Record<string, string>
  required?: boolean
  uploaded?: UploadedDocInfo
  loanId?: number
  uploading?: boolean
  onPreviewError: (msg: string) => void
}) {
  const file = documents[docKey]
  // "has a document" = a File picked this session OR one already saved to the
  // draft on the server (survives refresh).
  const displayName = file?.name ?? uploaded?.name
  const has = !!file || !!uploaded
  return (
    <div className={`group flex items-center justify-between gap-3 px-4 py-3 rounded-xl border transition-all ${
      has
        ? 'border-green-200 bg-green-50/60'
        : required
          ? 'border-red-100 bg-white hover:border-efin-blue/40 hover:bg-efin-blue/[0.03]'
          : 'border-gray-100 bg-white hover:border-efin-blue/30 hover:bg-efin-blue/[0.025]'
    }`}>
      {/* Left: icon + label */}
      <div className="flex items-center gap-3 min-w-0">
        <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-base ${
          has ? 'bg-green-100' : required ? 'bg-red-50' : 'bg-gray-100'
        }`}>
          {has ? '✅' : required ? '📄' : '📎'}
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-gray-800 leading-snug">
            {label}{required && <span className="text-red-500 ml-0.5">*</span>}
          </p>
          {displayName && (
            <p className="text-[11px] text-gray-500 truncate max-w-[200px] mt-0.5">{displayName}</p>
          )}
          {errors[docKey] && (
            <p className="mt-0.5 text-[11px] text-red-600 flex items-center gap-1"><AlertCircle size={10} />{errors[docKey]}</p>
          )}
        </div>
      </div>

      {/* Right: badge + actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`hidden sm:inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full ${
          uploading ? 'bg-blue-100 text-blue-700'
            : has ? 'bg-green-100 text-green-700'
            : required ? 'bg-red-50 text-red-500 border border-red-200'
            : 'bg-gray-100 text-gray-500'
        }`}>
          {uploading ? 'Saving…' : uploaded ? 'Saved ✓' : file ? 'Attached' : required ? 'Required' : 'Optional'}
        </span>
        {displayName && uploaded?.fileRef && loanId && (
          <button type="button" onClick={() => previewLoanDocument(loanId, uploaded.fileRef!, onPreviewError)}
            className="text-[11px] text-efin-blue hover:underline font-medium">View</button>
        )}
        {displayName && (
          <button type="button" onClick={() => onDocumentChange(docKey, null)}
            className="text-[11px] text-red-400 hover:text-red-600 font-medium">✕</button>
        )}
        <label className="cursor-pointer">
          <span className={`inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-colors ${
            has
              ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              : 'bg-efin-blue text-white hover:bg-[#064377]'
          }`}>
            {has ? '↩ Replace' : '↑ Upload'}
          </span>
          <input type="file" className="hidden" onChange={e => onDocumentChange(docKey, e.target.files?.[0] ?? null)} />
        </label>
      </div>
    </div>
  )
}

// Maps a completed Perfios analysis to the save DTO — identical shape/values to
// PerfiosAnalysisResults' save call (legacy pfv9ConfirmAttachment): String(abb)/
// String(span), fmtDate dates, first file's name.
function perfiosSaveRequest(u: PerfiosUploadResult): PerfiosReportSaveRequest {
  return {
    fileName: u.perFileData[0]?.fileName ?? null,
    averageBankBalance: u.abb != null ? String(u.abb) : null,
    span: u.span != null ? String(u.span) : null,
    totalTransactions: u.totalTxns || null,
    hasSalary: !!u.hasSalary,
    isValid: !!u.valid,
    firstTransactionDate: u.firstDate ? fmtPerfiosDate(u.firstDate) : null,
    lastTransactionDate: u.lastDate ? fmtPerfiosDate(u.lastDate) : null,
    manualReviewRequired: !!u.manualReviewRequired,
    staleDays: u.staledays || null,
    // Full report payload so the entire report reloads later on the loan's
    // Reports > Perfios Report tab, not just the summary (same as the detail
    // page's Confirm & Save).
    reportDataJson: serializePerfiosReport(u),
  }
}

// Salary Slip doc row — opens the full "Salary Slip Extraction — Auto Income
// Check" modal (legacy openPerfiosExtractionModal / #pse-overlay). The modal
// reads Net Pay + Month from up to 3 payslips; on confirm the first slip is
// attached as the loan document and the average net pay flows into wizard income.
function SalarySlipDoc({ docKey, label, documents, onDocumentChange, errors, uploaded, onIncome, loanId, uploading, onPreviewError }: {
  docKey: string; label: string
  documents: Record<string, File | null>
  onDocumentChange: (key: string, file: File | null) => void
  errors: Record<string, string>
  uploaded?: UploadedDocInfo
  onIncome: (amount: number) => void
  loanId?: number
  uploading?: boolean
  onPreviewError: (msg: string) => void
}) {
  const file = documents[docKey]
  const displayName = file?.name ?? uploaded?.name
  const has = !!file || !!uploaded
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  return (
    <div className={`group flex items-center justify-between gap-3 px-4 py-3 rounded-xl border transition-all ${
      has ? 'border-green-200 bg-green-50/60' : 'border-red-100 bg-white hover:border-efin-blue/40 hover:bg-efin-blue/[0.03]'
    }`}>
      {/* Left: icon + label */}
      <div className="flex items-center gap-3 min-w-0">
        <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-base ${has ? 'bg-green-100' : 'bg-amber-50'}`}>
          {has ? '✅' : '⚡'}
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-gray-800 leading-snug">
            {label}<span className="text-red-500 ml-0.5">*</span>
          </p>
          {displayName && (
            <p className="text-[11px] text-gray-500 truncate max-w-[200px] mt-0.5">{displayName}</p>
          )}
          {note && <p className="text-[11px] text-green-700 mt-0.5">{note}</p>}
          {errors[docKey] && (
            <p className="mt-0.5 text-[11px] text-red-600 flex items-center gap-1"><AlertCircle size={10} />{errors[docKey]}</p>
          )}
        </div>
      </div>

      {/* Right: badge + actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`hidden sm:inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full ${
          uploading ? 'bg-blue-100 text-blue-700'
            : has ? 'bg-green-100 text-green-700'
            : 'bg-red-50 text-red-500 border border-red-200'
        }`}>
          {uploading ? 'Saving…' : uploaded ? 'Saved ✓' : file ? 'Attached' : 'Required'}
        </span>
        {displayName && uploaded?.fileRef && loanId && (
          <button type="button" onClick={() => previewLoanDocument(loanId, uploaded.fileRef!, onPreviewError)}
            className="text-[11px] text-efin-blue hover:underline font-medium">View</button>
        )}
        {displayName && (
          <button type="button" onClick={() => { onDocumentChange(docKey, null); setNote(null) }}
            className="text-[11px] text-red-400 hover:text-red-600 font-medium">✕</button>
        )}
        <button type="button" onClick={() => setOpen(true)}
          className={`inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-colors ${
            has ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-efin-blue text-white hover:bg-[#064377]'
          }`}>
          ⚡ {has ? 'Re-upload' : 'Upload Document'}
        </button>
      </div>

      {open && (
        <Suspense fallback={null}>
          <SalarySlipExtractionModal
            onClose={() => setOpen(false)}
            onConfirm={(files, avgNet) => {
              if (files[0]) onDocumentChange(docKey, files[0])
              if (avgNet > 0) { onIncome(avgNet); setNote(`${files.length} slip${files.length !== 1 ? 's' : ''} read · avg net ${fmtINR(avgNet)}/mo → set as monthly income`) }
              setOpen(false)
            }}
          />
        </Suspense>
      )}
    </div>
  )
}

// Vanilla routes EVERY doc name containing "bank statement" or "banking"
// through the Perfios popup (efin-app.js:9536 markDocUploaded, :9937
// _docDrop, :10080 checklist render — all three gated on this exact test,
// with pfv9Open(itemId, docName) called regardless of whose statement it is
// or the statement period) — own salary-account, co-applicant's, and
// self-employed current/6-or-12-month current-account statements alike.
// Single source of truth for which Step-8 doc rows get the Perfios flow
// instead of a plain file input.
export function isBankStatementDocName(name: string): boolean {
  return /bank statement|banking/i.test(name)
}

// Formats a Perfios verification restored from the server (draft resume) the
// same way a fresh in-session result is formatted below, from the summary
// fields PerfiosController already returns (ABB/span/totalTransactions/
// isValid) — no fabricated data, no re-implementation of the full report.
function formatRestoredPerfiosSummary(r: PerfiosReport): string {
  const abb = r.averageBankBalance != null ? Math.round(Number(r.averageBankBalance)) : 0
  return `Perfios: ABB ${fmtINR(abb)} · ${r.span ?? '—'}d · ${r.totalTransactions ?? 0} txns · ${r.isValid ? 'Valid' : 'Needs review'}`
}

// Bank Statement doc row — opens the full Perfios v9 5-step analysis modal
// (legacy pfv9Open / perfios/index.html). On Confirm Attachment the statement is
// attached as the loan document and the finished report is handed up to persist
// once the loan id exists (post-submit) — matching legacy's attach-then-save.
// Reused for every bank-statement-labelled doc-item (own / co-applicant /
// current-account), not just the one mandatory slot — each rendered instance
// keeps its own `summary`/`open` state, so they process and display
// independently (mirrors legacy's per-doc-item _BFP_STORE keying).
function BankStatementDoc({ docKey, label, documents, onDocumentChange, errors, uploaded, onPerfios, restored, required = true, loanId, uploading, onPreviewError }: {
  docKey: string; label: string
  documents: Record<string, File | null>
  onDocumentChange: (key: string, file: File | null) => void
  errors: Record<string, string>
  uploaded?: UploadedDocInfo
  onPerfios: (docKey: string, result: PerfiosUploadResult) => void
  // Verification restored from the server for THIS doc-item on draft resume
  // (matched by file name — see the resume effect). Only seeds the badge; a
  // fresh in-session run always takes precedence and is never overwritten by
  // a late-arriving restore.
  restored?: PerfiosReport
  required?: boolean
  loanId?: number
  uploading?: boolean
  onPreviewError: (msg: string) => void
}) {
  const file = documents[docKey]
  const has = !!file || !!uploaded
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)

  // Seed the badge from a restored server-side verification once it arrives
  // (it resolves asynchronously, after mount) — but only if this doc-item
  // hasn't already produced a fresher in-session summary.
  useEffect(() => {
    if (restored && !summary) setSummary(formatRestoredPerfiosSummary(restored))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored])

  return (
    <div className={`group flex items-center justify-between gap-3 px-4 py-3 rounded-xl border transition-all ${
      summary || has
        ? 'border-green-200 bg-green-50/60'
        : required
          ? 'border-red-100 bg-white hover:border-efin-blue/40 hover:bg-efin-blue/[0.03]'
          : 'border-gray-100 bg-white hover:border-efin-blue/30 hover:bg-efin-blue/[0.025]'
    }`}>
      {/* Left: icon + label */}
      <div className="flex items-center gap-3 min-w-0">
        <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-base ${
          summary ? 'bg-green-100' : has ? 'bg-green-100' : required ? 'bg-blue-50' : 'bg-gray-100'
        }`}>
          {summary ? '✅' : has ? '🏦' : '🏦'}
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-gray-800 leading-snug">
            {label}{required && <span className="text-red-500 ml-0.5">*</span>}
          </p>
          {file && (
            <p className="text-[11px] text-gray-500 truncate max-w-[200px] mt-0.5">{file.name}</p>
          )}
          {summary && <p className="text-[11px] text-green-700 mt-0.5">{summary}</p>}
          {errors[docKey] && (
            <p className="mt-0.5 text-[11px] text-red-600 flex items-center gap-1"><AlertCircle size={10} />{errors[docKey]}</p>
          )}
        </div>
      </div>

      {/* Right: badge + actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`hidden sm:inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full ${
          uploading ? 'bg-blue-100 text-blue-700'
            : summary ? 'bg-green-100 text-green-700'
            : has ? 'bg-green-100 text-green-700'
            : required ? 'bg-red-50 text-red-500 border border-red-200'
            : 'bg-gray-100 text-gray-500'
        }`}>
          {uploading ? 'Saving…' : summary ? 'Perfios Verified ✓' : uploaded ? 'Saved ✓' : file ? 'Attached' : required ? 'Required' : 'Optional'}
        </span>
        {!file && uploaded?.fileRef && loanId && (
          <button type="button" onClick={() => previewLoanDocument(loanId, uploaded.fileRef!, onPreviewError)}
            className="text-[11px] text-efin-blue hover:underline font-medium">View</button>
        )}
        {file && (
          <button type="button" onClick={() => { onDocumentChange(docKey, null); setSummary(null) }}
            className="text-[11px] text-red-400 hover:text-red-600 font-medium">✕</button>
        )}
        <button type="button" onClick={() => setOpen(true)}
          className={`inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-colors ${
            has ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-efin-blue text-white hover:bg-[#064377]'
          }`}>
          🏦 {has ? 'Re-run Perfios' : 'Upload Statement'}
        </button>
      </div>

      {open && (
        <Suspense fallback={null}>
          <PerfiosModal
            onClose={() => setOpen(false)}
            onConfirm={(result, f) => {
              if (f) onDocumentChange(docKey, f)
              onPerfios(docKey, result)
              setSummary(`Perfios: ABB ${fmtINR(Math.round(result.abb))} · ${result.span}d · ${result.totalTxns} txns · ${result.valid ? 'Valid' : 'Needs review'}`)
              setOpen(false)
            }}
          />
        </Suspense>
      )}
    </div>
  )
}

function Step8({ documents, onDocumentChange, errors, uploadedDocs, empType, loanType, onIncome, onPerfios, perfiosRestored, loanId, uploadingKeys, onPreviewError }: {
  documents: Record<string, File | null>
  onDocumentChange: (key: string, file: File | null) => void
  errors: Record<string, string>
  uploadedDocs: Record<string, UploadedDocInfo>
  empType: string
  loanType: string
  onIncome: (amount: number) => void
  onPerfios: (docKey: string, result: PerfiosUploadResult) => void
  // Perfios verification restored on draft resume, keyed by doc-item key —
  // see the resume effect in the parent wizard component.
  perfiosRestored: Record<string, PerfiosReport>
  loanId?: number
  uploadingKeys: Record<string, boolean>
  // A preview/download failure (expired session, file removed server-side,
  // etc.) surfaces through the same shared upload-warning banner already
  // rendered above the wizard body, rather than a second ad-hoc error UI.
  onPreviewError: (msg: string) => void
}) {
  // Product + employment-type specific document checklist — Vanilla parity
  // (getWizardDocs / renderEnhancedDocChecklist). The list order (KYC → income
  // → product-specific) mirrors the matrix. Mandatory income docs render with
  // their stable persistence key + a "*"; everything else is optional, keyed by
  // its own name (uploaded at submit under that name as documentType).
  const docList = getWizardDocs(loanType, empType)
  // Required / Uploaded / Remaining progress — an at-a-glance summary of the
  // mandatory-document checklist (mandatory = docs that carry a stable
  // persistence key, i.e. the ones the submit gate enforces). A doc counts as
  // provided once it's attached locally or already persisted to the draft.
  // Presentation only — computeStepErrors still enforces each mandatory doc.
  const mandatoryNames = docList.filter(name => MANDATORY_DOC_KEY_BY_NAME[name] != null)
  const requiredTotal = mandatoryNames.length
  const uploadedCount = mandatoryNames.filter(name => {
    const key = MANDATORY_DOC_KEY_BY_NAME[name]
    return !!uploadedDocs[key] || !!documents[key]
  }).length
  const remaining = Math.max(0, requiredTotal - uploadedCount)
  const pct = requiredTotal > 0 ? Math.round((uploadedCount / requiredTotal) * 100) : 100
  return (
    <div className="space-y-4">
      {/* ── Intro text ── */}
      <p className="text-[13px] text-gray-500 leading-relaxed">
        Upload the documents for this loan product. Documents marked with <span className="text-red-500 font-semibold">*</span> are mandatory and must be uploaded before submission. Other documents can be added after submission.
        <span className="ml-1 text-gray-400">Accepted: PDF, JPG, PNG, XLSX, CSV — max 20 MB per file.</span>
      </p>

      {/* ── Progress tracker ── */}
      {requiredTotal > 0 && (
        <div className="rounded-2xl border overflow-hidden"
          style={{ borderColor: remaining === 0 ? '#bbf7d0' : '#e5e7eb', background: remaining === 0 ? '#f0fdf4' : '#f9fafb' }}>
          <div className="px-4 pt-3 pb-2">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-4 text-[12px]">
                <span className="text-gray-500">Required <span className="font-bold text-gray-800 ml-1">{requiredTotal}</span></span>
                <span className="text-green-600">Uploaded <span className="font-bold ml-1">{uploadedCount}</span></span>
                <span className={remaining > 0 ? 'text-amber-600' : 'text-gray-400'}>
                  Remaining <span className="font-bold ml-1">{remaining}</span>
                </span>
              </div>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                remaining === 0 ? 'bg-green-100 text-green-700' : 'bg-efin-blue/10 text-efin-blue'
              }`}>{pct}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className={`h-full rounded-full transition-all duration-500 ${remaining > 0 ? 'bg-efin-blue' : 'bg-green-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          {remaining === 0 && (
            <div className="px-4 py-2 border-t border-green-200 flex items-center gap-1.5 text-[12px] text-green-700 font-medium">
              <CheckCircle size={13} /> All mandatory documents provided — ready to continue.
            </div>
          )}
        </div>
      )}

      {/* ── Document list ── */}
      <div>
        <p className="wiz-section-head">Required Documents</p>
        <div className="space-y-2 mt-2">
          {docList.map(name => {
            // The map's keys ARE the mandatory doc names, so a hit ⟺ mandatory.
            const mandKey = MANDATORY_DOC_KEY_BY_NAME[name]
            const isMandatory = mandKey != null
            const key = mandKey ?? name
            const uploading = !!uploadingKeys[key]
            // Vanilla wizard doc-item behaviour: the Salary Slip item runs PSE
            // extraction; EVERY bank-statement-labelled doc-item runs Perfios —
            // own salary-account statement, co-applicant's, and self-employed
            // current-account statement (6 or 12 month) alike. Vanilla gates this
            // purely on the doc name (efin-app.js:9536 markDocUploaded, :9937
            // _docDrop, :10080 checklist render — all three test
            // /bank statement|banking/i with no exception for who/which account
            // it belongs to), not on whether the doc happens to be the one
            // mandatory bank-statement slot — mirrored here via
            // isBankStatementDocName so a co-applicant's or current-account
            // statement gets the same Perfios flow instead of falling through to
            // a plain file input.
            if (mandKey === 'salarySlip3mo') {
              return <SalarySlipDoc key={name} docKey={key} label={name} uploaded={uploadedDocs[key]} loanId={loanId} uploading={uploading} onPreviewError={onPreviewError}
                documents={documents} onDocumentChange={onDocumentChange} errors={errors} onIncome={onIncome} />
            }
            if (isBankStatementDocName(name)) {
              return <BankStatementDoc key={name} docKey={key} label={name} required={isMandatory} uploaded={uploadedDocs[key]} loanId={loanId} uploading={uploading} onPreviewError={onPreviewError}
                documents={documents} onDocumentChange={onDocumentChange} errors={errors} onPerfios={onPerfios} restored={perfiosRestored[key]} />
            }
            return (
              <MandatoryDoc key={name} docKey={key} label={name} required={isMandatory}
                uploaded={uploadedDocs[key]} loanId={loanId} uploading={uploading} onPreviewError={onPreviewError}
                documents={documents} onDocumentChange={onDocumentChange} errors={errors} />
            )
          })}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 mt-2 italic">
        Optional documents can also be added later from the application detail view.
      </p>
    </div>
  )
}

function Step9({ data, selectedBanks, onBanksChange }: {
  data: WizardData
  selectedBanks: SelectedBank[]
  onBanksChange: (banks: SelectedBank[]) => void
}) {
  // Resolve the applicant's employer (free-text compName captured in Step 5) to
  // a lender-master companyId so the matcher can evaluate employer-list (Path A)
  // banks. Vanilla did the same via the searchable company picker's hidden id;
  // here we match compName against the same master list (exact, case-insensitive
  // — a non-match is a custom employer, companyId omitted). Reuses the shared
  // ['lender-companies'] cache; survives draft-resume because compName persists.
  const { data: companies = [] } = useQuery({
    queryKey: ['lender-companies'],
    queryFn: () => lenderConfigApi.getCompanies().then(r => r.data.data ?? []),
    staleTime: 60_000,
  })
  const companyId = companies.find(
    c => c.name.trim().toLowerCase() === data.compName.trim().toLowerCase(),
  )?.id

  const P   = parseFloat(data.amount) || 0
  // Rate the applicant chose in Step 6, or undefined if left blank — passed
  // through so each card uses it when present, else falls back to that bank's
  // own min-CIBIL-derived rate (Vanilla's `wizRate || heuristic`).
  const enteredRate = parseFloat(data.loanRate) || undefined
  const n   = parseInt(data.tenure) || 24

  // ✅ Fallback UI if critical data missing. For Insurance the "amount"
  // field doesn't apply — Sum Assured is that product's headline figure —
  // so requiring `amount` here would have wrongly blocked every insurance
  // application at the final step.
  const isInsurance = data.loanType === 'insurance'
  const amountMissing = isInsurance ? !data.insSumAssured : !data.amount
  if (!data.mobile || !data.pan || !data.firstName || amountMissing) {
    return (
      <div className="space-y-4 p-6 bg-amber-50 border border-amber-200 rounded-lg">
        <p className="text-sm font-semibold text-amber-900 flex items-center gap-1.5"><AlertTriangle size={15} /> Incomplete Application</p>
        <p className="text-xs text-amber-800">Some required fields are missing. Please go back and complete all steps:</p>
        <ul className="text-xs text-amber-800 list-disc list-inside space-y-1">
          {!data.mobile && <li>Step 1: Contact information (Mobile, PAN)</li>}
          {!data.firstName && <li>Step 3: Personal Details (Name)</li>}
          {amountMissing && <li>Step 6: {isInsurance ? 'Insurance (Sum Assured)' : 'Loan Offer (Amount)'}</li>}
        </ul>
      </div>
    )
  }

  const maxBanks = data.loanType === 'personal_loan' ? 2 : 3
  return (
    <div className="space-y-5">
      {/* Step 9 is Vanilla's "Loan Analytics" — an ELIGIBILITY page only (no
          separate Review & Submit step, no product banner, no loan-figure
          tiles, no review notice). The step heading is rendered by the wizard
          body; here we show the sub-line and the eligible-lender match, which
          auto-runs on entering the step (Vanilla laLoadEligibility). */}
      <p className="text-[13px] text-gray-500 -mt-2">
        Based on the applicant's profile, the system identifies eligible lending banks.
        Select up to {maxBanks} bank{maxBanks > 1 ? 's' : ''} for this application.
      </p>

      <BankEligibilityMatch
        request={{
          loanType: data.loanType,
          salary: parseFloat(data.salary) || 0,
          obligations: parseFloat(data.obligations) || 0,
          empType: data.empType ? toEmploymentCode(data.empType) : undefined,
          compType: data.compType || undefined,
          companyId,
          cibil: data.cibil ? Number(data.cibil) : undefined,
          loanAmount: P > 0 ? P : undefined,
          tenure: n > 0 ? n : undefined,
          pinCode: data.zip || undefined,
          age: data.dob ? Math.floor((Date.now() - new Date(data.dob).getTime()) / 31557600000) : undefined,
        }}
        selected={selectedBanks}
        onSelectionChange={onBanksChange}
        interestRate={enteredRate}
      />
    </div>
  )
}

// ── Main Wizard Page ──────────────────────────────────────────────────────────
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
  }), [data, serverLoanId, step])

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
