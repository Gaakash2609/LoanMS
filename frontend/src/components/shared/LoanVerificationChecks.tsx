import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/api/axios'
import { loansApi } from '@/api/loansApi'
import { incomeVerificationApi } from '@/api/incomeVerificationApi'
import { LOAN_KEYS } from '@/hooks/useLoans'
import { customersApi } from '@/api/customersApi'
import { kycApi } from '@/api/kycApi'
import type { CreateCustomerRequest } from '@/types'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useHasPermission, useCurrentUserDept } from '@/hooks/usePermissions'
import { getDocumentWithTimeout, extractText } from '@/utils/perfios/pdf'
import { parseSalarySlip, SALARY_SLIP_VISION_PROMPT } from '@/utils/salarySlipExtraction'
import { Wallet, Banknote, RotateCcw, Mail, Plus, Trash2, ShieldCheck, FileSearch, FileSignature, FileCheck, Repeat, Upload, Search } from 'lucide-react'
import { offerWorkflowApi } from '@/api/offerWorkflowApi'
import { workflowKey } from '@/components/shared/OffersTab'
import { NumberInput } from '@/components/ui/NumberInput'
import { apiErrorMessage } from '@/utils/apiError'

// ── Loan Verification Checks ───────────────────────────────────────────────
// Server-backed React equivalents of legacy efin-app.js's client-side (localStorage
// / mailto) workflow-check actions — confirmIncomeCheck / confirmBankCheck /
// confirmEcsReturn / Deal Confirmation. Each preserves the Vanilla business
// outcome but persists through the real backend: a tracking entry
// (POST /api/loans/{id}/tracking) — the durable audit record that legacy kept
// in localStorage — plus Income Check's verified-salary write to the customer
// and Deal Confirmation's server email (POST /api/email/send) in place of
// legacy's mailto. React's status-based workflow is left unchanged.

const fmtInr = (v: number) => '₹' + Math.round(v).toLocaleString('en-IN')

// Port of Vanilla's LOAN_EMP_WORKFLOW `timelineActions` per loan type
// (efin-app.js:27204-27390, _default row per type), re-keyed to the backend's
// actual LoanType enum names (LoanMS.Domain/Enums/LoanType.cs — stored as the
// string). Drives WHICH workflow buttons the .tracking-actions bar renders —
// exactly like Vanilla's buildTimelineActionButtons iterating
// `wf.timelineActions`. Unknown types fall back to Personal, matching
// getWorkflow's own fallback. (Vanilla's insurance-only 'approve_ins' /
// 'disburse_ins' have no equivalent — the backend LoanType enum has no
// Insurance value — so they are intentionally not present.)
const TIMELINE_ACTIONS: Record<string, string[]> = {
  Personal:  ['fi_report', 'underwriting', 'approve', 'deviation', 'nach', 'disburse'],
  Business:  ['fi_report', 'underwriting', 'approve', 'deviation', 'nach', 'disburse'],
  Home:      ['fi_report', 'underwriting', 'approve', 'deviation', 'nach', 'disburse'],
  LAP:       ['fi_report', 'underwriting', 'approve', 'deviation', 'nach', 'disburse'],
  Education: ['fi_report', 'underwriting', 'approve', 'deviation', 'disburse'],
  Vehicle:   ['fi_report', 'underwriting', 'approve', 'deviation', 'disburse'],
  Car:       ['underwriting', 'approve', 'deviation', 'disburse'],
  Overdraft: ['underwriting', 'approve', 'deviation', 'disburse'],
  // Insurance — Vanilla's insurance product (LOAN_EMP_WORKFLOW.insurance):
  // approve_ins ("Verify Insurance" at login → "Approve Policy" at
  // underwriting) + disburse_ins ("Issue Policy"), and NO fi_report /
  // deviation. `nach` is kept so the Acceptance-stage NACH + Customer
  // Agreement can be completed before Issue Policy (the backend disburse gate
  // requires both regardless of product) — Vanilla's own insurance config
  // omits it, which would otherwise dead-end disbursal.
  Insurance: ['approve_ins', 'nach', 'disburse_ins'],
}

interface CheckProps {
  loanId: number
  customerId?: number
  customerName?: string
  customerEmail?: string
  employmentType?: string | null
  loanStatus: string
  // Loan type (drives which workflow buttons the actions bar shows —
  // Vanilla's wf.timelineActions) and the status permission the Underwriting
  // move checks (Vanilla rd.canChangeStatus). Optional so existing
  // callers/tests still compile.
  loanType?: string
  canChangeStatus?: boolean
  // Approve / Deviation / Disburse moved to the Offers tab (offer → deviation →
  // credit approval → sanction → disbursement, all server-authorised). The bar
  // only links there. Optional so existing callers/tests still compile.
  onOpenOffers?: () => void
  // Verification flags — a check button hides once its flag is done, matching
  // legacy's `if (!app.document_checked)` etc. (efin-app.js:3240-3247, 3234,
  // 27458). Optional so existing callers/tests still compile.
  documentChecked?: boolean
  incomeChecked?: boolean
  bankChecked?: boolean
  ecsReturn?: boolean
  fiReportChecked?: boolean
  nachDone?: boolean
  customerAgreementDone?: boolean
}

// Terminal stages where legacy shows NO action buttons in the Timeline
// (isAppFinalLocked / FINAL_LOCK_STAGES: disbursed/rejected/hold →
// React Disbursed/Rejected/Closed/OnHold). efin-app.js:710, 3218-3222.
const FINAL_LOCK_STATUSES = ['Disbursed', 'Rejected', 'Closed', 'OnHold']

// Self-employed detection — same normalization LoanDetailPage's employmentTip
// uses (efin-app.js's empType check: SELFEMP/PROFESSIONAL/SELF_EMPLOYED all
// route to the self-employed income-check flow, since Professional's income
// entries are also GST/ITR/business-style, not payslip-style).
function isSelfEmployedType(empType?: string | null): boolean {
  if (!empType) return false
  const t = empType.toLowerCase().replace(/[\s_-]/g, '')
  return t.includes('self') || t.includes('business') || t.includes('profession')
}

// Post the audit tracking entry every check produces. Shared by all four.
// The Overview verification flag a check flips on completion (Vanilla
// efin-app.js:3699-3702, 3644) — turns the loan-detail Overview badge ✓ Done.
type OverviewFlag = 'documentChecked' | 'incomeChecked' | 'bankChecked' | 'ecsReturn' | 'fiReportChecked' | 'nachDone' | 'customerAgreementDone'

function usePostTracking(loanId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (entry: { name: string; stage: string; status: string; comment: string; subNote?: string; overviewFlag?: OverviewFlag }) => {
      const res = await api.post(`/api/loans/${loanId}/tracking`, {
        name: entry.name, stage: entry.stage, assignedUser: '',
        status: entry.status, comment: entry.comment, subNote: entry.subNote ?? '',
      })
      // After the audit entry lands, flip the matching Overview verification
      // flag so its badge turns ✓ Done — the durable equivalent of Vanilla's
      // app.document_checked / incom_check / bank_check / ecs_return /
      // final_report being set alongside the tracking row.
      if (entry.overviewFlag) {
        await loansApi.updateOverview(loanId, { [entry.overviewFlag]: true })
      }
      return res
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tracking', loanId] })
      qc.invalidateQueries({ queryKey: LOAN_KEYS.detail(loanId) })
    },
  })
}

// ── Income Check ───────────────────────────────────────────────────────────
// Entry-type taxonomy is employment-aware, per Vanilla's icAddRow
// (efin-app.js:32997-33010): Salaried gets salary/bonus/arrear/other;
// Self-employed gets business_income/gst_credit/advance/rental/investment/
// other. Only the "core" type (salary, resp. business_income) counts toward
// the average — everything else is informational context, same as Vanilla's
// icCalcAvg/confirmIncomeCheck coreType filter below.
type SalariedIncomeType = 'salary' | 'bonus' | 'arrear' | 'other'
type SelfEmpIncomeType = 'business_income' | 'gst_credit' | 'advance' | 'rental' | 'investment' | 'other'
type IncomeType = SalariedIncomeType | SelfEmpIncomeType
interface IncomeRow { date: string; amount: string; month: string; type: IncomeType }
const SALARIED_TYPES: { value: SalariedIncomeType; label: string }[] = [
  { value: 'salary', label: 'Salary' }, { value: 'bonus', label: 'Bonus' },
  { value: 'arrear', label: 'Arrear' }, { value: 'other', label: 'Other' },
]
const SELFEMP_TYPES: { value: SelfEmpIncomeType; label: string }[] = [
  { value: 'business_income', label: 'Business Income' }, { value: 'gst_credit', label: 'GST Credit' },
  { value: 'advance', label: 'Advance / Drawing' }, { value: 'rental', label: 'Rental Income' },
  { value: 'investment', label: 'Investment Return' }, { value: 'other', label: 'Other' },
]
const BLANK_ROW: IncomeRow = { date: '', amount: '', month: '', type: 'salary' }

function IncomeCheckModal({ loanId, customerId, isSelfEmployed, onClose }: { loanId: number; customerId?: number; isSelfEmployed?: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const dept = useCurrentUserDept()
  const coreType: IncomeType = isSelfEmployed ? 'business_income' : 'salary'
  const typeOptions = isSelfEmployed ? SELFEMP_TYPES : SALARIED_TYPES
  const [rows, setRows] = useState<IncomeRow[]>([{ ...BLANK_ROW, type: coreType }])
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [slipMsg, setSlipMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [extracting, setExtracting] = useState(false)

  // Salary-slip auto-extraction — restores legacy PSE (efin-app.js:41973/42457):
  // read Net Pay + Month from an uploaded payslip and pre-fill an income row
  // instead of manual typing. Text PDFs → local text extraction; image slips →
  // the AI-vision relay (same generic /api/kyc/vision the KYC flow uses). The
  // parsed figure still flows through the normal confirm → customer.monthlyIncome
  // persistence below, so refresh-safe.
  async function handleSlip(file: File | undefined) {
    if (!file) return
    setSlipMsg(null); setExtracting(true)
    try {
      const ext = (file.name.split('.').pop() || '').toLowerCase()
      const isImage = file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)
      let text = ''
      if (ext === 'pdf' || file.type === 'application/pdf') {
        const pdf = await getDocumentWithTimeout({ data: await file.arrayBuffer() })
        text = await extractText(pdf)
      }
      if (isImage) {
        const data = await new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(String(r.result).split(',')[1] || '')
          r.onerror = () => reject(new Error('read-failed'))
          r.readAsDataURL(file)
        })
        const resp = await kycApi.extractFromImages({
          documentType: 'SALARY_SLIP',
          images: [{ mediaType: file.type || 'image/jpeg', data }],
          prompt: SALARY_SLIP_VISION_PROMPT,
        })
        if (!resp.data.success) throw new Error(resp.data.error || 'vision-failed')
        text = resp.data.text || ''
      } else if (text.trim().length < 20) {
        setSlipMsg({ text: `Couldn't read text from ${file.name} (scanned PDF?). Upload it as an image to auto-read, or fill the row manually.`, ok: false })
        return
      }
      const parsed = parseSalarySlip(text)
      if (parsed.netPay == null && parsed.month == null) {
        setSlipMsg({ text: `Could not read salary figures from ${file.name} — please fill the row manually.`, ok: false })
        return
      }
      setRows(rs => {
        const row: IncomeRow = { date: '', amount: parsed.netPay != null ? String(parsed.netPay) : '', month: parsed.month ?? '', type: coreType }
        const blankIdx = rs.findIndex(r => !r.amount && !r.month && r.type === coreType)
        return blankIdx >= 0 ? rs.map((r, i) => i === blankIdx ? row : r) : [...rs, row]
      })
      setSlipMsg({ text: `Extracted from ${file.name}: ${parsed.month ?? '—'} · Net ${parsed.netPay != null ? fmtInr(parsed.netPay) : '—'}`, ok: true })
    } catch {
      setSlipMsg({ text: 'Could not read the salary slip. Please fill the row manually.', ok: false })
    } finally {
      setExtracting(false)
    }
  }

  const amounts = rows.map(r => parseFloat(r.amount) || 0).filter(a => a > 0)
  const salaryAmounts = rows.filter(r => r.type === coreType).map(r => parseFloat(r.amount) || 0).filter(a => a > 0)
  const baseAmounts = salaryAmounts.length ? salaryAmounts : amounts
  const total = amounts.reduce((s, v) => s + v, 0)
  const avg = baseAmounts.length ? Math.round(baseAmounts.reduce((s, v) => s + v, 0) / baseAmounts.length) : 0
  const hi = amounts.length ? Math.max(...amounts) : 0
  const lo = amounts.length ? Math.min(...amounts) : 0
  const variance = hi > 0 ? Math.round((hi - lo) / hi * 100) : 0

  const submit = useMutation({
    mutationFn: async () => {
      // 1) Persist the verified net salary onto the customer (legacy set app.salary).
      //    Full round-trip so no existing field is dropped by the required-field
      //    PUT. Best-effort: the audit entry below (which records the verified
      //    Net Salary) is the guaranteed outcome, so a customer PUT that fails
      //    validation (e.g. a legacy record with a malformed phone/email) must
      //    NOT abort the whole income check.
      if (customerId) {
        try {
          const cur = (await customersApi.getById(customerId)).data.data
          if (cur) {
            const payload: Partial<CreateCustomerRequest> = {
              fullName: cur.fullName, email: cur.email, phone: cur.phone,
              panNumber: cur.panNumber, aadhaarNumber: cur.aadhaarNumber, dateOfBirth: cur.dateOfBirth,
              address: cur.address, city: cur.city, state: cur.state, pinCode: cur.pinCode,
              monthlyObligations: cur.monthlyObligations, employmentType: cur.employmentType,
              companyName: cur.companyName, cibilScore: cur.cibilScore,
              monthlyIncome: avg, // the verified figure
            }
            await customersApi.update(customerId, payload)
          }
        } catch { /* best-effort income sync — see note above */ }
      }
      // 2) Audit trail entry with the full analysis (legacy 'EFIN-Income Check - CPA').
      const lines = rows.filter(r => (parseFloat(r.amount) || 0) > 0)
        .map(r => `${r.date || '—'}   ${fmtInr(parseFloat(r.amount) || 0)}   ${r.month || ''}${r.type !== coreType ? '   (' + r.type + ')' : ''}`)
      const fullComment = [
        'Salary / Income Details:', ...lines, '',
        `Average Monthly Salary: ${fmtInr(avg)}`, `Total Credits: ${fmtInr(total)}`,
        `Highest: ${fmtInr(hi)}`, `Lowest: ${fmtInr(lo)}`,
        `Variance: ${variance}%${variance > 30 ? ' (High — Irregular Income)' : ''}`,
        `Net Salary Set: ${fmtInr(avg)}`, '', `Remark: ${comment.trim()}`,
      ].join('\n')
      await api.post(`/api/loans/${loanId}/tracking`, {
        name: 'EFIN-Income Check - CPA', stage: dept, assignedUser: '',
        status: 'COMPLETE', comment: fullComment, subNote: '',
      })
      // Income Checked is now BACKEND-DERIVED (Phase 5/6). The old client
      // shortcut (loansApi.updateOverview({ incomeChecked: true })) is no longer
      // honored by the backend — a browser can't assert "verified". Instead we
      // TRIGGER the authoritative verification run; its persisted result (and the
      // derived IncomeChecked flag) is shown by IncomeVerificationPanel. The
      // manual figures entered above remain the recorded income-check note.
      await incomeVerificationApi.run(loanId)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tracking', loanId] })
      qc.invalidateQueries({ queryKey: LOAN_KEYS.detail(loanId) })
      qc.invalidateQueries({ queryKey: ['income-verification', loanId] })
      onClose()
    },
    onError: () => setError('Could not save the income check. Please try again.'),
  })

  function confirm() {
    if (amounts.length === 0) { setError('Enter at least one income/salary entry.'); return }
    if (!comment.trim()) { setError('A comment is required.'); return }
    setError('')
    submit.mutate()
  }

  return (
    <Modal open onClose={onClose} title="Income Check" subtitle="Verify salary credits and set the net monthly salary" size="lg"
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" loading={submit.isPending} onClick={confirm}>Post Income Check</Button>
      </>}>
      {error && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto_auto] gap-2 items-center">
            <input type="date" value={r.date} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, date: e.target.value } : x))} className="efin-input text-xs" />
            <NumberInput placeholder="Amount (₹)" value={r.amount} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} className="efin-input text-xs" />
            <input type="text" placeholder="Month" value={r.month} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, month: e.target.value } : x))} className="efin-input text-xs" />
            <select value={r.type} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, type: e.target.value as IncomeRow['type'] } : x))} className="efin-input text-xs">
              {typeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button title="Remove" onClick={() => setRows(rs => rs.length > 1 ? rs.filter((_, j) => j !== i) : rs)} className="p-1.5 text-[color:var(--danger)]"><Trash2 size={14} /></button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-4">
          <button onClick={() => setRows(rs => [...rs, { ...BLANK_ROW, type: coreType }])} className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--accent)]"><Plus size={13} /> Add row</button>
          <label className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--accent)] cursor-pointer">
            <Upload size={13} /> {extracting ? 'Reading slip…' : 'Auto-fill from salary slip'}
            <input type="file" accept=".pdf,image/*" className="hidden" disabled={extracting}
              onChange={e => { handleSlip(e.target.files?.[0]); e.target.value = '' }} />
          </label>
        </div>
        {slipMsg && (
          <p className={`text-[11px] mt-1 ${slipMsg.ok ? 'text-green-600' : 'text-[color:var(--warn)]'}`}>{slipMsg.text}</p>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 text-center">
        {[['Avg / Month', fmtInr(avg)], ['Total', fmtInr(total)], ['Highest', fmtInr(hi)], ['Variance', variance + '%']].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-[color:var(--border)] p-2">
            <p className="text-[10px] uppercase tracking-wide text-[color:var(--text3)]">{k}</p>
            <p className="text-sm font-bold text-[color:var(--text)]">{v}</p>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <label className="block text-xs font-medium text-[color:var(--text2)] mb-1">Comment *</label>
        <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} placeholder="Verification remark" className="efin-input" />
      </div>
    </Modal>
  )
}

// ── Bank Details Check ─────────────────────────────────────────────────────
// Full field set restored to match Vanilla's dedicated Bank Check modal
// (efin-app.js:33393-33694): Check Type pills, structured Bank Details incl.
// Branch/Account Type, and a 3-way verdict — not the earlier generic
// bank-name/account-number-only form.
const BANK_CHECK_TYPES: { value: string; label: string }[] = [
  { value: 'salary_account', label: '💳 Salary Account' }, { value: 'savings_account', label: '🏧 Savings Account' },
  { value: 'current_account', label: '🏢 Current Account' }, { value: 'emi_debit', label: '📋 EMI Debit Check' },
  { value: 'ecs_mandate', label: '🔁 ECS / NACH Mandate' }, { value: 'od_cc', label: '💰 OD / CC Account' },
]
const BANK_CHECK_VERDICTS = [
  { value: 'ok', label: '✓ Okay to Process' }, { value: 'warn', label: '⚠ Discrepancy Found' }, { value: 'fail', label: '✗ Mismatch / Rejected' },
] as const

function BankCheckModal({ loanId, onClose }: { loanId: number; onClose: () => void }) {
  const post = usePostTracking(loanId)
  const dept = useCurrentUserDept()
  const [f, setF] = useState({
    bankName: '', accountHolder: '', accountNumber: '', ifsc: '', branch: '', accountType: '',
    checkType: 'salary_account', verdict: 'ok' as 'ok' | 'warn' | 'fail', stmtFrom: '', stmtTo: '', comment: '',
  })
  const [error, setError] = useState('')
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(p => ({ ...p, [k]: e.target.value }))

  function confirm() {
    if (!f.bankName.trim())      { setError('Please enter the Bank Name.'); return }
    if (!f.accountHolder.trim()) { setError('Please enter the Account Holder Name.'); return }
    if (!f.accountNumber.trim()) { setError('Please enter the Account Number.'); return }
    if (!f.ifsc.trim())          { setError('Please enter the IFSC Code.'); return }
    setError('')
    const checkTypeLabel = BANK_CHECK_TYPES.find(t => t.value === f.checkType)?.label.replace(/^\S+\s/, '') || f.checkType
    const verdictLabel = BANK_CHECK_VERDICTS.find(v => v.value === f.verdict)?.label.replace(/^\S+\s/, '') || f.verdict
    // Bank Details Check posts exclusively to Sub Note (Vanilla's
    // SUB_NOTE_ONLY_TASKS includes 'EFIN- Bank Details Check' — the Comment
    // column shows "—" for this task; posting the block into `comment`
    // instead would render it in the wrong column on the Timeline).
    const subNote = [
      `Bank Name: ${f.bankName.trim()}`, `Account Holder Name: ${f.accountHolder.trim()}`,
      `Account Number: ${f.accountNumber.trim()}`, `IFSC Code: ${f.ifsc.trim()}`,
      f.branch.trim() ? `Branch: ${f.branch.trim()}` : null,
      f.accountType.trim() ? `Account Type: ${f.accountType.trim()}` : null,
      (f.stmtFrom || f.stmtTo) ? `Statement Period: ${f.stmtFrom || '—'} to ${f.stmtTo || '—'}` : null,
      `Check Type: ${checkTypeLabel}`, `Result: ${verdictLabel}`,
      f.comment.trim() ? `` : null, f.comment.trim() ? `Remark: ${f.comment.trim()}` : null,
    ].filter((v): v is string => v !== null).join('\n')
    post.mutate({ name: 'EFIN- Bank Details Check', stage: dept, status: 'COMPLETE', comment: '', subNote, overviewFlag: 'bankChecked' },
      { onSuccess: onClose, onError: () => setError('Could not save the bank check.') })
  }

  return (
    <Modal open onClose={onClose} title="Bank Details Check" subtitle="Verify account details and record findings in timeline" size="lg"
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" loading={post.isPending} onClick={confirm}>Post Bank Check</Button>
      </>}>
      {error && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <label className="block text-xs font-medium text-[color:var(--text2)] mb-1">Check Type</label>
      <div className="flex flex-wrap gap-2 mb-3">
        {BANK_CHECK_TYPES.map(t => (
          <button key={t.value} type="button" onClick={() => setF(p => ({ ...p, checkType: t.value }))}
            className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${f.checkType === t.value ? 'bg-[color:var(--accent)] text-white border-[color:var(--accent)]' : 'border-[color:var(--border)] text-[color:var(--text2)]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input placeholder="Bank name *" value={f.bankName} onChange={set('bankName')} className="efin-input sm:col-span-2" />
        <input placeholder="Account holder name *" value={f.accountHolder} onChange={set('accountHolder')} className="efin-input sm:col-span-2" />
        <input placeholder="Account number *" value={f.accountNumber} onChange={set('accountNumber')} className="efin-input" />
        <input placeholder="IFSC code *" value={f.ifsc} onChange={e => setF(p => ({ ...p, ifsc: e.target.value.toUpperCase() }))} className="efin-input" />
        <input placeholder="Branch" value={f.branch} onChange={set('branch')} className="efin-input" />
        <input placeholder="Account type (e.g. Savings)" value={f.accountType} onChange={set('accountType')} className="efin-input" />
        <div>
          <label className="block text-[10px] text-[color:var(--text3)] mb-1">Statement period (from)</label>
          <input type="month" value={f.stmtFrom} onChange={set('stmtFrom')} className="efin-input" />
        </div>
        <div>
          <label className="block text-[10px] text-[color:var(--text3)] mb-1">Statement period (to)</label>
          <input type="month" value={f.stmtTo} onChange={set('stmtTo')} className="efin-input" />
        </div>
      </div>

      <label className="block text-xs font-medium text-[color:var(--text2)] mt-3 mb-1">Verification Result</label>
      <div className="flex flex-wrap gap-2">
        {BANK_CHECK_VERDICTS.map(v => (
          <button key={v.value} type="button" onClick={() => setF(p => ({ ...p, verdict: v.value }))}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${f.verdict === v.value ? 'bg-[color:var(--accent)] text-white border-[color:var(--accent)]' : 'border-[color:var(--border)] text-[color:var(--text2)]'}`}>
            {v.label}
          </button>
        ))}
      </div>

      <textarea placeholder="Comment (optional)" value={f.comment} onChange={set('comment')} rows={2} className="efin-input mt-3" />
    </Modal>
  )
}

// ── ECS Return ─────────────────────────────────────────────────────────────
// Rebuilt to match Vanilla's dedicated ECS Return modal (efin-app.js:33699-
// 34018): an entries table (date + amount, add/remove) with live Total/
// Highest/Lowest stats, a reason-code dropdown, and a separate "No ECS
// Found" path that clears the task without requiring any entries — not the
// earlier single free-text "Reason" field.
const ECS_REASON_CODES = [
  'Insufficient Funds', 'Account Closed', 'Account Frozen', 'Invalid Account',
  'Signature Mismatch', 'Mandate Cancelled', 'Payment Stopped', 'Bank Change Requested', 'Other',
]
interface EcsRow { date: string; amount: string }
const BLANK_ECS_ROW: EcsRow = { date: '', amount: '' }

function EcsReturnModal({ loanId, onClose }: { loanId: number; onClose: () => void }) {
  const post = usePostTracking(loanId)
  const dept = useCurrentUserDept()
  const [rows, setRows] = useState<EcsRow[]>([{ ...BLANK_ECS_ROW }, { ...BLANK_ECS_ROW }, { ...BLANK_ECS_ROW }])
  const [reasonCode, setReasonCode] = useState('')
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')

  const amounts = rows.map(r => parseFloat(r.amount) || 0).filter(a => a > 0)
  const hasEntries = amounts.length > 0
  const total = amounts.reduce((s, v) => s + v, 0)
  const hi = amounts.length ? Math.max(...amounts) : 0
  const lo = amounts.length ? Math.min(...amounts) : 0

  function confirm() {
    if (!comment.trim()) { setError('Please enter a remark.'); return }
    if (!amounts.length) { setError('Please enter at least one return entry.'); return }
    setError('')
    const entryLines = rows.filter(r => (parseFloat(r.amount) || 0) > 0)
      .map(r => [r.date || '—', fmtInr(parseFloat(r.amount) || 0)].join('    ')).join('\n')
    const fullComment = [
      'ECS Return Entries:', entryLines, '',
      `Total Entries: ${amounts.length}`, `Total Amount: ${fmtInr(total)}`,
      `Highest: ${fmtInr(hi)}`, `Lowest: ${fmtInr(lo)}`,
      reasonCode ? `Reason: ${reasonCode}` : null,
      `Remark: ${comment.trim()}`,
    ].filter((v): v is string => v !== null).join('\n')
    post.mutate({ name: 'EFIN-Charge', stage: dept, status: 'COMPLETE', comment: fullComment, subNote: '', overviewFlag: 'ecsReturn' },
      { onSuccess: onClose, onError: () => setError('Could not save the ECS return.') })
  }

  // "No ECS Found" — clear the task without requiring any entries, mirroring
  // Vanilla's ecsTaskClear. Warns first if the user has partially filled
  // rows, since that usually means they meant to submit them instead.
  function clearTask() {
    if (hasEntries && !window.confirm('You have ECS entries filled in. Are you sure you want to clear the task without submitting them?')) return
    post.mutate({ name: 'EFIN-Charge', stage: dept, status: 'COMPLETE', comment: 'No ECS Found', subNote: 'Task marked as complete. No ECS return entries were recorded (no ECS Found found in bank statement).', overviewFlag: 'ecsReturn' },
      { onSuccess: onClose, onError: () => setError('Could not clear the ECS task.') })
  }

  return (
    <Modal open onClose={onClose} title="ECS Return" subtitle="Record an ECS/NACH bounce" size="md"
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="secondary" loading={post.isPending} onClick={clearTask}>No ECS Found</Button>
        <Button size="sm" variant="danger" loading={post.isPending} onClick={confirm}>Post ECS Return</Button>
      </>}>
      {error && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
            <input type="date" value={r.date} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, date: e.target.value } : x))} className="efin-input text-xs" />
            <NumberInput placeholder="Amount (₹)" value={r.amount} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} className="efin-input text-xs" />
            <button title="Remove" onClick={() => setRows(rs => rs.length > 1 ? rs.filter((_, j) => j !== i) : rs)} className="p-1.5 text-[color:var(--danger)]"><Trash2 size={14} /></button>
          </div>
        ))}
        <button onClick={() => setRows(rs => [...rs, { ...BLANK_ECS_ROW }])} className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--accent)]"><Plus size={13} /> Add row</button>
      </div>

      {hasEntries && (
        <div className="grid grid-cols-3 gap-2 mt-4 text-center">
          {[['Total', fmtInr(total)], ['Highest', fmtInr(hi)], ['Lowest', fmtInr(lo)]].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-[color:var(--border)] p-2">
              <p className="text-[10px] uppercase tracking-wide text-[color:var(--text3)]">{k}</p>
              <p className="text-sm font-bold text-[color:var(--text)]">{v}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4">
        <label className="block text-xs font-medium text-[color:var(--text2)] mb-1">Reason Code</label>
        <select value={reasonCode} onChange={e => setReasonCode(e.target.value)} className="efin-input">
          <option value="">— Select Reason Code —</option>
          {ECS_REASON_CODES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="mt-3">
        <label className="block text-xs font-medium text-[color:var(--text2)] mb-1">Remark *</label>
        <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} placeholder="e.g. Insufficient funds" className="efin-input" />
      </div>
    </Modal>
  )
}

// ── Deal Confirmation (server email, replacing legacy mailto) ──────────────
// Parses the latest FI Report tracking entry's Sub Note (format written by
// FiReportModal below: "Final Resi Address - {result}\nFinal Office Address
// - {result}") to enforce Vanilla's _dcFinaliseAcceptance gate: deal
// confirmation cannot be sent until FI Report is complete AND both results
// are Positive (efin-app.js:34580-34585). There's no separate backend column
// for the resi/office result — Vanilla itself only ever kept these as
// in-memory app.fi_resi/app.fi_office, so the Sub Note text is the only
// durable record of them; parsing it needs no backend/schema change.
function parseFiResult(subNote?: string): { resi?: string; office?: string } {
  if (!subNote) return {}
  const resi = subNote.match(/Final Resi Address\s*-\s*([^\n]+)/i)?.[1]?.trim()
  const office = subNote.match(/Final Office Address\s*-\s*([^\n]+)/i)?.[1]?.trim()
  return { resi, office }
}

function DealConfirmModal({ loanId, customerName, customerEmail, onClose }: { loanId: number; customerName?: string; customerEmail?: string; onClose: () => void }) {
  const qc = useQueryClient()
  const dept = useCurrentUserDept()
  const { data: tracking } = useQuery({
    queryKey: ['tracking', loanId],
    queryFn: () => api.get<{ data: { name: string; subNote?: string; createdAt: string }[] }>(`/api/loans/${loanId}/tracking`).then(r => r.data.data ?? []),
  })
  const fiEntries = (tracking ?? []).filter(e => e.name === 'EFIN- FI report')
  const latestFi = fiEntries[fiEntries.length - 1]
  const { resi, office } = parseFiResult(latestFi?.subNote)
  const fiIncomplete = !latestFi
  const fiNegOrPending = !fiIncomplete && (
    resi === 'Negative' || resi === 'Pending' || office === 'Negative' || office === 'Pending'
  )
  const fiBlocked = fiIncomplete || fiNegOrPending

  const [to, setTo] = useState(customerEmail ?? '')
  const [subject, setSubject] = useState('Your loan has been approved — Deal Confirmation')
  const [body, setBody] = useState(
    `Dear ${customerName || 'Customer'},\n\nWe are pleased to confirm that your loan application has been approved. ` +
    `Please review the enclosed terms and reply to this email to accept, so we can proceed to disbursement.\n\nRegards,\nMudrahub Loan Team`)
  const [error, setError] = useState('')

  const send = useMutation({
    mutationFn: async () => {
      // EmailController answers an SMTP failure with HTTP 200 + success:false.
      // Stop here in that case — otherwise the tracking entry below would
      // record "Deal confirmation sent" and the loan would move to Acceptance
      // although the customer never received the email. Same check
      // LenderEmailCard / useLoans already apply to this endpoint.
      const sendRes = await api.post<{ success: boolean; message?: string }>('/api/email/send', { to: to.trim(), toName: customerName ?? '', subject: subject.trim(), html: body.replace(/\n/g, '<br>') })
      if (!sendRes.data?.success) throw new Error(sendRes.data?.message || 'The deal confirmation email could not be sent.')
      // Tracking entry name/comment/subNote matches Vanilla's
      // _dcFinaliseAcceptance exactly (efin-app.js:34586-34589) — other parts
      // of the app (e.g. the generic tracking status-map) key off the exact
      // string 'EFIN-Customer Confirmation'.
      await api.post(`/api/loans/${loanId}/tracking`, {
        name: 'EFIN-Customer Confirmation', stage: dept, assignedUser: '',
        status: 'COMPLETE', comment: 'Deal confirmation sent — awaiting customer reply',
        subNote: 'Status moved to Acceptance on deal confirmation send',
      })
      // Move the loan into Acceptance — the new parity status restored
      // specifically for this step (Approved → Acceptance → Disbursed).
      await loansApi.updateStatus(loanId, { newStatus: 'Acceptance', comment: `Deal confirmation email sent to ${to.trim()}.` })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tracking', loanId] })
      qc.invalidateQueries({ queryKey: LOAN_KEYS.detail(loanId) })
      onClose()
    },
    onError: (err: unknown) => setError(apiErrorMessage(err, 'Could not send the deal confirmation email.')),
  })

  function confirm() {
    if (fiBlocked) { setError(fiIncomplete ? 'Cannot move to Acceptance — EFIN FI Report must be completed first.' : 'Cannot move to Acceptance — both FI Report results must be Positive.'); return }
    if (!to.trim()) { setError('A recipient email is required.'); return }
    if (!subject.trim()) { setError('A subject is required.'); return }
    setError('')
    send.mutate()
  }

  return (
    <Modal open onClose={onClose} title="Send Deal Confirmation" subtitle="Email the approved-loan confirmation to the customer" size="lg"
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" loading={send.isPending} disabled={fiBlocked} onClick={confirm}><Mail size={14} className="mr-1" />Send</Button>
      </>}>
      {fiBlocked && (
        <div className="mb-3 text-sm text-[color:var(--warn)] bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
          {fiIncomplete
            ? 'EFIN FI Report must be completed before the deal confirmation can be sent.'
            : `Both FI Report results must be Positive before sending (currently Residence: ${resi ?? '—'}, Office: ${office ?? '—'}).`}
        </div>
      )}
      {error && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="space-y-3">
        <div><label className="block text-xs font-medium text-[color:var(--text2)] mb-1">To *</label>
          <input value={to} onChange={e => setTo(e.target.value)} placeholder="customer@email.com" className="efin-input" /></div>
        <div><label className="block text-xs font-medium text-[color:var(--text2)] mb-1">Subject *</label>
          <input value={subject} onChange={e => setSubject(e.target.value)} className="efin-input" /></div>
        <div><label className="block text-xs font-medium text-[color:var(--text2)] mb-1">Message</label>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={7} className="efin-input" /></div>
      </div>
    </Modal>
  )
}

// ── FI Report (Field Investigation) ───────────────────────────────────────
const FI_RESULTS = ['Positive', 'Negative', 'Pending', 'Waived']

// The auto-generated human-tone system note legacy posts after an FI report,
// keyed on the resi/office result combination (efin-app.js:3648-3682). Ported
// verbatim so the follow-up phrasing (and the 'EFIN- Report review' escalation
// on any Negative) is preserved.
function fiSystemNote(resi: string, office: string): { task: string; comment: string } {
  const lc = (v: string) => v === 'Waived' ? 'waived' : v.toLowerCase()
  const negResi = resi === 'Negative', negOffice = office === 'Negative'
  const pendResi = resi === 'Pending', pendOffice = office === 'Pending'
  if (negResi && negOffice) return { task: 'EFIN- Report review', comment: 'Both addresses came back negative. Sending for physical re-verification before we move ahead.' }
  if (negResi) return { task: 'EFIN- Report review', comment: `Residence verification failed. Raising for physical review — office FI is ${lc(office)}.` }
  if (negOffice) return { task: 'EFIN- Report review', comment: `Office verification failed. Need a physical check at the office — residence is ${lc(resi)}.` }
  if (pendResi && pendOffice) return { task: 'EFIN- FI report', comment: 'Both FIs are still pending. Will follow up with the agency and update once reports are in.' }
  if (pendResi) return { task: 'EFIN- FI report', comment: `Residence FI is still pending. Office is ${lc(office)} — will chase the agency for the resi report.` }
  if (pendOffice) return { task: 'EFIN- FI report', comment: `Office FI is still pending. Resi is ${lc(resi)} — waiting on the office verification to close this out.` }
  if (resi === 'Waived' && office === 'Waived') return { task: 'EFIN- FI report', comment: 'Both FIs waived as per policy. Closing this step.' }
  return { task: 'EFIN- FI report', comment: 'Both addresses cleared. No further FI action required.' }
}

function FiReportModal({ loanId, onClose }: { loanId: number; onClose: () => void }) {
  const qc = useQueryClient()
  const dept = useCurrentUserDept()
  const [resi, setResi] = useState('')
  const [office, setOffice] = useState('')
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')

  const submit = useMutation({
    mutationFn: async () => {
      // 1) Primary FI report entry (legacy 'EFIN- FI report', subNote carries
      //    the two address results).
      await api.post(`/api/loans/${loanId}/tracking`, {
        name: 'EFIN- FI report', stage: dept, assignedUser: '',
        status: 'COMPLETE', comment: comment.trim() || 'FI report submitted',
        subNote: `Final Resi Address - ${resi}\nFinal Office Address - ${office}`,
      })
      // 2) Auto system note — escalation / follow-up phrasing per the result mix.
      const sys = fiSystemNote(resi, office)
      await api.post(`/api/loans/${loanId}/tracking`, {
        name: sys.task, stage: 'System Comments', assignedUser: '',
        status: 'COMPLETE', comment: sys.comment, subNote: '',
      })
      // Flip the Overview "FI Report" badge to ✓ Done.
      await loansApi.updateOverview(loanId, { fiReportChecked: true })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tracking', loanId] })
      qc.invalidateQueries({ queryKey: LOAN_KEYS.detail(loanId) })
      onClose()
    },
    onError: () => setError('Could not save the FI report.'),
  })

  function confirm() {
    if (!resi || !office) { setError('Select both Residence and Office FI results.'); return }
    setError('')
    submit.mutate()
  }

  return (
    <Modal open onClose={onClose} title="EFIN FI Report" subtitle="Record the Field Investigation result" size="md"
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" loading={submit.isPending} onClick={confirm}>Post FI Report</Button>
      </>}>
      {error && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-[color:var(--text2)] mb-1">Residence FI *</label>
          <select value={resi} onChange={e => setResi(e.target.value)} className="efin-input">
            <option value="">— Select —</option>
            {FI_RESULTS.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[color:var(--text2)] mb-1">Office FI *</label>
          <select value={office} onChange={e => setOffice(e.target.value)} className="efin-input">
            <option value="">— Select —</option>
            {FI_RESULTS.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      </div>
      <textarea placeholder="Comment (optional)" value={comment} onChange={e => setComment(e.target.value)} rows={2} className="efin-input mt-3" />
    </Modal>
  )
}

// ── Simple comment → tracking-entry actions (Documents / NACH / Customer
// Agreement) ────────────────────────────────────────────────────────────────
// Documents Check mirrors legacy's generic direct-mode tracking form (no
// structured fields beyond stage/status/comment) — the "📄 Documents" button
// in the Timeline ACTIONS bar (efin-app.js:3241), which opens the "Documents
// Check" modal (tm-name 'EFIN — Documents') and, on submit, sets
// app.document_checked = true alongside the tracking entry (efin-app.js:3699).
// NACH / Customer Agreement are disburse PREREQUISITES in legacy: the Disburse
// button only appears once nach_done && customer_agreement_done
// (efin-app.js:2088/27403). Each now sets the matching persisted
// Loan.NachDone/CustomerAgreementDone flag (via overviewFlag below) alongside
// its tracking entry — LoanService.UpdateStatusAsync enforces the same gate
// server-side on Disburse, and LoanDetailPage's client-side gate reads these
// flags first, falling back to tracking-entry presence for older loans.
function SimpleActionModal({ loanId, title, subtitle, entryName, confirmLabel, overviewFlag, onClose }: {
  loanId: number; title: string; subtitle: string; entryName: string; confirmLabel: string; overviewFlag?: OverviewFlag; onClose: () => void
}) {
  const post = usePostTracking(loanId)
  const dept = useCurrentUserDept()
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  function confirm() {
    post.mutate(
      { name: entryName, stage: dept, status: 'COMPLETE', comment: comment.trim() || title, subNote: '', overviewFlag },
      { onSuccess: onClose, onError: () => setError('Could not save. Please try again.') })
  }
  return (
    <Modal open onClose={onClose} title={title} subtitle={subtitle} size="sm"
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" loading={post.isPending} onClick={confirm}>{confirmLabel}</Button>
      </>}>
      {error && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <label className="block text-xs font-medium text-[color:var(--text2)] mb-1">Comment (optional)</label>
      <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} placeholder="Reference / remark" className="efin-input" />
    </Modal>
  )
}

// ── Host card ──────────────────────────────────────────────────────────────
// The Timeline's single `.tracking-actions` bar (efin-app.js:3213-3256). It
// renders the CPA/task check actions and the Underwriting move. Approve with
// Details / Deviation / Skip / Approved Deviation / Disburse now live in the
// Offers tab (lender-specific offers → deviation → credit approval → sanction
// → disbursement); the bar shows a single "Offers & Approval" link instead.
type OpenModal =
  | 'documents' | 'income' | 'bank' | 'ecs' | 'deal' | 'fi' | 'nach' | 'agreement'
  | 'underwriting' | null

export default function LoanVerificationChecks({
  loanId, customerId, customerName, customerEmail, employmentType, loanStatus, loanType,
  canChangeStatus, onOpenOffers,
  documentChecked, incomeChecked, bankChecked, ecsReturn, fiReportChecked, nachDone, customerAgreementDone,
}: CheckProps) {
  const canPost = useHasPermission('canPostTracking')
  const dept = useCurrentUserDept()
  const qc = useQueryClient()
  const [open, setOpen] = useState<OpenModal>(null)
  // Underwriting-modal inputs.
  const [wfComment, setWfComment] = useState('')
  const [wfError, setWfError] = useState('')
  // Latest FI-report result — lets the FI button re-appear after a Negative/
  // Pending outcome even once posted (legacy buildTimelineActionButtons:
  // 27432-27435). There's no fi_resi/fi_office column, so read it back from
  // the FI entry's Sub Note (same source DealConfirmModal parses). Shares
  // TrackingPage's ['tracking', loanId] cache — no extra round-trip.
  const { data: tracking } = useQuery({
    queryKey: ['tracking', loanId],
    queryFn: () => api.get<{ data: { name: string; subNote?: string }[] }>(`/api/loans/${loanId}/tracking`).then(r => r.data.data ?? []),
    enabled: loanId > 0,
  })
  const acts = TIMELINE_ACTIONS[loanType ?? ''] ?? TIMELINE_ACTIONS.Personal
  // Deal confirmation sends the sanctioned terms, so it needs an active
  // sanction (the backend refuses Approved → Acceptance without one). Shares
  // the Offers tab's workflow cache.
  const { data: workflow } = useQuery({
    queryKey: workflowKey(loanId),
    queryFn: () => offerWorkflowApi.get(loanId).then(r => r.data.data ?? null),
    enabled: loanId > 0 && loanStatus === 'Approved',
  })
  const hasActiveSanction = !!workflow?.sanctions.some(s => s.status === 'Active')

  const invalidateWf = () => {
    qc.invalidateQueries({ queryKey: ['tracking', loanId] })
    qc.invalidateQueries({ queryKey: LOAN_KEYS.detail(loanId) })
    qc.invalidateQueries({ queryKey: ['loans'] })
    qc.invalidateQueries({ queryKey: workflowKey(loanId) })
  }
  const closeWf = () => { setOpen(null); setWfComment(''); setWfError('') }
  const onWfErr = (e: unknown) => {
    const d = (e as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
    setWfError(d?.message || d?.errors?.join(' ') || 'That action could not be completed.')
  }
  const wfOpts = { onSuccess: () => { invalidateWf(); closeWf() }, onError: onWfErr }
  // Post the Timeline tracking entry a transition produces, EXACTLY as Vanilla's
  // addTrackingEntry does (name / stage=poster dept / status Complete / comment /
  // sub note). Vanilla creates a Timeline row for every workflow transition
  // (EFIN-Underwriting/Approved/Deviation/… — efin-app.js:27510,31973,32129,
  // 32150,32374,32573); React's status endpoints do NOT, so we post it here
  // through the same POST /api/loans/{id}/tracking the check actions use.
  const postWfEntry = (name: string, comment: string, subNote: string, stage: string = dept) =>
    api.post(`/api/loans/${loanId}/tracking`, { name, stage, assignedUser: '', status: 'COMPLETE', comment, subNote })
  // Underwriting = move to UnderReview (Vanilla login→underwriting), then the
  // Vanilla Timeline entry. Offer-chain transitions write their own Timeline
  // entries server-side (OfferWorkflowService).
  const mUnderwriting = useMutation({
    mutationFn: async () => {
      await loansApi.updateStatus(loanId, { newStatus: 'UnderReview', comment: wfComment || undefined })
      await postWfEntry('EFIN-Underwriting', wfComment.trim() || 'Move', ' ')
    }, ...wfOpts,
  })
  // Final-stage lock — legacy shows no action buttons on terminal loans
  // (isAppFinalLocked, efin-app.js:3218). Manual comments still go through the
  // Timeline's "Manual Comment" button (admin-only there, matching legacy).
  if (FINAL_LOCK_STATUSES.includes(loanStatus)) return null

  const isSelfEmployed = isSelfEmployedType(employmentType)
  // Insurance product → relabel the workflow buttons (Vanilla approve_ins /
  // disburse_ins: Verify Insurance / Approve Policy / Issue Policy).
  const isIns = loanType === 'Insurance'

  // Stage gating via legacy's own status map (api-bridge STATUS_MAP): wip=Draft,
  // login=Submitted, underwriting=UnderReview, approved=Approved.
  //   • CPA checks (Documents/Income/Bank/ECS) → wip/login only, i.e. Draft/
  //     Submitted (efin-app.js:3239) — and require canPostTracking (they post a
  //     tracking entry).
  //   • FI Report → underwriting/approved/decision (efin-app.js:27431).
  //   • Deal Confirmation → Approved; NACH / Customer Agreement → Acceptance
  //     (efin-app.js:3232-3235, 27457-27459).
  // Each check also hides once its flag is done, exactly like legacy's `if (!flag)`.
  const cpaStage = loanStatus === 'Draft' || loanStatus === 'Submitted'
  const fiStage  = loanStatus === 'UnderReview' || loanStatus === 'Approved' || loanStatus === 'Decision'

  const fiEntries = (tracking ?? []).filter(e => e.name === 'EFIN- FI report')
  const latestFi = fiEntries[fiEntries.length - 1]
  const fi = parseFiResult(latestFi?.subNote)
  const fiNegOrPending = !!latestFi && (fi.resi === 'Negative' || fi.resi === 'Pending' || fi.office === 'Negative' || fi.office === 'Pending')

  // Check / task actions (post tracking → need canPost).
  const showDocuments  = canPost && cpaStage && !documentChecked
  const showIncome     = canPost && cpaStage && !incomeChecked
  const showBank       = canPost && cpaStage && !bankChecked
  const showEcs        = canPost && cpaStage && !ecsReturn
  const showFi         = canPost && acts.includes('fi_report') && fiStage && (!fiReportChecked || fiNegOrPending)
  const showNach       = canPost && acts.includes('nach') && loanStatus === 'Acceptance' && !nachDone
  const showAgreement  = canPost && loanStatus === 'Acceptance' && !customerAgreementDone
  const showDealConfirm = canPost && loanStatus === 'Approved' && hasActiveSanction

  // Workflow actions — Vanilla buildTimelineActionButtons, gated on
  // wf.timelineActions + status + the matching role permission. Insurance uses
  // approve_ins/disburse_ins (relabelled) but the same React endpoints.
  // approve_ins is Vanilla's insurance analogue of underwriting (at login) +
  // approve (at underwriting); disburse_ins of disburse. Fold them in so the
  // same buttons render for insurance, relabelled below.
  const showUnderwriting = (acts.includes('underwriting') || acts.includes('approve_ins')) && loanStatus === 'Submitted' && !!canChangeStatus
  // Offers / deviation / credit approval / sanction / disbursement: one link
  // into the Offers tab, from Underwriting onwards (and Approved/Acceptance).
  const showOffers = !!onOpenOffers && ['UnderReview', 'Offer', 'Decision', 'Approved', 'Acceptance'].includes(loanStatus)
  const anyCheck = showDocuments || showFi || showIncome || showBank || showEcs || showNach || showAgreement || showDealConfirm
  const anyWorkflow = showUnderwriting || showOffers
  // Nothing to do → no empty "Actions:" bar (legacy renders no buttons).
  if (!anyCheck && !anyWorkflow) return null

  return (
    // Horizontal action bar atop the Timeline tab — mirrors legacy's
    // `.tracking-actions` bar (efin-app.js:3213) that sat above the tracking
    // table, rather than a sidebar card.
    <Card className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-[color:var(--text3)] mr-1 flex items-center gap-1.5">
          <ShieldCheck size={13} /> Actions
        </span>
        {/* Workflow actions (Vanilla buildTimelineActionButtons order). */}
        {showFi && <Button size="sm" variant="danger" onClick={() => setOpen('fi')}><FileSearch size={14} className="mr-1" />EFIN FI Report</Button>}
        {showUnderwriting && <Button size="sm" onClick={() => setOpen('underwriting')}><Search size={14} className="mr-1" />{isIns ? 'Verify Insurance' : 'Underwriting'}</Button>}
        {showOffers && <Button size="sm" onClick={onOpenOffers}><FileSignature size={14} className="mr-1" />Offers &amp; Approval</Button>}
        {showNach && <Button size="sm" variant="danger" onClick={() => setOpen('nach')}><Repeat size={14} className="mr-1" />NACH</Button>}
        {/* Stage / CPA check actions. */}
        {showDocuments && <Button size="sm" variant="secondary" onClick={() => setOpen('documents')}><FileCheck size={14} className="mr-1" />Documents Check</Button>}
        {showIncome && <Button size="sm" variant="secondary" onClick={() => setOpen('income')}><Wallet size={14} className="mr-1" />Income Check</Button>}
        {showBank && <Button size="sm" variant="secondary" onClick={() => setOpen('bank')}><Banknote size={14} className="mr-1" />Bank Details Check</Button>}
        {showEcs && <Button size="sm" variant="secondary" onClick={() => setOpen('ecs')}><RotateCcw size={14} className="mr-1" />ECS Return</Button>}
        {showAgreement && <Button size="sm" variant="secondary" onClick={() => setOpen('agreement')}><FileSignature size={14} className="mr-1" />Customer Agreement</Button>}
        {showDealConfirm && <Button size="sm" onClick={() => setOpen('deal')}><Mail size={14} className="mr-1" />Send Deal Confirmation</Button>}
      </div>

      {open === 'documents' && <SimpleActionModal loanId={loanId} title="Documents Check" subtitle="Record document verification for this application" entryName="EFIN — Documents" confirmLabel="Mark Documents Checked" overviewFlag="documentChecked" onClose={() => setOpen(null)} />}
      {open === 'fi' && <FiReportModal loanId={loanId} onClose={() => setOpen(null)} />}
      {open === 'income' && <IncomeCheckModal loanId={loanId} customerId={customerId} isSelfEmployed={isSelfEmployed} onClose={() => setOpen(null)} />}
      {open === 'bank' && <BankCheckModal loanId={loanId} onClose={() => setOpen(null)} />}
      {open === 'ecs' && <EcsReturnModal loanId={loanId} onClose={() => setOpen(null)} />}
      {open === 'nach' && <SimpleActionModal loanId={loanId} title="NACH / E-Mandate" subtitle="Mark the NACH mandate as registered" entryName="EFIN-Nach" confirmLabel="Mark NACH Done" overviewFlag="nachDone" onClose={() => setOpen(null)} />}
      {open === 'agreement' && <SimpleActionModal loanId={loanId} title="Customer Agreement" subtitle="Record the signed customer agreement" entryName="EFIN-Customer Agreement" confirmLabel="Mark Agreement Done" overviewFlag="customerAgreementDone" onClose={() => setOpen(null)} />}
      {open === 'deal' && <DealConfirmModal loanId={loanId} customerName={customerName} customerEmail={customerEmail} onClose={() => setOpen(null)} />}

      {/* Workflow-action modals — Vanilla's openTrackWizard/openLenderApprovalModal/
          openDisburseModal/openDeviationModal equivalents, wired to loansApi. */}
      {open === 'underwriting' && (
        <Modal open onClose={closeWf} title={isIns ? 'Verify Insurance' : 'Move to Underwriting'} subtitle={isIns ? 'Verify the insurance application and send it for policy review' : 'Send this application into underwriting'} size="sm"
          footer={<><Button size="sm" variant="secondary" onClick={closeWf}>Cancel</Button><Button size="sm" loading={mUnderwriting.isPending} onClick={() => mUnderwriting.mutate()}>Confirm</Button></>}>
          {wfError && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{wfError}</div>}
          <label className="block text-xs font-medium text-[color:var(--text2)] mb-1">Comment (optional)</label>
          <textarea value={wfComment} onChange={e => setWfComment(e.target.value)} rows={2} className="efin-input" placeholder="Reason / remark" />
        </Modal>
      )}
    </Card>
  )
}
