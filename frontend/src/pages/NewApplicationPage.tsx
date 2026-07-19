import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { wizardApi, type WizardSubmitPayload } from '@/api/wizardApi'
import { kycApi } from '@/api/kycApi'
import { useAuthStore } from '@/store/authStore'
import { CheckCircle, ChevronRight, ChevronLeft, AlertCircle, Upload, Loader, CheckCircle2 } from 'lucide-react'

import { emiReducing as computeEmiReducing } from '@/utils/emi'
import { extractPanData, extractAadhaarData } from '@/utils/kycExtraction'
import { createDraftId, saveDraft, getDraft, deleteDraft } from '@/utils/draftStorage'

function fmtINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
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
  kycFirstName: '', kycLastName: '', kycDob: '', kycAadhar: '', kycGender: '', kycFather: '',
  kycStreet1: '', kycCity: '', kycState: '', kycPin: '',
  firstName: '', middleName: '', lastName: '', dob: '', gender: '', aadhar: '', email: '', phone: '', father: '',
  street1: '', street2: '', city: '', state: '', zip: '', homeType: 'Rented', sameAddr: false,
  pStreet1: '', pStreet2: '', pCity: '', pState: '', pZip: '', pHomeType: 'Rented',
  empType: '', compName: '', compType: '', salary: '', desig: '', officeEmail: '', obligations: '0',
  loanType: 'personal_loan', amount: '', loanRate: '12', tenure: '24', purpose: '', cibil: '',
  r1Name: '', r1Mobile: '', r1Relation: '', r2Name: '', r2Mobile: '', r2Relation: '',
}

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

function TextInput({ value, onChange, placeholder, type = 'text', maxLength, className = '' }: {
  value: string; onChange: (v: string) => void; placeholder?: string
  type?: string; maxLength?: number; className?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      className={`w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${className}`}
    />
  )
}

function SelectInput({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void
  options: Array<{ value: string; label: string } | string>; placeholder?: string
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
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
function Step1({ data, onChange, errors }: {
  data: WizardData
  onChange: (f: Partial<WizardData>) => void
  errors: Record<string, string>
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
  const { data: dsaList } = useQuery({
    queryKey: ['wizard-dsa'],
    queryFn: () => wizardApi.getDsaPartners().then(r => r.data.data ?? []),
    staleTime: 300_000,
    enabled: data.channel === 'dsa',
  })

  const salesUsers = (usersResp ?? []).filter(u => ['Sales', 'Manager', 'Admin'].includes(u.role))

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
      <FormGroup label="Mobile Number" required error={errors.mobile}>
        <TextInput value={data.mobile} onChange={v => onChange({ mobile: v })}
          placeholder="10-digit mobile" maxLength={10} type="tel" />
      </FormGroup>

      <FormGroup label="PAN Card Number" required error={errors.pan}>
        <TextInput value={data.pan} onChange={v => onChange({ pan: v.toUpperCase() })}
          placeholder="ABCDE1234F" maxLength={10} className="uppercase font-mono" />
      </FormGroup>

      <FormGroup label="Location" required error={errors.location}>
        <SelectInput
          value={data.location}
          onChange={v => onChange({ location: v })}
          options={(locations ?? []).map(l => ({ value: String(l.id), label: `${l.name} — ${l.city}` }))}
          placeholder="— Select Location —"
        />
      </FormGroup>

      <FormGroup label="Sales Person" required error={errors.salesPerson}>
        <SelectInput
          value={data.salesPerson}
          onChange={v => onChange({ salesPerson: v })}
          options={salesUsers.map(u => ({ value: u.fullName, label: u.fullName }))}
          placeholder="— Select Sales Person —"
        />
      </FormGroup>

      <FormGroup label="Channel">
        <SelectInput value={data.channel} onChange={v => onChange({ channel: v, dsaName: '' })}
          options={CHANNELS} />
      </FormGroup>

      {data.channel === 'dsa' && (
        <FormGroup label="DSA Name">
          <SelectInput
            value={data.dsaName}
            onChange={v => onChange({ dsaName: v })}
            options={(dsaList ?? []).map(d => ({ value: d.name, label: `${d.name} (${d.code})` }))}
            placeholder="— Select DSA —"
          />
        </FormGroup>
      )}
    </div>
  )
}

function Step2({ data, onChange }: { data: WizardData; onChange: (f: Partial<WizardData>) => void }) {
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
        onChange({
          kycFirstName: panData.firstName,
          firstName: panData.firstName,
          kycLastName: panData.lastName,
          lastName: panData.lastName,
          kycFather: panData.fatherName,
          father: panData.fatherName,
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
        onChange({
          kycAadhar: aadhaarData.aadhaarNumber,
          aadhar: aadhaarData.aadhaarNumber,
          kycDob: aadhaarData.dateOfBirth,
          dob: aadhaarData.dateOfBirth,
          kycGender: aadhaarData.gender,
          gender: aadhaarData.gender,
          kycCity: aadhaarData.city,
          city: aadhaarData.city,
          kycState: aadhaarData.state,
          state: aadhaarData.state,
          kycPin: aadhaarData.pinCode,
          zip: aadhaarData.pinCode,
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
          <span>📋 PAN Card</span>
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
                '🔍 Extract Data'
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
          <FormGroup label="First Name (from PAN)">
            <TextInput value={data.kycFirstName} onChange={v => onChange({ kycFirstName: v, firstName: v })}
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
          <span>🪪 Aadhaar Card</span>
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
                '🔍 Extract Data'
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
          <FormGroup label="Aadhaar Number">
            <TextInput value={data.kycAadhar}
              onChange={v => onChange({ kycAadhar: v.replace(/\s/g,''), aadhar: v.replace(/\s/g,'') })}
              placeholder="XXXX XXXX XXXX" maxLength={12}
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
          <FormGroup label="PIN Code">
            <TextInput value={data.kycPin} onChange={v => onChange({ kycPin: v, zip: v })}
              placeholder="—" maxLength={6} />
          </FormGroup>
        </div>
      </div>
    </div>
  )
}

function Step3({ data, onChange, errors }: {
  data: WizardData; onChange: (f: Partial<WizardData>) => void; errors: Record<string, string>
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
      <FormGroup label="First Name" required error={errors.firstName}>
        <TextInput value={data.firstName} onChange={v => onChange({ firstName: v })} placeholder="First name" />
      </FormGroup>
      <FormGroup label="Middle Name">
        <TextInput value={data.middleName} onChange={v => onChange({ middleName: v })} placeholder="Middle name" />
      </FormGroup>
      <FormGroup label="Last Name" required error={errors.lastName}>
        <TextInput value={data.lastName} onChange={v => onChange({ lastName: v })} placeholder="Last name" />
      </FormGroup>
      <FormGroup label="Date of Birth">
        <TextInput value={data.dob} onChange={v => onChange({ dob: v })} type="date" />
      </FormGroup>
      <FormGroup label="Gender">
        <SelectInput value={data.gender} onChange={v => onChange({ gender: v })}
          options={['Male', 'Female', 'Other']} placeholder="— Select —" />
      </FormGroup>
      <FormGroup label="Aadhaar Number">
        <TextInput value={data.aadhar} onChange={v => onChange({ aadhar: v })}
          placeholder="12-digit Aadhaar" maxLength={12} className="font-mono" />
      </FormGroup>
      <FormGroup label="Email Address">
        <TextInput value={data.email} onChange={v => onChange({ email: v })}
          type="email" placeholder="email@example.com" />
      </FormGroup>
      <FormGroup label="Alternate Phone">
        <TextInput value={data.phone} onChange={v => onChange({ phone: v })}
          type="tel" placeholder="Alternate number" maxLength={10} />
      </FormGroup>
      <FormGroup label="Father's Name">
        <TextInput value={data.father} onChange={v => onChange({ father: v })}
          placeholder="Father's name" />
      </FormGroup>
    </div>
  )
}

function Step4({ data, onChange }: { data: WizardData; onChange: (f: Partial<WizardData>) => void }) {
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
        <FormGroup label="House / Flat No.">
          <TextInput value={data.street1} onChange={v => onChange({ street1: v })} placeholder="Flat no, Floor" />
        </FormGroup>
        <FormGroup label="Street & Locality">
          <TextInput value={data.street2} onChange={v => onChange({ street2: v })} placeholder="Road, Area, Colony" />
        </FormGroup>
        <FormGroup label="City">
          <TextInput value={data.city} onChange={v => onChange({ city: v })} placeholder="City" />
        </FormGroup>
        <FormGroup label="Pin Code">
          <TextInput value={data.zip} onChange={v => onChange({ zip: v })} placeholder="6-digit pin" maxLength={6} />
        </FormGroup>
        <FormGroup label="State">
          <SelectInput value={data.state} onChange={v => onChange({ state: v })}
            options={STATES} placeholder="— Select State —" />
        </FormGroup>
        <FormGroup label="Home Type">
          <SelectInput value={data.homeType} onChange={v => onChange({ homeType: v })}
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
            <FormGroup label="Pin Code">
              <TextInput value={data.pZip} onChange={v => onChange({ pZip: v })} placeholder="6-digit pin" maxLength={6} />
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

function Step5({ data, onChange, errors }: {
  data: WizardData; onChange: (f: Partial<WizardData>) => void; errors: Record<string, string>
}) {
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
        <FormGroup label="Employment Type" required error={errors.empType}>
          <SelectInput value={data.empType} onChange={v => onChange({ empType: v })}
            options={EMP_TYPES} placeholder="— Select —" />
        </FormGroup>
        <FormGroup label="Gross Monthly Income (₹)" required error={errors.salary}>
          <TextInput value={data.salary} onChange={v => onChange({ salary: v })}
            type="number" placeholder="e.g. 50000" />
        </FormGroup>
        <FormGroup label="Existing Monthly EMI Obligations (₹)">
          <TextInput value={data.obligations} onChange={v => onChange({ obligations: v })}
            type="number" placeholder="0 if none" />
        </FormGroup>
        <FormGroup label="Designation">
          <TextInput value={data.desig} onChange={v => onChange({ desig: v })} placeholder="e.g. Manager" />
        </FormGroup>
      </div>

      {(data.empType === 'salaried' || data.empType === '') && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 mt-2">
          <FormGroup label="Employer / Company Name" required error={errors.compName}>
            <TextInput value={data.compName} onChange={v => onChange({ compName: v })}
              placeholder="e.g. Tata Consultancy" />
          </FormGroup>
          <FormGroup label="Company Type">
            <SelectInput value={data.compType} onChange={v => onChange({ compType: v })}
              options={COMP_TYPES} placeholder="— Select —" />
          </FormGroup>
          <FormGroup label="Official Email ID" required error={errors.officeEmail}>
            <TextInput value={data.officeEmail} onChange={v => onChange({ officeEmail: v })}
              type="email" placeholder="e.g. name@company.com" />
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

function Step6({ data, onChange, errors }: {
  data: WizardData; onChange: (f: Partial<WizardData>) => void; errors: Record<string, string>
}) {
  const P   = parseFloat(data.amount) || 0
  const r   = parseFloat(data.loanRate) || 0
  const n   = parseInt(data.tenure) || 0
  const { emi, total, totalInt } = computeEmiReducing(P, r, n)

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
        <FormGroup label="Loan Type" required>
          <SelectInput value={data.loanType} onChange={v => onChange({ loanType: v })} options={LOAN_TYPES} />
        </FormGroup>
        <FormGroup label="CIBIL Score">
          <TextInput value={data.cibil} onChange={v => onChange({ cibil: v })}
            type="number" placeholder="e.g. 750" />
        </FormGroup>
        <FormGroup label="Loan Amount (₹)" required error={errors.amount}>
          <TextInput value={data.amount} onChange={v => onChange({ amount: v })}
            type="number" placeholder="e.g. 500000" />
        </FormGroup>
        <FormGroup label="Interest Rate (% p.a.)" required error={errors.loanRate}>
          <TextInput value={data.loanRate} onChange={v => onChange({ loanRate: v })}
            type="number" placeholder="e.g. 12.5" />
        </FormGroup>
        <FormGroup label="Tenure (months)" required error={errors.tenure}>
          <TextInput value={data.tenure} onChange={v => onChange({ tenure: v })}
            type="number" placeholder="e.g. 24" />
        </FormGroup>
        <FormGroup label="Purpose / Remarks">
          <TextInput value={data.purpose} onChange={v => onChange({ purpose: v })}
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

function Step7({ data, onChange }: { data: WizardData; onChange: (f: Partial<WizardData>) => void }) {
  return (
    <div>
      <div className="mb-6">
        <p className="text-xs font-semibold text-gray-500 uppercase mb-4">Reference 1</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4">
          <FormGroup label="Name">
            <TextInput value={data.r1Name} onChange={v => onChange({ r1Name: v })} placeholder="Full name" />
          </FormGroup>
          <FormGroup label="Mobile">
            <TextInput value={data.r1Mobile} onChange={v => onChange({ r1Mobile: v })}
              type="tel" placeholder="10-digit mobile" maxLength={10} />
          </FormGroup>
          <FormGroup label="Relationship">
            <SelectInput value={data.r1Relation} onChange={v => onChange({ r1Relation: v })}
              options={RELATIONS} placeholder="— Select —" />
          </FormGroup>
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase mb-4">Reference 2</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4">
          <FormGroup label="Name">
            <TextInput value={data.r2Name} onChange={v => onChange({ r2Name: v })} placeholder="Full name" />
          </FormGroup>
          <FormGroup label="Mobile">
            <TextInput value={data.r2Mobile} onChange={v => onChange({ r2Mobile: v })}
              type="tel" placeholder="10-digit mobile" maxLength={10} />
          </FormGroup>
          <FormGroup label="Relationship">
            <SelectInput value={data.r2Relation} onChange={v => onChange({ r2Relation: v })}
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

      <p className="text-xs font-semibold text-gray-500 uppercase mt-5 mb-2">💼 Income &amp; Employment</p>
      <MandatoryDoc docKey="salarySlip3mo" label="Last 3 Month Salary Slips"
        documents={documents} onDocumentChange={onDocumentChange} errors={errors} />

      <p className="text-xs font-semibold text-gray-500 uppercase mt-5 mb-2">🏦 Banking</p>
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
        <p className="text-sm font-semibold text-amber-900">⚠️ Incomplete Application</p>
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
      <div className="mt-4 p-3 bg-green-50 rounded-lg border border-green-100 text-xs text-green-700">
        ✓ Review all details before submitting. Once submitted, a loan application will be created and assigned to the selected sales person.
      </div>
    </div>
  )
}

// ── Main Wizard Page ──────────────────────────────────────────────────────────
export default function NewApplicationPage() {
  const navigate    = useNavigate()
  const user        = useAuthStore(s => s.user)
  const [searchParams] = useSearchParams()

  // Resuming only happens when arriving with an explicit ?draftId= from the
  // Applications → Drafts list (see LoansPage). Visiting the wizard any other
  // way ("Register New" / New Application) always starts a brand-new draft —
  // it never reads, overwrites, or deletes another draft.
  const resumeDraftId = searchParams.get('draftId')
  const resumedDraft   = resumeDraftId ? getDraft<WizardData>(resumeDraftId) : null

  const [draftId]          = useState<string>(() => (resumeDraftId && resumedDraft) ? resumeDraftId : createDraftId())
  const [step, setStep]    = useState(resumedDraft?.step ?? 1)
  const [data, setData]    = useState<WizardData>(() => resumedDraft?.data ?? {
    ...emptyData,
    salesPerson: user?.fullName ?? '',
  })
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState('')
  const [documents, setDocuments] = useState<Record<string, File | null>>({})

  // Autosave the in-progress wizard as a Draft so it can be resumed later
  // from Applications → Drafts. Debounced to avoid writing on every keystroke.
  // File uploads (Stage 8) are intentionally excluded — they cannot be
  // serialized to local storage and are re-attached on resume.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const label = [data.firstName, data.middleName, data.lastName].filter(Boolean).join(' ')
        || data.mobile || 'Untitled application'
      saveDraft(draftId, step, data, label, data.loanType)
    }, 500)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [draftId, step, data])

  const setDocument = useCallback((key: string, file: File | null) => {
    setDocuments(prev => ({ ...prev, [key]: file }))
    setStepErrors(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const update = useCallback((fields: Partial<WizardData>) => {
    setData(prev => ({ ...prev, ...fields }))
    // Clear errors for changed fields
    const keys = Object.keys(fields)
    setStepErrors(prev => {
      const next = { ...prev }
      keys.forEach(k => delete next[k])
      return next
    })
  }, [])

  // ── Step validation (mirrors legacy validateStep) ─────────────────────────
  const validateCurrentStep = (): boolean => {
    const errs: Record<string, string> = {}

    if (step === 1) {
      if (!data.mobile || data.mobile.length !== 10) errs.mobile = 'Enter valid 10-digit mobile number'
      if (!data.pan || data.pan.length !== 10 || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(data.pan))
        errs.pan = 'Enter valid PAN (e.g. ABCDE1234F)'
      if (!data.location) errs.location = 'Please select a Location'
      if (!data.salesPerson) errs.salesPerson = 'Please select a Sales Person'
      if (data.channel === 'dsa' && !data.dsaName) errs.dsaName = 'DSA name is required for DSA channel'
    }
    if (step === 2) {
      if (!data.kycAadhar || data.kycAadhar.length !== 12) errs.kycAadhar = 'Aadhaar number (12 digits) is required'
      if (!data.kycFirstName && !data.firstName) errs.kycFirstName = 'Name is required from KYC'
    }
    if (step === 3) {
      if (!data.firstName) errs.firstName = 'First Name is required'
      if (!data.lastName) errs.lastName = 'Last Name is required'
      if (!data.gender) errs.gender = 'Gender is required'
      if (!data.dob) errs.dob = 'Date of Birth is required'
    }
    if (step === 4) {
      // Address step validation
      if (!data.street1) errs.street1 = 'Current street address is required'
      if (!data.city) errs.city = 'Current city is required'
      if (!data.state) errs.state = 'Current state is required'
      if (!data.zip || data.zip.length !== 6) errs.zip = 'Valid 6-digit PIN code is required'
      if (!data.homeType) errs.homeType = 'Home type is required'
    }
    if (step === 5) {
      if (!data.empType) errs.empType = 'Employment Type is required'
      if (!data.salary || parseFloat(data.salary) <= 0) errs.salary = 'Monthly income is required'
      if (data.empType !== 'self_employed') {
        if (!data.compName) errs.compName = 'Company name is required'
        if (!data.desig) errs.desig = 'Designation is required'
        if (!data.officeEmail) errs.officeEmail = 'Official Email ID is required'
      }
    }
    if (step === 6) {
      if (!data.loanType) errs.loanType = 'Loan type is required'
      if (!data.amount || parseFloat(data.amount) <= 0) errs.amount = 'Loan amount is required'
      if (!data.loanRate || parseFloat(data.loanRate) <= 0) errs.loanRate = 'Interest rate is required'
      if (!data.tenure || parseInt(data.tenure) <= 0) errs.tenure = 'Tenure (months) is required'
      if (!data.purpose) errs.purpose = 'Loan purpose is required'
    }
    if (step === 7) {
      // References - at least one reference required
      const hasRef1 = data.r1Name && data.r1Mobile && data.r1Relation
      const hasRef2 = data.r2Name && data.r2Mobile && data.r2Relation
      if (!hasRef1 && !hasRef2) {
        errs.references = 'At least one reference is required'
      }
      if (data.r1Name && !data.r1Mobile) errs.r1Mobile = 'Reference 1 mobile is required'
      if (data.r2Name && !data.r2Mobile) errs.r2Mobile = 'Reference 2 mobile is required'
    }
    if (step === 8) {
      // Mandatory documents - application cannot proceed/submit without these
      if (!documents.salarySlip3mo) errs.salarySlip3mo = 'Last 3 Month Salary Slips are required'
      if (!documents.bankStatement6mo) errs.bankStatement6mo = 'Last 6 Month Bank Statement is required'
    }
    // Step 9 (Loan Analytics) - no validation needed, it's summary only

    if (Object.keys(errs).length > 0) {
      setStepErrors(errs)
      return false
    }
    return true
  }

  const submit = useMutation({
    mutationFn: () => {
      const payload: WizardSubmitPayload = {
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
      }
      return wizardApi.submit(payload)
    },
    onSuccess: (res) => {
      const result = res.data.data
      deleteDraft(draftId) // completed application — no longer a draft
      if (result?.loanId) {
        navigate(`/loans/${result.loanId}`, {
          state: { newApplication: true, eFinId: result.eFinId, loanNumber: result.loanNumber }
        })
      }
    },
    onError: (error) => {
      let message = 'Failed to submit application. Please check all fields and try again.'
      if (error instanceof Error) {
        message = error.message
      }
      setSubmitError(message)
    },
  })

  const handleNext = () => {
    if (step === TOTAL_STEPS) {
      if (!validateCurrentStep()) return
      if (submit.isPending) return  // ✅ Prevent multiple clicks
      submit.mutate()
      return
    }
    if (!validateCurrentStep()) return
    setStep(s => s + 1)
  }

  const handleBack = () => {
    setStepErrors({})
    setStep(s => s - 1)
  }

  const progress = Math.round((step / TOTAL_STEPS) * 100)

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

        {step === 1 && <Step1 data={data} onChange={update} errors={stepErrors} />}
        {step === 2 && <Step2 data={data} onChange={update} />}
        {step === 3 && <Step3 data={data} onChange={update} errors={stepErrors} />}
        {step === 4 && <Step4 data={data} onChange={update} />}
        {step === 5 && <Step5 data={data} onChange={update} errors={stepErrors} />}
        {step === 6 && <Step6 data={data} onChange={update} errors={stepErrors} />}
        {step === 7 && <Step7 data={data} onChange={update} />}
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
          disabled={submit.isPending || (step === TOTAL_STEPS && Object.keys(stepErrors).length > 0)}
          className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {submit.isPending
            ? <><Loader size={16} className="animate-spin" /> Submitting...</>
            : step === TOTAL_STEPS
              ? '✓ Submit Application'
              : <>Continue <ChevronRight size={16} /></>
          }
        </button>
      </div>
    </div>
  )
}
