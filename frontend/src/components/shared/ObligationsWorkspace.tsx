import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { NumberInput } from '@/components/ui/NumberInput'
import { SkeletonText } from '@/components/ui/Skeleton'
import { formatCurrency, formatDate } from '@/utils/format'
import { useHasPermission } from '@/hooks/usePermissions'
import { useAuthStore } from '@/store/authStore'
import {
  Plus, Trash2, Pencil, TrendingUp, ScanSearch, CheckCircle2, XCircle,
  AlertTriangle, ShieldCheck, RotateCcw, Users,
} from 'lucide-react'
import {
  obligationsApi, type LoanObligation, type ObligationFoirResult,
  type DetectedObligationCandidate,
} from '@/api/obligationsApi'
import type { Loan } from '@/types'

// ─────────────────────────────────────────────────────────────────────────────
// Color palette (mirrors Vanilla JS CSS variables exactly)
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  accent:      '#0a589a',
  accentLight: '#1a72b8',
  accentSubtle:'rgba(10,88,154,.08)',
  accentBorder:'rgba(10,88,154,.18)',
  success:     '#1a7340',
  successBg:   'rgba(26,115,64,.07)',
  successBorder:'rgba(26,115,64,.25)',
  warn:        '#e67e00',
  warnBg:      'rgba(230,126,0,.08)',
  warnBorder:  'rgba(230,126,0,.25)',
  danger:      '#e31e25',
  dangerBg:    'rgba(227,30,37,.06)',
  dangerBorder:'rgba(227,30,37,.25)',
  text:        '#0c1733',
  text2:       '#3a4d6e',
  text3:       '#7a8aaa',
  surface:     '#ffffff',
  surface2:    '#f0f4ff',
  surface3:    '#e6ecf8',
  border:      '#dde3f0',
  border2:     '#c4cfe6',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const LOAN_TYPE_OPTIONS = [
  { value: 'personal_loan', label: 'Personal Loan' },
  { value: 'business_loan', label: 'Business Loan' },
  { value: 'home_loan', label: 'Home Loan' },
  { value: 'loan_against_property', label: 'LAP' },
  { value: 'new_car_loan', label: 'New Car Loan' },
  { value: 'used_car_loan', label: 'Used Car Loan' },
  { value: 'credit_card_loan', label: 'Credit Card' },
  { value: 'over_draft', label: 'OD/CC' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'education_loan', label: 'Education Loan' },
  { value: 'tw_loan', label: 'Two-Wheeler Loan' },
  { value: 'gold_loan', label: 'Gold Loan' },
  { value: 'other', label: 'Other' },
]
const LOAN_TYPE_LABEL: Record<string, string> = Object.fromEntries(LOAN_TYPE_OPTIONS.map(o => [o.value, o.label]))

const SOURCE_LABEL: Record<string, string> = {
  Manual: 'Manual', BankStatement: 'Bank Stmt', Bureau: 'Bureau', Document: 'Document',
}
const SOURCE_COLOR: Record<string, { bg: string; color: string }> = {
  BankStatement: { bg: 'rgba(10,88,154,.10)', color: C.accent },
  Bureau:        { bg: 'rgba(230,126,0,.10)', color: C.warn },
  Manual:        { bg: C.surface2, color: C.text3 },
  Document:      { bg: C.surface2, color: C.text2 },
}
const STATUS_MAP: Record<string, { bg: string; color: string; label: string }> = {
  Verified:        { bg: 'rgba(26,115,64,.10)',  color: C.success,  label: 'Verified'   },
  ReviewRequired:  { bg: 'rgba(230,126,0,.10)',  color: C.warn,     label: 'Review'     },
  Rejected:        { bg: 'rgba(227,30,37,.10)',  color: C.danger,   label: 'Rejected'   },
  Unverified:      { bg: C.surface2,             color: C.text3,    label: 'Unverified' },
}

// FOIR zone colour/label (Vanilla: 40–80 range) and ROI risk band.
const FOIR_PRESETS = [40, 50, 55, 60, 65, 70, 75, 80]
function foirZoneColor(f: number) { return f >= 70 ? C.danger : f >= 60 ? C.warn : f >= 50 ? C.accent : C.success }
function foirZoneLabel(f: number) { return f >= 70 ? 'Aggressive' : f >= 60 ? 'Moderate-High' : f >= 50 ? 'Standard' : 'Conservative' }
function roiRiskLabel(r: number) { return r >= 18 ? '🔴 High Risk' : r >= 13 ? '🟡 Moderate' : '🟢 Prime' }

// ─────────────────────────────────────────────────────────────────────────────
// Small atoms
// ─────────────────────────────────────────────────────────────────────────────
function Pill({ label, bg, color }: { label: string; bg: string; color: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 99,
      fontSize: 11, fontWeight: 700, background: bg, color,
    }}>{label}</span>
  )
}

function KpiCard({
  label, value, sub, accentColor, topColor,
}: {
  label: string; value: string; sub?: string; accentColor?: string; topColor?: string
}) {
  return (
    <div style={{
      background: C.surface, border: `1.5px solid ${C.border}`,
      borderRadius: 14, padding: '14px 16px', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: `linear-gradient(90deg,${topColor ?? C.accent},transparent)`,
      }} />
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '1.1px', color: C.text3, marginBottom: 5, fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, fontWeight: 800, color: accentColor ?? C.text }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: C.text3, marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

function SummaryKpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: '11px 14px',
    }}>
      <div style={{ fontSize: 10, color: C.text3, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, fontWeight: 800, color: color ?? C.text }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: C.text3, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Form types
// ─────────────────────────────────────────────────────────────────────────────
type OblForm = {
  loanType: string; financerName: string; sanctionAmount: string; loanEmi: string
  amountOutstanding: string; loanClosureDate: string; loanAccountNumber: string; selectBT: boolean
  applicantRole: 'Applicant' | 'CoApplicant'; isClosed: boolean
  interestRate: string; tenureMonths: string; startDate: string; maturityDate: string
  notes: string; overrideReason: string
}
const EMPTY_FORM: OblForm = {
  loanType: '', financerName: '', sanctionAmount: '', loanEmi: '', amountOutstanding: '',
  loanClosureDate: '', loanAccountNumber: '', selectBT: false, applicantRole: 'Applicant',
  isClosed: false, interestRate: '', tenureMonths: '', startDate: '', maturityDate: '',
  notes: '', overrideReason: '',
}

function figuresChangedNow(form: OblForm, editing: LoanObligation | null): boolean {
  if (!editing) return false
  return parseFloat(form.loanEmi || '0') !== editing.loanEmi
    || (form.financerName || '') !== (editing.financerName || '')
    || (form.loanAccountNumber || '') !== (editing.loanAccountNumber || '')
    || parseFloat(form.amountOutstanding || '0') !== editing.amountOutstanding
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function ObligationsWorkspace({ loanId, loan }: { loanId: number; loan: Loan }) {
  const user    = useAuthStore(s => s.user)
  const canEdit = useHasPermission('canEditObligations')
  // Admin gets a delete button; verify is Manager/OperationManager only
  const canDelete = user?.role === 'Admin'
  // Backend ReviewerRoles = "Admin,Manager,OperationManager" — all three can
  // verify/reject. Admin gets the full dropdown (all status transitions);
  // Manager and OperationManager get the quick Verify/Reject icon buttons.
  const canVerify = ['Admin', 'Manager', 'OperationManager'].includes(user?.role ?? '')
  const canAdminVerify = user?.role === 'Admin'
  const qc = useQueryClient()

  const [showForm,    setShowForm]    = useState(false)
  const [editing,     setEditing]     = useState<LoanObligation | null>(null)
  const [form,        setForm]        = useState<OblForm>(EMPTY_FORM)
  const [formError,   setFormError]   = useState('')

  // What-if inputs
  const [proposedEmi,  setProposedEmi]  = useState<string>('')
  const [coAppIncome,  setCoAppIncome]  = useState<string>('')
  // FOIR eligibility slider (Vanilla parity): null = follow the backend default
  // (lender limit / suggested); a value drives the what-if capacity server-side.
  const [foirPct,      setFoirPct]      = useState<number | null>(null)
  const [foirOverride, setFoirOverride] = useState<ObligationFoirResult | null>(null)

  const { data: ws, isLoading } = useQuery({
    queryKey: ['obligations-workspace', loanId],
    queryFn:  () => obligationsApi.getWorkspace(loanId).then(r => r.data.data),
  })

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['obligations-workspace', loanId] })
    qc.invalidateQueries({ queryKey: ['obligations', loanId] })
    // Keep any active what-if (proposed EMI / co-app income / FOIR slider) applied
    // after a data change instead of snapping the panel back to the defaults.
    const pe = proposedEmi.trim() === '' ? null : Number(proposedEmi)
    const ci = coAppIncome.trim() === '' ? null : Number(coAppIncome)
    if (pe === null && ci === null && foirPct === null) setFoirOverride(null)
    else recalc.mutate({ proposedEmi: pe, coApplicantIncome: ci, foirOverride: foirPct })
  }

  const obligations    = ws?.obligations ?? []
  const summary        = ws?.summary
  const foir           = foirOverride ?? ws?.foir
  const reconciliation = ws?.reconciliation

  // Debounced what-if recalc
  const recalc = useMutation({
    mutationFn: (body: { proposedEmi?: number | null; coApplicantIncome?: number | null; foirOverride?: number | null }) =>
      obligationsApi.calculateFoir(loanId, body).then(r => r.data.data),
    onSuccess: (data) => { if (data) setFoirOverride(data) },
  })
  useEffect(() => {
    const pe = proposedEmi.trim() === '' ? null : Number(proposedEmi)
    const ci = coAppIncome.trim() === '' ? null : Number(coAppIncome)
    if (pe === null && ci === null && foirPct === null) { setFoirOverride(null); return }
    const t = setTimeout(() => recalc.mutate({ proposedEmi: pe, coApplicantIncome: ci, foirOverride: foirPct }), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposedEmi, coAppIncome, foirPct])

  // CRUD
  function toPayload() {
    return {
      loanApplicationId: loanId,
      loanType: form.loanType,
      financerName: form.financerName || undefined,
      sanctionAmount: parseFloat(form.sanctionAmount) || 0,
      loanEmi: parseFloat(form.loanEmi) || 0,
      amountOutstanding: parseFloat(form.amountOutstanding) || 0,
      loanClosureDate: form.loanClosureDate || null,
      loanAccountNumber: form.loanAccountNumber || undefined,
      selectBT: form.selectBT,
      applicantRole: form.applicantRole,
      isClosed: form.isClosed,
      interestRate: form.interestRate.trim() === '' ? null : Number(form.interestRate),
      tenureMonths: form.tenureMonths.trim() === '' ? null : Math.round(Number(form.tenureMonths)),
      startDate: form.startDate || null,
      maturityDate: form.maturityDate || null,
      notes: form.notes || null,
      overrideReason: form.overrideReason || undefined,
    }
  }
  const create = useMutation({
    mutationFn: () => obligationsApi.create(toPayload()),
    onSuccess: (res) => {
      if (!res.data.success) { setFormError(res.data.errors?.[0] || res.data.message || 'Could not save obligation.'); return }
      invalidate(); closeForm()
    },
    onError: () => setFormError('Could not save obligation.'),
  })
  const update = useMutation({
    mutationFn: (id: number) => obligationsApi.update(id, toPayload()),
    onSuccess: (res) => {
      if (!res.data.success) { setFormError(res.data.errors?.[0] || res.data.message || 'Could not update.'); return }
      invalidate(); closeForm()
    },
    onError: () => setFormError('Could not update obligation.'),
  })
  const remove = useMutation({
    mutationFn: (id: number) => obligationsApi.delete(id),
    onSuccess: invalidate,
  })
  const verify = useMutation({
    mutationFn: (v: { id: number; decision: 'Verified' | 'Rejected' | 'ReviewRequired'; note?: string }) =>
      obligationsApi.verify(v.id, { decision: v.decision, note: v.note }),
    onSuccess: invalidate,
  })

  function openCreate() { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowForm(true) }
  function openEdit(o: LoanObligation) {
    setEditing(o)
    setForm({
      loanType: o.loanType,
      financerName: o.financerName || '',
      sanctionAmount: String(o.sanctionAmount ?? ''),
      loanEmi: String(o.loanEmi ?? ''),
      amountOutstanding: String(o.amountOutstanding ?? ''),
      loanClosureDate: o.loanClosureDate ? o.loanClosureDate.slice(0, 10) : '',
      loanAccountNumber: o.loanAccountNumber || '',
      selectBT: o.selectBT,
      applicantRole: o.applicantRole,
      isClosed: o.isClosed,
      interestRate: o.interestRate != null ? String(o.interestRate) : '',
      tenureMonths: o.tenureMonths != null ? String(o.tenureMonths) : '',
      startDate: o.startDate ? o.startDate.slice(0, 10) : '',
      maturityDate: o.maturityDate ? o.maturityDate.slice(0, 10) : '',
      notes: o.notes || '',
      overrideReason: '',
    })
    setFormError(''); setShowForm(true)
  }
  function closeForm() { setShowForm(false); setEditing(null); setForm(EMPTY_FORM); setFormError('') }
  function save() {
    if (!form.loanType) { setFormError('Loan Type is required'); return }
    const isDetectedEdit  = editing && editing.source !== 'Manual'
    const figsChanged     = figuresChangedNow(form, editing)
    if (isDetectedEdit && figsChanged && !form.overrideReason.trim()) {
      setFormError('Editing a detected obligation requires an override reason.'); return
    }
    if (editing) update.mutate(editing.id); else create.mutate()
  }
  function handleVerify(id: number, decision: 'Verified' | 'Rejected' | 'ReviewRequired') {
    if (decision === 'Rejected') {
      const note = prompt('Reason for rejecting this obligation?') || ''
      if (!note.trim()) return
      verify.mutate({ id, decision, note })
    } else {
      verify.mutate({ id, decision })
    }
  }

  if (isLoading) return <SkeletonText lines={6} className="py-4" />

  const detectedEditing = editing && editing.source !== 'Manual'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Page header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12,
        background: `linear-gradient(135deg,#fff8ee,#fff3e0)`,
        border: `1.5px solid #fcd8a0`,
        borderRadius: 14, padding: '14px 20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 24 }}>💳</span>
          <div>
            <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 16, fontWeight: 800, color: C.text }}>
              Running Loan Obligations
            </div>
            <div style={{ fontSize: 11.5, color: C.text3, marginTop: 2 }}>
              <ShieldCheck size={12} style={{ display: 'inline', verticalAlign: 'middle', color: C.accent, marginRight: 4 }} />
              Credit review workspace · proposed {formatCurrency(Math.round(loan.approvedAmount ?? loan.requestedAmount ?? 0))}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {canEdit && <DetectButton loanId={loanId} onImported={invalidate} />}
          {canEdit && (
            <button onClick={openCreate} style={styles.btnPrimary}>
              <Plus size={14} style={{ marginRight: 4 }} /> Add Obligation
            </button>
          )}
        </div>
      </div>

      {/* ── Summary strip ── */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10 }}>
          <SummaryKpi label="Active Monthly EMI"   value={formatCurrency(Math.round(summary.totalActiveMonthlyEmi))} sub={`${summary.activeCount} active`} color={C.accent} />
          <SummaryKpi label="Total Outstanding"    value={formatCurrency(Math.round(summary.totalOutstanding))} />
          <SummaryKpi label="Detected"             value={String(summary.detectedCount)} sub="from bank statement" color={summary.detectedCount ? C.accent : undefined} />
          <SummaryKpi label="Verified"             value={String(summary.verifiedCount)} color={summary.verifiedCount ? C.success : undefined} />
          <SummaryKpi label="Review Required"      value={String(summary.reviewRequiredCount)} color={summary.reviewRequiredCount ? C.warn : undefined} />
          <SummaryKpi label="Mismatches"           value={String(summary.mismatchCount)} color={summary.mismatchCount ? C.danger : undefined} sub={summary.closedCount ? `${summary.closedCount} closed` : undefined} />
        </div>
      )}

      {/* ── FOIR panel ── */}
      {foir && (
        <FoirPanel
          foir={foir}
          proposedEmi={proposedEmi} coAppIncome={coAppIncome}
          setProposedEmi={setProposedEmi} setCoAppIncome={setCoAppIncome}
          foirPct={foirPct} setFoirPct={setFoirPct}
          recomputing={recalc.isPending}
        />
      )}

      {/* ── Reconciliation alert ── */}
      {reconciliation && reconciliation.mismatchCount > 0 && (
        <div style={{
          background: 'rgba(230,126,0,.06)', border: '1.5px solid rgba(230,126,0,.3)',
          borderLeft: `4px solid ${C.warn}`, borderRadius: 12, padding: '14px 18px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <AlertTriangle size={15} style={{ color: C.warn }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: C.text2 }}>
              Reconciliation — {reconciliation.mismatchCount} mismatch(es)
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {reconciliation.mismatches.map((m, i) => (
              <div key={i} style={{ fontSize: 12, color: C.text3 }}>
                <span style={{ fontWeight: 600, color: C.text2 }}>{m.financerName || `Obligation #${m.obligationId}`}</span>
                {' · '}{m.field}: detected <code style={{ fontFamily: 'monospace' }}>{m.detectedValue}</code> vs <code style={{ fontFamily: 'monospace' }}>{m.currentValue}</code>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Add / Edit form ── */}
      {showForm && canEdit && (
        <div style={{ background: C.surface, border: `1.5px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 15, fontWeight: 800, color: C.text }}>
              {editing ? 'Edit Obligation' : '+ Add Running Loan Obligation'}
            </div>
            {detectedEditing && (
              <div style={{ fontSize: 11.5, color: C.warn, marginTop: 3 }}>
                Detected obligation — edits are recorded as a manual override
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 14 }}>
            <Field label="Loan Type *">
              <select value={form.loanType} onChange={e => setForm(p => ({ ...p, loanType: e.target.value }))} style={styles.inp}>
                <option value="">— Select —</option>
                {LOAN_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Applicant">
              <select value={form.applicantRole} onChange={e => setForm(p => ({ ...p, applicantRole: e.target.value as OblForm['applicantRole'] }))} style={styles.inp}>
                <option value="Applicant">Applicant</option>
                <option value="CoApplicant">Co-Applicant</option>
              </select>
            </Field>
            <Field label="Financer / Lender">
              <input value={form.financerName} onChange={e => setForm(p => ({ ...p, financerName: e.target.value }))} placeholder="Bank / NBFC name" style={styles.inp} />
            </Field>
            <Field label="Loan Account No.">
              <input value={form.loanAccountNumber} onChange={e => setForm(p => ({ ...p, loanAccountNumber: e.target.value }))} placeholder="Account number" style={{ ...styles.inp, fontFamily: 'monospace' }} />
            </Field>
            <Field label="Sanction Amount (₹)">
              <NumberInput value={form.sanctionAmount} onChange={e => setForm(p => ({ ...p, sanctionAmount: e.target.value }))} placeholder="e.g. 500000" style={styles.inp} />
            </Field>
            <Field label="EMI (₹/month)">
              <NumberInput value={form.loanEmi} onChange={e => setForm(p => ({ ...p, loanEmi: e.target.value }))} placeholder="e.g. 8000" style={{ ...styles.inp, color: form.loanEmi ? C.warn : undefined, fontWeight: form.loanEmi ? 700 : undefined }} />
            </Field>
            <Field label="Outstanding (₹)">
              <NumberInput value={form.amountOutstanding} onChange={e => setForm(p => ({ ...p, amountOutstanding: e.target.value }))} placeholder="e.g. 200000" style={styles.inp} />
            </Field>
            <Field label="Interest Rate (%)">
              <NumberInput value={form.interestRate} onChange={e => setForm(p => ({ ...p, interestRate: e.target.value }))} placeholder="e.g. 12.5" style={styles.inp} />
            </Field>
            <Field label="Tenure (months)">
              <NumberInput value={form.tenureMonths} onChange={e => setForm(p => ({ ...p, tenureMonths: e.target.value }))} placeholder="e.g. 48" style={styles.inp} />
            </Field>
            <Field label="Start Date">
              <input type="date" value={form.startDate} onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))} style={styles.inp} />
            </Field>
            <Field label="Maturity Date">
              <input type="date" value={form.maturityDate} onChange={e => setForm(p => ({ ...p, maturityDate: e.target.value }))} style={styles.inp} />
            </Field>
            <Field label="Closure Date">
              <input type="date" value={form.loanClosureDate} onChange={e => setForm(p => ({ ...p, loanClosureDate: e.target.value }))} style={styles.inp} />
            </Field>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, paddingBottom: 4, gridColumn: 'span 2' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: C.text2, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.selectBT} onChange={e => setForm(p => ({ ...p, selectBT: e.target.checked }))}
                  style={{ accentColor: C.accent, width: 'auto' }} />
                <span style={{ fontWeight: form.selectBT ? 700 : undefined, color: form.selectBT ? C.accent : undefined }}>Balance Transfer</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: C.text2, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.isClosed} onChange={e => setForm(p => ({ ...p, isClosed: e.target.checked }))}
                  style={{ accentColor: C.text3, width: 'auto' }} />
                Closed (excluded from FOIR)
              </label>
            </div>
            <Field label="Notes" style={{ gridColumn: 'span 4' }}>
              <input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional notes" style={styles.inp} />
            </Field>
            {detectedEditing && figuresChangedNow(form, editing) && (
              <Field label="Override reason *" style={{ gridColumn: 'span 4' }}>
                <input value={form.overrideReason} onChange={e => setForm(p => ({ ...p, overrideReason: e.target.value }))}
                  placeholder="Why the detected figures are being changed" style={{ ...styles.inp, borderColor: C.warn }} />
              </Field>
            )}
          </div>

          {formError && (
            <div style={{ fontSize: 12, color: C.danger, marginBottom: 10, padding: '6px 12px', background: 'rgba(227,30,37,.07)', borderRadius: 8 }}>
              ⚠ {formError}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button size="sm" loading={editing ? update.isPending : create.isPending} onClick={save}>
              {editing ? 'Update' : 'Add'} Obligation
            </Button>
            <Button size="sm" variant="secondary" onClick={closeForm}>Cancel</Button>
          </div>
        </div>
      )}

      {/* ── Obligations table (grouped by role) ── */}
      {obligations.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '50px 20px',
          background: '#fffaf5', borderRadius: 14, border: `1.5px dashed #fcd8a0`,
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>💳</div>
          <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 15, fontWeight: 700, marginBottom: 6, color: C.text2 }}>
            No Obligations Added
          </div>
          <div style={{ fontSize: 13, color: C.text3 }}>
            {canEdit ? 'Click "Add Obligation" to add running loans, or detect from a bank statement.' : 'No running loan obligations recorded.'}
          </div>
        </div>
      ) : (
        (['Applicant', 'CoApplicant'] as const).map(role => {
          const rows = obligations.filter(o => o.applicantRole === role)
          if (rows.length === 0) return null
          return (
            <div key={role} style={{ background: C.surface, border: `1.5px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
              {/* Group header */}
              <div style={{
                padding: '10px 18px', background: C.surface2,
                borderBottom: `1px solid ${C.border}`,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <Users size={13} style={{ color: C.text3 }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: C.text2 }}>
                  {role === 'Applicant' ? 'Applicant' : 'Co-Applicant'}
                </span>
                <span style={{ fontSize: 11, color: C.text3, marginLeft: 4 }}>· {rows.length} obligation{rows.length !== 1 ? 's' : ''}</span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: C.surface2, borderBottom: `1px solid ${C.border}` }}>
                      {['Loan Type', 'Lender', 'Source', 'Status', 'EMI (₹)', 'Outstanding (₹)', 'Lifecycle', 'BT', 'Actions'].map(h => (
                        <th key={h} style={{
                          padding: '9px 12px', textAlign: h === 'EMI (₹)' || h === 'Outstanding (₹)' ? 'right' : 'left',
                          fontWeight: 700, color: C.text2, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.6px', whiteSpace: 'nowrap',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((o, idx) => {
                      const src    = SOURCE_COLOR[o.source] ?? SOURCE_COLOR.Manual
                      const status = STATUS_MAP[o.verificationStatus] ?? STATUS_MAP.Unverified
                      return (
                        <tr key={o.id} style={{
                          background: idx % 2 === 0 ? C.surface : C.surface2,
                          opacity: o.isClosed ? 0.6 : 1,
                          transition: 'background .15s',
                        }}>
                          <td style={{ padding: '10px 12px', fontWeight: 600, color: C.text2 }}>
                            {LOAN_TYPE_LABEL[o.loanType] ?? o.loanType}
                          </td>
                          <td style={{ padding: '10px 12px', color: C.text2, maxWidth: 160 }}>
                            <span>{o.financerName || '—'}</span>
                            {o.hasReconciliationMismatch && <AlertTriangle size={11} style={{ display: 'inline', marginLeft: 5, color: C.warn }} />}
                            {o.isManualOverride && <span style={{ marginLeft: 5, fontSize: 10, color: C.text3 }}>(override)</span>}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <Pill label={SOURCE_LABEL[o.source] ?? o.source} bg={src.bg} color={src.color} />
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <Pill label={status.label} bg={status.bg} color={status.color} />
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: o.loanEmi > 0 ? C.warn : C.text3 }}>
                            {formatCurrency(o.loanEmi)}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', color: C.text2 }}>
                            {formatCurrency(o.amountOutstanding)}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            {o.isClosed
                              ? <Pill label={`Closed${o.loanClosureDate ? ' · ' + formatDate(o.loanClosureDate) : ''}`} bg={C.surface3} color={C.text3} />
                              : <Pill label="Active" bg={C.successBg} color={C.success} />}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            {o.selectBT
                              ? <Pill label="BT" bg={C.accentSubtle} color={C.accent} />
                              : <span style={{ color: C.text3 }}>—</span>}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>

                              {/* ── Admin: full status dropdown (Verified / ReviewRequired / Rejected) ── */}
                              {canAdminVerify && (
                                <AdminVerifyDropdown
                                  obligation={o}
                                  onVerify={(decision, note) => verify.mutate({ id: o.id, decision, note })}
                                />
                              )}

                              {/* ── Manager / OperationManager: quick icon buttons ── */}
                              {!canAdminVerify && canVerify && o.verificationStatus !== 'Verified' && (
                                <ActionBtn title="Mark Verified" color={C.success} hoverBg="rgba(26,115,64,.1)"
                                  onClick={() => handleVerify(o.id, 'Verified')}>
                                  <CheckCircle2 size={14} />
                                </ActionBtn>
                              )}
                              {!canAdminVerify && canVerify && o.verificationStatus !== 'Rejected' && (
                                <ActionBtn title="Reject" color={C.danger} hoverBg="rgba(227,30,37,.1)"
                                  onClick={() => handleVerify(o.id, 'Rejected')}>
                                  <XCircle size={14} />
                                </ActionBtn>
                              )}

                              {canEdit && (
                                <ActionBtn title="Edit" color={C.text3} hoverBg={C.surface3} onClick={() => openEdit(o)}>
                                  <Pencil size={13} />
                                </ActionBtn>
                              )}
                              {canDelete && (
                                <ActionBtn title="Delete" color={C.danger} hoverBg="rgba(227,30,37,.1)"
                                  onClick={() => { if (confirm('Delete this obligation?')) remove.mutate(o.id) }}>
                                  <Trash2 size={13} />
                                </ActionBtn>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  {/* Totals footer */}
                  {rows.length > 0 && (
                    <tfoot>
                      <tr style={{ background: 'rgba(26,79,163,.04)', borderTop: `1.5px solid ${C.border}` }}>
                        <td colSpan={4} style={{ padding: '9px 12px', fontSize: 11.5, fontWeight: 700, color: C.text2 }}>
                          Totals — {rows.filter(r => !r.isClosed).length} active
                        </td>
                        <td style={{ padding: '9px 12px', textAlign: 'right', fontSize: 13, fontWeight: 800, color: C.warn }}>
                          {formatCurrency(Math.round(rows.filter(r => !r.isClosed).reduce((s, r) => s + r.loanEmi, 0)))}
                        </td>
                        <td style={{ padding: '9px 12px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: C.text }}>
                          {formatCurrency(Math.round(rows.reduce((s, r) => s + r.amountOutstanding, 0)))}
                        </td>
                        <td colSpan={3} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin Verify Dropdown — gives Admin a full verify path for any status
// ─────────────────────────────────────────────────────────────────────────────
function AdminVerifyDropdown({
  obligation,
  onVerify,
}: {
  obligation: LoanObligation
  onVerify: (decision: 'Verified' | 'Rejected' | 'ReviewRequired', note?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const options: { decision: 'Verified' | 'Rejected' | 'ReviewRequired'; label: string; color: string; icon: ReactNode }[] = [
    { decision: 'Verified',       label: 'Mark Verified',       color: C.success,  icon: <CheckCircle2 size={13} /> },
    { decision: 'ReviewRequired', label: 'Flag for Review',     color: C.warn,     icon: <AlertTriangle size={13} /> },
    { decision: 'Rejected',       label: 'Reject',              color: C.danger,   icon: <XCircle size={13} /> },
  ]

  function choose(decision: 'Verified' | 'Rejected' | 'ReviewRequired') {
    setOpen(false)
    if (decision === 'Rejected') {
      const note = prompt('Reason for rejection?') || ''
      if (!note.trim()) return
      onVerify(decision, note)
    } else {
      onVerify(decision)
    }
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        title="Admin: set verification status"
        onClick={() => setOpen(o => !o)}
        style={{
          padding: '4px 6px', border: `1px solid ${C.border2}`,
          borderRadius: 6, cursor: 'pointer', fontSize: 10,
          background: C.surface2, color: C.text3,
          fontWeight: 700, letterSpacing: '.4px',
          transition: 'all .15s',
          display: 'flex', alignItems: 'center', gap: 3,
        }}
      >
        <ShieldCheck size={12} style={{ color: C.accent }} />
        <span>Verify</span>
        <span style={{ fontSize: 9 }}>▾</span>
      </button>
      {open && (
        <>
          {/* Backdrop */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 98 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute', right: 0, top: '110%', zIndex: 99,
            background: C.surface, border: `1.5px solid ${C.border2}`,
            borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)',
            minWidth: 170, overflow: 'hidden',
          }}>
            <div style={{ padding: '6px 10px', fontSize: 10, color: C.text3, fontWeight: 700, borderBottom: `1px solid ${C.border}`, letterSpacing: '.5px' }}>
              ADMIN · SET STATUS
            </div>
            {options.filter(o => o.decision !== obligation.verificationStatus).map(o => (
              <button key={o.decision} onClick={() => choose(o.decision)}
                style={{
                  width: '100%', padding: '9px 14px', border: 'none',
                  background: 'none', cursor: 'pointer', textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 13, color: o.color, fontWeight: 600,
                  transition: 'background .12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = C.surface2)}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                {o.icon} {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FOIR panel (full Vanilla JS parity)
// ─────────────────────────────────────────────────────────────────────────────
function FoirPanel({
  foir, proposedEmi, coAppIncome, setProposedEmi, setCoAppIncome, foirPct, setFoirPct, recomputing,
}: {
  foir: ObligationFoirResult
  proposedEmi: string; coAppIncome: string
  setProposedEmi: (v: string) => void; setCoAppIncome: (v: string) => void
  foirPct: number | null; setFoirPct: (v: number | null) => void
  recomputing: boolean
}) {
  if (!foir.incomeAvailable) {
    return (
      <div style={{ background: C.surface, border: `1.5px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.text3, fontSize: 13 }}>
          <TrendingUp size={16} style={{ color: C.text3 }} />
          {foir.decisionLabel || "FOIR needs the applicant's monthly income — none is on record yet."}
        </div>
      </div>
    )
  }

  const pass           = foir.passesLenderLimit
  const decisionColor  = pass === true ? C.success : pass === false ? C.danger : C.accent
  const postColor      = pass === false ? C.danger : pass === true ? C.success : C.accent
  const utilisationPct = foir.eligibleEmiAtCapacity > 0
    ? Math.min(100, Math.round((foir.existingActiveEmi / foir.eligibleEmiAtCapacity) * 100))
    : 0
  const utilColor = utilisationPct >= 90 ? C.danger : utilisationPct >= 70 ? C.warn : C.success
  const utilLabel = utilisationPct >= 90 ? '🔴 Over-leveraged' : utilisationPct >= 70 ? '🟡 Moderate' : utilisationPct >= 40 ? '🟢 Healthy' : '🔵 Low'

  // FOIR eligibility slider: shows the user's selection immediately, else the
  // backend's effective capacity FOIR (lender limit / suggested).
  const sliderVal    = foirPct ?? Math.round(foir.capacityFoirPct)
  const zColor       = foirZoneColor(sliderVal)
  const zLabel       = foirZoneLabel(sliderVal)
  const capSource    = foir.capacityFoirSource === 'override' ? 'your what-if'
    : foir.capacityFoirSource === 'lender' ? `${foir.lenderName ?? 'lender'} policy` : 'profile suggestion'
  const afterPct     = foir.capacityFoirPct > 0 ? Math.min(100, (foir.postLoanFoirPct / foir.capacityFoirPct) * 100) : 0
  const afterExceeds = foir.postLoanFoirPct > foir.capacityFoirPct

  return (
    <div style={{
      background: `linear-gradient(135deg,rgba(26,79,163,.04),rgba(227,30,37,.03))`,
      border: `1.5px solid rgba(26,79,163,.15)`,
      borderRadius: 18, padding: '22px 24px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 15, fontWeight: 800, color: C.text, display: 'flex', alignItems: 'center', gap: 8 }}>
            📊 FOIR Eligibility Engine
          </div>
          <div style={{ fontSize: 11, color: C.text3, marginTop: 3 }}>
            {foir.incomeBasis.replace(/-/g, ' ')} · CIBIL {foir.cibil} · {(foir.productKey ?? '').replace(/_/g, ' ')} · combined {formatCurrency(Math.round(foir.combinedIncome))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* ROI pill */}
          <div style={{
            background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 10,
            padding: '6px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 82,
          }}>
            <span style={{ fontSize: 9, color: C.text3, fontWeight: 700, letterSpacing: '.8px', textTransform: 'uppercase' }}>ROI</span>
            <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 17, fontWeight: 800, color: C.accent }}>{foir.proposedRatePct}%</span>
            <span style={{ fontSize: 9, color: C.text3 }}>{roiRiskLabel(foir.proposedRatePct)}</span>
          </div>
          {/* Suggested FOIR */}
          <div style={{ fontSize: 11.5, color: C.text3, background: C.accentSubtle, padding: '5px 11px', borderRadius: 8, lineHeight: 1.5 }}>
            Suggested <strong style={{ color: C.accent }}>{foir.suggestedFoirPct}%</strong><br />
            <span style={{ fontSize: 10 }}>{foir.proposedTenureMonths} mo · CIBIL {foir.cibil}</span>
          </div>
        </div>
      </div>

      {/* Decision banner */}
      <div style={{
        borderRadius: 10, padding: '9px 14px', marginBottom: 18, fontSize: 12.5, fontWeight: 600,
        background: `color-mix(in srgb, ${decisionColor} 10%, transparent)`,
        color: decisionColor, display: 'flex', alignItems: 'center', gap: 8,
        border: `1px solid color-mix(in srgb, ${decisionColor} 25%, transparent)`,
      }}>
        {pass === true ? <CheckCircle2 size={14} /> : pass === false ? <XCircle size={14} /> : <AlertTriangle size={14} />}
        {foir.decisionLabel}
      </div>

      {/* FOIR eligibility slider (40–80) */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 18px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.text2 }}>FOIR</span>
            <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, fontWeight: 800, color: zColor }}>{sliderVal}%</span>
            <Pill label={zLabel} bg={`color-mix(in srgb, ${zColor} 12%, transparent)`} color={zColor} />
            <span style={{ fontSize: 10.5, color: C.text3 }}>from {capSource}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {FOIR_PRESETS.map(f => {
              const on = sliderVal === f
              return (
                <button key={f} onClick={() => setFoirPct(f)} style={{
                  padding: '3px 9px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 700,
                  transition: 'all .15s', border: `1.5px solid ${on ? zColor : C.border2}`,
                  background: on ? zColor : C.surface2, color: on ? '#fff' : C.text3,
                }}>{f}%</button>
              )
            })}
          </div>
        </div>
        <input type="range" min={40} max={80} step={1} value={sliderVal}
          onChange={e => setFoirPct(Number(e.target.value))}
          style={{ width: '100%', height: 6, cursor: 'pointer', accentColor: zColor }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: C.text3 }}>
          <span>40% Conservative</span><span>60% Standard</span><span>80% Max</span>
        </div>
      </div>

      {/* EMI utilisation bar */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 4 }}>
          <span style={{ fontSize: 12, color: C.text2, fontWeight: 600 }}>Current EMI Load (Actual FOIR)</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: utilColor }}>{utilLabel} · {utilisationPct}% of cap used · Actual {foir.currentFoirPct}%</span>
        </div>
        <div style={{ background: C.surface3, borderRadius: 99, height: 12, overflow: 'hidden', position: 'relative' }}>
          <div style={{
            height: '100%', borderRadius: 99, width: `${utilisationPct}%`,
            background: utilColor, transition: 'width .5s',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10.5, color: C.text3 }}>
          <span>Going EMI {formatCurrency(Math.round(foir.existingActiveEmi))}</span>
          <span>FOIR Cap {formatCurrency(Math.round(foir.eligibleEmiAtCapacity))} ({foir.capacityFoirPct}% of income)</span>
        </div>
        {/* After new loan */}
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: C.text3 }}>
          <span>After new loan:</span>
          <div style={{ flex: 1, background: C.surface3, borderRadius: 99, height: 6, overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 99, width: `${afterPct.toFixed(1)}%`, background: afterExceeds ? C.danger : C.accent, transition: 'width .5s' }} />
          </div>
          <span style={{ fontWeight: 700, color: afterExceeds ? C.danger : C.accent }}>
            FOIR → {foir.postLoanFoirPct}%{afterExceeds ? ' ⚠ exceeds cap' : ' ✓'}
          </span>
        </div>
      </div>

      {/* 8 metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 14 }}>
        <KpiCard label="Current FOIR" value={`${foir.currentFoirPct}%`} sub={`${formatCurrency(Math.round(foir.existingActiveEmi))} existing EMI`} topColor={C.accent} />
        <KpiCard label="Post-loan FOIR" value={`${foir.postLoanFoirPct}%`} accentColor={postColor} topColor={postColor} sub={`+ ${formatCurrency(Math.round(foir.proposedEmi))} proposed`} />
        <KpiCard label="Lender FOIR Limit" value={foir.applicableFoirLimitPct != null ? `${foir.applicableFoirLimitPct}%` : '—'} topColor={C.border2}
          sub={foir.applicableFoirLimitPct != null ? `${foir.foirLimitSource}${foir.lenderName ? ' · ' + foir.lenderName : ''}` : 'no policy on file'} />
        <KpiCard label="Available Headroom" value={formatCurrency(Math.round(foir.availableHeadroomEmi))} accentColor={C.success} topColor={C.success} sub="EMI for new loan" />
        <KpiCard label="Eligible Loan" value={foir.eligibleLoanAmount != null ? formatCurrency(Math.round(foir.eligibleLoanAmount)) : '—'} accentColor={C.danger} topColor={C.danger}
          sub={`@ ${foir.proposedRatePct}% · ${foir.proposedTenureMonths} mo · EMI ${formatCurrency(Math.round(foir.proposedEmi))}`} />
        <KpiCard label="Combined Income" value={formatCurrency(Math.round(foir.combinedIncome))} topColor={C.accent} sub={foir.incomeBasis.replace(/-/g,' ')} />
        <KpiCard label="Balance Transfer EMI" value={formatCurrency(Math.round(foir.balanceTransferEmi))} topColor={foir.balanceTransferEmi > 0 ? C.accentLight : C.border2}
          sub={foir.balanceTransferEmi > 0 ? 'refinanced by new loan' : 'no BT'} />
        <KpiCard label="Suggested FOIR" value={`${foir.suggestedFoirPct}%`} topColor={C.text3} sub="profile heuristic (reference)" />
      </div>

      {foir.incomeBasisNote && (
        <div style={{ fontSize: 11, color: C.text3, marginBottom: 14 }}>{foir.incomeBasisNote}</div>
      )}

      {/* Detail breakdown (3 columns) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
        <DetailCard title="📋 Loan vs Request">
          <DetailRow label="Requested" value={formatCurrency(Math.round(foir.requestedAmount))} />
          <DetailRow label="FOIR-eligible" value={foir.eligibleLoanAmount != null ? formatCurrency(Math.round(foir.eligibleLoanAmount)) : '—'} bold
            color={(foir.eligibleLoanAmount ?? 0) >= foir.requestedAmount ? C.success : C.danger} />
          <DetailRow label="Conservative" value={formatCurrency(Math.round(foir.conservativeEligibleLoanAmount))} color={C.accent} />
          <Divider />
          <DetailRow label={foir.loanDiff >= 0 ? 'Headroom' : 'Shortfall'} bold
            value={`${foir.loanDiff >= 0 ? '↑' : '↓'} ${formatCurrency(Math.abs(Math.round(foir.loanDiff)))}`}
            color={foir.loanDiff >= 0 ? C.success : C.danger} />
          <DetailRow label="Max (no obligations)" value={formatCurrency(Math.round(foir.maxEligibleLoanAmount))} />
        </DetailCard>

        <DetailCard title="💳 EMI Breakdown">
          <DetailRow label={`FOIR Cap (${foir.capacityFoirPct}%)`} value={formatCurrency(Math.round(foir.eligibleEmiAtCapacity))} color={C.accent} />
          <DetailRow label="Going EMI" value={formatCurrency(Math.round(foir.existingNonBtEmi))} color={foir.existingNonBtEmi > 0 ? C.warn : C.text3} />
          <DetailRow label="Available EMI" value={formatCurrency(Math.round(foir.availableHeadroomEmi))} bold
            color={foir.availableHeadroomEmi > 0 ? C.success : C.danger} />
          <Divider />
          <DetailRow label="Proposed EMI" value={formatCurrency(Math.round(foir.proposedEmi))} bold color={C.accent} />
          <DetailRow label="Total EMI after" value={formatCurrency(Math.round(foir.totalObligationsAfter))} bold
            color={foir.totalObligationsAfter > foir.eligibleEmiAtCapacity ? C.danger : C.success} />
          <DetailRow label="CIBIL multiplier" value={`${foir.cibilMultiplier}× · ${formatCurrency(Math.round(foir.loanByMultiplier))}`} />
        </DetailCard>

        <DetailCard title="👥 Co-App & Risk Metrics">
          <DetailRow label="Primary net income" value={formatCurrency(Math.round(foir.primaryNetIncome))} />
          <DetailRow label="Co-applicant income" value={formatCurrency(Math.round(foir.coApplicantIncome))} color={foir.coApplicantIncome > 0 ? C.accent : C.text3} />
          <Divider />
          <DetailRow label="DSCR" value={foir.dscr} bold color={foir.dscr !== '—' && Number(foir.dscr) >= 1.5 ? C.success : foir.dscr === '—' ? C.text3 : C.danger} />
          <DetailRow label="Current FOIR" value={`${foir.currentFoirPct}%`} bold color={foir.currentFoirPct > 60 ? C.warn : C.success} />
          <DetailRow label="Post-loan FOIR" value={`${foir.postLoanFoirPct}%`} bold color={afterExceeds ? C.danger : foir.postLoanFoirPct > 60 ? C.warn : C.success} />
          <DetailRow label="Salary mult." value={`${foir.cibilMultiplier}×`} />
        </DetailCard>
      </div>

      {/* Balance-transfer benefit banner */}
      {foir.balanceTransferEmi > 0 && (
        <div style={{ padding: '11px 16px', background: C.accentSubtle, border: `1px solid ${C.accentBorder}`, borderRadius: 10, fontSize: 12.5, color: C.accent, display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 18 }}>🔄</span>
          <span><strong>Balance Transfer:</strong> {formatCurrency(Math.round(foir.balanceTransferEmi))}/mo excluded → frees up to {formatCurrency(Math.round(foir.btBenefitLoanAmount))} of eligible loan.</span>
        </div>
      )}

      {/* Outstanding warning */}
      {foir.nonBtOutstanding > 0 && (
        <div style={{ padding: '10px 14px', background: C.warnBg, border: `1px solid ${C.warnBorder}`, borderRadius: 8, fontSize: 12, color: C.warn, display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <span>⚠</span>
          <span>Non-BT outstanding: <strong>{formatCurrency(Math.round(foir.nonBtOutstanding))}</strong>{foir.btOutstanding > 0 ? ` · BT outstanding: ${formatCurrency(Math.round(foir.btOutstanding))}` : ''}</span>
        </div>
      )}

      {/* What-if controls */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16,
        alignItems: 'flex-end', borderTop: `1px solid ${C.border}`, paddingTop: 14,
      }}>
        <Field label="Proposed EMI (what-if)">
          <NumberInput min={0} value={proposedEmi} placeholder={String(Math.round(foir.proposedEmi))}
            onChange={e => setProposedEmi(e.target.value)} style={styles.inp} />
        </Field>
        <Field label="Co-applicant income (what-if)">
          <NumberInput min={0} value={coAppIncome} placeholder="0"
            onChange={e => setCoAppIncome(e.target.value)} style={styles.inp} />
        </Field>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {(proposedEmi || coAppIncome || foirPct !== null) && (
            <button onClick={() => { setProposedEmi(''); setCoAppIncome(''); setFoirPct(null) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: C.accent, display: 'flex', alignItems: 'center', gap: 4 }}>
              <RotateCcw size={11} /> Reset what-if
            </button>
          )}
          {recomputing && <span style={{ fontSize: 11, color: C.text3 }}>recomputing…</span>}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Bank-statement detection panel
// ─────────────────────────────────────────────────────────────────────────────
function DetectButton({ loanId, onImported }: { loanId: number; onImported: () => void }) {
  const [open,       setOpen]       = useState(false)
  const [candidates, setCandidates] = useState<DetectedObligationCandidate[] | null>(null)
  const [message,    setMessage]    = useState<string | null>(null)
  const [selected,   setSelected]   = useState<Set<string>>(new Set())

  const detect = useMutation({
    mutationFn: () => obligationsApi.detect(loanId).then(r => r.data.data),
    onSuccess: (data) => {
      setCandidates(data?.candidates ?? [])
      setMessage(data?.message ?? null)
      setSelected(new Set((data?.candidates ?? []).filter(c => !c.alreadyImported).map(c => c.detectionSignature)))
      setOpen(true)
    },
  })
  const importSel = useMutation({
    mutationFn: () => obligationsApi.importDetected(loanId, Array.from(selected)),
    onSuccess: (res) => { if (res.data.success) { setOpen(false); onImported() } },
  })

  return (
    <>
      <button onClick={() => detect.mutate()} disabled={detect.isPending}
        style={styles.btnSecondary}>
        <ScanSearch size={14} style={{ marginRight: 4 }} />
        {detect.isPending ? 'Detecting…' : 'Detect from Bank Stmt'}
      </button>
      {open && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,.4)', padding: 16,
        }} onClick={() => setOpen(false)}>
          <div style={{
            background: C.surface, borderRadius: 18,
            boxShadow: '0 20px 60px rgba(0,0,0,.2)',
            maxWidth: 700, width: '100%', maxHeight: '80vh', overflow: 'auto',
            padding: 24,
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <ScanSearch size={18} style={{ color: C.accent }} />
              <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 16, fontWeight: 800, color: C.text }}>Detected Obligations</span>
            </div>
            <p style={{ fontSize: 12, color: C.text3, marginBottom: 16 }}>
              Recurring EMI / mandate debits found in the persisted bank statement.
              Review and import — imported rows are marked <strong>Review Required</strong>.
            </p>
            {(!candidates || candidates.length === 0) ? (
              <p style={{ fontSize: 13, color: C.text3, padding: '20px 0' }}>
                {message || 'No recurring EMI debits detected.'}
              </p>
            ) : (
              <>
                <div style={{ overflowX: 'auto', marginBottom: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ background: C.surface2, borderBottom: `1px solid ${C.border}` }}>
                        {['', 'Lender (from narration)', 'EMI (₹)', 'Channel', 'Seen', 'Range'].map(h => (
                          <th key={h} style={{ padding: '8px 10px', textAlign: h === 'EMI (₹)' || h === 'Seen' ? 'right' : 'left', fontWeight: 700, color: C.text2, fontSize: 11 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.map((c, idx) => (
                        <tr key={c.detectionSignature} style={{
                          background: idx % 2 === 0 ? C.surface : C.surface2,
                          opacity: c.alreadyImported ? 0.5 : 1,
                        }}>
                          <td style={{ padding: '8px 10px' }}>
                            <input type="checkbox" disabled={c.alreadyImported}
                              checked={selected.has(c.detectionSignature)}
                              style={{ accentColor: C.accent, width: 'auto' }}
                              onChange={e => setSelected(prev => {
                                const n = new Set(prev)
                                if (e.target.checked) n.add(c.detectionSignature); else n.delete(c.detectionSignature)
                                return n
                              })} />
                          </td>
                          <td style={{ padding: '8px 10px', color: C.text2, fontWeight: 600 }}>
                            {c.financerName || <span style={{ color: C.text3 }}>Unknown lender</span>}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: C.warn }}>{formatCurrency(c.emi)}</td>
                          <td style={{ padding: '8px 10px', color: C.text3 }}>{c.channel}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', color: C.text2 }}>
                            {c.occurrenceCount}×
                            {c.alreadyImported && <span style={{ marginLeft: 5, fontSize: 10, color: C.success }}>imported</span>}
                          </td>
                          <td style={{ padding: '8px 10px', color: C.text3, fontSize: 11 }}>
                            {formatDate(c.firstSeen)} – {formatDate(c.lastSeen)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p style={{ fontSize: 11, color: C.text3, marginBottom: 14 }}>
                  Only the recurring EMI amount and the lender narration are taken — outstanding balance, tenure, rate and account number are left blank for you to complete on review.
                </p>
              </>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {candidates && candidates.length > 0 && (
                <Button size="sm" loading={importSel.isPending} disabled={selected.size === 0}
                  onClick={() => importSel.mutate()}>
                  Import {selected.size || ''} selected
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared atoms
// ─────────────────────────────────────────────────────────────────────────────
function Field({ label, children, style }: { label: string; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={style}>
      <label style={{ fontSize: 11.5, fontWeight: 600, color: C.text2, display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  )
}

function DetailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.text2, marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: 12 }}>{children}</div>
    </div>
  )
}
function DetailRow({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: C.text3 }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 600, color: color ?? C.text }}>{value}</span>
    </div>
  )
}
function Divider() { return <div style={{ height: 1, background: C.border }} /> }

function ActionBtn({ children, title, color, hoverBg, onClick }: {
  children: ReactNode; title: string; color: string; hoverBg: string; onClick: () => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <button title={title} onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        padding: 5, border: 'none', cursor: 'pointer', borderRadius: 6,
        background: hover ? hoverBg : 'transparent', color, transition: 'all .15s',
        display: 'inline-flex', alignItems: 'center',
      }}>
      {children}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = {
  inp: {
    width: '100%',
    padding: '7px 10px',
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 13,
    background: C.surface2,
    color: C.text,
    outline: 'none',
    boxSizing: 'border-box',
  } as React.CSSProperties,

  btnPrimary: {
    display: 'inline-flex', alignItems: 'center',
    padding: '7px 16px', borderRadius: 8, border: 'none',
    background: C.accent, color: '#fff',
    fontSize: 13, fontWeight: 700, cursor: 'pointer',
    transition: 'background .15s',
  } as React.CSSProperties,

  btnSecondary: {
    display: 'inline-flex', alignItems: 'center',
    padding: '7px 14px', borderRadius: 8,
    border: `1.5px solid ${C.border2}`,
    background: C.surface, color: C.text2,
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
    transition: 'all .15s',
  } as React.CSSProperties,
}
