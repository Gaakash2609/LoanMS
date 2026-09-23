import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { User, MapPin, Briefcase, Users, Pencil, X } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { customersApi } from '@/api/customersApi'
import { loansApi } from '@/api/loansApi'
import { formatDate } from '@/utils/format'
import { useHasPermission } from '@/hooks/usePermissions'
import type { Loan, Customer, LoanReference } from '@/types'
import { LOAN_KEYS } from '@/hooks/useLoans'

// ── Applicant tabs: Personal / Address / Employment / References ────────
// Ports the legacy application-detail tabs of the same names. The React
// detail page previously showed only a flat read-only Customer card and had
// no way to edit anything after submission (legacy's "Edit Details").
//
// Personal/Address/Employment all live on the Customer record and save
// through the existing PUT /api/customers/{id} (customersApi.update, which
// was exported but had no caller). References save through the existing
// PUT /api/loans/{id}/references. No backend changes.
//
// PUT /api/customers/{id} takes the FULL CreateCustomerRequestDto, so every
// save sends the whole customer back with only the edited section changed —
// sending a partial body would blank the untouched columns.

const EMP_TYPES = ['Salaried', 'Self Employed', 'Professional', 'Business']
const RESIDENCE_TYPES = ['Owned', 'Rented', 'Company Provided', 'Parental', 'Other']
const RELATIONS = ['Father', 'Mother', 'Spouse', 'Sibling', 'Friend', 'Colleague', 'Neighbour', 'Other']

type TabKey = 'personal' | 'address' | 'employment' | 'references'

// Emoji lookup copied from Vanilla's fieldGrid() iconMap (efin-app.js:3785)
// so the applicant read-tabs (Personal/Address/Employment/References) carry
// the same emoji labels as Vanilla.
const FIELD_EMOJI: Record<string, string> = {
  'Full Name': '👤', 'PAN': '🪪', 'Aadhaar': '🪪', 'Aadhar': '🪪', 'Date of Birth': '🎂', 'Gender': '⚧️',
  'Mobile': '📱', 'Phone': '📱', 'Alternate Phone': '📞', 'Email': '✉️', "Mother's Name": '👩', "Father's Name": '👨',
  'CIBIL Score': '📊', 'Monthly Income': '💰', 'Monthly Obligations': '💸',
  'Street Line 1': '📍', 'Street Line 2': '📍', 'City': '🏙️', 'Pin Code': '📮', 'PIN Code': '📮', 'State': '🗺️', 'Home Type': '🏠',
  'House / Flat No.': '📍', 'Street & Locality': '📍', 'Address': '📍',
  'Employment Type': '💼', 'Employment': '💼', 'Net Salary': '💰', 'Company Name': '🏢', 'Company': '🏢', 'Designation': '🎖️',
  'Company Type': '🏛️', 'Official Email ID': '✉️', 'Office Address': '📍',
  'Name': '👥', 'Relationship': '🤝',
}
// Boxed field cell — Vanilla fieldGrid() (efin-app.js:3784): emoji + uppercase
// label over a .field-val box; muted italic "—" when empty.
function Field({ label, value }: { label: string; value?: string | number | null }) {
  const emoji = Object.entries(FIELD_EMOJI).find(([k]) => label === k || label.endsWith('— ' + k) || label.endsWith(' ' + k))?.[1]
  const empty = value !== 0 && (value == null || value === '')
  return (
    <div className="detail-fg">
      <label>{emoji && <span style={{ fontSize: 11 }}>{emoji}</span>} {label}</label>
      <div className={`field-val ${empty ? 'empty' : ''}`}>{value === 0 ? '0' : (value || '—')}</div>
    </div>
  )
}

function Input({ label, value, onChange, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; type?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue" />
    </div>
  )
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-efin-blue">
        <option value="">— Select —</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

/**
 * `controlledTab` lets a parent drive which applicant section is showing and
 * hide the inner tab strip — used by LoanDetailPage, where legacy exposes
 * Personal / Address / Employment / References as four TOP-LEVEL app-detail
 * tabs rather than a nested strip. Omitting it keeps the original
 * self-contained behaviour, so every existing call site is unaffected.
 */
export default function LoanApplicantTabs({ loan, controlledTab }: {
  loan: Loan
  controlledTab?: TabKey
}) {
  const qc = useQueryClient()
  const c = loan.customer
  // Product-specific bag (Loan.ProductDataJson) — rendered as grouped
  // read-only detail on the Employment tab, matching Vanilla's product
  // conditional field groups (efin-app.js:2598-2660).
  const pd = useMemo<Record<string, string>>(() => {
    try { return loan.productDataJson ? JSON.parse(loan.productDataJson) : {} }
    catch { return {} }
  }, [loan.productDataJson])
  // Reference address — Vanilla composes it from r{n}addr1/addr2/city/pin
  // (efin-app.js:2689). The wizard saves those parts in ProductDataJson (the
  // LoanReference row itself carries no address unless later edited), so fall
  // back to composing them here when the reference's own address is empty.
  const refAddress = (n: number, own?: string | null): string | undefined => {
    if (own) return own
    const parts = [pd[`r${n}Addr1`], pd[`r${n}Addr2`], pd[`r${n}City`], pd[`r${n}Pin`]].filter(Boolean)
    return parts.length ? parts.join(', ') : undefined
  }
  const [tab, setTab] = useState<TabKey>('personal')
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')

  // Tab visibility + edit rights come from the Roles & Permissions editor.
  const canTabPersonal    = useHasPermission('canTabPersonal')
  const canTabAddress     = useHasPermission('canTabAddress')
  const canTabEmployment  = useHasPermission('canTabEmployment')
  const canTabReferences  = useHasPermission('canTabReferences')
  const canEdit           = useHasPermission('canEditDetails')
  const maskPersonal      = useHasPermission('canMaskPersonal', false)

  const [form, setForm] = useState({
    fullName: c.fullName ?? '', email: c.email ?? '', phone: c.phone ?? '',
    panNumber: c.panNumber ?? '', aadhaarNumber: c.aadhaarNumber ?? '',
    dateOfBirth: (c.dateOfBirth ?? '').slice(0, 10), gender: c.gender ?? '',
    fatherName: c.fatherName ?? '', motherName: c.motherName ?? '',
    alternatePhone: c.alternatePhone ?? '',
    houseNo: c.houseNo ?? '',
    address: c.address ?? '', city: c.city ?? '', state: c.state ?? '',
    pinCode: c.pinCode ?? '', residenceType: c.residenceType ?? '',
    permanentHouseNo: c.permanentHouseNo ?? '', permanentAddress: c.permanentAddress ?? '',
    permanentCity: c.permanentCity ?? '', permanentState: c.permanentState ?? '',
    permanentPinCode: c.permanentPinCode ?? '', permanentResidenceType: c.permanentResidenceType ?? '',
    employmentType: c.employmentType ?? '', companyName: c.companyName ?? '',
    designation: c.designation ?? '', companyType: c.companyType ?? '',
    officialEmail: c.officialEmail ?? '', officeAddress: c.officeAddress ?? '',
    officePinCode: c.officePinCode ?? '',
    monthlyIncome: c.monthlyIncome != null ? String(c.monthlyIncome) : '',
    monthlyObligations: c.monthlyObligations != null ? String(c.monthlyObligations) : '',
    cibilScore: c.cibilScore != null ? String(c.cibilScore) : '',
  })

  const [refs, setRefs] = useState<LoanReference[]>(() => {
    const existing = loan.references ?? []
    // Seed each row's address from the reference's own value, else compose it
    // from ProductDataJson (r{n}Addr*) so editing preserves the wizard-captured
    // address instead of silently clearing it on save.
    return [1, 2].map(n => {
      const ex = existing.find(r => r.refNumber === n)
      const addr = refAddress(n, ex?.address) ?? ''
      return ex ? { ...ex, address: addr } : { refNumber: n, name: '', mobile: '', relation: '', address: addr }
    })
  })

  const saveCustomer = useMutation({
    mutationFn: () => customersApi.update(c.id, {
      // Whole-record send — see header note.
      fullName: form.fullName, email: form.email, phone: form.phone,
      panNumber: form.panNumber || undefined,
      aadhaarNumber: form.aadhaarNumber || undefined,
      dateOfBirth: form.dateOfBirth || undefined,
      gender: form.gender || undefined,
      fatherName: form.fatherName || undefined,
      motherName: form.motherName || undefined,
      alternatePhone: form.alternatePhone || undefined,
      houseNo: form.houseNo || undefined,
      address: form.address || undefined,
      city: form.city || undefined,
      state: form.state || undefined,
      pinCode: form.pinCode || undefined,
      residenceType: form.residenceType || undefined,
      permanentHouseNo: form.permanentHouseNo || undefined,
      permanentAddress: form.permanentAddress || undefined,
      permanentCity: form.permanentCity || undefined,
      permanentState: form.permanentState || undefined,
      permanentPinCode: form.permanentPinCode || undefined,
      permanentResidenceType: form.permanentResidenceType || undefined,
      employmentType: form.employmentType || undefined,
      companyName: form.companyName || undefined,
      designation: form.designation || undefined,
      companyType: form.companyType || undefined,
      officialEmail: form.officialEmail || undefined,
      officeAddress: form.officeAddress || undefined,
      officePinCode: form.officePinCode || undefined,
      monthlyIncome: form.monthlyIncome ? Number(form.monthlyIncome) : undefined,
      monthlyObligations: form.monthlyObligations ? Number(form.monthlyObligations) : undefined,
      cibilScore: form.cibilScore ? Number(form.cibilScore) : undefined,
    } as Partial<Customer>),
    onSuccess: () => {
      setError(''); setEditing(false)
      qc.invalidateQueries({ queryKey: LOAN_KEYS.detail(loan.id) })
      qc.invalidateQueries({ queryKey: ['customers'] })
    },
    onError: (err: unknown) => {
      const d = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      setError(d?.message || d?.errors?.join(' ') || 'Could not save these details.')
    },
  })

  const saveRefs = useMutation({
    mutationFn: () => loansApi.updateReferences(loan.id,
      refs.filter(r => r.name?.trim()).map(r => ({
        name: r.name, mobile: r.mobile, relation: r.relation, address: r.address, refNumber: r.refNumber,
      }))),
    onSuccess: () => {
      setError(''); setEditing(false)
      qc.invalidateQueries({ queryKey: LOAN_KEYS.detail(loan.id) })
    },
    onError: (err: unknown) => {
      const d = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      setError(d?.message || d?.errors?.join(' ') || 'Could not save the references.')
    },
  })

  const tabs = ([
    { key: 'personal' as const,   label: 'Personal Details', icon: User,      allowed: canTabPersonal },
    { key: 'address' as const,    label: 'Address',          icon: MapPin,    allowed: canTabAddress },
    { key: 'employment' as const, label: 'Employment',       icon: Briefcase, allowed: canTabEmployment },
    { key: 'references' as const, label: 'References',       icon: Users,     allowed: canTabReferences },
  ]).filter(t => t.allowed)

  if (tabs.length === 0) return null
  const uncontrolledActive = tabs.some(t => t.key === tab) ? tab : tabs[0].key
  // A controlled tab always wins, but only if that tab is actually
  // permitted for this role — otherwise fall back to the computed one.
  const active = controlledTab && tabs.some(t => t.key === controlledTab)
    ? controlledTab
    : uncontrolledActive
  const isRefsTab = active === 'references'
  const saving = saveCustomer.isPending || saveRefs.isPending
  // Section metadata for the current tab's own icon header (only rendered
  // when a parent drives this via controlledTab — the self-contained tab
  // strip above already carries an icon per tab, so this would duplicate it).
  const activeMeta = tabs.find(t => t.key === active)
  const ActiveIcon = activeMeta?.icon ?? User

  const mask = (v?: string | null) => {
    if (!maskPersonal || !v) return v
    return v.length < 6 ? '****' : `${v.slice(0, 3)}****${v.slice(-3)}`
  }

  // Product-detail group: renders a titled block only when it has ≥1 value —
  // mirrors Vanilla's conditional (app.propType || ...) ? [...] : [] groups.
  const PGroup = ({ title, rows }: { title: string; rows: [string, string | undefined | null][] }) => {
    const present = rows.filter(([, v]) => v != null && v !== '')
    if (!present.length) return null
    return (
      <div>
        <p className="text-[11px] font-bold uppercase mb-2" style={{ color: 'var(--accent)', letterSpacing: '.5px' }}>{title}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          {present.map(([l, v]) => <Field key={l} label={l} value={v} />)}
        </div>
      </div>
    )
  }

  return (
    <Card>
      <div className="flex items-center gap-4 border-b border-gray-200 mb-4 -mt-1">
        {controlledTab ? (
          // Driven from LoanDetailPage's own top-level tab bar — show this
          // section's own icon + title instead of repeating the tab strip.
          <div className="flex items-center gap-2 pb-3 flex-1">
            <span className="section-icon-badge"><ActiveIcon size={15} /></span>
            <h3 className="text-sm font-bold text-gray-900">{activeMeta?.label}</h3>
          </div>
        ) : (
          <div className="flex gap-5 flex-1 overflow-x-auto">
            {tabs.map(t => {
              const Icon = t.icon
              const on = active === t.key
              return (
                <button key={t.key} onClick={() => { setTab(t.key); setEditing(false); setError('') }}
                  className={`flex items-center gap-1.5 pb-3 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                    on ? 'border-efin-blue text-efin-blue' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}>
                  <Icon size={14} className={on ? 'text-efin-blue' : 'text-gray-400'} />
                  {t.label}
                </button>
              )
            })}
          </div>
        )}
        {canEdit && (
          editing ? (
            <button onClick={() => { setEditing(false); setError('') }}
              className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 pb-3">
              <X size={13} /> Cancel
            </button>
          ) : (
            <button onClick={() => setEditing(true)}
              className="text-xs text-efin-blue hover:underline flex items-center gap-1 pb-3">
              <Pencil size={13} /> Edit Details
            </button>
          )
        )}
      </div>

      {error && <div className="mb-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {/* ── Personal ── */}
      {active === 'personal' && (editing ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input label="Full Name" value={form.fullName} onChange={v => setForm(p => ({ ...p, fullName: v }))} />
          <Input label="Father's Name" value={form.fatherName} onChange={v => setForm(p => ({ ...p, fatherName: v }))} />
          <Input label="Mother's Name" value={form.motherName} onChange={v => setForm(p => ({ ...p, motherName: v }))} />
          <Select label="Gender" value={form.gender} onChange={v => setForm(p => ({ ...p, gender: v }))} options={['Male', 'Female', 'Other']} />
          <Input label="Date of Birth" type="date" value={form.dateOfBirth} onChange={v => setForm(p => ({ ...p, dateOfBirth: v }))} />
          <Input label="PAN" value={form.panNumber} onChange={v => setForm(p => ({ ...p, panNumber: v.toUpperCase() }))} />
          <Input label="Aadhaar" value={form.aadhaarNumber} onChange={v => setForm(p => ({ ...p, aadhaarNumber: v }))} />
          <Input label="Email" value={form.email} onChange={v => setForm(p => ({ ...p, email: v }))} />
          <Input label="Mobile" value={form.phone} onChange={v => setForm(p => ({ ...p, phone: v }))} />
          <Input label="Alternate Phone" value={form.alternatePhone} onChange={v => setForm(p => ({ ...p, alternatePhone: v }))} />
          <Input label="CIBIL Score" value={form.cibilScore} onChange={v => setForm(p => ({ ...p, cibilScore: v }))} />
        </div>
      ) : (
        <>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <Field label="Full Name" value={c.fullName} />
          <Field label="Father's Name" value={c.fatherName} />
          <Field label="Mother's Name" value={c.motherName} />
          <Field label="Gender" value={c.gender} />
          <Field label="Date of Birth" value={c.dateOfBirth ? formatDate(c.dateOfBirth) : ''} />
          <Field label="PAN" value={mask(c.panNumber)} />
          <Field label="Aadhaar" value={mask(c.aadhaarNumber)} />
          <Field label="Email" value={c.email} />
          {/* Vanilla labels this "Mobile" and masks it for canMaskPersonal
              roles alongside PAN/Aadhaar (efin-app.js:2543). */}
          <Field label="Mobile" value={mask(c.phone)} />
          <Field label="Alternate Phone" value={c.alternatePhone} />
          <Field label="CIBIL Score" value={c.cibilScore} />
        </div>
        {/* Vanilla masked-fields note — efin-app.js:2548: shown to canMaskPersonal
            roles (Partner/DSA/Accounts) below the personal grid. */}
        {maskPersonal && (
          <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text3)' }}>
            🔒 PAN, Aadhar &amp; Mobile are masked for Partner access
          </div>
        )}
        </>
      ))}

      {/* ── Address (Current + Permanent) — Vanilla efin-app.js:2569/2579 ── */}
      {active === 'address' && (editing ? (
        <div className="space-y-5">
          <div>
            <p className="text-[11px] font-bold uppercase mb-2" style={{ color: 'var(--accent)', letterSpacing: '.5px' }}>📍 Current Address</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input label="House / Flat No." value={form.houseNo} onChange={v => setForm(p => ({ ...p, houseNo: v }))} />
              <div className="sm:col-span-2">
                <Input label="Street & Locality" value={form.address} onChange={v => setForm(p => ({ ...p, address: v }))} />
              </div>
              <Input label="City" value={form.city} onChange={v => setForm(p => ({ ...p, city: v }))} />
              <Input label="PIN Code" value={form.pinCode} onChange={v => setForm(p => ({ ...p, pinCode: v }))} />
              <Input label="State" value={form.state} onChange={v => setForm(p => ({ ...p, state: v }))} />
              <Select label="Home Type" value={form.residenceType} onChange={v => setForm(p => ({ ...p, residenceType: v }))} options={RESIDENCE_TYPES} />
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase mb-2" style={{ color: 'var(--accent)', letterSpacing: '.5px' }}>🏡 Permanent Address</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input label="House / Flat No." value={form.permanentHouseNo} onChange={v => setForm(p => ({ ...p, permanentHouseNo: v }))} />
              <div className="sm:col-span-2">
                <Input label="Street & Locality" value={form.permanentAddress} onChange={v => setForm(p => ({ ...p, permanentAddress: v }))} />
              </div>
              <Input label="City" value={form.permanentCity} onChange={v => setForm(p => ({ ...p, permanentCity: v }))} />
              <Input label="PIN Code" value={form.permanentPinCode} onChange={v => setForm(p => ({ ...p, permanentPinCode: v }))} />
              <Input label="State" value={form.permanentState} onChange={v => setForm(p => ({ ...p, permanentState: v }))} />
              <Select label="Home Type" value={form.permanentResidenceType} onChange={v => setForm(p => ({ ...p, permanentResidenceType: v }))} options={RESIDENCE_TYPES} />
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <p className="text-[11px] font-bold uppercase mb-2" style={{ color: 'var(--accent)', letterSpacing: '.5px' }}>📍 Current Address</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <Field label="House / Flat No." value={c.houseNo} />
              <div className="col-span-2"><Field label="Street & Locality" value={c.address} /></div>
              <Field label="City" value={c.city} />
              <Field label="PIN Code" value={c.pinCode} />
              <Field label="State" value={c.state} />
              <Field label="Home Type" value={c.residenceType} />
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase mb-2 flex items-center gap-2" style={{ color: 'var(--accent)', letterSpacing: '.5px' }}>
              🏡 Permanent Address
              {/* Vanilla "Same as Current" pill — efin-app.js:2580 */}
              {c.permanentHouseNo && c.permanentHouseNo === c.houseNo && c.permanentCity === c.city && (
                <span className="normal-case" style={{ fontSize: '10px', background: 'rgba(26,115,64,.1)', color: 'var(--success)', padding: '2px 10px', borderRadius: '20px', fontWeight: 600 }}>Same as Current</span>
              )}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <Field label="House / Flat No." value={c.permanentHouseNo} />
              <div className="col-span-2"><Field label="Street & Locality" value={c.permanentAddress} /></div>
              <Field label="City" value={c.permanentCity} />
              <Field label="PIN Code" value={c.permanentPinCode} />
              <Field label="State" value={c.permanentState} />
              <Field label="Home Type" value={c.permanentResidenceType} />
            </div>
          </div>
        </div>
      ))}

      {/* ── Employment ── */}
      {active === 'employment' && (editing ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Select label="Employment Type" value={form.employmentType} onChange={v => setForm(p => ({ ...p, employmentType: v }))} options={EMP_TYPES} />
          <Input label="Net Monthly Salary (₹)" value={form.monthlyIncome} onChange={v => setForm(p => ({ ...p, monthlyIncome: v }))} />
          <Input label="Company Name" value={form.companyName} onChange={v => setForm(p => ({ ...p, companyName: v }))} />
          <Input label="Designation" value={form.designation} onChange={v => setForm(p => ({ ...p, designation: v }))} />
          <Input label="Company Type" value={form.companyType} onChange={v => setForm(p => ({ ...p, companyType: v }))} />
          <Input label="Official Email ID" value={form.officialEmail} onChange={v => setForm(p => ({ ...p, officialEmail: v }))} />
          <div className="sm:col-span-2">
            <Input label="Office Address" value={form.officeAddress} onChange={v => setForm(p => ({ ...p, officeAddress: v }))} />
          </div>
          <Input label="Office PIN Code" value={form.officePinCode} onChange={v => setForm(p => ({ ...p, officePinCode: v }))} />
          <Input label="Monthly Obligations (₹)" value={form.monthlyObligations} onChange={v => setForm(p => ({ ...p, monthlyObligations: v }))} />
        </div>
      ) : loan.loanType === 'insurance' ? (
        // Insurance loans replace the whole base grid with Proposer + Policy +
        // Nominee fields — Vanilla shows NO Company/Designation/Office fields
        // for insurance (efin-app.js:2599-2615 builds an entirely separate
        // fieldGrid, it does not extend the salaried base fields).
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <Field label="Proposer Income Type" value={c.employmentType} />
          <Field label="Annual Income" value={c.monthlyIncome != null ? `₹${(c.monthlyIncome * 12).toLocaleString('en-IN')}` : ''} />
          <Field label="Insurance Type" value={pd.insType} />
          <Field label="Sum Assured" value={pd.insSumAssured ? `₹${Number(pd.insSumAssured).toLocaleString('en-IN')}` : ''} />
          <Field label="Policy Term" value={pd.insPolicyTerm ? `${pd.insPolicyTerm} Years` : ''} />
          <Field label="Payment Frequency" value={pd.insPremiumFreq} />
          <Field label="Est. Annual Premium" value={pd.insPremium ? `₹${Number(pd.insPremium).toLocaleString('en-IN')}` : ''} />
          <Field label="Preferred Insurer" value={pd.insInsurer} />
          <Field label="Existing Policy" value={pd.insExistingPolicy === 'yes' ? (pd.insExistingPolicyNumber || 'Yes') : 'None'} />
          {pd.insExistingCover && <Field label="Existing Coverage" value={`₹${Number(pd.insExistingCover).toLocaleString('en-IN')}`} />}
          <Field label="Nominee Name" value={pd.insNomineeName} />
          <Field label="Nominee Relationship" value={pd.insNomineeRelation} />
          <Field label="Nominee DOB" value={pd.insNomineeDob} />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <Field label="Employment Type" value={c.employmentType} />
            <Field label="Net Monthly Salary" value={c.monthlyIncome != null ? `₹${c.monthlyIncome.toLocaleString('en-IN')}` : ''} />
            <Field label="Company Name" value={c.companyName} />
            <Field label="Designation" value={c.designation} />
            <Field label="Company Type" value={c.companyType} />
            <Field label="Official Email ID" value={c.officialEmail} />
            <div className="col-span-2"><Field label="Office Address" value={c.officeAddress} /></div>
            <Field label="Office PIN Code" value={c.officePinCode} />
          </div>
          {/* Product-specific detail groups — Vanilla renders these on the
              Employment tab from the product bag as ONE flat grid appended
              after the base fields (efin-app.js:2659-2665: _empBaseFields +
              _propFields + _coAppFields + _carFields + _eduFields, no section
              headers, no Business/Biz group — that data is captured by the
              wizard but never shown on this tab). Kept as visually-grouped
              blocks here (existing component shape) but trimmed to exactly
              the fields/labels Vanilla renders, in Vanilla's order. */}
          {(pd.propertyType || pd.propertyValue || pd.builderSociety) &&
            <PGroup title="🏠 Property Details" rows={[['Property Type', pd.propertyType], ['Property Value', pd.propertyValue], ['Builder / Society', pd.builderSociety], ['Property City', pd.propertyCity], ['Ownership Type', pd.propertyOwnership], ['Under Construction', pd.propertyUnderConstruction]]} />}
          {(pd.coAppName || pd.coAppPan) &&
            <PGroup title="👥 Co-Applicant" rows={[['Co-Applicant Name', pd.coAppName], ['Co-Applicant PAN', pd.coAppPan], ['Co-Applicant Aadhaar', pd.coAppAadhar], ['Co-Applicant Mobile', pd.coAppMobile]]} />}
          {(pd.vehicleMake || pd.vehicleModel) &&
            <PGroup title="🚗 Vehicle Details" rows={[['Vehicle Make', pd.vehicleMake], ['Vehicle Model', pd.vehicleModel], ['Manufacture Year', pd.vehicleMfgYear], ['Ex-Showroom Price', pd.vehicleExShowroom || pd.vehiclePrice], ...(pd.vehicleKms ? [['KMs Driven', `${Number(pd.vehicleKms).toLocaleString('en-IN')} km`] as [string, string]] : []), ['Dealer Name', pd.vehicleDealer]]} />}
          {(pd.courseName || pd.instituteName) &&
            <PGroup title="🎓 Education Details" rows={[['Institution Name', pd.instituteName], ['Course Name', pd.courseName], ['Course Duration', pd.courseDuration ? `${pd.courseDuration} Year(s)` : ''], ['Study Location', pd.studyLocation], ['Admission Status', pd.admissionStatus]]} />}
        </div>
      ))}

      {/* ── References ── */}
      {active === 'references' && (editing ? (
        <div className="space-y-4">
          {refs.map((r, i) => (
            <div key={r.refNumber} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-3">
                <p className="text-[11px] font-bold text-gray-500 uppercase">Reference {r.refNumber}</p>
              </div>
              <Input label="Name" value={r.name ?? ''}
                onChange={v => setRefs(p => p.map((x, j) => j === i ? { ...x, name: v } : x))} />
              <Input label="Mobile" value={r.mobile ?? ''}
                onChange={v => setRefs(p => p.map((x, j) => j === i ? { ...x, mobile: v } : x))} />
              <Select label="Relationship" value={r.relation ?? ''}
                onChange={v => setRefs(p => p.map((x, j) => j === i ? { ...x, relation: v } : x))} options={RELATIONS} />
              <div className="sm:col-span-3">
                <Input label="Address" value={r.address ?? ''}
                  onChange={v => setRefs(p => p.map((x, j) => j === i ? { ...x, address: v } : x))} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {(loan.references ?? []).length === 0 ? (
            <p className="text-sm text-gray-400 py-4">No references recorded.</p>
          ) : (loan.references ?? []).map(r => (
            <div key={r.refNumber} className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm border-b border-gray-50 pb-3 last:border-0">
              <Field label={`Reference ${r.refNumber} — Name`} value={r.name} />
              <Field label="Mobile" value={r.mobile} />
              <Field label="Relationship" value={r.relation} />
              <div className="col-span-2 sm:col-span-3"><Field label="Address" value={refAddress(r.refNumber, r.address)} /></div>
            </div>
          ))}
        </div>
      ))}

      {editing && (
        <div className="flex items-center justify-end gap-3 mt-4 pt-4 border-t border-gray-100">
          <Button size="sm" loading={saving}
            onClick={() => (isRefsTab ? saveRefs.mutate() : saveCustomer.mutate())}>
            Save Changes
          </Button>
          <Button size="sm" variant="secondary" onClick={() => { setEditing(false); setError('') }}>Cancel</Button>
        </div>
      )}
    </Card>
  )
}
