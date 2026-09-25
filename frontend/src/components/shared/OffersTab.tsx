import { useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AxiosResponse } from 'axios'
import {
  AlertTriangle, BadgeIndianRupee, Ban, CheckCircle2, ChevronDown, ChevronRight, FileSignature, History,
  Landmark, Pencil, Plus, RotateCcw, ShieldCheck, SkipForward, Undo2, XCircle, ArrowRightCircle, ArrowLeftCircle,
  FileSearch, RefreshCw, Upload, UserCog,
} from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { NumberInput } from '@/components/ui/NumberInput'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { ErrorState } from '@/components/ui/States'
import { formatCurrency, formatDate, formatDateTime } from '@/utils/format'
import { apiErrorMessage } from '@/utils/apiError'
import { useToast } from '@/store/toastStore'
import { useAuthStore } from '@/store/authStore'
import type { ApiResponse } from '@/types'
import {
  offerWorkflowApi, newIdempotencyKey, OFFER_STATUS_LABEL, DEVIATION_STATUS_LABEL, BUREAU_PROVIDERS, validUntilFromDays,
  type ApplicationOffer, type DeviationCheck, type LoanWorkflow, type OfferTerms, type DisbursementInput, type Sanction,
  type OfferDeviationRequest, type BureauReportInput,
} from '@/api/offerWorkflowApi'
import { offerCardActions, deviationActions } from './offerActions'

// ── Offers tab ────────────────────────────────────────────────────────────
// Application-specific lender offers and everything that follows from them:
// final selection → deviation (lender-specific, rule driven) → credit (offer
// terms) approval → sanction → disbursement. Lender Details stays the lender
// master / processing-lines view; this tab never stores offers there.
//
// The server is the only authority. Buttons appear only when the API's
// `capabilities` allow them for this caller at this stage, every figure shown
// (EMI, fees, net disbursement, deviation result) is the one the API computed
// and stored, and every action re-reads the fresh workflow from the response.

export const workflowKey = (loanId: number) => ['loan-workflow', loanId] as const

const fmtPct = (v?: number | null) => (v == null ? '—' : `${v}%`)
// EMI is stored to the paisa by the API (2-dp reducing balance) — show it as stored.
const fmtEmi = (v?: number | null) =>
  v == null ? '—' : '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const tone = {
  ok: { background: 'rgba(26,115,64,.12)', color: 'var(--success)' },
  warn: { background: 'rgba(230,126,0,.14)', color: 'var(--warn)' },
  bad: { background: 'rgba(227,30,37,.10)', color: 'var(--danger, #e31e25)' },
  info: { background: 'var(--accent-subtle)', color: 'var(--accent)' },
  mute: { background: 'var(--surface2)', color: 'var(--text3)' },
}
const offerTone = (s: string) => (s === 'Final' ? tone.ok : s === 'Available' ? tone.info : s === 'Expired' ? tone.bad : tone.mute)
const devTone = (s: string) =>
  s === 'NotRequired' || s === 'Approved' ? tone.ok : s === 'Skipped' ? tone.info : s === 'Rejected' ? tone.bad : tone.warn
const apprTone = (s: string) => (s === 'Approved' ? tone.ok : s === 'Rejected' ? tone.bad : tone.mute)

function Pill({ children, style }: { children: ReactNode; style: React.CSSProperties }) {
  return <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11.5px] font-semibold" style={style}>{children}</span>
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-[13px]">
      <span style={{ color: 'var(--text3)' }}>{label}</span>
      <span className="text-right font-semibold" style={{ color: 'var(--text)' }}>{value}</span>
    </div>
  )
}

function ErrorBox({ msg }: { msg: string }) {
  return msg ? <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{msg}</div> : null
}

// ── Generic reason dialog (withdraw / unselect / skip / back / reverse …) ──
function ReasonModal({ title, subtitle, confirm, variant = 'primary', onClose, onSubmit, pending, error, extra }: {
  title: string; subtitle?: string; confirm: string; variant?: 'primary' | 'danger' | 'success'
  onClose: () => void; onSubmit: (reason: string) => void; pending: boolean; error: string; extra?: ReactNode
}) {
  const [reason, setReason] = useState('')
  return (
    <Modal open onClose={onClose} title={title} subtitle={subtitle} size="md"
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant={variant} loading={pending} disabled={pending || !reason.trim()} onClick={() => onSubmit(reason.trim())}>{confirm}</Button>
      </>}>
      <ErrorBox msg={error} />
      {extra}
      <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text2)' }}>Reason *</label>
      <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className="efin-input" placeholder="Recorded in the Timeline and audit log" />
    </Modal>
  )
}

// ── Offer create / revise ─────────────────────────────────────────────────
const EMPTY_TERMS: OfferTerms = {
  loanAmount: 0, tenureMonths: 0, baseRoi: 0, offeredRoi: 0, processingFeePct: 0, gstPct: 18,
  insuranceAmount: 0, pfInBundled: false, insuranceInBundled: false, btAmount: 0, stampDuty: 0,
}

function OfferFormModal({ wf, offer, requestedAmount, tenure, onClose, onDone }: {
  wf: LoanWorkflow; offer?: ApplicationOffer; requestedAmount: number; tenure: number
  onClose: () => void; onDone: (r: AxiosResponse<ApiResponse<LoanWorkflow>>) => void
}) {
  const cur = offer?.current
  const [bankId, setBankId] = useState<number>(offer?.bankId ?? 0)
  const [t, setT] = useState<OfferTerms>(cur ? {
    loanAmount: cur.loanAmount, tenureMonths: cur.tenureMonths, baseRoi: cur.baseRoi, offeredRoi: cur.offeredRoi,
    processingFeePct: cur.processingFeePct, gstPct: cur.gstPct, insuranceAmount: cur.insuranceAmount, pfInBundled: cur.pfInBundled,
    insuranceInBundled: cur.insuranceInBundled, btAmount: cur.btAmount, stampDuty: cur.stampDuty,
  } : { ...EMPTY_TERMS, loanAmount: requestedAmount, tenureMonths: tenure })
  const [validUntil, setValidUntil] = useState(offer?.validUntil ? offer.validUntil.slice(0, 10) : '')
  // Pre-filled from the lender's configured validity until the user edits the date.
  const [validTouched, setValidTouched] = useState(!!offer)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const set = (k: keyof OfferTerms) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setT(p => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value || 0) }))
  const activeBanks = new Set(wf.offers.filter(o => o.isActive).map(o => o.bankId))
  const lenders = wf.eligibleLenders.filter(l => !activeBanks.has(l.bankId))
  const lenderDays = offer ? null : wf.eligibleLenders.find(l => l.bankId === bankId)?.offerValidityDays ?? null
  const pickLender = (id: number) => {
    setBankId(id)
    if (!validTouched) setValidUntil(validUntilFromDays(wf.eligibleLenders.find(l => l.bankId === id)?.offerValidityDays))
  }

  const m = useMutation({
    mutationFn: () => offer
      ? offerWorkflowApi.reviseOffer(wf.loanId, offer.id, { ...t, expectedVersion: offer.version, reason, validUntil: validUntil || null })
      : offerWorkflowApi.createOffer(wf.loanId, { ...t, bankId, validUntil: validUntil || null }),
    onSuccess: onDone,
    onError: e => setError(apiErrorMessage(e)),
  })
  const num = (label: string, k: keyof OfferTerms, hint?: string) => (
    <div>
      <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text2)' }}>{label}</label>
      <NumberInput className="efin-input" min={0} value={t[k] as number} onChange={set(k)} />
      {hint && <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text3)' }}>{hint}</p>}
    </div>
  )
  const canSave = (offer || bankId > 0) && t.loanAmount > 0 && t.tenureMonths > 0 && (!offer || reason.trim())
  return (
    <Modal open onClose={onClose} size="lg"
      title={offer ? `Revise offer — ${offer.lenderName}` : 'Add lender offer'}
      subtitle={offer ? `Creates revision ${offer.currentRevisionNo + 1}; revision ${offer.currentRevisionNo} is kept. Deviation is re-evaluated and approval is required again.`
        : `Up to ${wf.maxActiveOffers} active offers, one per lender. EMI, fees and net disbursement are calculated by the server on save.`}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" loading={m.isPending} disabled={!canSave || m.isPending} onClick={() => m.mutate()}>{offer ? 'Save revision' : 'Add offer'}</Button>
      </>}>
      <ErrorBox msg={error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {!offer && (
          <div className="sm:col-span-3">
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text2)' }}>Lender *</label>
            <select className="efin-input" value={bankId} onChange={e => pickLender(Number(e.target.value))}>
              <option value={0}>— Select an eligible lender —</option>
              {lenders.map(l => <option key={l.bankId} value={l.bankId}>{l.bankName}</option>)}
            </select>
            {lenders.length === 0 && <p className="mt-1 text-[11.5px]" style={{ color: 'var(--text3)' }}>No other active, configured lender offers this product.</p>}
          </div>
        )}
        {num('Loan amount (₹) *', 'loanAmount')}
        {num('Tenure (months) *', 'tenureMonths')}
        {num('Base ROI (% p.a.)', 'baseRoi', "Lender's base / card rate — reference for ROI deviation")}
        {num('Offered ROI (% p.a.) *', 'offeredRoi', 'Reducing balance')}
        {num('Processing fee (%)', 'processingFeePct')}
        {num('GST on fee (%)', 'gstPct')}
        {num('Insurance (₹)', 'insuranceAmount')}
        {num('BT amount (₹)', 'btAmount', 'Paid to the existing lender')}
        {num('Stamp duty (₹)', 'stampDuty')}
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text2)' }}>
          <input type="checkbox" checked={t.pfInBundled} onChange={set('pfInBundled')} /> Fee + GST financed (bundled)
        </label>
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text2)' }}>
          <input type="checkbox" checked={t.insuranceInBundled} onChange={set('insuranceInBundled')} /> Insurance financed (bundled)
        </label>
        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text2)' }}>Valid until</label>
          <input type="date" className="efin-input" value={validUntil} onChange={e => { setValidTouched(true); setValidUntil(e.target.value) }} />
          {lenderDays != null && <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text3)' }}>Lender default: {lenderDays} days</p>}
          {!offer && lenderDays == null && bankId > 0 && !validUntil && <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text3)' }}>No default validity configured for this lender</p>}
        </div>
        {offer && (
          <div className="sm:col-span-3">
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text2)' }}>Reason for revision *</label>
            <input className="efin-input" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Lender revised ROI after negotiation" />
          </div>
        )}
      </div>
    </Modal>
  )
}

function ChecksList({ checks, manualReviewReason }: { checks: DeviationCheck[]; manualReviewReason?: string | null }) {
  if (!checks.length && !manualReviewReason) return <p className="text-[12.5px]" style={{ color: 'var(--text3)' }}>No policy rule applies.</p>
  return (
    <ul className="space-y-1">
      {manualReviewReason && <li className="text-[12.5px]" style={{ color: 'var(--warn)' }}>⚠ {manualReviewReason}</li>}
      {checks.map((c, i) => (
        <li key={i} className="flex items-start gap-2 text-[12.5px]">
          <Pill style={c.status === 'Within' ? tone.ok : c.status === 'Breach' ? tone.bad : tone.warn}>{c.status === 'MissingData' ? 'Missing data' : c.status}</Pill>
          <span style={{ color: 'var(--text2)' }}>
            {c.message}
            {c.ruleName && <span style={{ color: 'var(--text3)' }}> · {c.ruleName} v{c.ruleVersion}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

// ── One offer card ────────────────────────────────────────────────────────
function OfferCard({ o, wf, act }: { o: ApplicationOffer; wf: LoanWorkflow; act: (a: Action) => void }) {
  const [showHistory, setShowHistory] = useState(false)
  const c = o.current
  const cap = wf.capabilities
  const isFinal = o.status === 'Final'
  const can = new Set(offerCardActions(o, wf))
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: isFinal ? 'var(--success)' : 'var(--border)', background: 'var(--surface)' }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-[15px] font-bold" style={{ color: 'var(--text)' }}><Landmark size={16} /> {o.lenderName}</p>
          <p className="text-[11.5px]" style={{ color: 'var(--text3)' }}>
            Rev {o.currentRevisionNo}{o.validUntil ? ` · valid until ${formatDate(o.validUntil)}` : ''}{o.createdBy ? ` · added by ${o.createdBy}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Pill style={offerTone(o.status)}>{OFFER_STATUS_LABEL[o.status] ?? o.status}</Pill>
          {!cap.masked && <Pill style={devTone(o.deviationStatus)}>Deviation: {DEVIATION_STATUS_LABEL[o.deviationStatus] ?? o.deviationStatus}</Pill>}
          <Pill style={apprTone(o.approvalStatus)}>Credit: {o.approvalStatus}</Pill>
        </div>
      </div>

      {c && (
        <div className="mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          <Row label="Loan amount" value={formatCurrency(c.loanAmount)} />
          <Row label="Tenure" value={`${c.tenureMonths} months`} />
          {!cap.masked && <Row label="Base ROI" value={fmtPct(c.baseRoi)} />}
          <Row label="Offered ROI" value={`${fmtPct(c.offeredRoi)} (${c.rateType})`} />
          <Row label="EMI" value={fmtEmi(c.emi)} />
          <Row label="Processing fee" value={`${fmtPct(c.processingFeePct)} · ${formatCurrency(c.processingFeeAmount)}`} />
          <Row label="GST on fee" value={`${fmtPct(c.gstPct)} · ${formatCurrency(c.gstAmount)}`} />
          <Row label="Insurance" value={formatCurrency(c.insuranceAmount)} />
          <Row label="BT amount" value={formatCurrency(c.btAmount)} />
          <Row label="Stamp duty" value={formatCurrency(c.stampDuty)} />
          <Row label="Financed principal" value={formatCurrency(c.financedPrincipal)} />
          <Row label="Net disbursement" value={<span style={{ color: 'var(--accent)' }}>{formatCurrency(c.netDisbursement)}</span>} />
        </div>
      )}
      {o.statusReason && <p className="mt-2 text-[12px]" style={{ color: 'var(--text3)' }}>{o.statusReason}</p>}

      {!cap.masked && o.evaluation && o.isActive && (
        <div className="mt-3 rounded-xl p-3" style={{ background: 'var(--surface2)' }}>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>
            Deviation check (lender policy){o.latestEvaluatedAt && <span className="font-normal normal-case tracking-normal"> · re-checked {formatDateTime(o.latestEvaluatedAt)}</span>}
          </p>
          <ChecksList checks={o.evaluation.checks} manualReviewReason={o.evaluation.manualReviewReason} />
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {can.has('select') && <Button size="sm" onClick={() => act({ kind: 'select', offer: o })}><CheckCircle2 size={14} className="mr-1" />Select as final</Button>}
        {can.has('unselect') && <Button size="sm" variant="secondary" onClick={() => act({ kind: 'unselect', offer: o })}><Undo2 size={14} className="mr-1" />Change final offer</Button>}
        {can.has('raise') && <Button size="sm" variant="danger" onClick={() => act({ kind: 'raise', offer: o })}><AlertTriangle size={14} className="mr-1" />Raise deviation</Button>}
        {can.has('skip') && <Button size="sm" variant="secondary" onClick={() => act({ kind: 'skip', offer: o })}><SkipForward size={14} className="mr-1" />Skip deviation</Button>}
        {can.has('credit') && <Button size="sm" variant="success" onClick={() => act({ kind: 'credit', offer: o })}><ShieldCheck size={14} className="mr-1" />Credit approval</Button>}
        {can.has('revise') && <Button size="sm" variant="secondary" onClick={() => act({ kind: 'revise', offer: o })}><Pencil size={14} className="mr-1" />Revise terms</Button>}
        {can.has('withdraw') && <Button size="sm" variant="ghost" onClick={() => act({ kind: 'withdraw', offer: o })}><XCircle size={14} className="mr-1" />Withdraw</Button>}
        {o.revisions.length > 1 && (
          <Button size="sm" variant="ghost" onClick={() => setShowHistory(v => !v)}>
            <History size={14} className="mr-1" />Revisions ({o.revisions.length}){showHistory ? <ChevronDown size={13} className="ml-1" /> : <ChevronRight size={13} className="ml-1" />}
          </Button>
        )}
      </div>

      {showHistory && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead><tr style={{ color: 'var(--text3)' }} className="text-left">
              <th className="py-1 pr-3">Rev</th><th className="pr-3">Amount</th><th className="pr-3">Tenure</th><th className="pr-3">ROI</th>
              <th className="pr-3">EMI</th><th className="pr-3">Net disb.</th><th className="pr-3">Deviation</th><th className="pr-3">By / when</th><th>Reason</th>
            </tr></thead>
            <tbody>{o.revisions.map(r => (
              <tr key={r.revisionNo} className="border-t" style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}>
                <td className="py-1 pr-3 font-semibold">{r.revisionNo}</td><td className="pr-3">{formatCurrency(r.loanAmount)}</td>
                <td className="pr-3">{r.tenureMonths} mo</td><td className="pr-3">{fmtPct(r.offeredRoi)}</td><td className="pr-3">{fmtEmi(r.emi)}</td>
                <td className="pr-3">{formatCurrency(r.netDisbursement)}</td><td className="pr-3">{r.evaluationOutcome || '—'}</td>
                <td className="pr-3">{r.createdBy ?? '—'} · {formatDateTime(r.createdAt)}</td><td>{r.changeReason ?? '—'}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

type Action =
  | { kind: 'add' } | { kind: 'revise'; offer: ApplicationOffer } | { kind: 'withdraw'; offer: ApplicationOffer }
  | { kind: 'select'; offer: ApplicationOffer } | { kind: 'unselect'; offer: ApplicationOffer }
  | { kind: 'raise'; offer: ApplicationOffer } | { kind: 'skip'; offer: ApplicationOffer } | { kind: 'credit'; offer: ApplicationOffer }
  | { kind: 'decide'; deviationId: number } | { kind: 'moveToOffer' } | { kind: 'back' }
  | { kind: 'sanction' } | { kind: 'cancelSanction'; sanction: Sanction } | { kind: 'disburse'; sanction: Sanction }
  | { kind: 'reverse'; disbursementId: number } | { kind: 'bureau' } | { kind: 'reassign'; deviation: OfferDeviationRequest }

// ── Main tab ──────────────────────────────────────────────────────────────
export default function OffersTab({ loanId, requestedAmount, tenureMonths }: { loanId: number; requestedAmount: number; tenureMonths: number }) {
  const qc = useQueryClient()
  const toast = useToast()
  const me = useAuthStore(s => s.user)
  const { data: wf, isLoading, error: loadError, refetch } = useQuery({
    queryKey: workflowKey(loanId),
    queryFn: () => offerWorkflowApi.get(loanId).then(r => r.data.data ?? null),
  })
  const [action, setAction] = useState<Action | null>(null)
  const [error, setError] = useState('')
  const [idemKey, setIdemKey] = useState(newIdempotencyKey)
  const [showHistory, setShowHistory] = useState(false)

  const close = () => { setAction(null); setError(''); setIdemKey(newIdempotencyKey()) }
  const done = (r: AxiosResponse<ApiResponse<LoanWorkflow>>, msg?: string) => {
    if (r.data.data) qc.setQueryData(workflowKey(loanId), r.data.data)
    qc.invalidateQueries({ queryKey: ['loans'] })
    qc.invalidateQueries({ queryKey: ['tracking', loanId] })
    qc.invalidateQueries({ queryKey: ['tasks'] })
    if (msg) toast.success(msg)
    close()
  }
  const run = useMutation({
    mutationFn: (fn: () => Promise<AxiosResponse<ApiResponse<LoanWorkflow>>>) => fn(),
    onError: e => setError(apiErrorMessage(e)),
  })
  const go = (fn: () => Promise<AxiosResponse<ApiResponse<LoanWorkflow>>>, msg: string) =>
    run.mutate(fn, { onSuccess: r => done(r, msg) })
  // Re-check runs without a dialog, so its errors go to a toast.
  const recheck = useMutation({
    mutationFn: () => offerWorkflowApi.reEvaluate(loanId),
    onSuccess: r => done(r, 'Deviations re-checked against the current lender rules and bureau report'),
    onError: e => toast.error(apiErrorMessage(e)),
  })

  if (isLoading) return <Card><LoadingSpinner /></Card>
  if (loadError || !wf) return <ErrorState error={loadError} fallback="Could not load offers." onRetry={() => refetch()} />

  const cap = wf.capabilities
  const active = wf.offers.filter(o => o.isActive)
  const inactive = wf.offers.filter(o => !o.isActive)
  const final = wf.offers.find(o => o.status === 'Final')
  const openDeviation = wf.deviations.find(d => d.status === 'Raised')
  const completedDisbursement = wf.disbursements.find(d => d.type === 'Disbursement' && d.status === 'Completed')
  const a = action

  return (
    <div className="space-y-5">
      {/* Stage */}
      <Card>
        <CardHeader title={<><span className="section-icon-badge"><FileSignature size={15} /></span> Offers &amp; Approval</>}
          subtitle="Offer → Deviation (if required) → Credit approval → Sanction → Disbursement" />
        <div className="flex flex-wrap items-center gap-2">
          {wf.loanStatus === 'UnderReview' && (
            wf.moveToOfferBlockers.length > 0
              ? <p className="text-[13px]" style={{ color: 'var(--text2)' }}>Complete verification before offers: <strong>{wf.moveToOfferBlockers.join(', ')}</strong>.</p>
              : <p className="text-[13px]" style={{ color: 'var(--text2)' }}>Verification is complete — the application can move to the Offer stage.</p>
          )}
          {!['UnderReview', 'Offer', 'Decision', 'Approved', 'Acceptance', 'Disbursed', 'Closed'].includes(wf.loanStatus) && wf.offers.length === 0 && (
            <p className="text-[13px]" style={{ color: 'var(--text3)' }}>Offers open once underwriting and verification are complete.</p>
          )}
          {wf.loanStatus === 'OnHold' && <p className="text-[13px]" style={{ color: 'var(--warn)' }}>Application is on hold — offers, deviation, approval, sanction and disbursement are paused.</p>}
          {wf.loanStatus === 'Rejected' && <p className="text-[13px]" style={{ color: 'var(--danger, #e31e25)' }}>Application rejected — offer history is kept read-only.</p>}
          {wf.loanStatus === 'Offer' && !final && active.length > 0 && <p className="text-[13px]" style={{ color: 'var(--text2)' }}>Select the final offer to continue to deviation / credit approval.</p>}
          {wf.loanStatus === 'Offer' && final && final.approvalStatus !== 'Approved' && <p className="text-[13px]" style={{ color: 'var(--text2)' }}>
            {final.lenderName} is the final offer — {final.deviationStatus === 'Required' ? 'deviation must be raised (or skipped by an authorised approver) before credit approval.'
              : final.deviationStatus === 'Rejected' ? 'the deviation was rejected: revise the terms, choose another offer, or reject the application.'
              : final.approvalStatus === 'Rejected' ? 'credit approval was declined: revise the terms or choose another offer.'
              : 'awaiting credit approval.'}</p>}
          {wf.loanStatus === 'Approved' && !wf.sanctions.some(s => s.status === 'Active') && <p className="text-[13px]" style={{ color: 'var(--text2)' }}>Credit approved — the next step is to generate the sanction.</p>}
          {['Approved', 'Acceptance'].includes(wf.loanStatus) && wf.sanctions.some(s => s.status === 'Active') && !completedDisbursement && <p className="text-[13px]" style={{ color: 'var(--text2)' }}>Sanction active — send the deal confirmation, complete NACH and the customer agreement, then record the disbursement.</p>}
          {wf.loanStatus === 'Disbursed' && <p className="text-[13px]" style={{ color: 'var(--success)' }}>Disbursed.</p>}
          {wf.loanStatus === 'Decision' && openDeviation && <p className="text-[13px]" style={{ color: 'var(--warn)' }}>Deviation pending a decision{openDeviation.assignedApprover ? ` — assigned to ${openDeviation.assignedApprover}` : ' — escalated (no alternate approver available)'}.</p>}
          <div className="ml-auto flex flex-wrap gap-2">
            {cap.canMoveToOffer && wf.moveToOfferBlockers.length === 0 &&
              <Button size="sm" onClick={() => setAction({ kind: 'moveToOffer' })}><ArrowRightCircle size={14} className="mr-1" />Move to Offer</Button>}
            {cap.canBackToUnderwriting && <Button size="sm" variant="secondary" onClick={() => setAction({ kind: 'back' })}><ArrowLeftCircle size={14} className="mr-1" />Back to Underwriting</Button>}
            {cap.canReEvaluate && active.length > 0 &&
              <Button size="sm" variant="secondary" loading={recheck.isPending} disabled={recheck.isPending} onClick={() => recheck.mutate()}><RefreshCw size={14} className="mr-1" />Re-check deviations</Button>}
            {cap.canManageOffers && active.length < wf.maxActiveOffers &&
              <Button size="sm" onClick={() => setAction({ kind: 'add' })}><Plus size={14} className="mr-1" />Add offer</Button>}
          </div>
        </div>
        {cap.canManageOffers && active.length >= wf.maxActiveOffers &&
          <p className="mt-2 text-[12px]" style={{ color: 'var(--text3)' }}>{wf.maxActiveOffers} active offers — withdraw one to add another lender.</p>}
      </Card>

      {/* Bureau report — the only CIBIL source for deviation rules */}
      {!cap.masked && (wf.bureauReport || cap.canUploadBureauReport) && (
        <Card>
          <CardHeader title={<><span className="section-icon-badge"><FileSearch size={15} /></span> Bureau report (CIBIL)</>}
            subtitle="CIBIL deviation rules use only the uploaded bureau report — never a value typed on the customer."
            action={cap.canUploadBureauReport
              ? <Button size="sm" variant="secondary" onClick={() => setAction({ kind: 'bureau' })}><Upload size={14} className="mr-1" />{wf.bureauReport ? 'Upload newer report' : 'Upload bureau report'}</Button>
              : undefined} />
          {wf.bureauReport ? (
            <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-3">
              <Row label="Bureau" value={wf.bureauReport.bureauProvider} />
              <Row label="Score" value={wf.bureauReport.creditScore} />
              <Row label="Report date" value={formatDate(wf.bureauReport.reportDate)} />
              <Row label="Uploaded" value={`${wf.bureauReport.uploadedBy ?? '—'} · ${formatDateTime(wf.bureauReport.uploadedAt)}`} />
              {wf.bureauReport.fileName && <Row label="File" value={<span title="Saved in Documents as “Bureau Report”">{wf.bureauReport.fileName}</span>} />}
            </div>
          ) : (
            <p className="text-[13px]" style={{ color: 'var(--warn)' }}>No bureau report uploaded — lender rules on CIBIL go to manual review until one is uploaded.</p>
          )}
        </Card>
      )}

      {/* Offers */}
      {active.length > 0 && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {active.map(o => <OfferCard key={o.id} o={o} wf={wf} act={setAction} />)}
        </div>
      )}
      {active.length === 0 && wf.loanStatus === 'Offer' && (
        <Card><p className="text-sm" style={{ color: 'var(--text3)' }}>No active lender offer yet.</p></Card>
      )}

      {/* Deviation requests */}
      {wf.deviations.length > 0 && (
        <Card>
          <CardHeader title={<><span className="section-icon-badge"><AlertTriangle size={15} /></span> Deviation requests</>} />
          <div className="space-y-2">
            {wf.deviations.map(d => (
              <div key={d.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13.5px] font-semibold" style={{ color: 'var(--text)' }}>{d.lenderName} · {d.deviationType} <span className="font-normal" style={{ color: 'var(--text3)' }}>(rev {d.revisionNo}, {d.source})</span></p>
                  <Pill style={devTone(d.status === 'Raised' ? 'Raised' : d.status)}>{DEVIATION_STATUS_LABEL[d.status === 'Raised' ? 'Raised' : d.status] ?? d.status}</Pill>
                </div>
                <p className="mt-1 text-[12.5px]" style={{ color: 'var(--text2)' }}>
                  Raised by {d.raisedBy ?? '—'} on {formatDateTime(d.raisedAt)}{d.reason ? ` — ${d.reason}` : ''}
                </p>
                {d.status === 'Raised' && <p className="text-[12px]" style={{ color: 'var(--text3)' }}>
                  {d.assignedApprover ? `Approver: ${d.assignedApprover}` : 'No eligible alternate approver — escalated'}{d.assignmentState === 'Escalated' && d.assignedApprover ? ' (routed away from the raiser)' : ''}</p>}
                {d.status === 'Raised' && d.assignedApprover && !d.assignedApproverActive &&
                  <p className="text-[12px]" style={{ color: 'var(--warn)' }}>⚠ {d.assignedApprover}'s account is inactive — reassign this request to another approver.</p>}
                {d.decidedAt && <p className="text-[12px]" style={{ color: 'var(--text3)' }}>{d.status} by {d.decidedBy} on {formatDateTime(d.decidedAt)}{d.decisionComment ? ` — ${d.decisionComment}` : ''}</p>}
                {d.closedReason && <p className="text-[12px]" style={{ color: 'var(--text3)' }}>Closed: {d.closedReason}</p>}
                {d.flags && d.flags.length > 0 && <div className="mt-2"><ChecksList checks={d.flags} /></div>}
                <DeviationButtons acts={deviationActions(d, wf, me?.id)}
                  onDecide={() => setAction({ kind: 'decide', deviationId: d.id })} onReassign={() => setAction({ kind: 'reassign', deviation: d })} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Credit approvals */}
      {wf.creditApprovals.length > 0 && (
        <Card>
          <CardHeader title={<><span className="section-icon-badge"><ShieldCheck size={15} /></span> Credit approval</>} />
          <div className="space-y-1.5">
            {wf.creditApprovals.map(c => (
              <p key={c.id} className="text-[13px]" style={{ color: c.isCurrent ? 'var(--text)' : 'var(--text3)' }}>
                <Pill style={c.decision === 'Approved' ? tone.ok : tone.bad}>{c.decision}</Pill>{' '}
                {c.lenderName} rev {c.revisionNo} by {c.approver ?? '—'} on {formatDateTime(c.createdAt)} · deviation {DEVIATION_STATUS_LABEL[c.deviationStatusAtApproval] ?? c.deviationStatusAtApproval}
                {c.comment ? ` — ${c.comment}` : ''}{!c.isCurrent && c.decision === 'Approved' ? ' (superseded)' : ''}
              </p>
            ))}
          </div>
        </Card>
      )}

      {/* Sanction */}
      {(wf.sanctions.length > 0 || cap.canGenerateSanction) && (
        <Card>
          <CardHeader title={<><span className="section-icon-badge"><FileSignature size={15} /></span> Sanction</>}
            action={cap.canGenerateSanction ? <Button size="sm" onClick={() => setAction({ kind: 'sanction' })}>Generate sanction</Button> : undefined} />
          {wf.sanctions.length === 0 && <p className="text-sm" style={{ color: 'var(--text3)' }}>Credit approval is recorded — the sanction can now be generated from the approved offer.</p>}
          <div className="space-y-3">
            {wf.sanctions.map(s => (
              <div key={s.id} className="rounded-xl border p-3" style={{ borderColor: s.status === 'Active' ? 'var(--success)' : 'var(--border)', opacity: s.status === 'Active' ? 1 : 0.75 }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[14px] font-bold" style={{ color: 'var(--text)' }}>{s.sanctionNumber} <span className="font-normal" style={{ color: 'var(--text3)' }}>· {s.lenderName} · rev {s.revisionNo}</span></p>
                  <Pill style={s.status === 'Active' ? tone.ok : tone.mute}>{s.status}{s.cancellationType ? ` (${s.cancellationType})` : ''}</Pill>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-x-6 sm:grid-cols-3">
                  <Row label="Amount" value={formatCurrency(s.loanAmount)} /><Row label="Tenure" value={`${s.tenureMonths} mo`} />
                  <Row label="ROI" value={fmtPct(s.roi)} /><Row label="EMI" value={fmtEmi(s.emi)} />
                  <Row label="Fee + GST" value={formatCurrency(s.processingFeeAmount + s.gstAmount)} /><Row label="Insurance" value={formatCurrency(s.insuranceAmount)} />
                  <Row label="BT" value={formatCurrency(s.btAmount)} /><Row label="Stamp duty" value={formatCurrency(s.stampDuty)} />
                  <Row label="Net disbursement" value={formatCurrency(s.netDisbursement)} />
                </div>
                <p className="mt-1 text-[12px]" style={{ color: 'var(--text3)' }}>Generated by {s.generatedBy ?? '—'} on {formatDateTime(s.generatedAt)}
                  {s.cancelledAt ? ` · ${s.cancellationType} by ${s.cancelledBy} on ${formatDateTime(s.cancelledAt)}${s.cancelReason ? ` — ${s.cancelReason}` : ''}` : ''}</p>
                {s.status === 'Active' && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {cap.canDisburse && !completedDisbursement && <Button size="sm" variant="success" onClick={() => setAction({ kind: 'disburse', sanction: s })}><BadgeIndianRupee size={14} className="mr-1" />Record disbursement</Button>}
                    {cap.canCancelSanction && <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'cancelSanction', sanction: s })}><Ban size={14} className="mr-1" />Cancel / Revoke / Amend</Button>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Disbursement */}
      {wf.disbursements.length > 0 && (
        <Card>
          <CardHeader title={<><span className="section-icon-badge"><BadgeIndianRupee size={15} /></span> Disbursement</>} />
          <div className="space-y-2">
            {wf.disbursements.map(d => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
                <div className="text-[13px]" style={{ color: 'var(--text2)' }}>
                  <p className="font-semibold" style={{ color: 'var(--text)' }}>{d.type === 'Reversal' ? 'Reversal of' : ''} {formatCurrency(d.amount)} · {d.mode} · UTR {d.utr}</p>
                  <p>{formatDate(d.disbursementDate)} · A/c {d.bankAccountNumber} ({d.ifsc}){d.lenderReference ? ` · Lender ref ${d.lenderReference}` : ''} · by {d.createdBy ?? '—'}</p>
                  {d.reason && <p style={{ color: 'var(--text3)' }}>Reason: {d.reason}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Pill style={d.status === 'Completed' && d.type === 'Disbursement' ? tone.ok : tone.mute}>{d.type === 'Reversal' ? 'Reversal' : d.status}</Pill>
                  {cap.canReverseDisbursement && d.type === 'Disbursement' && d.status === 'Completed' &&
                    <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'reverse', disbursementId: d.id })}><RotateCcw size={14} className="mr-1" />Reverse</Button>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Closed offers history */}
      {inactive.length > 0 && (
        <Card>
          <button type="button" className="flex w-full items-center gap-2 text-left text-sm font-semibold" style={{ color: 'var(--text2)' }} onClick={() => setShowHistory(v => !v)}>
            {showHistory ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Offer history ({inactive.length} not active)
          </button>
          {showHistory && <div className="mt-3 grid grid-cols-1 gap-4 xl:grid-cols-2">{inactive.map(o => <OfferCard key={o.id} o={o} wf={wf} act={setAction} />)}</div>}
        </Card>
      )}

      {/* ── Dialogs ── */}
      {a?.kind === 'add' && <OfferFormModal wf={wf} requestedAmount={requestedAmount} tenure={tenureMonths} onClose={close} onDone={r => done(r, 'Offer added')} />}
      {a?.kind === 'revise' && <OfferFormModal wf={wf} offer={a.offer} requestedAmount={requestedAmount} tenure={tenureMonths} onClose={close} onDone={r => done(r, 'Offer revised')} />}
      {a?.kind === 'withdraw' && <ReasonModal title={`Withdraw ${a.offer.lenderName} offer`} confirm="Withdraw offer" variant="danger" onClose={close} pending={run.isPending} error={error}
        onSubmit={reason => go(() => offerWorkflowApi.withdrawOffer(loanId, a.offer.id, a.offer.version, reason), 'Offer withdrawn')} />}
      {a?.kind === 'unselect' && <ReasonModal title="Change final offer" subtitle={`${a.offer.lenderName} will no longer be the final offer.`} confirm="Unselect" onClose={close} pending={run.isPending} error={error}
        onSubmit={reason => go(() => offerWorkflowApi.unselectOffer(loanId, a.offer.id, a.offer.version, reason), 'Final offer cleared')} />}
      {a?.kind === 'select' && (
        <Modal open onClose={close} title={`Select ${a.offer.lenderName} as final offer`} size="sm"
          subtitle="The other active offers become 'Not selected'. Terms can change later only through a new revision."
          footer={<><Button size="sm" variant="secondary" onClick={close}>Cancel</Button>
            <Button size="sm" loading={run.isPending} onClick={() => go(() => offerWorkflowApi.selectOffer(loanId, a.offer.id, a.offer.version), 'Final offer selected')}>Confirm selection</Button></>}>
          <ErrorBox msg={error} />
          <p className="text-sm" style={{ color: 'var(--text2)' }}>Revision {a.offer.currentRevisionNo}: {formatCurrency(a.offer.current?.loanAmount)} at {fmtPct(a.offer.current?.offeredRoi)} for {a.offer.current?.tenureMonths} months, EMI {formatCurrency(a.offer.current?.emi)}.</p>
        </Modal>
      )}
      {a?.kind === 'raise' && <RaiseDeviationModal wf={wf} offer={a.offer} error={error} pending={run.isPending} onClose={close}
        onSubmit={(type, reason) => go(() => offerWorkflowApi.raiseDeviation(loanId, a.offer.id, type, reason, idemKey), 'Deviation raised')} />}
      {a?.kind === 'skip' && <ReasonModal title="Skip deviation" subtitle="An authorised bypass of the policy deviation — your name, the reason and the time are recorded." confirm="Skip deviation" onClose={close} pending={run.isPending} error={error}
        onSubmit={reason => go(() => offerWorkflowApi.skipDeviation(loanId, a.offer.id, reason), 'Deviation skipped')} />}
      {a?.kind === 'decide' && <DecideModal error={error} pending={run.isPending} onClose={close}
        onSubmit={(approve, comment) => go(() => offerWorkflowApi.decideDeviation(loanId, a.deviationId, approve, comment, idemKey), approve ? 'Deviation approved' : 'Deviation rejected')} />}
      {a?.kind === 'credit' && <CreditApprovalModal offer={a.offer} error={error} pending={run.isPending} onClose={close}
        onSubmit={(decision, comment) => go(() => offerWorkflowApi.creditApproval(loanId, a.offer.id, decision, a.offer.currentRevisionNo, comment, idemKey),
          decision === 'Approve' ? 'Credit approval recorded' : 'Offer terms declined')} />}
      {a?.kind === 'moveToOffer' && <ReasonModal title="Move to Offer stage" subtitle="Verification is complete; lender offers can now be added." confirm="Move to Offer" onClose={close} pending={run.isPending} error={error}
        onSubmit={reason => go(() => offerWorkflowApi.moveToOffer(loanId, reason), 'Moved to Offer stage')} />}
      {a?.kind === 'back' && <ReasonModal title="Send back to Underwriting" subtitle="The final selection is cleared and any open deviation request is closed. Offers are kept." confirm="Send back" variant="danger" onClose={close} pending={run.isPending} error={error}
        onSubmit={reason => go(() => offerWorkflowApi.backToUnderwriting(loanId, reason), 'Sent back to Underwriting')} />}
      {a?.kind === 'sanction' && final && (
        <Modal open onClose={close} title="Generate sanction" size="sm"
          subtitle="Creates an immutable sanction from the credit-approved final offer. Corrections later need an Amendment and a fresh credit approval."
          footer={<><Button size="sm" variant="secondary" onClick={close}>Cancel</Button>
            <Button size="sm" loading={run.isPending} onClick={() => go(() => offerWorkflowApi.generateSanction(loanId, idemKey), 'Sanction generated')}>Generate</Button></>}>
          <ErrorBox msg={error} />
          <p className="text-sm" style={{ color: 'var(--text2)' }}>{final.lenderName} rev {final.currentRevisionNo}: {formatCurrency(final.current?.loanAmount)}, {fmtPct(final.current?.offeredRoi)}, {final.current?.tenureMonths} months, net disbursement {formatCurrency(final.current?.netDisbursement)}.</p>
        </Modal>
      )}
      {a?.kind === 'cancelSanction' && <CancelSanctionModal sanction={a.sanction} error={error} pending={run.isPending} onClose={close}
        onSubmit={(type, reason) => go(() => offerWorkflowApi.cancelSanction(loanId, a.sanction.id, type, reason), `Sanction ${type === 'Revoke' ? 'revoked' : type === 'Amendment' ? 'cancelled for amendment' : 'cancelled'}`)} />}
      {a?.kind === 'disburse' && <DisburseModal sanction={a.sanction} error={error} pending={run.isPending} onClose={close}
        onSubmit={body => go(() => offerWorkflowApi.disburse(loanId, body, idemKey), 'Disbursement recorded')} />}
      {a?.kind === 'bureau' && <BureauUploadModal error={error} pending={run.isPending} onClose={close}
        onSubmit={b => go(() => offerWorkflowApi.uploadBureauReport(loanId, b), 'Bureau report uploaded — deviations re-checked')} />}
      {a?.kind === 'reassign' && <ReassignModal loanId={loanId} deviation={a.deviation} error={error} pending={run.isPending} onClose={close}
        onSubmit={(userId, reason) => go(() => offerWorkflowApi.reassignDeviation(loanId, a.deviation.id, userId, reason), 'Deviation reassigned')} />}
      {a?.kind === 'reverse' && <ReasonModal title="Reverse disbursement" subtitle="Posts a reversal entry; the original disbursement record is kept." confirm="Reverse" variant="danger" onClose={close} pending={run.isPending} error={error}
        onSubmit={reason => go(() => offerWorkflowApi.reverseDisbursement(loanId, a.disbursementId, reason), 'Disbursement reversed')} />}
    </div>
  )
}

function RaiseDeviationModal({ wf, offer, onClose, onSubmit, pending, error }: {
  wf: LoanWorkflow; offer: ApplicationOffer; onClose: () => void; onSubmit: (type: string, reason: string) => void; pending: boolean; error: string
}) {
  const flagged = offer.evaluation?.checks.filter(c => c.status !== 'Within').map(c => c.deviationType) ?? []
  const [type, setType] = useState(flagged.length === 1 ? flagged[0] : flagged.length > 1 ? 'Multiple' : '')
  const [reason, setReason] = useState('')
  return (
    <Modal open onClose={onClose} title={`Raise deviation — ${offer.lenderName}`} size="md"
      subtitle="Deviation is specific to this lender. It is routed to an eligible approver other than you."
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="danger" loading={pending} disabled={pending || !type || !reason.trim()} onClick={() => onSubmit(type, reason.trim())}>Raise deviation</Button></>}>
      <ErrorBox msg={error} />
      {offer.evaluation && <div className="mb-3 rounded-xl p-3" style={{ background: 'var(--surface2)' }}><ChecksList checks={offer.evaluation.checks} manualReviewReason={offer.evaluation.manualReviewReason} /></div>}
      <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text2)' }}>Deviation type *</label>
      <select className="efin-input mb-3" value={type} onChange={e => setType(e.target.value)}>
        <option value="">— Select —</option>
        {flagged.length > 1 && <option value="Multiple">Multiple ({flagged.join(', ')})</option>}
        {wf.manualDeviationCategories.map(c => <option key={c} value={c}>{c === 'LoanAmount' ? 'Loan Amount' : c}</option>)}
      </select>
      <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text2)' }}>Reason *</label>
      <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className="efin-input" placeholder="Why this exception is justified" />
    </Modal>
  )
}

function DecideModal({ onClose, onSubmit, pending, error }: { onClose: () => void; onSubmit: (approve: boolean, comment?: string) => void; pending: boolean; error: string }) {
  const [comment, setComment] = useState('')
  return (
    <Modal open onClose={onClose} title="Decide deviation" size="md" subtitle="Approving the deviation does not approve the credit terms — Credit approval is a separate step."
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="danger" loading={pending} disabled={pending || !comment.trim()} onClick={() => onSubmit(false, comment.trim())}>Reject</Button>
        <Button size="sm" variant="success" loading={pending} disabled={pending} onClick={() => onSubmit(true, comment.trim() || undefined)}>Approve</Button></>}>
      <ErrorBox msg={error} />
      <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text2)' }}>Comment (required to reject)</label>
      <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} className="efin-input" />
    </Modal>
  )
}

function CreditApprovalModal({ offer, onClose, onSubmit, pending, error }: {
  offer: ApplicationOffer; onClose: () => void; onSubmit: (d: 'Approve' | 'Reject', comment?: string) => void; pending: boolean; error: string
}) {
  const [comment, setComment] = useState('')
  const c = offer.current
  return (
    <Modal open onClose={onClose} title={`Credit approval — ${offer.lenderName}`} size="md"
      subtitle={`Revision ${offer.currentRevisionNo} · deviation ${DEVIATION_STATUS_LABEL[offer.deviationStatus] ?? offer.deviationStatus}. To change terms, use Revise terms — a new revision needs a new approval.`}
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="danger" loading={pending} disabled={pending || !comment.trim()} onClick={() => onSubmit('Reject', comment.trim())}>Decline terms</Button>
        <Button size="sm" variant="success" loading={pending} disabled={pending} onClick={() => onSubmit('Approve', comment.trim() || undefined)}>Approve terms</Button></>}>
      <ErrorBox msg={error} />
      {c && <div className="mb-3 grid grid-cols-2 gap-x-6">
        <Row label="Amount" value={formatCurrency(c.loanAmount)} /><Row label="Tenure" value={`${c.tenureMonths} mo`} />
        <Row label="ROI" value={fmtPct(c.offeredRoi)} /><Row label="EMI" value={fmtEmi(c.emi)} />
        <Row label="Net disbursement" value={formatCurrency(c.netDisbursement)} />
      </div>}
      <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text2)' }}>Comment (required to decline)</label>
      <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} className="efin-input" />
    </Modal>
  )
}

function CancelSanctionModal({ sanction, onClose, onSubmit, pending, error }: {
  sanction: Sanction; onClose: () => void; onSubmit: (t: 'Cancel' | 'Revoke' | 'Amendment', reason: string) => void; pending: boolean; error: string
}) {
  const [type, setType] = useState<'Cancel' | 'Revoke' | 'Amendment'>('Amendment')
  return (
    <ReasonModal title={`Cancel sanction ${sanction.sanctionNumber}`} confirm="Confirm" variant="danger" onClose={onClose} pending={pending} error={error}
      subtitle="The sanction record is kept. The application returns to the Offer stage; a new credit approval and sanction are required."
      onSubmit={reason => onSubmit(type, reason)}
      extra={<>
        <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text2)' }}>Type *</label>
        <select className="efin-input mb-3" value={type} onChange={e => setType(e.target.value as typeof type)}>
          <option value="Amendment">Amendment (correct the terms and re-sanction)</option>
          <option value="Cancel">Cancel</option>
          <option value="Revoke">Revoke (lender withdrew the sanction)</option>
        </select>
      </>} />
  )
}

function DisburseModal({ sanction, onClose, onSubmit, pending, error }: {
  sanction: Sanction; onClose: () => void; onSubmit: (b: DisbursementInput) => void; pending: boolean; error: string
}) {
  const [f, setF] = useState<DisbursementInput>({
    amount: sanction.netDisbursement, disbursementDate: new Date().toISOString().slice(0, 10), bankAccountNumber: '', ifsc: '',
    accountHolderName: '', utr: '', lenderReference: '', mode: 'NEFT',
  })
  const set = (k: keyof DisbursementInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF(p => ({ ...p, [k]: k === 'amount' ? Number(e.target.value || 0) : e.target.value }))
  const ok = f.amount > 0 && f.bankAccountNumber.trim() && f.ifsc.trim() && f.utr.trim() && f.disbursementDate
  const field = (label: string, k: keyof DisbursementInput, placeholder?: string) => (
    <div>
      <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text2)' }}>{label}</label>
      <input className="efin-input" value={String(f[k] ?? '')} onChange={set(k)} placeholder={placeholder} />
    </div>
  )
  return (
    <Modal open onClose={onClose} title="Record disbursement" size="lg"
      subtitle={`Sanction ${sanction.sanctionNumber} · ${sanction.lenderName} · net disbursement ${formatCurrency(sanction.netDisbursement)}. NACH and Customer Agreement must be done.`}
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="success" loading={pending} disabled={pending || !ok} onClick={() => onSubmit({ ...f, ifsc: f.ifsc.trim().toUpperCase() })}>Disburse</Button></>}>
      <ErrorBox msg={error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text2)' }}>Amount (₹) *</label>
          <NumberInput className="efin-input" min={0} value={f.amount} onChange={set('amount')} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text2)' }}>Date *</label>
          <input type="date" className="efin-input" value={f.disbursementDate} onChange={set('disbursementDate')} />
        </div>
        {field('Beneficiary account number *', 'bankAccountNumber')}
        {field('IFSC *', 'ifsc', 'HDFC0001234')}
        {field('Account holder name', 'accountHolderName')}
        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text2)' }}>Mode *</label>
          <select className="efin-input" value={f.mode} onChange={set('mode')}>
            {['NEFT', 'RTGS', 'IMPS', 'Cheque', 'Other'].map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        {field('UTR / transaction reference *', 'utr')}
        {field('Lender reference (loan account no.)', 'lenderReference')}
      </div>
    </Modal>
  )
}

function DeviationButtons({ acts, onDecide, onReassign }: { acts: ReturnType<typeof deviationActions>; onDecide: () => void; onReassign: () => void }) {
  if (!acts.length) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {acts.includes('ownRequest') && <p className="text-[12px]" style={{ color: 'var(--warn)' }}>You raised this deviation — a different approver must decide it.</p>}
      {acts.includes('decide') && <Button size="sm" onClick={onDecide}><ShieldCheck size={14} className="mr-1" />Decide deviation</Button>}
      {acts.includes('reassign') && <Button size="sm" variant="ghost" onClick={onReassign}><UserCog size={14} className="mr-1" />Reassign approver</Button>}
    </div>
  )
}

function BureauUploadModal({ onClose, onSubmit, pending, error }: {
  onClose: () => void; onSubmit: (b: BureauReportInput) => void; pending: boolean; error: string
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [file, setFile] = useState<File | null>(null)
  const [score, setScore] = useState(0)
  const [provider, setProvider] = useState(BUREAU_PROVIDERS[0])
  const [reportDate, setReportDate] = useState(today)
  const scoreOk = score >= 300 && score <= 900
  const ok = !!file && scoreOk && !!reportDate && reportDate <= today
  return (
    <Modal open onClose={onClose} title="Upload bureau report" size="md"
      subtitle="The report file is saved to Documents; its score becomes the CIBIL used by lender deviation rules and every live offer is re-checked."
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" loading={pending} disabled={pending || !ok}
          onClick={() => file && onSubmit({ file, creditScore: score, bureauProvider: provider, reportDate })}>Upload</Button></>}>
      <ErrorBox msg={error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text2)' }}>Report file * <span style={{ color: 'var(--text3)' }}>(PDF / PNG / JPG, up to 10 MB)</span></label>
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" className="efin-input"
            onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text2)' }}>Bureau *</label>
          <select className="efin-input" value={provider} onChange={e => setProvider(e.target.value)}>
            {BUREAU_PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text2)' }}>Score (as printed on the report) *</label>
          <NumberInput className="efin-input" min={300} max={900} value={score || ''} onChange={e => setScore(Number(e.target.value || 0))} />
          {score > 0 && !scoreOk && <p className="mt-0.5 text-[11px]" style={{ color: 'var(--danger, #e31e25)' }}>Score must be between 300 and 900.</p>}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text2)' }}>Report date *</label>
          <input type="date" className="efin-input" max={today} value={reportDate} onChange={e => setReportDate(e.target.value)} />
        </div>
      </div>
    </Modal>
  )
}

function ReassignModal({ loanId, deviation, onClose, onSubmit, pending, error }: {
  loanId: number; deviation: OfferDeviationRequest; onClose: () => void; onSubmit: (userId: number, reason: string) => void; pending: boolean; error: string
}) {
  const { data: approvers, isLoading, error: loadError } = useQuery({
    queryKey: ['deviation-approvers', loanId, deviation.id],
    queryFn: () => offerWorkflowApi.eligibleApprovers(loanId, deviation.id).then(r => r.data.data ?? []),
  })
  const [userId, setUserId] = useState(0)
  const [reason, setReason] = useState('')
  const choices = (approvers ?? []).filter(x => x.userId !== deviation.assignedApproverId)
  return (
    <Modal open onClose={onClose} title={`Reassign deviation — ${deviation.lenderName}`} size="md"
      subtitle={`Currently with ${deviation.assignedApprover ?? 'no approver (escalated)'}. Only active credit approvers other than the raiser can be chosen.`}
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" loading={pending} disabled={pending || !userId || !reason.trim()} onClick={() => onSubmit(userId, reason.trim())}>Reassign</Button></>}>
      <ErrorBox msg={error || (loadError ? apiErrorMessage(loadError) : '')} />
      <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text2)' }}>New approver *</label>
      {isLoading ? <LoadingSpinner /> : (
        <select className="efin-input mb-3" value={userId} onChange={e => setUserId(Number(e.target.value))}>
          <option value={0}>— Select approver —</option>
          {choices.map(x => <option key={x.userId} value={x.userId}>{x.name} · {x.roleTitle}</option>)}
        </select>
      )}
      {!isLoading && !loadError && choices.length === 0 && <p className="mb-3 text-[12px]" style={{ color: 'var(--text3)' }}>No other eligible approver is available.</p>}
      <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text2)' }}>Reason *</label>
      <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className="efin-input" placeholder="e.g. Approver on leave" />
    </Modal>
  )
}
