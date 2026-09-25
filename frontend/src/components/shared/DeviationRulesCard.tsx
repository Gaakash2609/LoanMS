import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FlaskConical, History, Pencil, Plus, Power, Trash2 } from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { NumberInput } from '@/components/ui/NumberInput'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { banksApi } from '@/api/banksApi'
import { apiErrorMessage } from '@/utils/apiError'
import { formatDate } from '@/utils/format'
import { useToast } from '@/store/toastStore'
import {
  offerWorkflowApi, METRIC_OPTIONS, CONDITION_FIELDS, CONDITION_OPS,
  type DeviationRule, type DeviationRuleInput, type DeviationEvaluation,
} from '@/api/offerWorkflowApi'

// ── Deviation rules (lender-specific, versioned) ──────────────────────────
// Product & Risk Officer / Chief Administrator. A rule is never edited in
// place: "Edit" saves a new version and retires the old one (kept read-only in
// History); rules are deactivated, never deleted. The API validates overlaps,
// conflicts, priorities and dates on save and owns the tie-break
// (priority → specificity → latest effective date → conflict error).

const PRODUCTS = ['', 'personal_loan', 'business_loan', 'home_loan', 'new_car_loan', 'education_loan', 'loan_against_property', 'over_draft', 'insurance']
const today = () => new Date().toISOString().slice(0, 10)
const FACT_LABELS: Record<string, string> = {
  loanAmount: 'Loan amount (₹)', tenureMonths: 'Tenure (months)', baseRoi: 'Base ROI (%)', offeredRoi: 'Offered ROI (%)',
  monthlyIncome: 'Monthly income (₹)', postLoanFoirPct: 'Post-loan FOIR (%)', bureauCibil: 'Bureau CIBIL',
}
const blank = (bankId = 0): DeviationRuleInput => ({
  name: '', bankId, productKey: '', loanType: '', deviationType: 'ROI', metric: 'ROI_MIN_PCT', limitValue: 0,
  maxApprovableDeviation: null, conditions: [], conditionLogic: 'AND', priority: 100, effectiveFrom: today(),
  effectiveTo: null, approvalRequired: true, notes: '', changeReason: '',
})
const toInput = (r: DeviationRule): DeviationRuleInput => ({
  name: r.name, bankId: r.bankId, productKey: r.productKey ?? '', loanType: r.loanType ?? '', deviationType: r.deviationType,
  metric: r.metric, limitValue: r.limitValue, maxApprovableDeviation: r.maxApprovableDeviation ?? null, conditions: r.conditions,
  conditionLogic: r.conditionLogic, priority: r.priority, effectiveFrom: r.effectiveFrom.slice(0, 10),
  effectiveTo: r.effectiveTo ? r.effectiveTo.slice(0, 10) : null, approvalRequired: r.approvalRequired, notes: r.notes ?? '', changeReason: '',
})

function RuleForm({ initial, editing, banks, onClose }: {
  initial: DeviationRuleInput; editing?: DeviationRule; banks: { id: number; bankName: string }[]; onClose: () => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState<DeviationRuleInput>(initial)
  const [error, setError] = useState('')
  const [sim, setSim] = useState<DeviationEvaluation | null>(null)
  const [facts, setFacts] = useState({ loanAmount: 500000, tenureMonths: 36, baseRoi: 13, offeredRoi: 12, monthlyIncome: 100000, postLoanFoirPct: 40, bureauCibil: 750 })
  const set = <K extends keyof DeviationRuleInput>(k: K, v: DeviationRuleInput[K]) => setF(p => ({ ...p, [k]: v }))
  const payload = (): DeviationRuleInput => ({
    ...f, productKey: f.productKey || null, loanType: f.loanType || null,
    effectiveFrom: `${f.effectiveFrom.slice(0, 10)}T00:00:00Z`, effectiveTo: f.effectiveTo ? `${f.effectiveTo.slice(0, 10)}T23:59:59Z` : null,
  })
  const save = useMutation({
    mutationFn: () => editing ? offerWorkflowApi.newRuleVersion(editing.id, payload()) : offerWorkflowApi.createRule(payload()),
    onSuccess: r => { toast.success(r.data.message ?? 'Rule saved'); qc.invalidateQueries({ queryKey: ['deviation-rules'] }); onClose() },
    onError: e => setError(apiErrorMessage(e)),
  })
  const simulate = useMutation({
    mutationFn: () => offerWorkflowApi.simulate({
      bankId: f.bankId, productKey: f.productKey || undefined, loanType: f.loanType || undefined,
      loanAmount: facts.loanAmount, tenureMonths: facts.tenureMonths, baseRoi: facts.baseRoi, offeredRoi: facts.offeredRoi,
      processingFeePct: 0, gstPct: 0, insuranceAmount: 0, pfInBundled: false, insuranceInBundled: false, btAmount: 0, stampDuty: 0,
      monthlyIncome: facts.monthlyIncome, postLoanFoirPct: facts.postLoanFoirPct, bureauCibil: facts.bureauCibil, draftRule: editing ? null : payload(),
    }),
    onSuccess: r => { setSim(r.data.data ?? null); setError('') },
    onError: e => setError(apiErrorMessage(e)),
  })
  const metrics = METRIC_OPTIONS[f.deviationType] ?? []
  const label = (t: string) => <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text2)' }}>{t}</label>
  return (
    <Modal open onClose={onClose} size="xl" title={editing ? `New version of "${editing.name}" (v${editing.version + 1})` : 'New deviation rule'}
      subtitle={editing ? `Version ${editing.version} stays in history, read-only. Lender cannot change.` : 'Lender-specific. Unit and comparison follow the metric.'}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="ghost" loading={simulate.isPending} disabled={!f.bankId} onClick={() => simulate.mutate()}><FlaskConical size={14} className="mr-1" />Dry run</Button>
        <Button size="sm" loading={save.isPending} disabled={save.isPending || !f.bankId || !f.name.trim() || (!!editing && !f.changeReason?.trim())} onClick={() => save.mutate()}>
          {editing ? 'Save new version' : 'Create rule'}
        </Button>
      </>}>
      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">{label('Rule name *')}<input className="efin-input" value={f.name} onChange={e => set('name', e.target.value)} /></div>
        <div>{label('Lender *')}
          <select className="efin-input" value={f.bankId} disabled={!!editing} onChange={e => set('bankId', Number(e.target.value))}>
            <option value={0}>— Select —</option>{banks.map(b => <option key={b.id} value={b.id}>{b.bankName}</option>)}
          </select>
        </div>
        <div>{label('Product (blank = all)')}
          <select className="efin-input" value={f.productKey ?? ''} onChange={e => set('productKey', e.target.value)}>
            {PRODUCTS.map(p => <option key={p} value={p}>{p || 'All products'}</option>)}
          </select>
        </div>
        <div>{label('Deviation type *')}
          <select className="efin-input" value={f.deviationType} onChange={e => { set('deviationType', e.target.value); set('metric', METRIC_OPTIONS[e.target.value][0].value) }}>
            {Object.keys(METRIC_OPTIONS).map(t => <option key={t} value={t}>{t === 'LoanAmount' ? 'Loan Amount' : t}</option>)}
          </select>
        </div>
        <div>{label('Metric *')}
          <select className="efin-input" value={f.metric} onChange={e => set('metric', e.target.value)}>
            {metrics.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div>{label('Allowed limit *')}<NumberInput className="efin-input" min={0} value={f.limitValue} onChange={e => set('limitValue', Number(e.target.value || 0))} /></div>
        <div>{label('Max approvable breach (optional)')}
          <NumberInput className="efin-input" min={0} value={f.maxApprovableDeviation ?? ''} onChange={e => set('maxApprovableDeviation', e.target.value === '' ? null : Number(e.target.value))} />
        </div>
        <div>{label('Priority * (lower wins)')}<NumberInput className="efin-input" min={1} value={f.priority} onChange={e => set('priority', Number(e.target.value || 0))} /></div>
        <div>{label('Effective from *')}<input type="date" className="efin-input" value={f.effectiveFrom.slice(0, 10)} onChange={e => set('effectiveFrom', e.target.value)} /></div>
        <div>{label('Effective to')}<input type="date" className="efin-input" value={f.effectiveTo ?? ''} onChange={e => set('effectiveTo', e.target.value || null)} /></div>
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text2)' }}>
          <input type="checkbox" checked={f.approvalRequired} onChange={e => set('approvalRequired', e.target.checked)} /> Breach needs deviation approval
        </label>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>Conditions (when the rule applies)</span>
          <select className="efin-input !w-auto !py-1 text-xs" value={f.conditionLogic} onChange={e => set('conditionLogic', e.target.value as 'AND' | 'OR')}>
            <option value="AND">All must match (AND)</option><option value="OR">Any may match (OR)</option>
          </select>
          <Button size="sm" variant="ghost" onClick={() => set('conditions', [...f.conditions, { field: 'loanAmount', op: 'gte', value: '' }])}><Plus size={13} className="mr-1" />Condition</Button>
        </div>
        {f.conditions.length === 0 && <p className="text-[12px]" style={{ color: 'var(--text3)' }}>No conditions — applies to every application of this lender / product.</p>}
        {f.conditions.map((c, i) => (
          <div key={i} className="mb-2 flex flex-wrap items-center gap-2">
            <select className="efin-input !w-auto" value={c.field} onChange={e => set('conditions', f.conditions.map((x, j) => j === i ? { ...x, field: e.target.value } : x))}>
              {CONDITION_FIELDS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select className="efin-input !w-auto" value={c.op} onChange={e => set('conditions', f.conditions.map((x, j) => j === i ? { ...x, op: e.target.value } : x))}>
              {CONDITION_OPS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <input className="efin-input !w-40" value={c.value} placeholder={c.op === 'in' ? 'a,b,c' : 'value'} onChange={e => set('conditions', f.conditions.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
            <button type="button" aria-label="Remove condition" className="p-1" style={{ color: 'var(--text3)' }} onClick={() => set('conditions', f.conditions.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>{label('Notes')}<input className="efin-input" value={f.notes ?? ''} onChange={e => set('notes', e.target.value)} /></div>
        {editing && <div>{label('Change reason *')}<input className="efin-input" value={f.changeReason ?? ''} onChange={e => set('changeReason', e.target.value)} placeholder="e.g. Credit committee revision" /></div>}
      </div>

      <div className="mt-4 rounded-xl p-3" style={{ background: 'var(--surface2)' }}>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>Dry run — sample application (nothing is saved)</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(facts) as (keyof typeof facts)[]).map(k => (
            <div key={k}>{label(FACT_LABELS[k])}<NumberInput className="efin-input" value={facts[k]} onChange={e => setFacts(p => ({ ...p, [k]: Number(e.target.value || 0) }))} /></div>
          ))}
        </div>
        {sim && (
          <div className="mt-2 text-[12.5px]" style={{ color: 'var(--text2)' }}>
            <p className="font-semibold">Outcome: {sim.outcome === 'NotRequired' ? 'No deviation' : 'Deviation required'}{sim.manualReview ? ' (manual review)' : ''}</p>
            {sim.manualReviewReason && <p>{sim.manualReviewReason}</p>}
            {sim.checks.map((c, i) => <p key={i}>• [{c.status}] {c.message}{c.ruleName ? ` — ${c.ruleName}` : ''}</p>)}
          </div>
        )}
      </div>
    </Modal>
  )
}

export default function DeviationRulesCard() {
  const qc = useQueryClient()
  const toast = useToast()
  const [bankFilter, setBankFilter] = useState(0)
  const [history, setHistory] = useState(false)
  const [form, setForm] = useState<{ initial: DeviationRuleInput; editing?: DeviationRule } | null>(null)
  const [toggle, setToggle] = useState<DeviationRule | null>(null)
  const [reason, setReason] = useState('')
  const [toggleError, setToggleError] = useState('')
  const { data: banks = [] } = useQuery({ queryKey: ['banks-for-rules'], queryFn: () => banksApi.getAll().then(r => r.data.data ?? []) })
  const { data: rules, isLoading } = useQuery({
    queryKey: ['deviation-rules', bankFilter, history],
    queryFn: () => offerWorkflowApi.listRules(bankFilter || undefined, history).then(r => r.data.data ?? []),
  })
  const toggleM = useMutation({
    mutationFn: (r: DeviationRule) => offerWorkflowApi.setRuleActive(r.id, !r.isActive, reason),
    onSuccess: r => { toast.success(r.data.message ?? 'Saved'); qc.invalidateQueries({ queryKey: ['deviation-rules'] }); setToggle(null); setReason('') },
    onError: e => setToggleError(apiErrorMessage(e)),
  })
  const bankList = banks.map(b => ({ id: b.id, bankName: b.bankName }))
  return (
    <Card>
      <CardHeader title="Deviation Rules (lender policy)"
        subtitle="Configurable, versioned, lender-specific rules the offer deviation check uses. Missing data or no rule = manual review."
        action={<Button size="sm" onClick={() => setForm({ initial: blank(bankFilter) })}><Plus size={14} className="mr-1" />New rule</Button>} />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <select className="efin-input !w-auto" value={bankFilter} onChange={e => setBankFilter(Number(e.target.value))}>
          <option value={0}>All lenders</option>{bankList.map(b => <option key={b.id} value={b.id}>{b.bankName}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text2)' }}>
          <input type="checkbox" checked={history} onChange={e => setHistory(e.target.checked)} /><History size={14} /> Show version history
        </label>
      </div>
      {isLoading ? <LoadingSpinner /> : !rules?.length ? <p className="text-sm" style={{ color: 'var(--text3)' }}>No deviation rules yet. Offers from a lender without rules go to manual review.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left" style={{ color: 'var(--text3)' }}>
              <th className="py-1.5 pr-3">Rule</th><th className="pr-3">Lender / product</th><th className="pr-3">Type · metric</th><th className="pr-3">Limit</th>
              <th className="pr-3">Conditions</th><th className="pr-3">Priority</th><th className="pr-3">Effective</th><th className="pr-3">Status</th><th />
            </tr></thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id} className="border-t align-top" style={{ borderColor: 'var(--border)', color: r.isLatest ? 'var(--text)' : 'var(--text3)' }}>
                  <td className="py-1.5 pr-3 font-semibold">{r.name}<div className="font-normal" style={{ color: 'var(--text3)' }}>{r.ruleKey} · v{r.version}{r.createdBy ? ` · ${r.createdBy}` : ''}</div></td>
                  <td className="pr-3">{r.bankName}<div style={{ color: 'var(--text3)' }}>{r.productKey || 'All products'}</div></td>
                  <td className="pr-3">{r.deviationType} · {r.metric}</td>
                  <td className="pr-3">{r.limitValue} <span style={{ color: 'var(--text3)' }}>{r.unit}</span>{r.maxApprovableDeviation != null ? <div style={{ color: 'var(--text3)' }}>max approvable {r.maxApprovableDeviation}</div> : null}</td>
                  <td className="pr-3">{r.conditions.length ? r.conditions.map(c => `${c.field} ${c.op} ${c.value}`).join(` ${r.conditionLogic} `) : '—'}</td>
                  <td className="pr-3">{r.priority}</td>
                  <td className="pr-3">{formatDate(r.effectiveFrom)} – {r.effectiveTo ? formatDate(r.effectiveTo) : 'open'}</td>
                  <td className="pr-3">{r.supersededAt ? `Superseded ${formatDate(r.supersededAt)}` : r.isActive ? 'Active' : 'Inactive'}</td>
                  <td className="whitespace-nowrap">
                    {r.isLatest && !r.supersededAt && <>
                      <button type="button" className="p-1" title="Edit (new version)" aria-label="Edit rule" onClick={() => setForm({ initial: toInput(r), editing: r })}><Pencil size={13} /></button>
                      <button type="button" className="p-1" title={r.isActive ? 'Deactivate' : 'Activate'} aria-label="Toggle rule" onClick={() => { setToggle(r); setToggleError('') }}><Power size={13} /></button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {form && <RuleForm initial={form.initial} editing={form.editing} banks={bankList} onClose={() => setForm(null)} />}
      {toggle && (
        <Modal open onClose={() => setToggle(null)} size="sm" title={`${toggle.isActive ? 'Deactivate' : 'Activate'} "${toggle.name}"`}
          footer={<><Button size="sm" variant="secondary" onClick={() => setToggle(null)}>Cancel</Button>
            <Button size="sm" loading={toggleM.isPending} disabled={!reason.trim()} onClick={() => toggleM.mutate(toggle)}>Confirm</Button></>}>
          {toggleError && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{toggleError}</div>}
          <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text2)' }}>Reason *</label>
          <textarea className="efin-input" rows={3} value={reason} onChange={e => setReason(e.target.value)} />
        </Modal>
      )}
    </Card>
  )
}
