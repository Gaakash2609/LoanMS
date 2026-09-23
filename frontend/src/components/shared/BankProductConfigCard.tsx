import { useMemo, useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { buildCsv, downloadCsv } from '@/utils/loanExport'
import { Search, ChevronLeft, X, Trash2, Plus, Download, Upload } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { useAuthStore } from '@/store/authStore'
import {
  banksApi, parseJsonList, normalizeLoanType, offersProduct, LOAN_PRODUCTS, EMP_TYPES, COMPANY_TYPES, HOME_TYPES,
  type BankConfig, type ProductKey,
} from '@/api/banksApi'
import { lenderConfigApi } from '@/api/lenderConfigApi'
import { BankRulesGrid, CibilRulesGrid, PinsGrid, EmpTypesGrid, HomeTypesGrid, CreditScoreGrid } from '@/components/shared/BankBulkConfigGrids'
import { ProductCategoriesGrid } from '@/components/shared/BankProductCategoriesTab'
import { AssignedBanksSection } from '@/components/shared/AssignedBanksSection'
import { AddBankModal } from '@/components/shared/AddBankModal'
import BulkUploadBanksModal from '@/components/shared/BulkUploadBanksModal'
import { NumberInput } from '@/components/ui/NumberInput'

// ── Lender Configuration → per-product Analytic-Banks editor ─────────────────
// Legacy "Analytic Banks" tab (efin-app.js laRenderBanks / laOpenBankDetail /
// laDetailTab, index.html #lc-panel-banks-cfg): product-first picker → a
// summary table with Path A/B eligibility mode + per-bank counts → a per-bank
// detail editor with sub-tabs (Approved Companies · PIN Codes · Employment
// Types · Salary Categories · CIBIL Rules · Bank Rules).
//
// Data model preserved: Personal Loan reads/writes the BankMaster row's own
// columns; the other 8 products read/write that bank's BankProductRule for the
// productKey. Eligibility lines + serviceable PINs are bank-level (shared
// across products), exactly as the backend stores them.

type RuleForm = {
  minCibil: string; acceptNtc: boolean
  maxLoanAmt: string; minTenure: string; maxTenure: string
  foirLimit: string; pfRequired: boolean
  minAge: string; maxAge: string; minExpMonths: string
  empTypes: string[]; compTypes: string[]; homeTypes: string[]
  serviceablePins: string
}

const n = (v?: number | null) => (v == null ? '' : String(v))
const num = (s: string): number | null => (s.trim() === '' ? null : Number(s))

function buildForm(bank: BankConfig, productKey: ProductKey): RuleForm {
  if (productKey === 'personal') {
    return {
      minCibil: n(bank.minCibil), acceptNtc: !!bank.acceptNtc,
      maxLoanAmt: n(bank.maxLoanAmt), minTenure: n(bank.minTenure), maxTenure: n(bank.maxTenure),
      foirLimit: n(bank.foirLimit), pfRequired: !!bank.pfRequired,
      minAge: n(bank.minAge), maxAge: n(bank.maxAge), minExpMonths: n(bank.minExpMonths),
      empTypes: parseJsonList(bank.empTypesJson),
      compTypes: parseJsonList(bank.compTypesJson),
      homeTypes: parseJsonList(bank.homeTypesJson),
      serviceablePins: parseJsonList(bank.serviceablePinsJson).join('\n'),
    }
  }
  const r = (bank.productRules ?? []).find(x => x.productKey === productKey)
  return {
    minCibil: n(r?.minCibil), acceptNtc: !!r?.acceptNtc,
    maxLoanAmt: n(r?.maxLoanAmt), minTenure: n(r?.minTenure), maxTenure: n(r?.maxTenure),
    foirLimit: n(r?.foirLimit), pfRequired: !!r?.pfRequired,
    minAge: n(r?.minAge), maxAge: n(r?.maxAge), minExpMonths: n(r?.minExpMonths),
    empTypes: parseJsonList(r?.empTypesJson),
    compTypes: parseJsonList(r?.compTypesJson),
    homeTypes: parseJsonList(r?.homeTypesJson),
    // Serviceable PINs live only on the bank row (no per-product PIN column),
    // so they stay bank-level for every product — same as legacy.
    serviceablePins: parseJsonList(bank.serviceablePinsJson).join('\n'),
  }
}

/** Per-product rule accessor for the summary table (personal = base columns). */
function ruleFor(bank: BankConfig, productKey: ProductKey) {
  if (productKey === 'personal') {
    return { minCibil: bank.minCibil, acceptNtc: bank.acceptNtc, maxLoanAmt: bank.maxLoanAmt, foirLimit: bank.foirLimit, empTypesJson: bank.empTypesJson }
  }
  const r = (bank.productRules ?? []).find(x => x.productKey === productKey)
  return { minCibil: r?.minCibil, acceptNtc: r?.acceptNtc, maxLoanAmt: r?.maxLoanAmt, foirLimit: r?.foirLimit, empTypesJson: r?.empTypesJson }
}

function NumField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-gray-500 mb-1">{label}</label>
      <NumberInput value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue" />
    </div>
  )
}

function ChipGroup({ label, options, selected, onToggle }: {
  label: string; options: string[]; selected: string[]; onToggle: (v: string) => void
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-gray-500 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map(o => {
          const on = selected.includes(o)
          return (
            <button key={o} type="button" onClick={() => onToggle(o)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                on ? 'bg-efin-blue text-white border-efin-blue' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}>
              {o}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const EMP_TYPE_META: Record<string, { title: string; desc: string }> = {
  SALARIED: { title: 'Salaried', desc: 'Fixed monthly salary · Employed with a company or government' },
  SELFEMP:  { title: 'Self-Employed Professional (SEP)', desc: 'Doctors, CAs, Lawyers, Architects — licensed professionals' },
  SENP:     { title: 'Self-Employed Non-Professional (SENP)', desc: 'Traders, Manufacturers, Business Owners — non-licensed' },
}

type DetailTab = 'companies' | 'pins' | 'emptype' | 'categories' | 'cibil' | 'rules'
const DETAIL_TABS: { key: DetailTab; label: string }[] = [
  { key: 'companies',  label: '🏢 Approved Companies' },
  { key: 'pins',       label: '📍 PIN Codes' },
  { key: 'emptype',    label: '👔 Employment Types' },
  { key: 'categories', label: '📂 Salary Categories' },
  { key: 'cibil',      label: '💳 CIBIL Rules' },
  { key: 'rules',      label: '📋 Bank Rules' },
]

// ── Per-bank detail editor (legacy la-bank-detail) ───────────────────────────
function BankDetailEditor({ bank, productKey, canEdit, onClose }: {
  bank: BankConfig; productKey: ProductKey; canEdit: boolean; onClose: () => void
}) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<DetailTab>('companies')
  const [form, setForm] = useState<RuleForm>(() => buildForm(bank, productKey))
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [lineForm, setLineForm] = useState({ companyId: '', categoryId: '', pinCode: '', pf: false })

  const { data: companies } = useQuery({ queryKey: ['lender-companies'], queryFn: () => lenderConfigApi.getCompanies().then(r => r.data.data ?? []) })
  const { data: categories } = useQuery({ queryKey: ['lender-categories'], queryFn: () => lenderConfigApi.getCategories().then(r => r.data.data ?? []) })
  const companyName = (id: number) => companies?.find(c => c.id === id)?.name ?? `#${id}`
  const categoryName = (id: number) => categories?.find(c => c.id === id)?.name ?? `#${id}`
  const categorySalary = (id: number) => categories?.find(c => c.id === id)?.salary
  const salaryLabel = (id: number) => { const s = categorySalary(id); return s != null ? `₹${s.toLocaleString('en-IN')}` : '—' }

  const set = <K extends keyof RuleForm>(k: K, v: RuleForm[K]) => setForm(p => ({ ...p, [k]: v }))
  const toggleIn = (k: 'empTypes' | 'compTypes' | 'homeTypes', v: string) =>
    setForm(p => ({ ...p, [k]: p[k].includes(v) ? p[k].filter(x => x !== v) : [...p[k], v] }))

  const pins = form.serviceablePins.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
  const badPins = pins.filter(p => !/^\d{6}$/.test(p))

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['banksConfig'] }); qc.invalidateQueries({ queryKey: ['banks'] }) }

  // Saves the rule record (CIBIL + Bank Rules + emp/company/home types) plus
  // the bank-level serviceable PINs — one PUT each, matching the backend's
  // single-record model (legacy split these across tabs only because it was
  // client-side; here they persist to the same rows).
  const save = useMutation({
    mutationFn: async () => {
      const shared = {
        minCibil: num(form.minCibil), acceptNtc: form.acceptNtc,
        maxLoanAmt: num(form.maxLoanAmt), minTenure: num(form.minTenure), maxTenure: num(form.maxTenure),
        foirLimit: num(form.foirLimit), pfRequired: form.pfRequired,
        minAge: num(form.minAge), maxAge: num(form.maxAge), minExpMonths: num(form.minExpMonths),
        empTypes: form.empTypes, compTypes: form.compTypes,
      }
      if (productKey === 'personal') {
        await banksApi.update(bank.id, { bankName: bank.bankName, ...shared, homeTypes: form.homeTypes, serviceablePins: pins })
      } else {
        await banksApi.upsertProductRule(bank.id, productKey, { ...shared, homeTypes: form.homeTypes })
        await banksApi.update(bank.id, { bankName: bank.bankName, serviceablePins: pins })
      }
    },
    onSuccess: () => { setError(''); setSaved(true); setTimeout(() => setSaved(false), 2500); invalidate() },
    onError: (err: unknown) => {
      const d = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      setError(d?.message || d?.errors?.join(' ') || 'Could not save these rules.')
    },
  })

  const addLine = useMutation({
    mutationFn: () => lenderConfigApi.createLine({
      bankId: bank.id, companyId: Number(lineForm.companyId), categoryId: Number(lineForm.categoryId),
      pinCode: lineForm.pinCode.trim() || undefined, pf: lineForm.pf,
    }),
    onSuccess: () => { setLineForm({ companyId: '', categoryId: '', pinCode: '', pf: false }); invalidate() },
    onError: (err: unknown) => {
      const d = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      setError(d?.message || d?.errors?.join(' ') || 'Could not add line.')
    },
  })
  const removeLine = useMutation({
    mutationFn: (id: number) => lenderConfigApi.deleteLine(id),
    onSuccess: invalidate,
  })

  const lines = bank.lines ?? []
  const distinctCatIds = [...new Set(lines.map(l => l.categoryId))]

  return (
    <div className="border-2 rounded-2xl overflow-hidden" style={{ borderColor: 'rgba(8,88,151,.18)' }}>
      {/* Detail header */}
      <div className="px-5 py-4 border-b border-gray-200" style={{ background: 'rgba(8,88,151,.03)' }}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[10px] flex items-center justify-center font-extrabold text-base shrink-0"
              style={{ background: bank.isIncred ? 'rgba(245,158,11,.15)' : 'rgba(77,124,255,.12)', color: bank.isIncred ? '#f59e0b' : 'var(--accent)' }}>
              {bank.bankName.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <p className="font-extrabold text-base text-gray-900">{bank.bankName}</p>
              <p className="text-[10.5px] mt-0.5">
                {lines.length > 0
                  ? <span style={{ color: 'var(--success)', fontWeight: 700 }}>🏢 Company List (Path A)</span>
                  : <span style={{ color: '#0369a1', fontWeight: 700 }}>🔓 Open List (Path B)</span>}
                {bank.isIncred && <span style={{ color: '#f59e0b', fontWeight: 700, marginLeft: 8 }}>InCred</span>}
                {bank.isElite && <span style={{ color: 'var(--success)', fontWeight: 700, marginLeft: 6 }}>Mudrahub</span>}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100" title="Close"><X size={16} /></button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-0 border-b border-gray-200 overflow-x-auto" style={{ background: 'var(--surface2)' }}>
        {DETAIL_TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="px-4 py-2.5 text-[12.5px] font-semibold whitespace-nowrap border-b-2 transition-colors"
            style={tab === t.key
              ? { borderColor: 'var(--accent)', color: 'var(--accent)' }
              : { borderColor: 'transparent', color: 'var(--text3)' }}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-5 space-y-4">
        {error && (
          <div className="text-xs rounded-lg px-3 py-2" style={{ color: 'var(--danger)', background: 'rgba(192,57,43,.1)', border: '1px solid rgba(192,57,43,.25)' }}>{error}</div>
        )}

        {/* ── Approved Companies (eligibility lines) ── */}
        {tab === 'companies' && (
          <div>
            <p className="text-xs text-gray-500 mb-3">List of employer companies this bank approves. If <strong>empty</strong> → bank uses Path B (Open List matching only).</p>
            {canEdit && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 mb-3 items-end">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 mb-1">Company</label>
                  <select value={lineForm.companyId} onChange={e => setLineForm(p => ({ ...p, companyId: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white">
                    <option value="">Select…</option>
                    {(companies ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 mb-1">Salary Category</label>
                  <select value={lineForm.categoryId} onChange={e => setLineForm(p => ({ ...p, categoryId: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white">
                    <option value="">Select…</option>
                    {(categories ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 mb-1">PIN Code</label>
                  <input value={lineForm.pinCode} onChange={e => setLineForm(p => ({ ...p, pinCode: e.target.value }))} placeholder="Optional" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm" />
                </div>
                <label className="flex items-center gap-2 text-xs pb-2"><input type="checkbox" checked={lineForm.pf} onChange={e => setLineForm(p => ({ ...p, pf: e.target.checked }))} />PF Required</label>
                <Button size="sm" loading={addLine.isPending} disabled={!lineForm.companyId || !lineForm.categoryId} onClick={() => addLine.mutate()}>
                  <Plus size={13} className="mr-1" />Add Line
                </Button>
              </div>
            )}
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>{['Company', 'Salary Category', 'PIN Code', 'Min Salary', 'PF', ''].map(h => <th key={h} className="px-2.5 py-2 text-left font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {lines.length === 0 && <tr><td colSpan={6} className="px-2.5 py-6 text-center text-gray-400">No approved companies — this bank is Open List (Path B).</td></tr>}
                  {lines.map(l => (
                    <tr key={l.id} className="border-t border-gray-100">
                      <td className="px-2.5 py-2 font-medium text-gray-900">{companyName(l.companyId)}</td>
                      <td className="px-2.5 py-2">{categoryName(l.categoryId)}</td>
                      <td className="px-2.5 py-2">{l.pinCode || '—'}</td>
                      <td className="px-2.5 py-2">{salaryLabel(l.categoryId)}</td>
                      <td className="px-2.5 py-2">{l.pf ? 'Yes' : 'No'}</td>
                      <td className="px-2.5 py-2 text-right">
                        {canEdit && <button onClick={() => { if (confirm('Delete this line?')) removeLine.mutate(l.id) }} className="p-1 rounded text-[color:var(--danger)] hover:bg-red-50"><Trash2 size={13} /></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-gray-400 mt-2"><span style={{ color: 'var(--accent)', fontWeight: 700 }}>{lines.length}</span> approved company line(s).</p>
          </div>
        )}

        {/* ── PIN Codes ── */}
        {tab === 'pins' && (
          <div>
            <p className="text-xs text-gray-500 mb-2">6-digit PIN codes this bank services. Leave <strong>empty</strong> = no geographic restriction (serves all locations).</p>
            <textarea value={form.serviceablePins} onChange={e => set('serviceablePins', e.target.value)} rows={5}
              placeholder={'400001, 400002, 110001'} disabled={!canEdit}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-efin-blue" />
            <p className="text-[11px] mt-1">
              <span className="text-gray-500">{pins.length} PIN(s)</span>
              {badPins.length > 0 && <span className="text-[color:var(--danger)] ml-2">{badPins.length} invalid (6 digits): {badPins.slice(0, 3).join(', ')}</span>}
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <button type="button" disabled={pins.length === 0}
                onClick={() => downloadCsv(buildCsv(['Bank', 'Pin Code'], pins.map(p => [bank.bankName, p])), `${bank.bankName.replace(/\s+/g, '-').toLowerCase()}-pins.csv`)}
                className="text-[11px] font-semibold text-efin-blue hover:underline disabled:opacity-40">Export PINs</button>
              <span className="text-gray-300">·</span>
              <button type="button" onClick={() => downloadCsv(buildCsv(['Pin Code'], [['400001'], ['110001']]), 'pin-codes-template.csv')} className="text-[11px] font-semibold text-efin-blue hover:underline">Download template</button>
              {canEdit && (<>
                <span className="text-gray-300">·</span>
                <label className="text-[11px] font-semibold text-efin-blue hover:underline cursor-pointer">Import CSV
                  <input type="file" accept=".csv" className="hidden" onChange={async e => {
                    const file = e.target.files?.[0]; e.target.value = ''
                    if (!file) return
                    const text = await file.text()
                    const found = text.match(/\b\d{6}\b/g) ?? []
                    if (!found.length) { setError('No 6-digit PIN codes found in that file.'); return }
                    setError(''); set('serviceablePins', Array.from(new Set([...pins, ...found])).join('\n'))
                  }} />
                </label>
              </>)}
            </div>
          </div>
        )}

        {/* ── Employment Types + Company Types ── */}
        {tab === 'emptype' && (
          <div className="space-y-4">
            <p className="text-xs text-gray-500">Select which employment types this bank accepts for loan applications.</p>
            <div className="flex flex-col gap-2.5">
              {EMP_TYPES.map(e => {
                const on = form.empTypes.includes(e)
                const meta = EMP_TYPE_META[e]
                return (
                  <label key={e} className="flex items-start gap-3 px-4 py-3 rounded-[10px] border cursor-pointer"
                    style={{ background: 'var(--surface2)', borderColor: on ? 'var(--accent)' : 'var(--border)' }}>
                    <input type="checkbox" checked={on} disabled={!canEdit} onChange={() => toggleIn('empTypes', e)} className="mt-0.5" style={{ accentColor: 'var(--accent)' }} />
                    <div><div className="text-[13px] font-semibold text-gray-900">{meta?.title ?? e}</div><div className="text-[11.5px] text-gray-500 mt-0.5">{meta?.desc}</div></div>
                  </label>
                )
              })}
            </div>
            <ChipGroup label="PREFERRED COMPANY TYPES" options={COMPANY_TYPES} selected={form.compTypes} onToggle={v => canEdit && toggleIn('compTypes', v)} />
            {productKey !== 'personal' && <ChipGroup label="HOME TYPES" options={HOME_TYPES} selected={form.homeTypes} onToggle={v => canEdit && toggleIn('homeTypes', v)} />}
          </div>
        )}

        {/* ── Salary Categories (derived from lines + global list) ── */}
        {tab === 'categories' && (
          <div>
            <p className="text-xs text-gray-500 mb-3">Salary categories set the minimum income threshold. Categories are managed globally in the <strong>Categories</strong> tab and applied to this bank through its approved-company lines.</p>
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">In use by this bank ({distinctCatIds.length})</p>
            {distinctCatIds.length === 0
              ? <p className="text-sm text-gray-400">No categories in use — add approved-company lines to assign categories.</p>
              : (
                <div className="flex flex-col gap-1.5">
                  {distinctCatIds.map(id => (
                    <div key={id} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm">
                      <span className="font-medium text-gray-900">{categoryName(id)}</span>
                      <span className="text-xs text-gray-500">{categorySalary(id) != null ? `Salary ≥ ${salaryLabel(id)}` : ''}</span>
                    </div>
                  ))}
                </div>
              )}
          </div>
        )}

        {/* ── CIBIL Rules ── */}
        {tab === 'cibil' && (
          <div>
            <p className="text-xs text-gray-500 mb-3">Minimum CIBIL score and credit-history acceptance rules for this bank.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 items-end max-w-xl">
              <NumField label="Min CIBIL (300–900)" value={form.minCibil} onChange={v => set('minCibil', v)} placeholder="700" />
              <label className="flex items-center gap-2 text-xs pb-2"><input type="checkbox" checked={form.acceptNtc} disabled={!canEdit} onChange={e => set('acceptNtc', e.target.checked)} />Accept NTC (New To Credit)</label>
            </div>
          </div>
        )}

        {/* ── Bank Rules ── */}
        {tab === 'rules' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
            <NumField label="Max Loan Amount (₹)" value={form.maxLoanAmt} onChange={v => set('maxLoanAmt', v)} placeholder="5000000" />
            <NumField label="Min Tenure (months)" value={form.minTenure} onChange={v => set('minTenure', v)} placeholder="12" />
            <NumField label="Max Tenure (months)" value={form.maxTenure} onChange={v => set('maxTenure', v)} placeholder="60" />
            <NumField label="FOIR Limit (%)" value={form.foirLimit} onChange={v => set('foirLimit', v)} placeholder="55" />
            <NumField label="Min Age" value={form.minAge} onChange={v => set('minAge', v)} placeholder="21" />
            <NumField label="Max Age" value={form.maxAge} onChange={v => set('maxAge', v)} placeholder="58" />
            <NumField label="Min Experience (months)" value={form.minExpMonths} onChange={v => set('minExpMonths', v)} placeholder="6" />
            <label className="flex items-center gap-2 text-xs pb-2"><input type="checkbox" checked={form.pfRequired} disabled={!canEdit} onChange={e => set('pfRequired', e.target.checked)} />PF Required</label>
          </div>
        )}

        {/* Save (rules + PINs). Approved-company lines save inline above. */}
        {canEdit && tab !== 'companies' && tab !== 'categories' && (
          <div className="flex items-center gap-3 pt-1 border-t border-gray-100">
            <Button size="sm" loading={save.isPending} disabled={badPins.length > 0} onClick={() => save.mutate()}>Save</Button>
            <Button size="sm" variant="secondary" onClick={() => setForm(buildForm(bank, productKey))}>Reset</Button>
            {saved && <span className="text-xs font-semibold text-[color:var(--success)]">✓ Saved</span>}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl px-3.5 py-2.5" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
      <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text3)' }}>{label}</p>
      <p className="text-xl font-extrabold" style={{ fontFamily: 'var(--font-head)', color }}>{value}</p>
    </div>
  )
}

// The general-config sub-sections legacy nests under the PERSONAL product
// workspace only (index.html #lc-general-config-section, shown when
// isPersonalLoan; efin-app.js lcSelectProduct). Passed in from LenderConfigPage
// so the existing Companies/Categories/Import-Lines components move here rather
// than being duplicated.
type WorkTab = 'banks' | 'companies' | 'categories' | 'lines' | 'bankrules' | 'cibil' | 'pins' | 'emptypes' | 'hometypes' | 'creditscore' | 'prodcategories'

// Non-personal multi-config bulk-grid tabs (legacy #lc-multi-config-section /
// lcBl*). 'banks' is the Analytic-Banks summary table (the Assign/Unassign
// surface + per-bank detail editor); the rest are product-scoped bulk grids
// that write each assigned bank's BankProductRule (or per-product category).
const NP_GRID_TABS: WorkTab[] = ['pins', 'emptypes', 'cibil', 'hometypes', 'bankrules', 'prodcategories', 'creditscore']

// Module-scoped workspace state — mirrors legacy's module-level _lcActiveProduct
// (efin-app.js:15897) so the selected product and nested tab SURVIVE component
// remounts within the SPA session (switching to the Match tab and back,
// leaving and re-entering the page). Vanilla keeps it in a module var and only
// loses it on a full reload — this reproduces exactly that (reset on reload).
// Before this, productKey was local useState and every remount snapped the
// user back to the product picker.
let _lcActiveProduct: ProductKey | null = null
let _lcWorkTab: WorkTab = 'banks'

export default function BankProductConfigCard({ companiesTab, categoriesTab, linesTab }: {
  companiesTab?: ReactNode; categoriesTab?: ReactNode; linesTab?: ReactNode
} = {}) {
  const user = useAuthStore(s => s.user)
  const canEdit = ['Admin', 'ProductTeam'].includes(user?.role ?? '')
  const [productKey, _setProductKey] = useState<ProductKey | null>(() => _lcActiveProduct)
  const setProductKey = (v: ProductKey | null) => { _lcActiveProduct = v; _setProductKey(v) }
  const [search, setSearch] = useState('')
  const [pathFilter, setPathFilter] = useState<'' | 'patha' | 'pathb'>('')
  const [openBankId, setOpenBankId] = useState<number | null>(null)
  // Nested workspace tab (Personal only) — legacy #lc-tabs order verbatim:
  // Analytic Banks · Companies · Categories · Import Lines · Bank Rules ·
  // CIBIL Rules · Serviceable PINs · Employment Types. Default 'banks'.
  // Persisted in the module var above so it also survives remounts.
  const [workTab, _setWorkTab] = useState<WorkTab>(() => _lcWorkTab)
  const setWorkTab = (v: WorkTab) => { _lcWorkTab = v; _setWorkTab(v) }
  // Product-assignment filter (legacy Assigned-Banks grid shows banks offered
  // for the selected product). Default 'offered' to mirror Vanilla.
  const [assignFilter, setAssignFilter] = useState<'offered' | 'not' | 'all'>('offered')
  const [showBulkUpload, setShowBulkUpload] = useState(false)
  const [showAddBank, setShowAddBank] = useState(false)
  const qc = useQueryClient()

  const { data: banks, isLoading } = useQuery({
    queryKey: ['banksConfig'],
    queryFn: () => banksApi.getAll().then(r => r.data.data ?? []),
  })

  // A bank "offers" a product iff its loanTypes list is empty (→ all products,
  // legacy null case) OR contains the product (normalised). Assign/Unassign
  // writes Banks.LoanTypesJson via PUT /api/banks (banksApi.update).
  // offersProduct is the shared helper in banksApi (also used by the
  // per-product bulk grids to pick assigned banks).
  const setOffered = useMutation({
    mutationFn: ({ bank, next }: { bank: BankConfig; next: string[] }) =>
      banksApi.update(bank.id, { bankName: bank.bankName, loanTypes: next }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['banksConfig'] }),
  })
  const toggleOffered = (b: BankConfig, pk: string) => {
    const lt = parseJsonList(b.loanTypesJson)
    const norm = normalizeLoanType(pk)
    const allKeys = LOAN_PRODUCTS.map(p => p.key as string)
    let next: string[]
    if (offersProduct(b, pk)) {
      // Unassign — materialise "all except this" when it was the all-products
      // (empty) case, otherwise just drop this product.
      next = lt.length === 0 ? allKeys.filter(k => normalizeLoanType(k) !== norm) : lt.filter(k => normalizeLoanType(k) !== norm)
    } else {
      next = [...lt, pk]
      if (allKeys.every(k => next.map(normalizeLoanType).includes(normalizeLoanType(k)))) next = [] // collapse to all
    }
    setOffered.mutate({ bank: b, next })
  }

  const allBanks = useMemo(() => banks ?? [], [banks])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const offered = (b: BankConfig) => productKey != null && offersProduct(b, productKey)
    return allBanks.filter(b =>
      (!q || b.bankName.toLowerCase().includes(q)) &&
      (pathFilter === '' || (pathFilter === 'patha' ? (b.lines?.length ?? 0) > 0 : (b.lines?.length ?? 0) === 0)) &&
      (productKey == null || assignFilter === 'all' || (assignFilter === 'offered' ? offered(b) : !offered(b))),
    )
  }, [allBanks, search, pathFilter, assignFilter, productKey])

  // ── Stage 1: product picker ── (legacy: each card carries a "Full Config +"
  // action, and the whole card opens the product's full configuration.)
  if (!productKey) {
    const openProduct = (k: ProductKey) => { setProductKey(k); setOpenBankId(null); setWorkTab(k === 'personal' ? 'banks' : 'pins') }
    return (
      <Card>
        <p className="text-sm font-semibold text-gray-900 mb-1">Choose a Loan Product</p>
        <p className="text-xs text-gray-500 mb-4">Select a loan product to manage its bank eligibility settings</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {LOAN_PRODUCTS.map(p => (
            <div key={p.key} onClick={() => openProduct(p.key)}
              className="flex flex-col border border-gray-200 rounded-xl overflow-hidden text-left hover:border-efin-blue hover:bg-efin-blue/10 transition-colors cursor-pointer">
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="text-2xl">{p.icon}</span>
                <div><p className="text-sm font-semibold text-gray-900">{p.name}</p><p className="text-xs text-gray-500">{p.desc}</p></div>
              </div>
              <button onClick={e => { e.stopPropagation(); openProduct(p.key) }}
                className="text-[12px] font-bold text-efin-blue text-left px-4 py-2 border-t border-gray-100 hover:bg-efin-blue/5">
                Full Config +
              </button>
            </div>
          ))}
        </div>
      </Card>
    )
  }

  const product = LOAN_PRODUCTS.find(p => p.key === productKey) ?? LOAN_PRODUCTS[0]
  const stats = {
    total: allBanks.length,
    lines: allBanks.reduce((s, b) => s + (b.lines?.length ?? 0), 0),
    pathA: allBanks.filter(b => (b.lines?.length ?? 0) > 0).length,
    pathB: allBanks.filter(b => (b.lines?.length ?? 0) === 0).length,
    incred: allBanks.filter(b => b.isIncred).length,
  }
  const openBank = filtered.find(b => b.id === openBankId) ?? null

  const configScope = productKey === 'personal'
    ? 'bank assignment & full configuration (Analytic Banks, Companies, Categories, Import Lines)'
    : 'bank assignment & full configuration (Assigned Banks, PINs, Employment, CIBIL, Home Type, Bank Rules, Categories, Credit Score)'

  // Non-personal products mirror legacy lc-multi-config-section EXACTLY — the 7
  // lcBl tabs only (NO Analytic Banks tab; that summary/detail lives in the
  // Personal general-config). Fall back to the first tab if a stale personal
  // tab (e.g. 'banks') is carried over.
  const npActiveTab: WorkTab = NP_GRID_TABS.includes(workTab) ? workTab : 'pins'

  return (
    <Card>
      {/* Active product bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900">{product.icon} {product.name} — Bank Configuration</p>
          <p className="text-xs text-gray-500">{product.name} — {configScope}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => { setProductKey(null); setOpenBankId(null) }}><ChevronLeft size={14} className="mr-0.5" />Change Product</Button>
      </div>

      {/* Assigned Banks (per product) — legacy #lc-product-banks. Bank
          create/assign/edit/remove for THIS product, above the config tabs. */}
      <AssignedBanksSection canEdit={canEdit} productKey={productKey} />

      <p className="text-center text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">General Configuration</p>

      {/* Nested workspace tabs — legacy #lc-tabs, shown for PERSONAL only
          (index.html #lc-general-config-section: display when isPersonalLoan;
          efin-app.js lcSelectProduct). Order verbatim: Analytic Banks ·
          Companies · Categories · Import Lines. Default 'banks'. */}
      {productKey === 'personal' && (
        <div className="flex gap-1 border-b border-gray-200 mb-4 overflow-x-auto">
          {([
            ['banks', '🏛 Analytic Banks'], ['companies', '🏢 Companies'], ['categories', '📂 Categories'], ['lines', '📥 Import Lines'],
            ['bankrules', '📋 Bank Rules'], ['cibil', '💳 CIBIL Rules'], ['pins', '📍 Serviceable PINs'], ['emptypes', '👔 Employment Types'],
          ] as [typeof workTab, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setWorkTab(k)}
              className="px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors"
              style={workTab === k ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : { borderColor: 'transparent', color: 'var(--text3)' }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Multi-config workspace tabs — legacy #lc-multi-config-section / lcBl*,
          shown for the 8 NON-PERSONAL products (efin-app.js lcSelectProduct
          isMultiConfig). Order: Analytic Banks (assign + per-bank detail) ·
          Serviceable PINs · Employment Types · CIBIL · Home Type · Bank Rules.
          Each grid (except PINs, which is bank-wide) edits the assigned banks'
          per-product BankProductRule. Default 'banks'. */}
      {productKey !== 'personal' && (
        <div className="flex gap-1 border-b border-gray-200 mb-4 overflow-x-auto">
          {([
            ['pins', '📍 Serviceable PINs'], ['emptypes', '👔 Employment Types'],
            ['cibil', '💳 CIBIL Rules'], ['hometypes', '🏠 Home Type'], ['bankrules', '📋 Bank Rules'],
            ['prodcategories', '📂 Categories'], ['creditscore', '🏦 Banking/Credit Score'],
          ] as [typeof workTab, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setWorkTab(k)}
              className="px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors"
              style={npActiveTab === k ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : { borderColor: 'transparent', color: 'var(--text3)' }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {productKey === 'personal' && workTab === 'companies' && companiesTab}
      {productKey === 'personal' && workTab === 'categories' && categoriesTab}
      {productKey === 'personal' && workTab === 'lines' && linesTab}
      {productKey === 'personal' && workTab === 'bankrules' && <BankRulesGrid canEdit={canEdit} />}
      {productKey === 'personal' && workTab === 'cibil' && <CibilRulesGrid canEdit={canEdit} />}
      {productKey === 'personal' && workTab === 'pins' && <PinsGrid canEdit={canEdit} />}
      {productKey === 'personal' && workTab === 'emptypes' && <EmpTypesGrid canEdit={canEdit} />}

      {/* Non-personal product-scoped bulk grids (write BankProductRule[pk]) —
          exactly the 7 legacy lcBl tabs, no Analytic Banks tab. */}
      {productKey !== 'personal' && npActiveTab === 'pins' && <PinsGrid canEdit={canEdit} productKey={productKey} />}
      {productKey !== 'personal' && npActiveTab === 'emptypes' && <EmpTypesGrid canEdit={canEdit} productKey={productKey} />}
      {productKey !== 'personal' && npActiveTab === 'cibil' && <CibilRulesGrid canEdit={canEdit} productKey={productKey} />}
      {productKey !== 'personal' && npActiveTab === 'hometypes' && <HomeTypesGrid canEdit={canEdit} productKey={productKey} />}
      {productKey !== 'personal' && npActiveTab === 'bankrules' && <BankRulesGrid canEdit={canEdit} productKey={productKey} />}
      {productKey !== 'personal' && npActiveTab === 'prodcategories' && <ProductCategoriesGrid canEdit={canEdit} productKey={productKey} />}
      {productKey !== 'personal' && npActiveTab === 'creditscore' && <CreditScoreGrid canEdit={canEdit} productKey={productKey} />}

      {/* Analytic Banks summary + per-bank detail — PERSONAL general-config only
          (legacy: shown under isPersonalLoan; non-personal uses the lcBl grids). */}
      {productKey === 'personal' && workTab === 'banks' && (<>
      {/* Analytic Banks toolbar — legacy "Lender Configuration List" header +
          Export (laExportBanks) · Bulk Upload (laOpenBulkUploadModal) ·
          + Add Bank (laOpenAddBankModal). */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="mr-auto min-w-0">
          <p className="text-sm font-bold text-gray-900">Lender Configuration List</p>
          <p className="text-[11px] text-gray-500">Each bank's eligibility filters: Approved Companies · PIN Codes · Employment Types · Salary Categories · CIBIL Rules · Bank Rules</p>
        </div>
        <Button size="sm" variant="secondary" disabled={allBanks.length === 0}
          onClick={() => downloadCsv(buildCsv(['Bank', 'InCred', 'Elite', 'Min CIBIL', 'Max Loan', 'FOIR %', 'Serviceable PINs'],
            allBanks.map(b => [b.bankName, b.isIncred ? 'Yes' : 'No', b.isElite ? 'Yes' : 'No', String(b.minCibil ?? ''), String(b.maxLoanAmt ?? ''), String(b.foirLimit ?? ''), String(parseJsonList(b.serviceablePinsJson).length)])),
            `lender-banks-${product.key}-${new Date().toISOString().slice(0, 10)}.csv`)}>
          <Download size={14} className="mr-1" />Export
        </Button>
        {canEdit && <Button size="sm" variant="secondary" onClick={() => setShowBulkUpload(true)}><Upload size={14} className="mr-1" />Bulk Upload</Button>}
        {canEdit && <Button size="sm" onClick={() => setShowAddBank(true)}><Plus size={14} className="mr-1" />Add Bank</Button>}
      </div>
      {/* Path A/B explainer */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mb-3">
        <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(26,115,64,.05)', border: '1.5px solid rgba(26,115,64,.2)' }}>
          <p className="text-[11px] font-extrabold uppercase tracking-wide mb-1" style={{ color: 'var(--success)' }}>🏢 Path A — Company List</p>
          <p className="text-[11.5px] text-gray-600 leading-relaxed">Bank appears <strong>only if</strong> the applicant's company is in the approved list and all other criteria match.</p>
        </div>
        <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(3,105,161,.05)', border: '1.5px solid rgba(3,105,161,.2)' }}>
          <p className="text-[11px] font-extrabold uppercase tracking-wide mb-1" style={{ color: '#0369a1' }}>🔓 Path B — Open List</p>
          <p className="text-[11.5px] text-gray-600 leading-relaxed">No company list. Eligibility from <strong>Bank Rules · CIBIL · PIN · Category · Employment Type</strong>.</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-4">
        <StatCard label="Total Banks" value={stats.total} color="var(--accent)" />
        <StatCard label="Company Lines" value={stats.lines} color="var(--accent2)" />
        <StatCard label="Path A · Co. List" value={stats.pathA} color="var(--success)" />
        <StatCard label="Path B · Open List" value={stats.pathB} color="#0369a1" />
        <StatCard label="InCred Banks" value={stats.incred} color="var(--warn)" />
      </div>

      {/* Search + path filter */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search banks…" className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue" />
        </div>
        <select value={pathFilter} onChange={e => setPathFilter(e.target.value as '' | 'patha' | 'pathb')} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">All Paths</option>
          <option value="patha">Path A (Company List)</option>
          <option value="pathb">Path B (Open List)</option>
        </select>
        <select value={assignFilter} onChange={e => setAssignFilter(e.target.value as 'offered' | 'not' | 'all')} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="offered">Offered for this product</option>
          <option value="not">Not offered</option>
          <option value="all">All banks</option>
        </select>
      </div>

      {!canEdit && <div className="mb-3 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">Your role can view these rules but not change them (Admin / Product Team only).</div>}

      {isLoading ? <LoadingSpinner /> : filtered.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">No banks match.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>{['Bank', 'Offered', 'Eligibility Mode', 'Companies', 'Categories', 'PINs', 'Emp Types', 'CIBIL', 'Bank Rules', ''].map(h => <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map(b => {
                const r = ruleFor(b, productKey)
                const isPathA = (b.lines?.length ?? 0) > 0
                const catIds = [...new Set((b.lines ?? []).map(l => l.categoryId))]
                const empTypes = parseJsonList(r.empTypesJson)
                const pinCount = parseJsonList(b.serviceablePinsJson).length
                const cibil = r.minCibil
                const cibilColor = cibil == null ? 'var(--text3)' : cibil >= 720 ? 'var(--success)' : cibil >= 680 ? 'var(--warn)' : 'var(--accent2)'
                const rulesSet = r.maxLoanAmt != null || r.foirLimit != null
                const bankLoanTypes = parseJsonList(b.loanTypesJson)
                const offersAll = bankLoanTypes.length === 0
                const offeredHere = offersProduct(b, productKey)
                return (
                  <tr key={b.id} className="border-t border-gray-100 hover:bg-[color:var(--accent-subtle)]">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-[9px] flex items-center justify-center font-extrabold text-[13px] shrink-0" style={{ background: b.isIncred ? 'rgba(245,158,11,.15)' : 'rgba(77,124,255,.12)', color: b.isIncred ? '#f59e0b' : 'var(--accent)' }}>{b.bankName.slice(0, 1).toUpperCase()}</div>
                        <div className="min-w-0">
                          <p className="font-bold text-[13px] text-gray-900 truncate">{b.bankName}</p>
                          <p className="leading-none">
                            {b.isIncred && <span className="text-[9.5px] font-bold" style={{ color: '#f59e0b' }}>InCred</span>}
                            {b.isElite && <span className="text-[9.5px] font-bold ml-1" style={{ color: 'var(--success)' }}>Mudrahub</span>}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {offersAll
                          ? <span className="text-[10px] text-gray-400">All products</span>
                          : offeredHere
                            ? <span className="text-[10px] font-bold" style={{ color: 'var(--success)' }}>✓ Offered</span>
                            : <span className="text-[10px] text-gray-400">Not offered</span>}
                        {canEdit && (
                          <button onClick={() => toggleOffered(b, productKey)} disabled={setOffered.isPending}
                            className="text-[10px] font-semibold hover:underline disabled:opacity-50"
                            style={{ color: offeredHere ? 'var(--danger)' : 'var(--accent)' }}>
                            {offeredHere ? '✕ Unassign' : '＋ Assign'}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {isPathA
                        ? <span className="text-[10.5px] font-bold px-2.5 py-1 rounded-full" style={{ background: 'rgba(26,115,64,.1)', color: 'var(--success)' }}>🏢 Company List</span>
                        : <span className="text-[10.5px] font-bold px-2.5 py-1 rounded-full" style={{ background: 'rgba(3,105,161,.1)', color: '#0369a1' }}>🔓 Open List</span>}
                    </td>
                    <td className="px-3 py-2.5">{isPathA ? <><span className="font-bold" style={{ color: 'var(--accent)' }}>{b.lines?.length ?? 0}</span> <span className="text-[10.5px] text-gray-400">lines</span></> : <span className="text-gray-400">No restriction</span>}</td>
                    <td className="px-3 py-2.5">{catIds.length ? <span className="font-bold" style={{ color: 'var(--accent)' }}>{catIds.length}</span> : <span className="text-gray-400">All</span>}</td>
                    <td className="px-3 py-2.5">{pinCount ? <><span className="font-bold" style={{ color: 'var(--success)' }}>{pinCount}</span> <span className="text-[10.5px] text-gray-400">pins</span></> : <span className="text-gray-400">All</span>}</td>
                    <td className="px-3 py-2.5">{empTypes.length ? empTypes.map(e => <span key={e} className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded mr-1" style={{ background: 'rgba(230,126,0,.1)', color: 'var(--warn)' }}>{({ SALARIED: 'Sal.', SELFEMP: 'SEP', SENP: 'SENP' } as Record<string, string>)[e] ?? e}</span>) : <span className="text-gray-400">All</span>}</td>
                    <td className="px-3 py-2.5">{cibil != null ? <span className="font-bold" style={{ color: cibilColor, fontFamily: 'var(--font-head)' }}>{cibil}{r.acceptNtc ? ' +NTC' : ''}</span> : <span className="text-gray-400">—</span>}</td>
                    <td className="px-3 py-2.5">{rulesSet ? <span className="text-[10.5px] px-2 py-0.5 rounded" style={{ background: 'rgba(8,88,151,.07)', color: 'var(--accent)' }}>₹{((r.maxLoanAmt ?? 0) / 100000).toFixed(0)}L · {r.foirLimit ?? 50}% FOIR</span> : <span className="text-gray-400">Default</span>}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <button onClick={() => setOpenBankId(openBankId === b.id ? null : b.id)} className="text-[11px] font-semibold text-efin-blue hover:underline">{openBankId === b.id ? 'Close' : '✏ Edit'}</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {openBank && (
        <div className="mt-4">
          <BankDetailEditor key={`${openBank.id}-${productKey}`} bank={openBank} productKey={productKey} canEdit={canEdit} onClose={() => setOpenBankId(null)} />
        </div>
      )}
      </>)}

      {showBulkUpload && <BulkUploadBanksModal onClose={() => setShowBulkUpload(false)} />}
      {showAddBank && <AddBankModal onClose={() => setShowAddBank(false)} />}
    </Card>
  )
}
