import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { wizardApi, type WizardSubmitPayload } from '@/api/wizardApi'
import { loansApi } from '@/api/loansApi'
import { kycApi } from '@/api/kycApi'
import { useAuthStore } from '@/store/authStore'
import { CheckCircle, ChevronRight, ChevronLeft, AlertCircle, Upload, Loader, CheckCircle2, ClipboardList, IdCard, Search, Briefcase, Landmark, AlertTriangle } from 'lucide-react'

import { emiReducing as computeEmiReducing } from '@/utils/emi'
import { extractPanData, extractAadhaarData } from '@/utils/kycExtraction'
import { createDraftId } from '@/utils/draftStorage'
import { LOAN_KEYS } from '@/hooks/useLoans'

function fmtINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
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
const LOAN_TYPES = [
  { value: 'personal_loan', label: 'Personal Loan' },
  { value: 'business_loan', label: 'Business Loan' },
  { value: 'home_loan',     label: 'Home Loan' },
  { value: 'new_car',       label: 'New Car Loan' },
  { value: 'used_car',      label: 'Used Car Loan' },
  { value: 'education',     label: 'Education Loan' },
  { value: 'lap',           label: 'Loan Against Property' },
  { value: 'insurance',     label: 'Insurance' },
]

const HOME_TYPES = ['Owned', 'Rented', 'Company Provided', 'Parental', 'Other']

const EMP_TYPES = [
  { value: 'salaried',     label: 'Salaried' },
  { value: 'self_employed',label: 'Self Employed / Business' },
  { value: 'professional', label: 'Professional (CA/Doctor/Lawyer)' },
]

const COMP_TYPES = ['Private Limited', 'Public Limited', 'Government', 'PSU', 'Partnership', 'Proprietorship', 'LLP', 'Other']

const CHANNELS = [
  { value: 'direct', label: 'Direct' },
  { value: 'dsa',    label: 'DSA' },
  { value: 'agent',  label: 'Partner / Agent' },
  { value: 'online', label: 'Online' },
  { value: 'branch', label: 'Branch Walk-in' },
]

const RELATIONS = ['Father', 'Mother', 'Spouse', 'Sibling', 'Friend', 'Colleague', 'Neighbour', 'Other']

const STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana',
  'Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya',
  'Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura',
  'Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Chandigarh','Jammu and Kashmir','Ladakh',
  'Puducherry','Lakshadweep','Dadra and Nagar Haveli','Andaman and Nicobar Islands']

// ── Zod schemas per step ──────────────────────────────────────────────────────






const TOTAL_STEPS = 9

const STEP_LABELS = [
  'Contact & Assignment', 'KYC Verification', 'Personal Details',
  'Address', 'Employment', 'Initial Offer', 'References', 'Documents', 'Loan Analytics',
]

// ── Wizard State ──────────────────────────────────────────────────────────────
interface WizardData {
  // Step 1
  mobile: string; pan: string; location: string; salesPerson: string
  channel: string; dsaName: string
  // Phase 2A — actual FK ids selected alongside the display fields above.
  dsaId: string; partnerId: string
  // Step 2 (KYC - manual entry in React version)
  kycFirstName: string; kycLastName: string; kycDob: string
  kycAadhar: string; kycGender: string; kycFather: string
  kycStreet1: string; kycCity: string; kycState: string; kycPin: string
  // Step 3 — Personal
  firstName: string; middleName: string; lastName: string
  dob: string; gender: string; aadhar: string; email: string; phone: string; father: string
  // Step 4 — Address
  street1: string; street2: string; city: string; state: string; zip: string; homeType: string; sameAddr: boolean
  pStreet1: string; pStreet2: string; pCity: string; pState: string; pZip: string; pHomeType: string
  // Step 5 — Employment
  empType: string; compName: string; compType: string; salary: string; desig: string; officeEmail: string; obligations: string
  // Step 6 — Loan offer
  loanType: string; amount: string; loanRate: string; tenure: string; purpose: string; cibil: string
  // Step 7 — References
  r1Name: string; r1Mobile: string; r1Relation: string
  r2Name: string; r2Mobile: string; r2Relation: string
}

const emptyData: WizardData = {
  mobile: '', pan: '', location: '', salesPerson: '', channel: 'direct', dsaName: '',
  dsaId: '', partnerId: '',
  kycFirstName: '', kycLastName: '', kycDob: '', kycAadhar: '', kycGender: '', kycFather: '',
  kycStreet1: '', kycCity: '', kycState: '', kycPin: '',
  firstName: '', middleName: '', lastName: '', dob: '', gender: '', aadhar: '', email: '', phone: '', father: '',
  street1: '', street2: '', city: '', state: '', zip: '', homeType: 'Rented', sameAddr: false,
  pStreet1: '', pStreet2: '', pCity: '', pState: '', pZip: '', pHomeType: 'Rented',
  empType: '', compName: '', compType: '', salary: '', desig: '', officeEmail: '', obligations: '0',
  loanType: 'personal_loan', amount: '', loanRate: '12', tenure: '24', purpose: '', cibil: '',
  r1Name: '', r1Mobile: '', r1Relation: '', r2Name: '', r2Mobile: '', r2Relation: '',
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

  return {
    ...fallback,
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
    empType: p.empType ?? fallback.empType,
    compName: p.compName ?? fallback.compName,
    compType: p.compType ?? fallback.compType,
    salary: p.salary != null && p.salary > 0 ? String(p.salary) : fallback.salary,
    obligations: p.obligations != null ? String(p.obligations) : fallback.obligations,
    desig: p.desig ?? fallback.desig,
    officeEmail: p.officeEmail ?? fallback.officeEmail,
    loanType: p.loanType ?? fallback.loanType,
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
function computeStepErrors(
  step: number,
  data: WizardData,
  documents: Record<string, File | null>,
): Record<string, string> {
  const errs: Record<string, string> = {}

  if (step === 1) {
    if (!MOBILE_RE.test(data.mobile)) errs.mobile = 'Enter a valid 10-digit mobile number (numbers only)'
    if (!PAN_RE.test(data.pan)) errs.pan = 'Enter valid PAN (e.g. ABCDE1234F)'
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
    if (data.aadhar && !AADHAR_RE.test(data.aadhar)) errs.aadhar = 'Enter a valid 12-digit Aadhaar number'
    if (data.email && !EMAIL_RE.test(data.email)) errs.email = 'Enter a valid email address (e.g. name@example.com)'
    if (data.phone && !MOBILE_RE.test(data.phone)) errs.phone = 'Enter a valid 10-digit mobile number (numbers only)'
  }
  if (step === 4) {
    // Address step validation
    if (!data.street1) errs.street1 = 'Current street address is required'
    if (!data.city) errs.city = 'Current city is required'
    if (!data.state) errs.state = 'Current state is required'
    if (!PIN_RE.test(data.zip)) errs.zip = 'Enter a valid 6-digit PIN code (numbers only)'
    if (!data.homeType) errs.homeType = 'Home type is required'
    if (!data.sameAddr && data.pZip && !PIN_RE.test(data.pZip))
      errs.pZip = 'Enter a valid 6-digit PIN code (numbers only)'
  }
  if (step === 5) {
    if (!data.empType) errs.empType = 'Employment Type is required'
    if (!data.salary || parseFloat(data.salary) <= 0) errs.salary = 'Monthly income is required'
    if (data.obligations && parseFloat(data.obligations) < 0) errs.obligations = 'Obligations cannot be negative'
    if (data.empType !== 'self_employed') {
      if (!data.compName) errs.compName = 'Company name is required'
      if (!data.desig) errs.desig = 'Designation is required'
      if (!data.officeEmail) errs.officeEmail = 'Official Email ID is required'
      else if (!EMAIL_RE.test(data.officeEmail)) errs.officeEmail = 'Enter a valid email address (e.g. name@company.com)'
    }
  }
  if (step === 6) {
    if (!data.loanType) errs.loanType = 'Loan type is required'
    if (!data.amount || parseFloat(data.amount) <= 0) errs.amount = 'Loan amount must be greater than 0'
    if (!data.loanRate || parseFloat(data.loanRate) <= 0) errs.loanRate = 'Interest rate must be greater than 0'
    if (!data.tenure || !/^\d+$/.test(data.tenure) || parseInt(data.tenure) <= 0 || parseInt(data.tenure) > 360)
      errs.tenure = 'Tenure must be a whole number between 1 and 360 months'
    if (!data.purpose) errs.purpose = 'Loan purpose is required'
    if (data.cibil && (parseInt(data.cibil) < 300 || parseInt(data.cibil) > 900))
      errs.cibil = 'CIBIL score must be between 300 and 900'
  }
  if (step === 7) {
    // References - at least one reference required
    const hasRef1 = data.r1Name && data.r1Mobile && data.r1Relation
    const hasRef2 = data.r2Name && data.r2Mobile && data.r2Relation
    if (!hasRef1 && !hasRef2) {
      errs.references = 'At least one reference is required'
    }
    if (data.r1Name && !data.r1Mobile) errs.r1Mobile = 'Reference 1 mobile is required'
    else if (data.r1Mobile && !MOBILE_RE.test(data.r1Mobile)) errs.r1Mobile = 'Enter a valid 10-digit mobile number'
    if (data.r2Name && !data.r2Mobile) errs.r2Mobile = 'Reference 2 mobile is required'
    else if (data.r2Mobile && !MOBILE_RE.test(data.r2Mobile)) errs.r2Mobile = 'Enter a valid 10-digit mobile number'
  }
  if (step === 8) {
    // Mandatory documents - application cannot proceed/submit without these
    if (!documents.salarySlip3mo) errs.salarySlip3mo = 'Last 3 Month Salary Slips are required'
    if (!documents.bankStatement6mo) errs.bankStatement6mo = 'Last 6 Month Bank Statement is required'
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
function FormGroup({ label, required, error, children }: {
  label: string; required?: boolean; error?: string; children: React.ReactNode
}) {
  return (
    <div className="mb-4">
      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
        {label}{required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600 flex items-center gap-1"><AlertCircle size={11} />{error}</p>}
    </div>
  )
}

function TextInput({
  value, onChange, onBlur, placeholder, type = 'text', inputMode, pattern, maxLength, minLength,
  className = '', digitsOnly, decimalOnly,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string
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
      type={type}
      inputMode={inputMode}
      pattern={pattern}
      value={value}
      onChange={e => onChange(filter(e.target.value))}
      onBlur={onBlur}
      placeholder={placeholder}
      maxLength={maxLength}
      minLength={minLength}
      className={`w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${className}`}
    />
  )
}

function SelectInput({ value, onChange, onBlur, options, placeholder }: {
  value: string; onChange: (v: string) => void
  // See TextInput.onBlur — same purpose for dropdowns (e.g. a required
  // Location/State select the person opened and left on the placeholder).
  onBlur?: () => void
  options: Array<{ value: string; label: string } | string>; placeholder?: string
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onBlur}
      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
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

  const salesUsers = (usersResp ?? []).filter(u => ['Sales', 'Manager', 'Admin'].includes(u.role))

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
      <FormGroup label="Mobile Number" required error={errors.mobile}>
        <TextInput value={data.mobile} onChange={v => onChange({ mobile: v })} onBlur={() => touch('mobile')}
          placeholder="10-digit mobile" maxLength={10} minLength={10}
          type="tel" inputMode="numeric" pattern="\d{10}" digitsOnly />
      </FormGroup>

      <FormGroup label="PAN Card Number" required error={errors.pan}>
        <TextInput value={data.pan} onChange={v => onChange({ pan: v.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
          onBlur={() => touch('pan')}
          placeholder="ABCDE1234F" maxLength={10} minLength={10}
          pattern="[A-Z]{5}[0-9]{4}[A-Z]" className="uppercase font-mono" />
      </FormGroup>

      <FormGroup label="Location" required error={errors.location}>
        <SelectInput
          value={data.location}
          onChange={v => onChange({ location: v })}
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
          options={salesUsers.map(u => ({ value: u.fullName, label: u.fullName }))}
          placeholder="— Select Sales Person —"
        />
      </FormGroup>

      <FormGroup label="Channel">
        <SelectInput value={data.channel}
          onChange={v => onChange({ channel: v, dsaName: '', dsaId: '', partnerId: '' })}
          options={CHANNELS} />
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

      {data.channel === 'agent' && (
        <FormGroup label="Partner Name" required error={errors.partnerId}>
          <SelectInput
            value={data.partnerId}
            onChange={v => onChange({ partnerId: v })}
            onBlur={() => touch('partnerId')}
            options={partnerList.map(p => ({ value: String(p.id), label: `${p.name} (${p.code})` }))}
            placeholder="— Select Partner —"
          />
        </FormGroup>
      )}
    </div>
  )
}

function Step2({ data, onChange, errors, touch, touched }: {
  data: WizardData; onChange: (f: Partial<WizardData>) => void; errors: Record<string, string>
  touch: (field: string) => void; touched: Record<string, boolean>
}) {
  const [panImages, setPanImages] = useState<File[]>([])
  const [aadhaarImages, setAadhaarImages] = useState<File[]>([])
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

  const extractPan = useMutation({
    mutationFn: async () => {
      if (!panImages.length) throw new Error('No PAN images selected')
      setExtractionStatus(s => ({ ...s, pan: { status: 'loading' } }))

      try {
        const base64Images = await Promise.all(panImages.map(fileToBase64))
        const response = await kycApi.extractFromImages({
          documentType: 'PAN',
          images: base64Images.map((data, i) => ({
            mediaType: panImages[i].type,
            data,
          })),
          prompt: `Extract PAN card information. Return ONLY the following fields in this exact format:
FIRST NAME: <first name>
LAST NAME: <last name>
FATHER'S NAME: <father's name>

Extract exactly what is on the card. Be accurate.`,
        })

        if (!response.data.success) {
          throw new Error(response.data.error || 'Extraction failed')
        }

        // Parse extracted text
        const panData = extractPanData(response.data.text || '')
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
      if (!aadhaarImages.length) throw new Error('No Aadhaar images selected')
      setExtractionStatus(s => ({ ...s, aadhaar: { status: 'loading' } }))

      try {
        const base64Images = await Promise.all(aadhaarImages.map(fileToBase64))
        const response = await kycApi.extractFromImages({
          documentType: 'AADHAAR',
          images: base64Images.map((data, i) => ({
            mediaType: aadhaarImages[i].type,
            data,
          })),
          prompt: `Extract Aadhaar card information. Return ONLY the following fields in this exact format:
AADHAAR NUMBER: <12 digit number>
DATE OF BIRTH: <DD/MM/YYYY>
GENDER: <Male/Female/Other>
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
        // Same touched-field precedence as extractPan above.
        onChange({
          kycAadhar: aadhaarData.aadhaarNumber,
          kycDob: aadhaarData.dateOfBirth,
          kycGender: aadhaarData.gender,
          kycCity: aadhaarData.city,
          kycState: aadhaarData.state,
          kycPin: aadhaarData.pinCode,
          ...(!touched.aadhar ? { aadhar: aadhaarData.aadhaarNumber } : {}),
          ...(!touched.dob ? { dob: aadhaarData.dateOfBirth } : {}),
          ...(!touched.gender ? { gender: aadhaarData.gender } : {}),
          ...(!touched.city ? { city: aadhaarData.city } : {}),
          ...(!touched.state ? { state: aadhaarData.state } : {}),
          ...(!touched.zip ? { zip: aadhaarData.pinCode } : {}),
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

  return (
    <div>
      <div className="mb-5 p-4 bg-blue-50 rounded-xl border border-blue-100 text-sm text-blue-700">
        <p className="font-semibold mb-1">KYC Verification</p>
        <p className="text-xs mb-2">
          Upload clear photos of your PAN and Aadhaar cards. The system will extract data automatically using AI.
          {!kycStatus?.configured && ' Note: AI extraction is not configured. Please enter data manually.'}
        </p>
        <p className="text-xs font-medium text-blue-600">All fields are editable — correct any extracted data as needed.</p>
      </div>

      {/* PAN Card Upload */}
      <div className="mb-6 p-4 border border-gray-200 rounded-lg bg-gray-50">
        <p className="text-xs font-semibold text-gray-600 uppercase mb-3 flex items-center gap-2">
          <span className="flex items-center gap-1"><ClipboardList size={14} /> PAN Card</span>
          {extractionStatus.pan?.status === 'success' && (
            <span className="flex items-center gap-1 text-green-600 text-xs font-normal">
              <CheckCircle2 size={14} /> Extracted
            </span>
          )}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* File upload */}
          <div>
            <label className="block mb-2">
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
                <Upload size={20} className="mx-auto mb-2 text-gray-400" />
                <p className="text-xs font-medium text-gray-600">Click to upload PAN card photo</p>
                <p className="text-xs text-gray-400 mt-1">JPG, PNG (clear image)</p>
              </div>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={e => handlePanFilesSelect(e.target.files)}
                className="hidden"
              />
            </label>
            {panImages.length > 0 && (
              <div className="text-xs text-gray-600 mt-2">
                {panImages.length} image(s) selected
              </div>
            )}
          </div>

          {/* Extract button */}
          <div className="flex items-end">
            <button
              onClick={() => extractPan.mutate()}
              disabled={
                !panImages.length ||
                extractPan.isPending ||
                !kycStatus?.configured
              }
              className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
            >
              {extractPan.isPending ? (
                <>
                  <Loader size={14} className="animate-spin" /> Extracting...
                </>
              ) : (
                <><Search size={14} /> Extract Data</>
              )}
            </button>
          </div>
        </div>

        {extractionStatus.pan?.message && (
          <div
            className={`mt-3 p-2 rounded text-xs ${
              extractionStatus.pan.status === 'success'
                ? 'bg-green-100 text-green-700'
                : extractionStatus.pan.status === 'error'
                ? 'bg-red-100 text-red-700'
                : 'bg-yellow-100 text-yellow-700'
            }`}
          >
            {extractionStatus.pan.message}
          </div>
        )}

        {/* PAN Fields */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4 mt-4">
          <FormGroup label="First Name (from PAN)" error={errors.kycFirstName}>
            <TextInput value={data.kycFirstName} onChange={v => onChange({ kycFirstName: v, firstName: v })}
              onBlur={() => touch('kycFirstName')}
              placeholder="—" />
          </FormGroup>
          <FormGroup label="Last Name (from PAN)">
            <TextInput value={data.kycLastName} onChange={v => onChange({ kycLastName: v, lastName: v })}
              placeholder="—" />
          </FormGroup>
          <FormGroup label="Father's Name">
            <TextInput value={data.kycFather} onChange={v => onChange({ kycFather: v, father: v })}
              placeholder="—" />
          </FormGroup>
        </div>
      </div>

      {/* Aadhaar Card Upload */}
      <div className="mb-4 p-4 border border-gray-200 rounded-lg bg-gray-50">
        <p className="text-xs font-semibold text-gray-600 uppercase mb-3 flex items-center gap-2">
          <span className="flex items-center gap-1"><IdCard size={14} /> Aadhaar Card</span>
          {extractionStatus.aadhaar?.status === 'success' && (
            <span className="flex items-center gap-1 text-green-600 text-xs font-normal">
              <CheckCircle2 size={14} /> Extracted
            </span>
          )}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* File upload */}
          <div>
            <label className="block mb-2">
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
                <Upload size={20} className="mx-auto mb-2 text-gray-400" />
                <p className="text-xs font-medium text-gray-600">Click to upload Aadhaar photo</p>
                <p className="text-xs text-gray-400 mt-1">JPG, PNG (both sides clear)</p>
              </div>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={e => handleAadhaarFilesSelect(e.target.files)}
                className="hidden"
              />
            </label>
            {aadhaarImages.length > 0 && (
              <div className="text-xs text-gray-600 mt-2">
                {aadhaarImages.length} image(s) selected
              </div>
            )}
          </div>

          {/* Extract button */}
          <div className="flex items-end">
            <button
              onClick={() => extractAadhaar.mutate()}
              disabled={
                !aadhaarImages.length ||
                extractAadhaar.isPending ||
                !kycStatus?.configured
              }
              className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
            >
              {extractAadhaar.isPending ? (
                <>
                  <Loader size={14} className="animate-spin" /> Extracting...
                </>
              ) : (
                <><Search size={14} /> Extract Data</>
              )}
            </button>
          </div>
        </div>

        {extractionStatus.aadhaar?.message && (
          <div
            className={`mt-3 p-2 rounded text-xs ${
              extractionStatus.aadhaar.status === 'success'
                ? 'bg-green-100 text-green-700'
                : extractionStatus.aadhaar.status === 'error'
                ? 'bg-red-100 text-red-700'
                : 'bg-yellow-100 text-yellow-700'
            }`}
          >
            {extractionStatus.aadhaar.message}
          </div>
        )}

        {/* Aadhaar Fields */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4 mt-4">
          <FormGroup label="Aadhaar Number" required error={errors.kycAadhar}>
            <TextInput value={data.kycAadhar}
              onChange={v => onChange({ kycAadhar: v, aadhar: v })}
              onBlur={() => touch('kycAadhar')}
              placeholder="XXXXXXXXXXXX" maxLength={12} minLength={12}
              inputMode="numeric" pattern="\d{12}" digitsOnly
              className="font-mono" />
          </FormGroup>
          <FormGroup label="Date of Birth">
            <TextInput value={data.kycDob} onChange={v => onChange({ kycDob: v, dob: v })}
              placeholder="DD/MM/YYYY" />
          </FormGroup>
          <FormGroup label="Gender">
            <SelectInput value={data.kycGender}
              onChange={v => onChange({ kycGender: v, gender: v })}
              options={['Male', 'Female', 'Other']} placeholder="—" />
          </FormGroup>
          <FormGroup label="City / District">
            <TextInput value={data.kycCity} onChange={v => onChange({ kycCity: v, city: v })}
              placeholder="—" />
          </FormGroup>
          <FormGroup label="State">
            <TextInput value={data.kycState} onChange={v => onChange({ kycState: v, state: v })}
              placeholder="—" />
          </FormGroup>
          <FormGroup label="PIN Code" error={errors.kycPin}>
            <TextInput value={data.kycPin} onChange={v => onChange({ kycPin: v, zip: v })}
              onBlur={() => touch('kycPin')}
              placeholder="6-digit PIN" maxLength={6} minLength={6}
              inputMode="numeric" pattern="\d{6}" digitsOnly />
          </FormGroup>
        </div>
      </div>
    </div>
  )
}

function Step3({ data, onChange, errors, touch }: {
  data: WizardData; onChange: (f: Partial<WizardData>) => void; errors: Record<string, string>
  touch: (field: string) => void
}) {
  return (
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
          options={['Male', 'Female', 'Other']} placeholder="— Select —" />
      </FormGroup>
      <FormGroup label="Aadhaar Number" error={errors.aadhar}>
        <TextInput value={data.aadhar} onChange={v => onChange({ aadhar: v })} onBlur={() => touch('aadhar')}
          placeholder="12-digit Aadhaar" maxLength={12} minLength={12}
          inputMode="numeric" pattern="\d{12}" digitsOnly className="font-mono" />
      </FormGroup>
      <FormGroup label="Email Address" error={errors.email}>
        <TextInput value={data.email} onChange={v => onChange({ email: v })} onBlur={() => touch('email')}
          type="email" inputMode="email" placeholder="email@example.com" />
      </FormGroup>
      <FormGroup label="Alternate Phone" error={errors.phone}>
        <TextInput value={data.phone} onChange={v => onChange({ phone: v })} onBlur={() => touch('phone')}
          type="tel" inputMode="numeric" pattern="\d{10}" digitsOnly
          placeholder="10-digit alternate number" maxLength={10} minLength={10} />
      </FormGroup>
      <FormGroup label="Father's Name">
        <TextInput value={data.father} onChange={v => onChange({ father: v })}
          placeholder="Father's name" />
      </FormGroup>
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
      <p className="text-xs font-semibold text-gray-500 uppercase mb-4">Current Address</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
        <FormGroup label="House / Flat No." required error={errors.street1}>
          <TextInput value={data.street1} onChange={v => onChange({ street1: v })}
            onBlur={() => touch('street1')} placeholder="Flat no, Floor" />
        </FormGroup>
        <FormGroup label="Street & Locality">
          <TextInput value={data.street2} onChange={v => onChange({ street2: v })} placeholder="Road, Area, Colony" />
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

      <div className="mt-5">
        <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-gray-600">
          <input type="checkbox" checked={data.sameAddr}
            onChange={e => handleSameAddr(e.target.checked)}
            className="w-4 h-4 accent-blue-600" />
          Same as current address
        </label>
      </div>

      {!data.sameAddr && (
        <>
          <p className="text-xs font-semibold text-gray-500 uppercase mt-6 mb-4">Permanent Address</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            <FormGroup label="House / Flat No.">
              <TextInput value={data.pStreet1} onChange={v => onChange({ pStreet1: v })} placeholder="Flat no, Floor" />
            </FormGroup>
            <FormGroup label="Street & Locality">
              <TextInput value={data.pStreet2} onChange={v => onChange({ pStreet2: v })} placeholder="Road, Area, Colony" />
            </FormGroup>
            <FormGroup label="City">
              <TextInput value={data.pCity} onChange={v => onChange({ pCity: v })} placeholder="City" />
            </FormGroup>
            <FormGroup label="Pin Code" error={errors.pZip}>
              <TextInput value={data.pZip} onChange={v => onChange({ pZip: v })} onBlur={() => touch('pZip')}
                placeholder="6-digit pin" maxLength={6} minLength={6}
                inputMode="numeric" pattern="\d{6}" digitsOnly />
            </FormGroup>
            <FormGroup label="State">
              <SelectInput value={data.pState} onChange={v => onChange({ pState: v })}
                options={STATES} placeholder="— Select State —" />
            </FormGroup>
            <FormGroup label="Home Type">
              <SelectInput value={data.pHomeType} onChange={v => onChange({ pHomeType: v })}
                options={HOME_TYPES} placeholder="— Select —" />
            </FormGroup>
          </div>
        </>
      )}
    </div>
  )
}

function Step5({ data, onChange, errors, touch }: {
  data: WizardData; onChange: (f: Partial<WizardData>) => void; errors: Record<string, string>
  touch: (field: string) => void
}) {
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
        <FormGroup label="Employment Type" required error={errors.empType}>
          <SelectInput value={data.empType} onChange={v => onChange({ empType: v })} onBlur={() => touch('empType')}
            options={EMP_TYPES} placeholder="— Select —" />
        </FormGroup>
        <FormGroup label="Gross Monthly Income (₹)" required error={errors.salary}>
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

      {(data.empType === 'salaried' || data.empType === '') && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 mt-2">
          <FormGroup label="Employer / Company Name" required error={errors.compName}>
            <TextInput value={data.compName} onChange={v => onChange({ compName: v })}
              onBlur={() => touch('compName')} placeholder="e.g. Tata Consultancy" />
          </FormGroup>
          <FormGroup label="Company Type">
            <SelectInput value={data.compType} onChange={v => onChange({ compType: v })}
              options={COMP_TYPES} placeholder="— Select —" />
          </FormGroup>
          <FormGroup label="Official Email ID" required error={errors.officeEmail}>
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
          <FormGroup label="Company / Business Type">
            <SelectInput value={data.compType} onChange={v => onChange({ compType: v })}
              options={COMP_TYPES} placeholder="— Select —" />
          </FormGroup>
        </div>
      )}
    </div>
  )
}

function Step6({ data, onChange, errors, touch }: {
  data: WizardData; onChange: (f: Partial<WizardData>) => void; errors: Record<string, string>
  touch: (field: string) => void
}) {
  const P   = parseFloat(data.amount) || 0
  const r   = parseFloat(data.loanRate) || 0
  const n   = parseInt(data.tenure) || 0
  const { emi, total, totalInt } = computeEmiReducing(P, r, n)

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
        <FormGroup label="Loan Type" required error={errors.loanType}>
          <SelectInput value={data.loanType} onChange={v => onChange({ loanType: v })} onBlur={() => touch('loanType')}
            options={LOAN_TYPES} />
        </FormGroup>
        <FormGroup label="CIBIL Score" error={errors.cibil}>
          <TextInput value={data.cibil} onChange={v => onChange({ cibil: v })} onBlur={() => touch('cibil')}
            inputMode="numeric" pattern="\d{3}" digitsOnly maxLength={3}
            placeholder="e.g. 750" />
        </FormGroup>
        <FormGroup label="Loan Amount (₹)" required error={errors.amount}>
          <TextInput value={data.amount} onChange={v => onChange({ amount: v })} onBlur={() => touch('amount')}
            inputMode="decimal" decimalOnly placeholder="e.g. 500000" />
        </FormGroup>
        <FormGroup label="Interest Rate (% p.a.)" required error={errors.loanRate}>
          <TextInput value={data.loanRate} onChange={v => onChange({ loanRate: v })} onBlur={() => touch('loanRate')}
            inputMode="decimal" decimalOnly placeholder="e.g. 12.5" />
        </FormGroup>
        <FormGroup label="Tenure (months)" required error={errors.tenure}>
          <TextInput value={data.tenure} onChange={v => onChange({ tenure: v })} onBlur={() => touch('tenure')}
            inputMode="numeric" pattern="\d+" digitsOnly maxLength={3}
            placeholder="e.g. 24" />
        </FormGroup>
        <FormGroup label="Purpose / Remarks" required error={errors.purpose}>
          <TextInput value={data.purpose} onChange={v => onChange({ purpose: v })} onBlur={() => touch('purpose')}
            placeholder="Loan purpose" />
        </FormGroup>
      </div>

      {emi > 0 && (
        <div className="mt-5 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-100">
          <p className="text-xs font-semibold text-blue-600 uppercase mb-3">EMI Calculator (Reducing Balance)</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-gray-500">Monthly EMI</p>
              <p className="text-lg font-bold text-blue-700">{fmtINR(emi)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Principal</p>
              <p className="text-sm font-semibold text-gray-800">{fmtINR(P)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Total Interest</p>
              <p className="text-sm font-semibold text-gray-800">{fmtINR(totalInt)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Total Payable</p>
              <p className="text-sm font-semibold text-gray-800">{fmtINR(total)}</p>
            </div>
          </div>
        </div>
      )}
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
        <p className="text-xs font-semibold text-gray-500 uppercase mb-4">Reference 1</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4">
          <FormGroup label="Name">
            <TextInput value={data.r1Name} onChange={v => onChange({ r1Name: v })} onBlur={() => touch('r1Name')}
              placeholder="Full name" />
          </FormGroup>
          <FormGroup label="Mobile" error={errors.r1Mobile}>
            <TextInput value={data.r1Mobile} onChange={v => onChange({ r1Mobile: v })} onBlur={() => touch('r1Mobile')}
              type="tel" inputMode="numeric" pattern="\d{10}" digitsOnly
              placeholder="10-digit mobile" maxLength={10} minLength={10} />
          </FormGroup>
          <FormGroup label="Relationship">
            <SelectInput value={data.r1Relation} onChange={v => onChange({ r1Relation: v })}
              onBlur={() => touch('r1Relation')}
              options={RELATIONS} placeholder="— Select —" />
          </FormGroup>
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase mb-4">Reference 2</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4">
          <FormGroup label="Name">
            <TextInput value={data.r2Name} onChange={v => onChange({ r2Name: v })} onBlur={() => touch('r2Name')}
              placeholder="Full name" />
          </FormGroup>
          <FormGroup label="Mobile" error={errors.r2Mobile}>
            <TextInput value={data.r2Mobile} onChange={v => onChange({ r2Mobile: v })} onBlur={() => touch('r2Mobile')}
              type="tel" inputMode="numeric" pattern="\d{10}" digitsOnly
              placeholder="10-digit mobile" maxLength={10} minLength={10} />
          </FormGroup>
          <FormGroup label="Relationship">
            <SelectInput value={data.r2Relation} onChange={v => onChange({ r2Relation: v })}
              onBlur={() => touch('r2Relation')}
              options={RELATIONS} placeholder="— Select —" />
          </FormGroup>
        </div>
      </div>
    </div>
  )
}

const OPTIONAL_DOCS_BEFORE = ['PAN Card', 'Aadhaar Card (Front)', 'Aadhaar Card (Back)']
const OPTIONAL_DOCS_AFTER = ['Form 16 / ITR', 'Employment Letter / Offer Letter', 'Address Proof', 'Photo']

// NOTE: MandatoryDoc lives at module scope (not nested inside Step8). Defining
// a component inline inside another component's render body gives it a brand
// new identity on every render of the parent, so React treats it as a
// different component type each time and unmounts/remounts its DOM instead of
// reconciling it — that full unmount/remount is exactly what produced the
// blinking/flickering (upload boxes, borders, icons momentarily disappearing
// and reappearing) whenever `documents`/`errors` changed while on Step 8.
// Hoisting it here keeps a stable component identity across re-renders so
// React reconciles in place instead of remounting.
function MandatoryDoc({ docKey, label, documents, onDocumentChange, errors }: {
  docKey: string; label: string
  documents: Record<string, File | null>
  onDocumentChange: (key: string, file: File | null) => void
  errors: Record<string, string>
}) {
  const file = documents[docKey]
  return (
    <div className="p-3 border border-dashed border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50/30 transition-colors">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-sm text-gray-700">
          {label}<span className="text-red-500 ml-1">*</span>
        </span>
        <span className={`text-xs px-2 py-1 rounded ${file ? 'bg-green-100 text-green-700' : 'bg-red-50 text-red-500'}`}>
          1 document required
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <label className="cursor-pointer">
          <span className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 inline-block">
            {file ? 'Replace File' : 'Upload'}
          </span>
          <input
            type="file"
            className="hidden"
            onChange={e => onDocumentChange(docKey, e.target.files?.[0] ?? null)}
          />
        </label>
        {file && <span className="text-xs text-gray-600 truncate max-w-[240px]">{file.name}</span>}
      </div>
      {errors[docKey] && (
        <p className="mt-1 text-xs text-red-600 flex items-center gap-1"><AlertCircle size={11} />{errors[docKey]}</p>
      )}
    </div>
  )
}

function Step8({ documents, onDocumentChange, errors }: {
  documents: Record<string, File | null>
  onDocumentChange: (key: string, file: File | null) => void
  errors: Record<string, string>
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 mb-4">Upload required documents. Documents marked with * are mandatory and must be uploaded before the application can be submitted. Other documents can be uploaded after application submission.</p>

      {OPTIONAL_DOCS_BEFORE.map(doc => (
        <div key={doc} className="flex items-center justify-between p-3 border border-dashed border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50/30 transition-colors">
          <span className="text-sm text-gray-700">{doc}</span>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">Upload after submit</span>
        </div>
      ))}

      <p className="text-xs font-semibold text-gray-500 uppercase mt-5 mb-2 flex items-center gap-1.5"><Briefcase size={13} /> Income &amp; Employment</p>
      <MandatoryDoc docKey="salarySlip3mo" label="Last 3 Month Salary Slips"
        documents={documents} onDocumentChange={onDocumentChange} errors={errors} />

      <p className="text-xs font-semibold text-gray-500 uppercase mt-5 mb-2 flex items-center gap-1.5"><Landmark size={13} /> Banking</p>
      <MandatoryDoc docKey="bankStatement6mo" label="Last 6 Month Bank Statement"
        documents={documents} onDocumentChange={onDocumentChange} errors={errors} />

      <p className="text-xs font-semibold text-gray-500 uppercase mt-5 mb-2">Other Documents</p>
      {OPTIONAL_DOCS_AFTER.map(doc => (
        <div key={doc} className="flex items-center justify-between p-3 border border-dashed border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50/30 transition-colors">
          <span className="text-sm text-gray-700">{doc}</span>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">Upload after submit</span>
        </div>
      ))}

      <p className="text-xs text-gray-500 mt-4">
        Non-mandatory document uploads are handled in the application detail view after submission. This matches the existing workflow.
      </p>
    </div>
  )
}

function Step9({ data }: { data: WizardData }) {
  const P   = parseFloat(data.amount) || 0
  const r   = parseFloat(data.loanRate) || 12
  const n   = parseInt(data.tenure) || 24
  const { emi, total, totalInt } = P > 0 && n > 0 ? computeEmiReducing(P, r, n) : { emi: 0, total: 0, totalInt: 0 }
  const loanLabel = LOAN_TYPES.find(t => t.value === data.loanType)?.label ?? data.loanType

  // ✅ Fallback UI if critical data missing
  if (!data.mobile || !data.pan || !data.firstName || !data.amount) {
    return (
      <div className="space-y-4 p-6 bg-amber-50 border border-amber-200 rounded-lg">
        <p className="text-sm font-semibold text-amber-900 flex items-center gap-1.5"><AlertTriangle size={15} /> Incomplete Application</p>
        <p className="text-xs text-amber-800">Some required fields are missing. Please go back and complete all steps:</p>
        <ul className="text-xs text-amber-800 list-disc list-inside space-y-1">
          {!data.mobile && <li>Step 1: Contact information (Mobile, PAN)</li>}
          {!data.firstName && <li>Step 3: Personal Details (Name)</li>}
          {!data.amount && <li>Step 6: Loan Offer (Amount)</li>}
        </ul>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Application Summary & Loan Analytics</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          ['Applicant Name',   [data.firstName, data.middleName, data.lastName].filter(Boolean).join(' ') || '—'],
          ['Mobile',           data.mobile || '—'],
          ['PAN',              data.pan || '—'],
          ['Email',            data.email || '—'],
          ['Date of Birth',    data.dob || '—'],
          ['Aadhaar Number',   data.aadhar || '—'],
          ['Loan Type',        loanLabel],
          ['Loan Amount',      P > 0 ? fmtINR(P) : '—'],
          ['Interest Rate',    r > 0 ? `${r}% p.a.` : '—'],
          ['Tenure',           n > 0 ? `${n} months` : '—'],
          ['Monthly EMI',      emi > 0 ? fmtINR(emi) : '—'],
          ['Total Interest',   totalInt > 0 ? fmtINR(totalInt) : '—'],
          ['Total Payable',    total > 0 ? fmtINR(total) : '—'],
          ['Employment',       data.empType ? data.empType.charAt(0).toUpperCase() + data.empType.slice(1) : '—'],
          ['Monthly Income',   data.salary ? fmtINR(parseFloat(data.salary)) : '—'],
          ['Sales Person',     data.salesPerson || '—'],
          ['Channel',          data.channel || '—'],
          ['CIBIL Score',      data.cibil || '—'],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between text-sm py-2 border-b border-gray-50">
            <span className="text-gray-500">{label}</span>
            <span className="font-medium text-gray-900 text-right max-w-[55%]">{value}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 p-3 bg-green-50 rounded-lg border border-green-100 text-xs text-green-700 flex items-start gap-1.5">
        <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> Review all details before submitting. Once submitted, a loan application will be created and assigned to the selected sales person.
      </div>
    </div>
  )
}

// ── Main Wizard Page ──────────────────────────────────────────────────────────
export default function NewApplicationPage() {
  const navigate    = useNavigate()
  const qc          = useQueryClient()
  const user        = useAuthStore(s => s.user)
  const [searchParams] = useSearchParams()

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
  const [data, setData]    = useState<WizardData>(() => ({
    ...emptyData,
    salesPerson: user?.fullName ?? '',
  }))
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
  const [docUploadWarning, setDocUploadWarning] = useState('')
  // The id of the backend Draft Loan record this wizard session is tied to
  // (see wizardApi.saveDraft). Once set, every subsequent draft-save,
  // validate, and final submit call reuses this same record instead of the
  // final submit accidentally creating a brand-new, duplicate Loan.
  const [serverLoanId, setServerLoanId] = useState<number | undefined>(
    isResumingDraft ? resumeLoanId : undefined
  )

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
    empType:     data.empType === 'salaried' ? 'SALARIED'
                : data.empType === 'self_employed' ? 'SELFEMP'
                : data.empType === 'professional' ? 'PROFESSIONAL'
                : data.empType,
    compName:    data.compName,
    compType:    data.compType,
    salary:      parseFloat(data.salary) || 0,
    obligations: parseFloat(data.obligations) || 0,
    desig:       data.desig,
    officeEmail: data.officeEmail,
    loanType:    data.loanType,
    amount:      parseFloat(data.amount) || 0,
    loanRate:    parseFloat(data.loanRate) || 12,
    tenure:      parseInt(data.tenure) || 24,
    purpose:     data.purpose,
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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const fullName = [data.firstName, data.middleName, data.lastName].filter(Boolean).join(' ')
      if (data.mobile || fullName) {
        wizardApi.saveDraft(buildPayload()).then(res => {
          const loanId = res.data.data?.loanId
          if (loanId) setServerLoanId(loanId)
        }).catch(() => {
          // Autosave to the backend failed — this round's progress only
          // lives in memory until the next successful autosave; nothing
          // falls back to localStorage.
        })
      }
    }, 800)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, step, data])

  const setDocument = useCallback((key: string, file: File | null) => {
    setDocuments(prev => ({ ...prev, [key]: file }))
    setTouched(prev => (prev[key] ? prev : { ...prev, [key]: true }))
  }, [])

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
    () => computeStepErrors(step, data, documents),
    [step, data, documents],
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
        if (documents.salarySlip3mo)
          uploads.push(loansApi.uploadDocument(result.loanId, documents.salarySlip3mo, 'salary_slip'))
        if (documents.bankStatement6mo)
          uploads.push(loansApi.uploadDocument(result.loanId, documents.bankStatement6mo, 'bank_statement'))

        if (uploads.length) {
          const outcomes = await Promise.allSettled(uploads)
          if (outcomes.some(o => o.status === 'rejected')) {
            setDocUploadWarning(
              'Application submitted, but one or more documents failed to upload. ' +
              'Please retry the upload from the application details page.'
            )
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

  const handleNext = () => {
    if (step === TOTAL_STEPS) {
      if (!validateCurrentStep()) return
      if (submit.isPending || validateMutation.isPending) return  // ✅ Prevent multiple clicks
      setSubmitError('')
      validateMutation.mutate()
      return
    }
    if (!validateCurrentStep()) return
    setStep(s => s + 1)
  }

  const handleBack = () => {
    setStep(s => s - 1)
  }

  const progress = Math.round((step / TOTAL_STEPS) * 100)

  if (isResuming) {
    return (
      <div className="max-w-2xl mx-auto py-24 text-center">
        <Loader size={28} className="mx-auto text-efin-blue animate-spin mb-4" />
        <p className="text-sm text-gray-500">Loading your draft…</p>
      </div>
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
              className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
            >
              View Application
            </button>
          )}
          <button
            onClick={() => navigate('/loans')}
            className={submissionResult.applicationId > 0
              ? 'px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors'
              : 'px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors'}
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
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">New Loan Application</h1>
        <p className="text-sm text-gray-500 mt-0.5">Complete all steps to submit the application</p>
      </div>

      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-600">Step {step} of {TOTAL_STEPS}: {STEP_LABELS[step - 1]}</span>
          <span className="text-sm text-gray-400">{progress}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-blue-600 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex gap-1.5 mb-6 overflow-x-auto pb-1">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1
          const done   = n < step
          const active = n === step
          return (
            <div key={n} className={`flex flex-col items-center min-w-[60px] ${active ? 'opacity-100' : done ? 'opacity-80' : 'opacity-40'}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mb-1 ${
                done   ? 'bg-green-500 text-white' :
                active ? 'bg-blue-600 text-white' :
                         'bg-gray-200 text-gray-500'
              }`}>
                {done ? <CheckCircle size={14} /> : n}
              </div>
              <span className="text-[9px] text-center text-gray-500 leading-tight max-w-[56px]">{label}</span>
            </div>
          )
        })}
      </div>

      {/* Step body */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-5">
        <h2 className="text-base font-semibold text-gray-900 mb-5 pb-3 border-b border-gray-100">
          {step}. {STEP_LABELS[step - 1]}
        </h2>

        {step === 1 && <Step1 data={data} onChange={update} errors={stepErrors} touch={touch} />}
        {step === 2 && <Step2 data={data} onChange={update} errors={stepErrors} touch={touch} touched={touched} />}
        {step === 3 && <Step3 data={data} onChange={update} errors={stepErrors} touch={touch} />}
        {step === 4 && <Step4 data={data} onChange={update} errors={stepErrors} touch={touch} />}
        {step === 5 && <Step5 data={data} onChange={update} errors={stepErrors} touch={touch} />}
        {step === 6 && <Step6 data={data} onChange={update} errors={stepErrors} touch={touch} />}
        {step === 7 && <Step7 data={data} onChange={update} errors={stepErrors} touch={touch} />}
        {step === 8 && <Step8 documents={documents} onDocumentChange={setDocument} errors={stepErrors} />}
        {step === 9 && <Step9 data={data} />}
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
          disabled={step === 1}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={16} /> Back
        </button>

        <button
          onClick={handleNext}
          disabled={submit.isPending || validateMutation.isPending || (step === TOTAL_STEPS && Object.keys(liveStepErrors).length > 0)}
          className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {validateMutation.isPending
            ? <><Loader size={16} className="animate-spin" /> Checking...</>
            : submit.isPending
              ? <><Loader size={16} className="animate-spin" /> Submitting...</>
              : step === TOTAL_STEPS
                ? <><CheckCircle2 size={16} /> Submit Application</>
                : <>Continue <ChevronRight size={16} /></>
          }
        </button>
      </div>
    </div>
  )
}
