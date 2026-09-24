import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronRight, ChevronLeft, Plus, Trash2, Building2, SlidersHorizontal, ListChecks } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { NumberInput } from '@/components/ui/NumberInput'
import { useAuthStore } from '@/store/authStore'
import {
  banksApi, parseJsonList, LOAN_PRODUCTS, EMP_TYPES, COMPANY_TYPES, HOME_TYPES,
  type BankConfig, type ProductKey,
} from '@/api/banksApi'
import { lenderConfigApi } from '@/api/lenderConfigApi'

// ── Lender Configuration → Guided "Quick Setup" ──────────────────────────────
// A single linear flow that collapses the advanced screen's product-picker +
// 3 nested tab levels + per-bank sub-tabs into three plain steps:
//   1. Bank & Product   2. Eligibility Rules   3. Approved Companies → Save
// It writes to the SAME endpoints the advanced editor uses (banksApi.create /
// update / upsertProductRule, lenderConfigApi.createLine) and therefore feeds
// the SAME eligibility engine and Wizard Step 9 — nothing about how the system
// functions changes; this is purely an easier way to reach it. The advanced
// "Bank Config" tab stays fully available for power users and edge cases.

const EMP_LABEL: Record<string, string> = { SALARIED: 'Salaried', SELFEMP: 'Self-Employed Professional', SENP: 'Self-Employed Non-Professional' }

// Match AddBankModal's new-bank seed so a bank created here behaves identically
// to one created from the advanced screen (SALARIED + the 5 standard corporate
// company types) when the user doesn't change the defaults.
const DEFAULT_EMP_TYPES = ['SALARIED']
const DEFAULT_COMP_TYPES = COMPANY_TYPES.slice(0, 5)

const numOrNull = (s: string): number | null => (s.trim() === '' ? null : Number(s))
const str = (v?: number | null) => (v == null ? '' : String(v))

type RuleForm = {
  minCibil: string; acceptNtc: boolean
  maxLoanAmt: string; minTenure: string; maxTenure: string
  foirLimit: string; pfRequired: boolean
  minAge: string; maxAge: string; minExpMonths: string
  empTypes: string[]; compTypes: string[]; homeTypes: string[]
  serviceablePins: string
}

const BLANK_RULE: RuleForm = {
  minCibil: '', acceptNtc: false, maxLoanAmt: '', minTenure: '', maxTenure: '',
  foirLimit: '', pfRequired: false, minAge: '', maxAge: '', minExpMonths: '',
  empTypes: DEFAULT_EMP_TYPES, compTypes: DEFAULT_COMP_TYPES, homeTypes: [], serviceablePins: '',
}

// Read a bank's current rule for the chosen product into the form, mirroring the
// advanced editor's buildForm (personal = base columns, others = the product's
// BankProductRule; PINs are always bank-level).
function ruleFromBank(bank: BankConfig, productKey: ProductKey): RuleForm {
  const pins = parseJsonList(bank.serviceablePinsJson).join('\n')
  if (productKey === 'personal') {
    return {
      minCibil: str(bank.minCibil), acceptNtc: !!bank.acceptNtc,
      maxLoanAmt: str(bank.maxLoanAmt), minTenure: str(bank.minTenure), maxTenure: str(bank.maxTenure),
      foirLimit: str(bank.foirLimit), pfRequired: !!bank.pfRequired,
      minAge: str(bank.minAge), maxAge: str(bank.maxAge), minExpMonths: str(bank.minExpMonths),
      empTypes: parseJsonList(bank.empTypesJson), compTypes: parseJsonList(bank.compTypesJson),
      homeTypes: parseJsonList(bank.homeTypesJson), serviceablePins: pins,
    }
  }
  const r = (bank.productRules ?? []).find(x => x.productKey === productKey)
  return {
    minCibil: str(r?.minCibil), acceptNtc: !!r?.acceptNtc,
    maxLoanAmt: str(r?.maxLoanAmt), minTenure: str(r?.minTenure), maxTenure: str(r?.maxTenure),
    foirLimit: str(r?.foirLimit), pfRequired: !!r?.pfRequired,
    minAge: str(r?.minAge), maxAge: str(r?.maxAge), minExpMonths: str(r?.minExpMonths),
    empTypes: parseJsonList(r?.empTypesJson), compTypes: parseJsonList(r?.compTypesJson),
    homeTypes: parseJsonList(r?.homeTypesJson), serviceablePins: pins,
  }
}

type PendingLine = { companyId: string; categoryId: string; pinCode: string; pf: boolean }

function StepDot({ n, label, icon, active, done }: { n: number; label: string; icon: React.ReactNode; active: boolean; done: boolean }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold"
        style={active
          ? { background: 'var(--accent)', color: '#fff' }
          : done
            ? { background: 'rgba(26,115,64,.12)', color: 'var(--success)' }
            : { background: 'var(--surface2)', color: 'var(--text3)', border: '1px solid var(--border)' }}>
        {done ? <Check size={15} strokeWidth={3} /> : icon}
      </div>
      <div className="min-w-0 hidden sm:block">
        <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>Step {n}</p>
        <p className="text-[12.5px] font-bold truncate" style={{ color: active ? 'var(--accent)' : 'var(--text2)' }}>{label}</p>
      </div>
    </div>
  )
}

function NumField({ label, value, onChange, placeholder, disabled }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-gray-500 mb-1">{label}</label>
      <NumberInput value={value} placeholder={placeholder} disabled={disabled}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue disabled:bg-gray-50" />
    </div>
  )
}

function Chips({ label, options, selected, onToggle, disabled, renderLabel }: {
  label: string; options: string[]; selected: string[]; onToggle: (v: string) => void; disabled?: boolean
  renderLabel?: (v: string) => string
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-gray-500 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map(o => {
          const on = selected.includes(o)
          return (
            <button key={o} type="button" disabled={disabled} onClick={() => onToggle(o)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors disabled:opacity-60 ${
                on ? 'bg-efin-blue text-white border-efin-blue' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}>
              {renderLabel ? renderLabel(o) : o}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function LenderQuickSetup({ onOpenAdvanced }: { onOpenAdvanced?: () => void } = {}) {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const canManage = user?.role === 'Admin' || user?.role === 'ProductTeam'

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [bankMode, setBankMode] = useState<'existing' | 'new'>('new')
  const [existingBankId, setExistingBankId] = useState('')
  const [newBankName, setNewBankName] = useState('')
  const [newIncred, setNewIncred] = useState(false)
  const [newElite, setNewElite] = useState(false)
  const [productKey, setProductKey] = useState<ProductKey>('personal')
  const [form, setForm] = useState<RuleForm>(BLANK_RULE)
  const [pendingLines, setPendingLines] = useState<PendingLine[]>([])
  const [lineDraft, setLineDraft] = useState<PendingLine>({ companyId: '', categoryId: '', pinCode: '', pf: false })
  const [addingCompany, setAddingCompany] = useState(false)
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCompany, setNewCompany] = useState({ name: '', compType: '' })
  const [newCategory, setNewCategory] = useState({ name: '', salary: '' })
  const [error, setError] = useState('')
  const [doneSummary, setDoneSummary] = useState<{ bank: string; product: string; lines: number } | null>(null)

  const { data: banks = [], isLoading } = useQuery({
    queryKey: ['banksConfig'],
    queryFn: () => banksApi.getAll().then(r => r.data.data ?? []),
  })
  const { data: companies = [] } = useQuery({
    queryKey: ['lender-companies'],
    queryFn: () => lenderConfigApi.getCompanies().then(r => r.data.data ?? []),
  })
  const { data: categories = [] } = useQuery({
    queryKey: ['lender-categories'],
    queryFn: () => lenderConfigApi.getCategories().then(r => r.data.data ?? []),
  })

  const set = <K extends keyof RuleForm>(k: K, v: RuleForm[K]) => setForm(p => ({ ...p, [k]: v }))
  const toggleIn = (k: 'empTypes' | 'compTypes' | 'homeTypes', v: string) =>
    setForm(p => ({ ...p, [k]: p[k].includes(v) ? p[k].filter(x => x !== v) : [...p[k], v] }))

  // Prefill the rule form from the chosen bank+product when editing an existing
  // bank, so its current settings are never silently wiped. A new bank starts
  // from the shared defaults.
  useEffect(() => {
    if (bankMode === 'new') { setForm(BLANK_RULE); return }
    const b = banks.find(x => x.id === Number(existingBankId))
    if (b) setForm(ruleFromBank(b, productKey))
  }, [bankMode, existingBankId, productKey, banks])

  const pins = useMemo(() => form.serviceablePins.split(/[\s,]+/).map(s => s.trim()).filter(Boolean), [form.serviceablePins])
  const badPins = pins.filter(p => !/^\d{6}$/.test(p))

  const companyName = (id: string) => companies.find(c => c.id === Number(id))?.name ?? `#${id}`
  const categoryLabel = (id: string) => {
    const c = categories.find(x => x.id === Number(id))
    return c ? `${c.name} (≥ ₹${c.salary.toLocaleString('en-IN')})` : `#${id}`
  }

  const bankLabel = bankMode === 'new'
    ? (newBankName.trim() || 'New bank')
    : (banks.find(b => b.id === Number(existingBankId))?.bankName ?? 'Bank')
  const productLabel = LOAN_PRODUCTS.find(p => p.key === productKey)?.name ?? productKey

  const step1Valid = bankMode === 'new' ? newBankName.trim().length > 0 : !!existingBankId

  function reset(keepBank = false) {
    setStep(1)
    if (!keepBank) { setBankMode('new'); setExistingBankId(''); setNewBankName(''); setNewIncred(false); setNewElite(false); setProductKey('personal') }
    setForm(BLANK_RULE); setPendingLines([]); setLineDraft({ companyId: '', categoryId: '', pinCode: '', pf: false })
    setError(''); setDoneSummary(null)
  }

  // ── Inline quick-add company / category (same endpoints as the Companies /
  // Categories tabs) so Path A can be set up without leaving this flow. ──
  const createCompany = useMutation({
    mutationFn: () => lenderConfigApi.createCompany({ name: newCompany.name.trim(), compType: newCompany.compType || undefined, empTypes: DEFAULT_EMP_TYPES }),
    onSuccess: async (res) => {
      const id = res.data.data?.id
      await qc.invalidateQueries({ queryKey: ['lender-companies'] })
      if (id) setLineDraft(p => ({ ...p, companyId: String(id) }))
      setAddingCompany(false); setNewCompany({ name: '', compType: '' })
    },
    onError: (err: unknown) => setError(errMsg(err, 'Could not add company.')),
  })
  const createCategory = useMutation({
    mutationFn: () => lenderConfigApi.createCategory({ name: newCategory.name.trim(), salary: Number(newCategory.salary) || 0 }),
    onSuccess: async (res) => {
      const id = res.data.data?.id
      await qc.invalidateQueries({ queryKey: ['lender-categories'] })
      if (id) setLineDraft(p => ({ ...p, categoryId: String(id) }))
      setAddingCategory(false); setNewCategory({ name: '', salary: '' })
    },
    onError: (err: unknown) => setError(errMsg(err, 'Could not add category.')),
  })

  function addPendingLine() {
    if (!lineDraft.companyId || !lineDraft.categoryId) return
    setPendingLines(p => [...p, lineDraft])
    setLineDraft({ companyId: '', categoryId: '', pinCode: '', pf: false })
  }

  // ── Final persist — one Save writes everything through existing endpoints ──
  const save = useMutation({
    mutationFn: async () => {
      let bankId: number
      let bankName: string
      if (bankMode === 'new') {
        const res = await banksApi.create({ bankName: newBankName.trim(), isIncred: newIncred, isElite: newElite })
        const id = res.data.data?.id
        if (!id) throw new Error('Bank could not be created.')
        bankId = id; bankName = newBankName.trim()
      } else {
        bankId = Number(existingBankId)
        bankName = banks.find(b => b.id === bankId)?.bankName ?? ''
      }
      const shared = {
        minCibil: numOrNull(form.minCibil), acceptNtc: form.acceptNtc,
        maxLoanAmt: numOrNull(form.maxLoanAmt), minTenure: numOrNull(form.minTenure), maxTenure: numOrNull(form.maxTenure),
        foirLimit: numOrNull(form.foirLimit), pfRequired: form.pfRequired,
        minAge: numOrNull(form.minAge), maxAge: numOrNull(form.maxAge), minExpMonths: numOrNull(form.minExpMonths),
        empTypes: form.empTypes, compTypes: form.compTypes,
      }
      if (productKey === 'personal') {
        await banksApi.update(bankId, { bankName, ...shared, homeTypes: form.homeTypes, serviceablePins: pins })
      } else {
        await banksApi.upsertProductRule(bankId, productKey, { ...shared, homeTypes: form.homeTypes })
        await banksApi.update(bankId, { bankName, serviceablePins: pins })
      }
      for (const ln of pendingLines) {
        await lenderConfigApi.createLine({
          bankId, companyId: Number(ln.companyId), categoryId: Number(ln.categoryId),
          pinCode: ln.pinCode.trim() || undefined, pf: ln.pf,
        })
      }
      return { bank: bankName, product: productLabel, lines: pendingLines.length }
    },
    onSuccess: (summary) => {
      setError('')
      qc.invalidateQueries({ queryKey: ['banksConfig'] })
      qc.invalidateQueries({ queryKey: ['banks'] })
      setDoneSummary(summary)
    },
    onError: (err: unknown) => setError(errMsg(err, 'Could not save this configuration.')),
  })

  if (isLoading) {
    return <Card><p className="text-sm text-gray-400 py-8 text-center">Loading…</p></Card>
  }

  if (!canManage) {
    return (
      <Card>
        <p className="text-sm font-semibold text-gray-900 mb-1">Quick Setup</p>
        <p className="text-xs text-gray-500">Your role can view lender rules but not change them. Bank setup is available to Admin / Product Team only.</p>
      </Card>
    )
  }

  if (doneSummary) {
    return (
      <Card>
        <div className="flex flex-col items-center text-center py-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-full mb-3" style={{ background: 'rgba(26,115,64,.12)' }}>
            <Check size={28} strokeWidth={3} style={{ color: 'var(--success)' }} />
          </div>
          <p className="text-lg font-extrabold text-gray-900">{doneSummary.bank} configured</p>
          <p className="text-sm text-gray-500 mt-1">
            {doneSummary.product} rules saved{doneSummary.lines > 0 ? ` · ${doneSummary.lines} approved compan${doneSummary.lines === 1 ? 'y' : 'ies'} (Path A)` : ' · Open List (Path B)'}.
          </p>
          <p className="text-xs text-gray-400 mt-1">This bank now matches applicants in the wizard's Loan Analytics step.</p>
          <div className="flex flex-wrap justify-center gap-2 mt-5">
            <Button size="sm" onClick={() => reset(false)}><Plus size={14} className="mr-1" />Set up another bank</Button>
            {onOpenAdvanced && <Button size="sm" variant="secondary" onClick={onOpenAdvanced}>Open advanced Bank Config</Button>}
          </div>
        </div>
      </Card>
    )
  }

  const nonPersonal = productKey !== 'personal'

  return (
    <Card>
      {/* Stepper */}
      <div className="flex items-center gap-2 mb-5">
        <StepDot n={1} label="Bank & Product" icon={<Building2 size={15} />} active={step === 1} done={step > 1} />
        <ChevronRight size={16} className="text-gray-300 shrink-0" />
        <StepDot n={2} label="Eligibility Rules" icon={<SlidersHorizontal size={15} />} active={step === 2} done={step > 2} />
        <ChevronRight size={16} className="text-gray-300 shrink-0" />
        <StepDot n={3} label="Companies & Save" icon={<ListChecks size={15} />} active={step === 3} done={false} />
        {onOpenAdvanced && (
          <button onClick={onOpenAdvanced} className="ml-auto text-[11px] font-semibold text-efin-blue hover:underline shrink-0">Advanced editor →</button>
        )}
      </div>

      {error && (
        <div className="text-xs rounded-lg px-3 py-2 mb-4" style={{ color: 'var(--danger)', background: 'rgba(227,30,37,.1)', border: '1px solid rgba(227,30,37,.25)' }}>{error}</div>
      )}

      {/* ── Step 1: Bank & Product ── */}
      {step === 1 && (
        <div className="space-y-5">
          <div>
            <p className="text-sm font-bold text-gray-900 mb-2">Which bank?</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button type="button" onClick={() => setBankMode('new')}
                className="rounded-xl border-2 px-4 py-3 text-left transition-colors"
                style={{ borderColor: bankMode === 'new' ? 'var(--accent)' : 'var(--border)', background: bankMode === 'new' ? 'var(--accent-subtle)' : '#fff' }}>
                <p className="text-[13px] font-bold text-gray-900">＋ Add a new bank</p>
                <p className="text-[11.5px] text-gray-500">Create a lender and configure it now</p>
              </button>
              <button type="button" onClick={() => setBankMode('existing')}
                className="rounded-xl border-2 px-4 py-3 text-left transition-colors"
                style={{ borderColor: bankMode === 'existing' ? 'var(--accent)' : 'var(--border)', background: bankMode === 'existing' ? 'var(--accent-subtle)' : '#fff' }}>
                <p className="text-[13px] font-bold text-gray-900">Edit an existing bank</p>
                <p className="text-[11.5px] text-gray-500">{banks.length} bank{banks.length === 1 ? '' : 's'} configured</p>
              </button>
            </div>
          </div>

          {bankMode === 'new' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">Bank name *</label>
                <input autoFocus value={newBankName} onChange={e => setNewBankName(e.target.value)} placeholder="e.g. Kotak Mahindra Bank"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue" />
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={newIncred} onChange={e => setNewIncred(e.target.checked)} />InCred Bank</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={newElite} onChange={e => setNewElite(e.target.checked)} />Mudrahub (Elite)</label>
            </div>
          ) : (
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Select bank *</label>
              <select value={existingBankId} onChange={e => setExistingBankId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white max-w-md">
                <option value="">— Choose a bank —</option>
                {banks.map(b => <option key={b.id} value={b.id}>{b.bankName}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">Loan product</label>
            <select value={productKey} onChange={e => setProductKey(e.target.value as ProductKey)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white max-w-md">
              {LOAN_PRODUCTS.map(p => <option key={p.key} value={p.key}>{p.icon} {p.name}</option>)}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">Rules below apply to this product{productKey === 'personal' ? ' (stored on the bank itself)' : ` (a ${productLabel} override)`}.</p>
          </div>

          <div className="flex justify-end pt-1">
            <Button size="sm" disabled={!step1Valid} onClick={() => setStep(2)}>Next: Eligibility Rules<ChevronRight size={15} className="ml-1" /></Button>
          </div>
        </div>
      )}

      {/* ── Step 2: Eligibility Rules ── */}
      {step === 2 && (
        <div className="space-y-5">
          <p className="text-[12px] text-gray-500">
            Configuring <strong className="text-gray-800">{bankLabel}</strong> · <strong className="text-gray-800">{productLabel}</strong>.
            Leave a field blank to apply <em>no</em> restriction on it.
          </p>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-2">CIBIL & Loan Limits</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
              <NumField label="Min CIBIL (300–900)" value={form.minCibil} onChange={v => set('minCibil', v)} placeholder="700" />
              <NumField label="Max Loan (₹)" value={form.maxLoanAmt} onChange={v => set('maxLoanAmt', v)} placeholder="5000000" />
              <NumField label="FOIR Limit (%)" value={form.foirLimit} onChange={v => set('foirLimit', v)} placeholder="55" />
              <label className="flex items-center gap-2 text-xs pb-2"><input type="checkbox" checked={form.acceptNtc} onChange={e => set('acceptNtc', e.target.checked)} />Accept NTC (New To Credit)</label>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-2">Tenure, Age & Experience</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
              <NumField label="Min Tenure (months)" value={form.minTenure} onChange={v => set('minTenure', v)} placeholder="12" />
              <NumField label="Max Tenure (months)" value={form.maxTenure} onChange={v => set('maxTenure', v)} placeholder="60" />
              <NumField label="Min Age" value={form.minAge} onChange={v => set('minAge', v)} placeholder="21" />
              <NumField label="Max Age" value={form.maxAge} onChange={v => set('maxAge', v)} placeholder="58" />
              <NumField label="Min Experience (months)" value={form.minExpMonths} onChange={v => set('minExpMonths', v)} placeholder="6" />
              <label className="flex items-center gap-2 text-xs pb-2"><input type="checkbox" checked={form.pfRequired} onChange={e => set('pfRequired', e.target.checked)} />PF Required</label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Chips label="EMPLOYMENT TYPES" options={EMP_TYPES} selected={form.empTypes} onToggle={v => toggleIn('empTypes', v)} renderLabel={v => EMP_LABEL[v] ?? v} />
            <Chips label="PREFERRED COMPANY TYPES" options={COMPANY_TYPES} selected={form.compTypes} onToggle={v => toggleIn('compTypes', v)} />
          </div>
          {nonPersonal && (
            <Chips label="HOME TYPES" options={HOME_TYPES} selected={form.homeTypes} onToggle={v => toggleIn('homeTypes', v)} />
          )}

          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">Serviceable PIN codes <span className="text-gray-400">(optional · blank = serves all)</span></label>
            <textarea value={form.serviceablePins} onChange={e => set('serviceablePins', e.target.value)} rows={3}
              placeholder="400001, 400002, 110001"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-efin-blue" />
            <p className="text-[11px] mt-1">
              <span className="text-gray-500">{pins.length} PIN(s)</span>
              {badPins.length > 0 && <span className="text-[color:var(--danger)] ml-2">{badPins.length} invalid (need 6 digits): {badPins.slice(0, 3).join(', ')}</span>}
            </p>
          </div>

          <div className="flex justify-between pt-1">
            <Button size="sm" variant="secondary" onClick={() => setStep(1)}><ChevronLeft size={15} className="mr-1" />Back</Button>
            <Button size="sm" disabled={badPins.length > 0} onClick={() => setStep(3)}>Next: Companies<ChevronRight size={15} className="ml-1" /></Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Approved Companies (Path A) + Save ── */}
      {step === 3 && (
        <div className="space-y-5">
          <div className="rounded-xl px-4 py-3" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
            <p className="text-[12.5px] text-gray-600">
              <strong className="text-gray-800">Approved companies are optional.</strong> Leave this empty and the bank matches every applicant who meets the rules
              (<strong style={{ color: '#0369a1' }}>Open List · Path B</strong>). Add companies to restrict the bank to those employers only
              (<strong style={{ color: 'var(--success)' }}>Company List · Path A</strong>).
            </p>
          </div>

          {/* Add-line row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 items-end">
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Company</label>
              <select value={lineDraft.companyId} onChange={e => e.target.value === '__new' ? setAddingCompany(true) : setLineDraft(p => ({ ...p, companyId: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white">
                <option value="">Select…</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="__new">＋ Add new company…</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Salary Category</label>
              <select value={lineDraft.categoryId} onChange={e => e.target.value === '__new' ? setAddingCategory(true) : setLineDraft(p => ({ ...p, categoryId: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white">
                <option value="">Select…</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name} (≥ ₹{c.salary.toLocaleString('en-IN')})</option>)}
                <option value="__new">＋ Add new category…</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">PIN Code</label>
              <input value={lineDraft.pinCode} onChange={e => setLineDraft(p => ({ ...p, pinCode: e.target.value }))} placeholder="Optional"
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm" />
            </div>
            <label className="flex items-center gap-2 text-xs pb-2"><input type="checkbox" checked={lineDraft.pf} onChange={e => setLineDraft(p => ({ ...p, pf: e.target.checked }))} />PF Required</label>
            <Button size="sm" variant="secondary" disabled={!lineDraft.companyId || !lineDraft.categoryId} onClick={addPendingLine}>
              <Plus size={13} className="mr-1" />Add
            </Button>
          </div>

          {/* Inline quick-add company */}
          {addingCompany && (
            <div className="rounded-lg border border-gray-200 p-3 grid grid-cols-1 sm:grid-cols-3 gap-2 items-end" style={{ background: 'var(--surface2)' }}>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">New company name</label>
                <input value={newCompany.name} onChange={e => setNewCompany(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Infosys Ltd"
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">Company type</label>
                <select value={newCompany.compType} onChange={e => setNewCompany(p => ({ ...p, compType: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white">
                  <option value="">—</option>
                  {COMPANY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <Button size="sm" loading={createCompany.isPending} disabled={!newCompany.name.trim()} onClick={() => createCompany.mutate()}>Save company</Button>
                <Button size="sm" variant="secondary" onClick={() => { setAddingCompany(false); setNewCompany({ name: '', compType: '' }) }}>Cancel</Button>
              </div>
            </div>
          )}
          {/* Inline quick-add category */}
          {addingCategory && (
            <div className="rounded-lg border border-gray-200 p-3 grid grid-cols-1 sm:grid-cols-3 gap-2 items-end" style={{ background: 'var(--surface2)' }}>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">New category name</label>
                <input value={newCategory.name} onChange={e => setNewCategory(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Premium"
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">Min salary (₹)</label>
                <NumberInput value={newCategory.salary} onChange={e => setNewCategory(p => ({ ...p, salary: e.target.value }))} placeholder="50000"
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm" />
              </div>
              <div className="flex gap-2">
                <Button size="sm" loading={createCategory.isPending} disabled={!newCategory.name.trim() || !newCategory.salary} onClick={() => createCategory.mutate()}>Save category</Button>
                <Button size="sm" variant="secondary" onClick={() => { setAddingCategory(false); setNewCategory({ name: '', salary: '' }) }}>Cancel</Button>
              </div>
            </div>
          )}

          {/* Pending lines list */}
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>{['Company', 'Salary Category', 'PIN', 'PF', ''].map(h => <th key={h} className="px-2.5 py-2 text-left font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {pendingLines.length === 0 && (
                  <tr><td colSpan={5} className="px-2.5 py-5 text-center text-gray-400">No companies added — bank will be <strong style={{ color: '#0369a1' }}>Open List (Path B)</strong>.</td></tr>
                )}
                {pendingLines.map((l, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-2.5 py-2 font-medium text-gray-900">{companyName(l.companyId)}</td>
                    <td className="px-2.5 py-2">{categoryLabel(l.categoryId)}</td>
                    <td className="px-2.5 py-2">{l.pinCode || '—'}</td>
                    <td className="px-2.5 py-2">{l.pf ? 'Yes' : 'No'}</td>
                    <td className="px-2.5 py-2 text-right">
                      <button onClick={() => setPendingLines(p => p.filter((_, j) => j !== i))} className="p-1 rounded text-[color:var(--danger)] hover:bg-red-50"><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {bankMode === 'existing' && (
            <p className="text-[11px] text-gray-400">Adding companies here appends to this bank's existing approved list; it never removes current ones.</p>
          )}

          {/* Review + Save */}
          <div className="rounded-xl px-4 py-3" style={{ background: 'var(--accent-subtle)', border: '1px solid var(--border)' }}>
            <p className="text-[12px] text-gray-700">
              Ready to save: <strong>{bankLabel}</strong> · <strong>{productLabel}</strong> ·{' '}
              {pendingLines.length > 0 ? <span style={{ color: 'var(--success)', fontWeight: 700 }}>Path A ({pendingLines.length} compan{pendingLines.length === 1 ? 'y' : 'ies'})</span> : <span style={{ color: '#0369a1', fontWeight: 700 }}>Path B (Open List)</span>}
              {pins.length > 0 && <> · {pins.length} PIN(s)</>}
            </p>
          </div>

          <div className="flex justify-between pt-1">
            <Button size="sm" variant="secondary" onClick={() => setStep(2)}><ChevronLeft size={15} className="mr-1" />Back</Button>
            <Button loading={save.isPending} disabled={!step1Valid || badPins.length > 0} onClick={() => save.mutate()}>
              <Check size={15} className="mr-1" strokeWidth={3} />Save Configuration
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

function errMsg(err: unknown, fallback: string): string {
  const d = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
  return d?.message || d?.errors?.join(' ') || (err instanceof Error ? err.message : '') || fallback
}
