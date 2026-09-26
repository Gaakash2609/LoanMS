import React, { useState } from 'react'
import { SkeletonText } from '@/components/ui/Skeleton'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X, Pencil, Trash2, Calculator, Sparkles, ChevronDown, ChevronUp, Save, RotateCcw, Check } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { payoutApi, type PayoutRule, type PayoutRuleWriteRequest } from '@/api/payoutApi'
import { settingsApi } from '@/api/settingsApi'
import { formatCurrency } from '@/utils/format'
import { useAuthStore } from '@/store/authStore'
import { NumberInput } from '@/components/ui/NumberInput'
import { apiErrorMessage as errorMessage } from '@/utils/apiError'

// ── Payout Rules engine editor ──────────────────────────────────────────
const RULE_KEYS: { key: string; label: string; via: 'Claims + Wizard' | 'Claims' | 'Wizard' }[] = [
  { key: 'personal_loan',         label: 'Personal Loan',           via: 'Claims + Wizard' },
  { key: 'business_loan',         label: 'Business Loan',           via: 'Claims + Wizard' },
  { key: 'home_loan',             label: 'Home Loan',               via: 'Claims + Wizard' },
  { key: 'education_loan',        label: 'Education Loan',          via: 'Claims + Wizard' },
  { key: 'new_car_loan',          label: 'New Car Loan',            via: 'Claims + Wizard' },
  { key: 'used_car_loan',         label: 'Used Car Loan',           via: 'Wizard' },
  { key: 'loan_against_property', label: 'Loan Against Property',   via: 'Wizard' },
  { key: 'over_draft',            label: 'Overdraft / Cash Credit', via: 'Wizard' },
  { key: 'insurance',             label: 'Insurance',               via: 'Wizard' },
  { key: 'vehicle',               label: 'Vehicle Loan',            via: 'Claims' },
  { key: 'lap',                   label: 'LAP (enum fallback)',     via: 'Claims' },
]

const KEY_LABEL: Record<string, string> = Object.fromEntries(RULE_KEYS.map(r => [r.key, r.label]))


function toNumberOrNull(v: string): number | null {
  const t = v.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// ── Shared input styles ──────────────────────────────────────────────────
const INP = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-efin-blue focus:border-efin-blue transition-colors'
const INP_SM = 'w-full border border-gray-200 rounded-md px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-efin-blue focus:border-efin-blue transition-colors'

// ── Create / Edit Rule modal ─────────────────────────────────────────────
function RuleFormModal({ rule, usedKeys, onClose, onSaved }: {
  rule: PayoutRule | null; usedKeys: string[]; onClose: () => void; onSaved: () => void
}) {
  const isEdit = rule != null
  const [loanType, setLoanType] = useState(rule?.loanType ?? '')
  const [percentage, setPercentage] = useState(rule ? String(rule.percentage) : '')
  const [minAmount, setMinAmount] = useState(rule?.minAmount != null ? String(rule.minAmount) : '')
  const [maxAmount, setMaxAmount] = useState(rule?.maxAmount != null ? String(rule.maxAmount) : '')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  const available = RULE_KEYS.filter(r => !usedKeys.includes(r.key))

  const save = useMutation({
    mutationFn: async (payload: PayoutRuleWriteRequest) => {
      if (rule) await payoutApi.updateRule(rule.id, payload)
      else await payoutApi.createRule(payload)
    },
    onSuccess: () => onSaved(),
    onError: (err: unknown) => setError(errorMessage(err, 'Could not save this rule.')),
  })

  function handleSubmit() {
    if (!loanType) { setError('Please choose a loan type.'); return }
    const pct = Number(percentage)
    if (!percentage.trim() || !Number.isFinite(pct) || pct <= 0) {
      setError('Percentage must be a number greater than 0.'); return
    }
    const min = toNumberOrNull(minAmount)
    const max = toNumberOrNull(maxAmount)
    if (min != null && max != null && min > max) {
      setError('Min payout cannot be greater than max payout.'); return
    }
    setError('')
    if (save.isPending) return
    save.mutate({ loanType, percentage: pct, minAmount: min, maxAmount: max, notes: notes.trim() || null })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[var(--z-modal)] p-4" onClick={onClose}>
      <div className="w-full max-w-md" onClick={e => e.stopPropagation()}>
        <Card className="p-0 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50">
            <div>
              <p className="text-sm font-semibold text-gray-900">{isEdit ? 'Edit Payout Rule' : 'New Payout Rule'}</p>
              <p className="text-xs text-gray-500 mt-0.5">Commission rate for a loan type</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-200 transition-colors">
              <X size={16} />
            </button>
          </div>

          <div className="p-5 space-y-4">
            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
            )}

            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Loan Type <span className="text-red-500">*</span></label>
              {isEdit ? (
                <>
                  <input value={KEY_LABEL[loanType] ?? loanType} disabled
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500" />
                  <p className="text-[11px] text-gray-400 mt-1">Loan type cannot be changed after creation.</p>
                </>
              ) : (
                <select value={loanType} onChange={e => setLoanType(e.target.value)} className={INP}>
                  <option value="">Select loan type…</option>
                  {available.map(r => (
                    <option key={r.key} value={r.key}>{r.label}</option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">
                Payout % of loan amount <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <NumberInput step="0.01" min="0" value={percentage} onChange={e => setPercentage(e.target.value)}
                  placeholder="e.g. 1.5" className={INP + ' pr-8'} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium">%</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1.5">Min Payout (₹)</label>
                <NumberInput min="0" value={minAmount} onChange={e => setMinAmount(e.target.value)}
                  placeholder="No floor" className={INP} />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1.5">Max Payout (₹)</label>
                <NumberInput min="0" value={maxAmount} onChange={e => setMaxAmount(e.target.value)}
                  placeholder="No cap" className={INP} />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Internal Note</label>
              <input value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="e.g. Standard DSA rate for personal loans"
                className={INP} />
              {isEdit && (
                <p className="text-[11px] text-amber-600 mt-1">
                  Existing note cannot be loaded from the API. Leaving blank will clear it.
                </p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" loading={save.isPending} disabled={save.isPending} onClick={handleSubmit}>
              {isEdit ? 'Save Changes' : 'Create Rule'}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

// ── Payout Calculator ────────────────────────────────────────────────────
function RuleCalculator({ rules }: { rules: PayoutRule[] }) {
  const [loanType, setLoanType] = useState('')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')

  const calc = useMutation({
    mutationFn: () => payoutApi.calculatePayout(loanType, Number(amount)).then(r => r.data.data),
    onError: (err: unknown) => setError(errorMessage(err, 'Could not calculate.')),
    onSuccess: () => setError(''),
  })

  const canRun = !!loanType && !!amount.trim() && Number(amount) > 0

  return (
    <div className="border border-gray-200 rounded-xl p-5 bg-white">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-efin-blue/10 flex items-center justify-center">
          <Calculator size={14} className="text-efin-blue" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900">Payout Preview</p>
          <p className="text-xs text-gray-500">Dry run — nothing is saved</p>
        </div>
      </div>

      {error && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <div className="grid sm:grid-cols-3 gap-3 items-end">
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1.5">Loan Type</label>
          <select value={loanType} onChange={e => setLoanType(e.target.value)} className={INP}>
            <option value="">Select…</option>
            {rules.map(r => (
              <option key={r.id} value={r.loanType}>{KEY_LABEL[r.loanType] ?? r.loanType}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1.5">Loan Amount</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">₹</span>
            <NumberInput min="0" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="e.g. 500000" className={INP + ' pl-7'} />
          </div>
        </div>
        <Button size="sm" disabled={!canRun || calc.isPending} loading={calc.isPending}
          onClick={() => calc.mutate()}>
          Calculate
        </Button>
      </div>

      {calc.data && (
        <div className="mt-4 rounded-lg border border-efin-blue/20 bg-efin-blue/5 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">
              {KEY_LABEL[calc.data.loanType] ?? calc.data.loanType} · {calc.data.payoutRate}% of {formatCurrency(calc.data.loanAmount)}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">Estimated payout</p>
          </div>
          <p className="text-2xl font-bold text-efin-blue">{formatCurrency(calc.data.payoutAmount)}</p>
        </div>
      )}
    </div>
  )
}

// ── Claim Lists Editor ───────────────────────────────────────────────────
const CLAIM_LISTS_SETTING_KEY = 'efin_payout_claim_lists'
const CLAIM_LISTS_CATEGORY = 'PayoutClaim'

interface ClaimListsRaw {
  banks: string[]
  products: { v: string; l: string }[]
  contests: { v: string; l: string }[]
  bizCats: { v: string; l: string }[]
}

const DEFAULT_CLAIM_LISTS: ClaimListsRaw = {
  banks: ['InCred', 'HDFC', 'ICICI', 'Bajaj', 'Axis', 'Kotak', 'SBI', 'PNB', 'IDFC', 'Tata Capital'],
  products: [
    { v: 'personal_loan', l: 'Personal Loan' }, { v: 'home_loan', l: 'Home Loan' },
    { v: 'business_loan', l: 'Business Loan' }, { v: 'new_car_loan', l: 'New Car Loan' },
    { v: 'used_car_loan', l: 'Used Car Loan' }, { v: 'education_loan', l: 'Education Loan' },
    { v: 'loan_against_property', l: 'Loan Against Property' },
  ],
  contests: [],
  bizCats: [
    { v: 'loan_tbc', l: 'Loan TBC' }, { v: 'personal_loan', l: 'Personal Loan' },
    { v: 'home_loan', l: 'Home Loan' }, { v: 'business_loan', l: 'Business Loan' },
    { v: 'auto_loan', l: 'Auto Loan' }, { v: 'lap', l: 'Loan Against Property' },
  ],
}

function parseStoredClaimLists(raw?: string | null): ClaimListsRaw {
  if (!raw) return { ...DEFAULT_CLAIM_LISTS }
  try {
    const p = JSON.parse(raw)
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      return {
        banks: Array.isArray(p.banks) ? p.banks : DEFAULT_CLAIM_LISTS.banks,
        products: Array.isArray(p.products) ? p.products : DEFAULT_CLAIM_LISTS.products,
        contests: Array.isArray(p.contests) ? p.contests : DEFAULT_CLAIM_LISTS.contests,
        bizCats: Array.isArray(p.bizCats) ? p.bizCats : DEFAULT_CLAIM_LISTS.bizCats,
      }
    }
  } catch { /* fall through */ }
  return { ...DEFAULT_CLAIM_LISTS }
}

// A single pill-style tag with an × remove button
function Tag({ label, sub, onRemove }: { label: string; sub?: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded-full pl-3 pr-1.5 py-1 text-xs text-gray-700 transition-colors group">
      <span className="font-medium">{label}</span>
      {sub && <span className="text-gray-400 font-mono text-[10px]">{sub}</span>}
      <button
        onClick={onRemove}
        className="w-4 h-4 rounded-full flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
        title="Remove"
      >
        <X size={10} />
      </button>
    </span>
  )
}

// Section within the editor — collapsible with item count badge
function ListSection({
  title, icon, count, note, children,
}: {
  title: string; icon: string; count: number; note?: string; children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="text-base">{icon}</span>
        <span className="flex-1 text-sm font-semibold text-gray-800">{title}</span>
        <span className="text-xs font-medium text-gray-500 bg-white border border-gray-200 rounded-full px-2 py-0.5 min-w-[24px] text-center">
          {count}
        </span>
        {open ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
      </button>
      {open && (
        <div className="p-4 space-y-3">
          {note && (
            <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">{note}</p>
          )}
          {children}
        </div>
      )}
    </div>
  )
}

function ClaimListsEditor() {
  const qc = useQueryClient()
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')

  const { data: raw, isLoading } = useQuery({
    queryKey: ['claim-lists-admin'],
    queryFn: () => settingsApi.getByKey(CLAIM_LISTS_SETTING_KEY).then(r => r.data.data?.value ?? null),
    staleTime: 0,
  })

  const [lists, setLists] = useState<ClaimListsRaw | null>(null)
  const working = lists ?? parseStoredClaimLists(raw)
  const setField = <K extends keyof ClaimListsRaw>(k: K, v: ClaimListsRaw[K]) =>
    setLists({ ...(lists ?? parseStoredClaimLists(raw)), [k]: v })

  // Add-item input state — one per list
  const [newBank, setNewBank] = useState('')
  const [newProdL, setNewProdL] = useState(''); const [newProdV, setNewProdV] = useState('')
  const [newConL, setNewConL]   = useState(''); const [newConV, setNewConV]   = useState('')
  const [newBizL, setNewBizL]   = useState(''); const [newBizV, setNewBizV]   = useState('')

  const saveMutation = useMutation({
    mutationFn: () => settingsApi.update(CLAIM_LISTS_SETTING_KEY, JSON.stringify(working), CLAIM_LISTS_CATEGORY),
    onSuccess: () => {
      setSaved(true); setSaveError('')
      qc.invalidateQueries({ queryKey: ['claim-lists'] })
      qc.invalidateQueries({ queryKey: ['claim-lists-admin'] })
      setTimeout(() => setSaved(false), 2500)
    },
    onError: (err: unknown) => {
      const d = (err as { response?: { data?: { message?: string } } })?.response?.data
      setSaveError(d?.message || 'Could not save. Please try again.')
    },
  })

  const thisYear = new Date().getFullYear()

  const addBank = () => {
    const v = newBank.trim()
    if (!v) return
    setField('banks', [...working.banks, v]); setNewBank('')
  }
  const addProduct = () => {
    const v = newProdV.trim().toLowerCase().replace(/\s+/g, '_'), l = newProdL.trim()
    if (!v || !l) return
    setField('products', [...working.products, { v, l }]); setNewProdV(''); setNewProdL('')
  }
  const addContest = () => {
    const v = newConV.trim().toLowerCase().replace(/\s+/g, '_'), l = newConL.trim()
    if (!v || !l) return
    setField('contests', [...working.contests, { v, l }]); setNewConV(''); setNewConL('')
  }
  const addBiz = () => {
    const v = newBizV.trim().toLowerCase().replace(/\s+/g, '_'), l = newBizL.trim()
    if (!v || !l) return
    setField('bizCats', [...working.bizCats, { v, l }]); setNewBizV(''); setNewBizL('')
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-gray-100 bg-gray-50">
        <div>
          <p className="text-sm font-semibold text-gray-900">Claims Form — Dropdown Lists</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Manage options shown in the New Claim form. No code change needed.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {saved && (
            <span className="flex items-center gap-1 text-xs font-medium text-green-600">
              <Check size={12} /> Saved
            </span>
          )}
          <button
            onClick={() => setLists(parseStoredClaimLists(raw))}
            title="Discard unsaved changes"
            className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <RotateCcw size={14} />
          </button>
          <Button size="sm" loading={saveMutation.isPending} disabled={saveMutation.isPending}
            onClick={() => { setSaved(false); setSaveError(''); saveMutation.mutate() }}>
            <Save size={13} className="mr-1.5" />Save
          </Button>
        </div>
      </div>

      {saveError && (
        <div className="mx-5 mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</div>
      )}

      {isLoading ? (
        <div className="p-5"><SkeletonText lines={4} /></div>
      ) : (
        <div className="p-5 space-y-3">

          {/* ── Banks ── */}
          <ListSection title="Banks" icon="🏦" count={working.banks.length}>
            {/* Tag cloud */}
            <div className="flex flex-wrap gap-2 min-h-[32px]">
              {working.banks.length === 0
                ? <p className="text-xs text-gray-400 italic">No banks yet — add one below</p>
                : working.banks.map((b, i) => (
                  <Tag key={i} label={b} onRemove={() => setField('banks', working.banks.filter((_, j) => j !== i))} />
                ))
              }
            </div>
            {/* Add row */}
            <div className="flex gap-2 pt-1 border-t border-gray-100">
              <input
                value={newBank} onChange={e => setNewBank(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addBank()}
                placeholder="Bank name (press Enter to add)"
                className={INP_SM + ' flex-1'}
              />
              <button onClick={addBank} disabled={!newBank.trim()}
                className="px-3 py-1.5 bg-efin-blue text-white text-xs rounded-md hover:bg-[#1a5bc7] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1">
                <Plus size={12} /> Add
              </button>
            </div>
          </ListSection>

          {/* ── Products ── */}
          <ListSection title="Products" icon="📋" count={working.products.length}>
            <div className="flex flex-wrap gap-2 min-h-[32px]">
              {working.products.length === 0
                ? <p className="text-xs text-gray-400 italic">No products yet — add one below</p>
                : working.products.map((p, i) => (
                  <Tag key={i} label={p.l} sub={p.v}
                    onRemove={() => setField('products', working.products.filter((_, j) => j !== i))} />
                ))
              }
            </div>
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2 pt-1 border-t border-gray-100">
              <input value={newProdL} onChange={e => setNewProdL(e.target.value)}
                placeholder="Display name  (e.g. Gold Loan)"
                className={INP_SM} />
              <input value={newProdV} onChange={e => setNewProdV(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addProduct()}
                placeholder="Key  (e.g. gold_loan)"
                className={INP_SM + ' font-mono'} />
              <button onClick={addProduct} disabled={!newProdL.trim() || !newProdV.trim()}
                className="px-3 py-1.5 bg-efin-blue text-white text-xs rounded-md hover:bg-[#1a5bc7] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1">
                <Plus size={12} /> Add
              </button>
            </div>
            <p className="text-[11px] text-gray-400">Key must match what the backend expects (snake_case). Display name is shown to users.</p>
          </ListSection>

          {/* ── Contests ── */}
          <ListSection
            title="Contests"
            icon="🏆"
            count={working.contests.length}
            note={`Q1–Q4 + Annual for ${thisYear - 1} and ${thisYear} appear automatically. Add custom or future-year contests here.`}
          >
            <div className="flex flex-wrap gap-2 min-h-[32px]">
              {working.contests.length === 0
                ? <p className="text-xs text-gray-400 italic">No custom contests — auto-generated ones always show</p>
                : working.contests.map((c, i) => (
                  <Tag key={i} label={c.l} sub={c.v}
                    onRemove={() => setField('contests', working.contests.filter((_, j) => j !== i))} />
                ))
              }
            </div>
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2 pt-1 border-t border-gray-100">
              <input value={newConL} onChange={e => setNewConL(e.target.value)}
                placeholder="Display name  (e.g. H1 2027 Contest)"
                className={INP_SM} />
              <input value={newConV} onChange={e => setNewConV(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addContest()}
                placeholder="Key  (e.g. h1_2027)"
                className={INP_SM + ' font-mono'} />
              <button onClick={addContest} disabled={!newConL.trim() || !newConV.trim()}
                className="px-3 py-1.5 bg-efin-blue text-white text-xs rounded-md hover:bg-[#1a5bc7] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1">
                <Plus size={12} /> Add
              </button>
            </div>
          </ListSection>

          {/* ── Business Categories ── */}
          <ListSection title="Business Categories" icon="🗂️" count={working.bizCats.length}>
            <div className="flex flex-wrap gap-2 min-h-[32px]">
              {working.bizCats.length === 0
                ? <p className="text-xs text-gray-400 italic">No categories yet — add one below</p>
                : working.bizCats.map((c, i) => (
                  <Tag key={i} label={c.l} sub={c.v}
                    onRemove={() => setField('bizCats', working.bizCats.filter((_, j) => j !== i))} />
                ))
              }
            </div>
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2 pt-1 border-t border-gray-100">
              <input value={newBizL} onChange={e => setNewBizL(e.target.value)}
                placeholder="Display name  (e.g. Gold Loan)"
                className={INP_SM} />
              <input value={newBizV} onChange={e => setNewBizV(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addBiz()}
                placeholder="Key  (e.g. gold_loan)"
                className={INP_SM + ' font-mono'} />
              <button onClick={addBiz} disabled={!newBizL.trim() || !newBizV.trim()}
                className="px-3 py-1.5 bg-efin-blue text-white text-xs rounded-md hover:bg-[#1a5bc7] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1">
                <Plus size={12} /> Add
              </button>
            </div>
          </ListSection>

        </div>
      )}
    </div>
  )
}

// ── Main PayoutRulesTab ──────────────────────────────────────────────────
export default function PayoutRulesTab() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const canWrite = user?.role === 'Admin'

  const [editing, setEditing] = useState<PayoutRule | 'new' | null>(null)
  const [actionError, setActionError] = useState('')

  const { data: rules, isLoading, error: loadError } = useQuery({
    queryKey: ['payout-rules'],
    queryFn: () => payoutApi.getRules().then(r => r.data.data ?? []),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['payout-rules'] })
  const onError = (err: unknown) => setActionError(errorMessage(err, 'That action could not be completed.'))

  const remove = useMutation({
    mutationFn: (id: number) => payoutApi.deleteRule(id),
    onSuccess: () => { setActionError(''); invalidate() },
    onError,
  })

  const seed = useMutation({
    mutationFn: () => payoutApi.seedDefaultRules(),
    onSuccess: () => { setActionError(''); invalidate() },
    onError,
  })

  const list = rules ?? []
  const usedKeys = list.map(r => r.loanType)

  return (
    <div className="space-y-5">

      {/* ── Payout Rules card ── */}
      <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-gray-100 bg-gray-50">
          <div>
            <p className="text-sm font-semibold text-gray-900">Payout Rules</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Commission rate per loan type — % of loan amount, clamped between min and max.
            </p>
          </div>
          {canWrite && (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus size={14} className="mr-1" />Add Rule
            </Button>
          )}
        </div>

        <div className="p-5">
          {!canWrite && (
            <div className="mb-4 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              You can view these rules. Only an Admin can change them.
            </div>
          )}
          {actionError && (
            <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{actionError}</div>
          )}
          {loadError != null && (
            <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {errorMessage(loadError, 'Could not load payout rules.')}
            </div>
          )}

          {isLoading ? (
            <SkeletonText lines={4} className="py-3" />
          ) : list.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
                <Calculator size={20} className="text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-700">No payout rules yet</p>
              <p className="text-xs text-gray-500 mt-1 mb-4">
                Without a rule, every claim calculates as ₹0.
              </p>
              {canWrite && (
                <Button size="sm" variant="secondary" loading={seed.isPending} disabled={seed.isPending}
                  onClick={() => seed.mutate()}>
                  <Sparkles size={14} className="mr-1.5" />Seed default rules
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide pb-2.5 pr-4">Loan Type</th>
                    <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide pb-2.5 pr-4">Applies Via</th>
                    <th className="text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wide pb-2.5 pr-4">Rate</th>
                    <th className="text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wide pb-2.5 pr-4">Min</th>
                    <th className="text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wide pb-2.5 pr-4">Max</th>
                    {canWrite && <th className="pb-2.5 w-16"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {list.map(r => {
                    const known = RULE_KEYS.find(k => k.key === r.loanType)
                    return (
                      <tr key={r.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-3 pr-4">
                          <p className="font-medium text-gray-900 text-sm">{known?.label ?? r.loanType}</p>
                          <p className="text-[11px] text-gray-400 font-mono mt-0.5">{r.loanType}</p>
                        </td>
                        <td className="py-3 pr-4">
                          {known
                            ? <Badge variant="default">{known.via}</Badge>
                            : <Badge variant="warning">Unmatched key</Badge>}
                        </td>
                        <td className="py-3 pr-4 text-right">
                          <span className="font-semibold text-efin-blue">{r.percentage}%</span>
                        </td>
                        <td className="py-3 pr-4 text-right text-gray-600 text-sm">
                          {r.minAmount != null ? formatCurrency(r.minAmount) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="py-3 pr-4 text-right text-gray-600 text-sm">
                          {r.maxAmount != null ? formatCurrency(r.maxAmount) : <span className="text-gray-300">—</span>}
                        </td>
                        {canWrite && (
                          <td className="py-3">
                            <div className="flex items-center gap-1 justify-end">
                              <button onClick={() => setEditing(r)} title="Edit"
                                className="p-1.5 rounded-lg text-gray-400 hover:text-efin-blue hover:bg-efin-blue/10 transition-colors">
                                <Pencil size={13} />
                              </button>
                              <button
                                onClick={() => {
                                  if (window.confirm(`Delete payout rule for ${known?.label ?? r.loanType}? Claims for this type will calculate as ₹0.`))
                                    remove.mutate(r.id)
                                }}
                                disabled={remove.isPending} title="Delete"
                                className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40">
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Calculator ── */}
      {list.length > 0 && <RuleCalculator rules={list} />}

      {/* ── Claim Lists Editor (Admin only) ── */}
      {canWrite && <ClaimListsEditor />}

      {/* ── Rule create/edit modal ── */}
      {editing && (
        <RuleFormModal
          key={editing === 'new' ? 'new' : editing.id}
          rule={editing === 'new' ? null : editing}
          usedKeys={usedKeys}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setActionError(''); invalidate() }}
        />
      )}
    </div>
  )
}
