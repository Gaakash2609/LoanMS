import { useParams, useNavigate } from 'react-router-dom'
import { SubTabBar } from '@/components/ui/SubTabBar'
import { DetailTabBar } from '@/components/ui/DetailTabBar'
import { useLoan, LOAN_KEYS } from '@/hooks/useLoans'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { DeleteCustomerModal } from '@/components/shared/DeleteCustomerModal'
import { StatusBadge } from '@/components/ui/Badge'
import { LoadingSpinner, PageLoader } from '@/components/ui/LoadingSpinner'
import { formatCurrency, formatDate, formatDateTime } from '@/utils/format'
import { fromRemarks } from '@/constants/advFilter'
import {
  ArrowLeft,
  XCircle, Lock, Wallet,
  PauseCircle, PlayCircle,
  Lightbulb, Copy, Check, Ellipsis, ChevronDown, Archive,
} from 'lucide-react'
import type { Loan, ApiResponse } from '@/types'
import { useState, useMemo, useEffect, lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import { useAuthStore } from '@/store/authStore'
import ObligationsWorkspace from '@/components/shared/ObligationsWorkspace'
import { Plus, Trash2, Pencil, RotateCcw } from 'lucide-react'
import LenderEmailCard from '@/components/shared/LenderEmailCard'
import { LENDER_EMAIL_VISIBLE_STAGES } from '@/utils/lenderEmailTemplates'
import { perfiosApi } from '@/api/perfiosApi'
import { deserializePerfiosReport } from '@/utils/perfios/persist'
import { FileCheck, LifeBuoy } from 'lucide-react'
import LoanVerificationChecks from '@/components/shared/LoanVerificationChecks'
import OffersTab, { workflowKey } from '@/components/shared/OffersTab'
import { offerWorkflowApi } from '@/api/offerWorkflowApi'
import { loansApi } from '@/api/loansApi'
import api from '@/api/axios'

// Lazy: each is a whole tab's worth of code (TrackingPage is a full page
// component reused here; PerfiosWorkflow pulls in the pdfjs-dist PDF
// parsing engine) that only renders when the user actually clicks into
// that tab, but was previously imported eagerly into this already-large
// route chunk. Splitting these out is what actually shrinks
// LoanDetailPage's bundle -- unlike the other pages flagged in past
// validation passes, this one had a real, fixable cause.
const IncredTab = lazy(() => import('./IncredTab'))
const TrackingPage = lazy(() => import('./TrackingPage'))
const PerfiosWorkflow = lazy(() => import('@/components/shared/PerfiosWorkflow'))
// The full read-only report renderer. It shares no pdfjs code (that lives in
// the upload/parse path only), so this chunk stays light — but it is large
// enough on its own to keep out of the main route chunk.
const PerfiosAnalysisResults = lazy(() => import('@/components/shared/PerfiosAnalysisResults'))
import LoanDocumentsCard from '@/components/shared/LoanDocumentsCard'
import SanctionDetailCard from '@/components/shared/SanctionDetailCard'
import { hasReachedSanctionStage } from '@/utils/loanStage'
import IncomeVerificationPanel from '@/components/shared/IncomeVerificationPanel'
import LoanAssignmentCard from '@/components/shared/LoanAssignmentCard'
import RequiredDocumentsChecklist from '@/components/shared/RequiredDocumentsChecklist'
import LoanApplicantTabs from '@/components/shared/LoanApplicantTabs'
import { tasksApi } from '@/api/tasksApi'
import { useHasPermission, useCurrentRole } from '@/hooks/usePermissions'
import { SkeletonText } from '@/components/ui/Skeleton'

// Header action bar — Vanilla buildDetailActionBar (efin-app.js:38921): Un-hold,
// Re-open and the "⋯ More" menu (Put on Hold / Reject) live in the loan header,
// NOT in an Overview sidebar. Workflow moves (Underwriting / Approve with
// Details / Disburse / Deviation / checks) live in Timeline → Actions
// (LoanVerificationChecks). Each header action asks for a reason in one shared
// modal and calls the existing dedicated endpoint.
type HeaderAction = 'Reject' | 'Hold' | 'Un-hold' | 'Re-open' | 'Archive'
const HEADER_ACTION_META: Record<HeaderAction, {
  title: string; hint: string; placeholder: string; required: boolean
  variant: 'primary' | 'danger' | 'secondary'; confirm: string
}> = {
  Reject:   { title: 'Reject Application', hint: 'It can be re-opened within 45 days of the original creation date.',
              placeholder: 'Comment / rejection reason (optional)', required: false, variant: 'danger', confirm: 'Reject' },
  Hold:     { title: 'Put on Hold', hint: 'The application is paused and can be un-held later.',
              placeholder: 'Hold reason (required)', required: true, variant: 'secondary', confirm: 'Hold' },
  'Un-hold': { title: 'Un-hold Application', hint: 'Resumes the application at the stage it was in before the hold.',
              placeholder: 'Comment (optional)', required: false, variant: 'primary', confirm: 'Un-hold' },
  'Re-open': { title: 'Re-open Application', hint: 'Resumes processing from the stage this loan was in before rejection.',
              placeholder: 'Remarks (required)', required: true, variant: 'primary', confirm: 'Re-open' },
  Archive:  { title: 'Archive Application',
              hint: 'Moves it out of the active lists into Applications → Archived. The customer, documents and history are kept. It does not reset the 45-day re-application rule and cannot be undone.',
              placeholder: 'Archive reason (required)', required: true, variant: 'secondary', confirm: 'Archive' },
}

// PATCH /api/loans/{id}/archive [Authorize(Roles=...)] — mirrored for the button.
const ARCHIVE_ROLES = ['Admin', 'ProductTeam', 'LocationHead']

// Vanilla header empNote (efin-app.js:27179) — the employment-keyed
// verification hint. Matched on the applicant's employment type.
function employmentTip(empType?: string | null): string | null {
  if (!empType) return null
  const t = empType.toLowerCase().replace(/[\s_-]/g, '')
  if (t.includes('salar')) return 'Salaried: Verify salary slips, Form 16 and employer credentials'
  if (t.includes('self') || t.includes('business')) return 'Self-Employed: Verify ITR, GST returns and banking strength'
  if (t.includes('profession')) return 'Professional: Verify registration certificate, ITR and practice proof'
  return null
}

// ── Vanilla fieldGrid() cell (efin-app.js:3784) — an uppercase emoji label
// over a boxed value; muted italic "—" when empty. Used across the loan-
// detail tabs to reproduce Vanilla's read-only detail grids exactly.
function FVal({ emoji, label, value, node }: { emoji?: string; label: string; value?: string | null; node?: ReactNode }) {
  const empty = node == null && (value == null || value === '' || value === '—')
  return (
    <div className="detail-fg">
      <label>{emoji && <span style={{ fontSize: 11 }}>{emoji}</span>} {label}</label>
      <div className={`field-val ${empty ? 'empty' : ''}`}>{node ?? (value || '—')}</div>
    </div>
  )
}
// Vanilla checkBadge() (efin-app.js:3135) — the Doc/Income/Bank/ECS/FI flags.
function CheckBadge({ done }: { done: boolean }) {
  return done
    ? <span className="check-badge check-done">✓ Done</span>
    : <span className="check-badge check-pending">⏳ Pending</span>
}

// Overview label maps — Vanilla renders the human label, not the stored code
// (efin-app.js:2487-2488). Lead source / channel are persisted in Remarks as
// their raw code (e.g. "reference", "direct").
const LEAD_SOURCE_LABELS: Record<string, string> = {
  facebook: 'Facebook', whatsapp: 'WhatsApp', instagram: 'Instagram',
  google_ads: 'Google Ads', reference: 'Reference', walk_in: 'Walk-In',
  cold_call: 'Cold Call', partner: 'Partner',
}
const CHANNEL_LABELS: Record<string, string> = {
  direct: 'Direct', agent: 'Partner / Agent', online: 'Online', dsa: 'DSA',
}
function mapLabel(m: Record<string, string>, v?: string | null): string | undefined {
  if (!v) return undefined
  return m[v] ?? m[v.toLowerCase()] ?? v
}

// Active Time — React equivalent of Vanilla getActiveTimeDisplay(app)
// (efin-app.js:24104). Live elapsed hours since createdAt for an in-flight
// loan; frozen at the transition into a terminal status once it reaches one.
// Vanilla's stored total_active_hours has no React field, so this derives the
// value from data already on the loan (createdAt + statusHistory).
function computeActiveTime(loan: Loan): string {
  const start = new Date(loan.createdAt).getTime()
  if (isNaN(start)) return 'N/A'
  const TERMINAL = ['Disbursed', 'Rejected', 'OnHold', 'Closed']
  let end = Date.now()
  if (TERMINAL.includes(loan.status)) {
    const t = [...(loan.statusHistory ?? [])].reverse().find(h => TERMINAL.includes(h.toStatus))
    const tm = t ? new Date(t.changedAt).getTime() : NaN
    if (!isNaN(tm)) end = tm
  }
  const h = Math.max(0, (end - start) / 3600000)
  const s = h.toFixed(2) + ' Hours'
  if (h < 1) return `${s} (${Math.round(h * 60)} min)`
  const d = Math.floor(h / 24), r = Math.round(h % 24)
  return d > 0 ? `${s} (${d}d ${r}h)` : s
}

function ObligationsTab({ loanId, loan }: { loanId: number; loan: Loan }) {
  // The credit-review workspace (summary, backend-authoritative FOIR, bank-
  // statement detection, reconciliation, verify) lives in its own component;
  // this tab simply mounts it. All business logic is server-side.
  return <ObligationsWorkspace loanId={loanId} loan={loan} />
}

// ── Bank Details sub-tab — Vanilla's #lender-panel-banks (index.html:1147):
// the per-bank lender-processing table (Bank / Temp App No / App No / Approved
// Loan / Remarks) with a View↔Edit toolbar, plus the Disbursement
// Pre-Conditions checklist below it. React previously showed only the
// bank-statement extraction card here; the bankLines table (data already on
// loan.bankLines, written via PUT /bank-lines) had no UI on this tab.
type BankLineRow = { id?: number; bankName: string; tempApplicationNumber: string; applicationNumber: string; approvedLoan: string; remarks: string }
const EMPTY_BANK_ROW: BankLineRow = { bankName: '', tempApplicationNumber: '', applicationNumber: '', approvedLoan: '', remarks: '' }

function BankLinesCard({ loan }: { loan: Loan }) {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  // Mirrors PUT /api/loans/{id}/bank-lines [Authorize(Roles=...)].
  const canEdit = ['Admin', 'Manager', 'LoginTeam', 'TeamLeader', 'LocationHead', 'OperationManager', 'Accounts', 'ProductTeam'].includes(user?.role ?? '')
  // Vanilla hides the Application Number column for Partner users
  // (index.html:1174 `bank-col-appno` gets style="display:none" when
  // currentUser.role==='partner') — Partners only ever see the Temp
  // Application Number, not the lender-assigned one.
  const isPartner = user?.role === 'Partner'
  const toRows = (): BankLineRow[] => (loan.bankLines ?? []).map(b => ({
    id: b.id, bankName: b.bankName ?? '', tempApplicationNumber: b.tempApplicationNumber ?? '',
    applicationNumber: b.applicationNumber ?? '', approvedLoan: b.approvedLoan != null ? String(b.approvedLoan) : '',
    remarks: b.remarks ?? '',
  }))
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState<BankLineRow[]>(toRows)
  const [error, setError] = useState('')

  // Disbursement pre-conditions status (NACH / Customer Agreement via tracking,
  // Doc Check via the Overview flag) — legacy's pre-condition checklist.
  const { data: tracking } = useQuery({
    queryKey: ['tracking', loan.id],
    queryFn: () => api.get<ApiResponse<{ name: string }[]>>(`/api/loans/${loan.id}/tracking`).then(r => r.data.data ?? []),
  })
  const trk = tracking ?? []
  const preconds = [
    { label: 'NACH / eMandate Setup', note: 'Register NACH mandate for auto-debit of EMIs', done: !!loan.nachDone || trk.some(e => e.name === 'EFIN-Nach') },
    { label: 'Customer Agreement Signed', note: 'Loan agreement signed by customer', done: !!loan.customerAgreementDone || trk.some(e => e.name === 'EFIN-Customer Agreement') },
    { label: 'Document Check Complete', note: 'All KYC and income documents verified', done: !!loan.documentChecked },
  ]
  const pendingCount = preconds.filter(p => !p.done).length

  const save = useMutation({
    mutationFn: () => loansApi.updateBankLines(loan.id, rows.filter(r => r.bankName.trim()).map(r => ({
      bankName: r.bankName.trim(), tempApplicationNumber: r.tempApplicationNumber.trim(),
      applicationNumber: r.applicationNumber.trim() || undefined,
      approvedLoan: r.approvedLoan ? Number(r.approvedLoan) : undefined,
      remarks: r.remarks.trim() || undefined,
    }))),
    onSuccess: () => { setEditing(false); setError(''); qc.invalidateQueries({ queryKey: LOAN_KEYS.detail(loan.id) }) },
    onError: (err: unknown) => {
      const d = (err as { response?: { data?: { message?: string } } })?.response?.data
      setError(d?.message || 'Could not save bank details.')
    },
  })

  const set = (i: number, k: keyof BankLineRow, v: string) => setRows(p => p.map((r, j) => j === i ? { ...r, [k]: v } : r))

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text3)' }}>
            <span className="w-2 h-2 rounded-full" style={{ background: editing ? 'var(--accent)' : 'var(--text3)' }} />
            {editing ? 'Edit mode' : 'View mode'}
          </div>
          {canEdit && (editing ? (
            <div className="flex gap-2">
              <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
              <Button size="sm" variant="secondary" onClick={() => { setRows(toRows()); setEditing(false); setError('') }}>Cancel</Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => setEditing(true)}><Pencil size={13} className="mr-1" /> Edit</Button>
          ))}
        </div>
        {error && <div className="mb-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        <div className="overflow-x-auto rounded-[14px] border border-token">
          <table className="table-premium w-full border-collapse" style={{ minWidth: 820 }}>
            <thead>
              <tr className="text-left border-b border-token">
                {['Bank', 'Temporary Application Number', 'Application Number', 'Approved Loan Amount', 'Remarks']
                  .filter(h => !(isPartner && h === 'Application Number')).map(h => (
                  <th key={h} className="py-3 px-4 text-[10.5px] font-semibold uppercase" style={{ letterSpacing: '1px', color: 'var(--text3)' }}>{h}</th>
                ))}
                {editing && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {(editing ? rows : toRows()).length === 0 ? (
                <tr><td colSpan={(isPartner ? 4 : 5) + (editing ? 1 : 0)} className="py-8 text-center text-sm" style={{ color: 'var(--text3)' }}>No lender lines yet.</td></tr>
              ) : (editing ? rows : toRows()).map((r, i) => (
                <tr key={r.id ?? i} className="border-b border-token last:border-0">
                  {editing ? (<>
                    <td className="p-2"><input className="w-full border border-gray-300 rounded px-2 py-1 text-sm" value={r.bankName} onChange={e => set(i, 'bankName', e.target.value)} placeholder="Bank / NBFC" /></td>
                    <td className="p-2"><input className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono" value={r.tempApplicationNumber} onChange={e => set(i, 'tempApplicationNumber', e.target.value)} /></td>
                    {!isPartner && <td className="p-2"><input className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono" value={r.applicationNumber} onChange={e => set(i, 'applicationNumber', e.target.value)} /></td>}
                    <td className="p-2"><input className="w-full border border-gray-300 rounded px-2 py-1 text-sm text-right" value={r.approvedLoan} onChange={e => set(i, 'approvedLoan', e.target.value)} /></td>
                    <td className="p-2"><input className="w-full border border-gray-300 rounded px-2 py-1 text-sm" value={r.remarks} onChange={e => set(i, 'remarks', e.target.value)} /></td>
                    <td className="p-2 text-center"><button onClick={() => setRows(p => p.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500"><Trash2 size={14} /></button></td>
                  </>) : (<>
                    <td className="py-3 px-4 font-medium" style={{ color: 'var(--text)' }}>{r.bankName || '—'}</td>
                    <td className="py-3 px-4 font-mono text-xs" style={{ color: 'var(--text2)' }}>{r.tempApplicationNumber || '—'}</td>
                    {!isPartner && <td className="py-3 px-4 font-mono text-xs" style={{ color: 'var(--text2)' }}>{r.applicationNumber || '—'}</td>}
                    <td className="py-3 px-4 font-mono tabular-nums text-right">{r.approvedLoan ? formatCurrency(Number(r.approvedLoan)) : '0'}</td>
                    <td className="py-3 px-4 text-xs" style={{ color: 'var(--text3)' }}>{r.remarks || '—'}</td>
                  </>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editing && (
          <button onClick={() => setRows(p => [...p, { ...EMPTY_BANK_ROW }])}
            className="mt-3 text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--accent)' }}>
            <Plus size={13} /> Add lender line
          </button>
        )}
      </Card>

      {/* Disbursement Pre-Conditions — legacy checklist. Actions live in the
          Timeline tab (NACH / Customer Agreement / checks); this mirrors the
          status shown in Vanilla's Lender Details panel. */}
      <Card>
        <CardHeader
          title={<><span className="section-icon-badge">🔒</span> Disbursement Pre-Conditions</>}
          action={<span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: pendingCount ? 'rgba(230,126,0,.14)' : 'rgba(0,212,170,.15)', color: pendingCount ? 'var(--warn)' : 'var(--accent2)' }}>{pendingCount ? `${pendingCount} Pending` : 'All Done'}</span>}
        />
        <div className="space-y-2.5">
          {preconds.map(p => (
            <div key={p.label} className="flex items-center gap-3 py-2 px-3 rounded-lg" style={{ background: 'var(--surface2)' }}>
              <span>{p.done ? '✅' : '⏳'}</span>
              <div className="flex-1">
                <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{p.label}</p>
                <p className="text-xs" style={{ color: 'var(--text3)' }}>{p.note}</p>
              </div>
              <span className="text-[11px] font-bold" style={{ color: p.done ? 'var(--accent2)' : 'var(--warn)' }}>{p.done ? 'Done' : 'Pending'}</span>
            </div>
          ))}
          <p className="text-[11px] pt-1" style={{ color: 'var(--text3)' }}>Complete these from the Timeline tab's action bar (NACH, Customer Agreement, checks).</p>
        </div>
      </Card>
    </div>
  )
}

function BankIncredTabs({ loan }: { loan: Loan }) {
  const loanId = loan.id
  const [tab, setTab] = useState<'bank' | 'incred' | 'lenderEmail'>('bank')

  // Tab visibility now honours the Settings → Roles & Permissions editor,
  // the same way legacy's applyTabVisibility() did. Previously these tabs
  // were always shown regardless of what an admin had toggled off.
  const canBank        = useHasPermission('canTabLenderDetails')
  const canIncred      = useHasPermission('canViewIncred')

  // Vanilla's Lender Details tab has only Bank Details + InCred sub-tabs
  // (index.html); the LENDER EMAIL section lives in the Timeline tab instead.
  // The former 'lenderEmail' sub-tab here was React-only — removed; the
  // LenderEmailCard now renders in the Timeline tab (see LoanDetailPage).
  // Emoji (not lucide icons) to match the target look exactly — same
  // convention as the outer detail tab bar's 🏦/📋/👤 etc: an emoji keeps its
  // own color regardless of active state (InCred's ⚡ stays orange even when
  // it isn't the selected sub-tab), which a recolored icon component can't do.
  const tabs = [
    { key: 'bank' as const, label: 'Loan Source', emoji: '🏦', allowed: canBank },
    // U+FE0F forces the coloured emoji glyph; without it ⚡ can render as a
    // plain text glyph in the tab's grey instead of orange.
    { key: 'incred' as const, label: 'InCred', emoji: '\u26A1\uFE0F', allowed: canIncred },
  ].filter(t => t.allowed)

  // If the active tab just got hidden, fall back to the first visible one.
  const activeTab = tabs.some(t => t.key === tab) ? tab : tabs[0]?.key

  if (tabs.length === 0) {
    return (
      <Card>
        <p className="text-sm text-gray-500 py-6 text-center">
          🔒 Your role does not have access to lender details.
        </p>
      </Card>
    )
  }

  return (
    <div className="px-8 pt-2">
      <SubTabBar tabs={tabs} active={activeTab} onChange={setTab} />

      {activeTab === 'incred' ? (
        <Suspense fallback={<LoadingSpinner />}><IncredTab loanId={loanId} loan={loan} /></Suspense>
      ) : (
        // Vanilla's Bank Details panel = the per-bank lender-processing table
        // (BankLinesCard) + Disbursement Pre-Conditions. The bank-statement
        // account-extraction card (AccountDetailsCard) was removed from this
        // tab — Perfios report itself lives under Reports, not duplicated here.
        <div className="space-y-6">
          <BankLinesCard loan={loan} />
        </div>
      )}
    </div>
  )
}

// ── Tasks tab — Vanilla's #tab-tasks-tab (efin-app.js): a loan-scoped task
// assignment list with a "Task Assignments" header (Pending/Done counts +
// Assign Task) and an empty state. Reuses the existing tasksApi rather than
// duplicating the /tasks page's own logic. ──────────────────────────────
function LoanTasksTab({ loanId }: { loanId: number }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: tasks, isLoading } = useQuery({
    queryKey: ['tasks', 'loan', loanId],
    queryFn: () => tasksApi.getAll({ loanId }).then(r => r.data.data ?? []),
  })
  const toggle = useMutation({
    mutationFn: (id: number) => tasksApi.toggleComplete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', 'loan', loanId] }),
  })
  const list = tasks ?? []
  const pending = list.filter(t => !t.isCompleted).length
  const done = list.filter(t => t.isCompleted).length
  return (
    <Card>
      <div className="flex items-center gap-2.5 flex-wrap mb-4 rounded-2xl px-4 py-3.5"
        style={{ background: 'linear-gradient(135deg,#eef4ff,#e8f0fe)', border: '1.5px solid #c8d8f8' }}>
        <span style={{ fontSize: 20 }}>📋</span>
        <div style={{ fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>Task Assignments</div>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(230,126,0,.12)', color: 'var(--warn)' }}>{pending} Pending</span>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(26,115,64,.1)', color: 'var(--success)' }}>{done} Done</span>
        <Button size="sm" className="ml-auto" onClick={() => navigate('/tasks')}>＋ Assign Task</Button>
      </div>
      {isLoading ? <LoadingSpinner /> : list.length === 0 ? (
        <div className="text-center py-10">
          <div style={{ fontSize: 30 }}>📋</div>
          <p className="text-sm font-semibold mt-2" style={{ color: 'var(--text)' }}>No Tasks Yet</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>Assign the first task to get started</p>
          <Button size="sm" className="mt-3" onClick={() => navigate('/tasks')}>＋ Assign First Task</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map(t => (
            <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg border" style={{ borderColor: 'var(--border)' }}>
              <input type="checkbox" checked={t.isCompleted} disabled={t.isPaused && !t.isCompleted} onChange={() => toggle.mutate(t.id)} aria-label={`Complete ${t.title}`}
                title={t.isPaused && !t.isCompleted ? 'Paused — the application is on hold' : undefined} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${t.isCompleted ? 'line-through opacity-60' : ''}`} style={{ color: 'var(--text)' }}>{t.title}</p>
                <p className="text-xs" style={{ color: 'var(--text3)' }}>
                  {t.assignedTo ? `Assigned to ${t.assignedTo}` : 'Unassigned'}{t.dueDate ? ` · due ${formatDate(t.dueDate)}` : ''}
                </p>
                {t.isPaused && !t.isCompleted && <p className="text-xs font-semibold" style={{ color: 'var(--warn)' }}>⏸ Paused{t.pauseReason ? ` — ${t.pauseReason}` : ''}</p>}
              </div>
              <span className="info-pill">{t.priority}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ── Detail tab keys — legacy switchTab() targets, same order ────────────
// overview / personal / address / employment / references / documents /
// lender-details / tracking-tab / reports (index.html #page-app-detail).
type DetailTabKey =
  | 'overview' | 'personal' | 'address' | 'employment' | 'references'
  | 'documents' | 'lender-details' | 'offers' | 'tracking' | 'reports'
  | 'tasks' | 'obligations'

// ── Reports tab ─────────────────────────────────────────────────────────
// Legacy files the Perfios report under Reports > Perfios Report
// (switchReportsSubTab('perfios'), index.html #reports-subtab-perfios).
// PerfiosReportCard and PerfiosWorkflow existed in this file but were never
// rendered anywhere after the page was flattened — the whole Perfios surface
// was unreachable. This tab is where they belong and where they now live.
// Vanilla's Reports tab (index.html #tab-reports) holds the Perfios report, the
// CIBIL report and "Other Info" (team & assignment). The backend-persisted
// income-verification result is derived from the Perfios bank-statement
// analysis, so it sits with the Perfios report; Team & Assignment sits under
// Other Info — Vanilla hides both from the Overview
// (efin-app.js renderDetailOtherInfo / "Hidden from Overview").
function ReportsPanel({ loan }: { loan: Loan }) {
  const loanId = loan.id
  const [sub, setSub] = useState<'perfios' | 'cibil' | 'other-info'>('perfios')
  const navigate = useNavigate()
  // Same gate the income panel had on the Overview (Vanilla rd.canViewBanks).
  const canViewBanks = useHasPermission('canViewBanks')

  const subs = [
    { key: 'perfios' as const, label: 'Perfios Report' },
    { key: 'cibil' as const, label: 'CIBIL Report' },
    { key: 'other-info' as const, label: 'Other Info' },
  ]

  return (
    <div>
      <SubTabBar tabs={subs} active={sub} onChange={setSub} />

      {sub === 'other-info' ? (
        <LoanAssignmentCard loan={loan} />
      ) : sub === 'perfios' ? (
        <div className="space-y-5">
          <PerfiosReportCard loanId={loanId} />
          {/* Backend-authoritative income verification — persisted engine result
              (state, month-by-month evidence, verified income, manual review). */}
          {canViewBanks && <IncomeVerificationPanel loanId={loanId} />}
          <Card>
            <CardHeader title="Analyse a Bank Statement" subtitle="Upload a statement to run a fresh Perfios analysis" />
            <Suspense fallback={<LoadingSpinner />}><PerfiosWorkflow loanId={loanId} /></Suspense>
          </Card>
        </div>
      ) : (
        <Card>
          <CardHeader title="CIBIL Credit Report" />
          <p className="text-sm text-gray-500 mb-4">
            The full bureau report opens on the CIBIL page, where the pull is run against the customer's PAN.
          </p>
          <Button size="sm" variant="secondary" onClick={() => navigate('/cibil')}>
            Open CIBIL Check
          </Button>
        </Card>
      )}
    </div>
  )
}


// ── Perfios bank-statement verification (read-only summary) ─────────────────
// Displays the latest saved Perfios report for this loan via
// PerfiosController's GetLatest. This card is intentionally read-only —
// the upload/parse/analyse step that PRODUCES a report lives in the
// PerfiosWorkflow tab rendered a few lines below (the "Analyse a Bank
// Statement" panel), which is a full React-native re-implementation of
// legacy's client-side engine (wwwroot/perfios/js/perfios-core.js) under
// utils/perfios/{pdf,parser,categorizer,calculations,analysis}.ts, driven
// by hooks/usePerfiosUpload.ts and PerfiosUpload/PerfiosAnalysisResults.
// That flow calls perfiosApi.save() on completion, which is what this
// card then reads back via GetLatest. (An earlier version of this comment
// said the upload step was not reproduced; that stopped being true once
// the utils/perfios engine and PerfiosWorkflow were added — left as a
// straight correction rather than a silent edit.)
function PerfiosReportCard({ loanId }: { loanId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['perfiosReport', loanId],
    queryFn: () => perfiosApi.getLatest(loanId).then(r => r.data.data),
  })

  // Re-hydrate the COMPLETE saved report (all transactions, ABB grid,
  // category buckets, validation checks, account header) from the persisted
  // JSON, so Reports > Perfios Report shows the whole report the backend
  // stored — and it survives a refresh / opening on another device, exactly
  // like the live analysis did. Falls back to null (→ summary card below)
  // for legacy rows saved before full-report persistence, or if the blob is
  // somehow unreadable.
  const fullResult = useMemo(
    () => deserializePerfiosReport(data?.reportDataJson),
    [data?.reportDataJson],
  )

  if (isLoading) {
    return (
      <Card>
        <CardHeader title="Bank Statement Verification (Perfios)" subtitle="Most recent verified bank-statement analysis for this loan" />
        <SkeletonText lines={3} className="py-2" />
      </Card>
    )
  }

  if (!data) {
    return (
      <Card>
        <CardHeader title="Bank Statement Verification (Perfios)" subtitle="Most recent verified bank-statement analysis for this loan" />
        <p className="text-sm text-gray-400 py-4">No bank-statement verification recorded for this loan yet.</p>
      </Card>
    )
  }

  // Full report available → render the same rich, tabbed report the live run
  // shows, read-only (it is already saved). A slim provenance line names the
  // file + when it was verified.
  if (fullResult) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-gray-500">
          Saved Perfios report{data.fileName ? ` · ${data.fileName}` : ''} · Verified {formatDateTime(data.verifiedAt)}
        </p>
        <Suspense fallback={<LoadingSpinner />}>
          <PerfiosAnalysisResults result={fullResult} loanId={loanId} onReset={() => { /* no-op: reload the tab to re-run */ }} readOnly />
        </Suspense>
      </div>
    )
  }

  // Legacy summary-only row (no stored full payload) → keep the compact card.
  return (
    <Card>
      <CardHeader title="Bank Statement Verification (Perfios)" subtitle="Most recent verified bank-statement analysis for this loan" />
      <div>
        <div className="flex items-center gap-2 mb-3">
          <FileCheck size={16} className={data.isValid ? 'text-green-600' : 'text-yellow-600'} />
          <span className={`text-sm font-semibold ${data.isValid ? 'text-green-700' : 'text-yellow-700'}`}>
            {data.isValid ? 'Valid' : 'Needs Review'}{data.manualReviewRequired ? ' · Manual Review Required' : ''}
          </span>
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm">
          <div><dt className="text-gray-400 text-xs">File</dt><dd className="text-gray-800">{data.fileName || '—'}</dd></div>
          <div><dt className="text-gray-400 text-xs">Average Balance</dt><dd className="text-gray-800">{data.averageBankBalance != null ? formatCurrency(Number(data.averageBankBalance)) : '—'}</dd></div>
          <div><dt className="text-gray-400 text-xs">Span</dt><dd className="text-gray-800">{data.span || '—'}</dd></div>
          <div><dt className="text-gray-400 text-xs">Total Transactions</dt><dd className="text-gray-800">{data.totalTransactions ?? '—'}</dd></div>
          <div><dt className="text-gray-400 text-xs">Salary Detected</dt><dd className="text-gray-800">{data.hasSalary ? 'Yes' : 'No'}</dd></div>
          <div><dt className="text-gray-400 text-xs">Stale Days</dt><dd className="text-gray-800">{data.staleDays ?? '—'}</dd></div>
          <div><dt className="text-gray-400 text-xs">First Transaction</dt><dd className="text-gray-800">{data.firstTransactionDate || '—'}</dd></div>
          <div><dt className="text-gray-400 text-xs">Last Transaction</dt><dd className="text-gray-800">{data.lastTransactionDate || '—'}</dd></div>
          <div><dt className="text-gray-400 text-xs">Verified At</dt><dd className="text-gray-800">{formatDateTime(data.verifiedAt)}</dd></div>
        </dl>
      </div>
    </Card>
  )
}

export default function LoanDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: loan, isLoading } = useLoan(Number(id))
  // Lead Source (wizard Step 1, Online channel only) rides Loan.ProductDataJson
  // like the other extra wizard fields — it was never part of the Remarks
  // string, so the "Lead Source" row below was parsing a segment
  // (`fromRemarks(loan.remarks, 'LeadSource')`) that the backend never writes,
  // always showing "—". Read it from productDataJson instead, the same place
  // the wizard actually saves it.
  const overviewProductData = useMemo<Record<string, string>>(() => {
    try { return loan?.productDataJson ? JSON.parse(loan.productDataJson) : {} }
    catch { return {} }
  }, [loan?.productDataJson])
  const user = useAuthStore(s => s.user)
  const [actionError, setActionError] = useState('')
  const [pendingAction, setPendingAction] = useState<HeaderAction | null>(null)
  const [actionReason, setActionReason] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [deleteCustomerOpen, setDeleteCustomerOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  // Escape closes the header "More" menu (the backdrop handles outside clicks).
  useEffect(() => {
    if (!moreOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moreOpen])

  // ── Detail tabs ───────────────────────────────────────────────────────
  // Restores legacy's nine-tab navigation on the application detail page
  // (index.html #page-app-detail, switchTab()). The page had been flattened
  // into one long scroll, which moved every section out of the place users
  // reach it from. Same tab keys, same order, same labels as legacy.
  const [tab, setTab] = useState<DetailTabKey>('overview')

  // Permission-driven gating (Settings → Roles & Permissions).
  const canDocumentsTab = useHasPermission('canTabDocuments')
  // Legacy gates each tab through applyTabVisibility(); these are the same
  // permission keys the Roles & Permissions editor already writes.
  const canOverviewTab   = useHasPermission('canTabOverview')
  const canPersonalTab   = useHasPermission('canTabPersonal')
  const canAddressTab    = useHasPermission('canTabAddress')
  const canEmploymentTab = useHasPermission('canTabEmployment')
  const canReferencesTab = useHasPermission('canTabReferences')
  const canLenderTab     = useHasPermission('canTabLenderDetails')
  const canTimelineTab   = useHasPermission('canTabTimeline')
  const canReportsTab    = useHasPermission('canTabReports')
  const canObligationsTab = useHasPermission('canTabObligations')
  // Offers = this application's lender offers → deviation → credit approval →
  // sanction → disbursement. Separate from Lender Details (lender master /
  // processing lines), never stored there.
  const canOffersTab     = useHasPermission('canTabOffers')
  // Vanilla gates the Overview verification-check badges (Doc/Income/Bank/ECS/
  // FI) on rd.canViewBanks (efin-app.js:2495) — external/limited roles don't
  // see internal processing flags. React previously showed them to everyone.
  const canViewBanks     = useHasPermission('canViewBanks')
  // Legacy hides the Timeline "Checks:" status row for external roles
  // (efin-app.js:3161: partner / dsa_user get no check badges). useCurrentRole
  // returns the backend PascalCase role, so match 'Partner' / 'Dsa'.
  const currentRole = useCurrentRole()
  const showTimelineChecks = currentRole !== 'Partner' && currentRole !== 'Dsa'

  // Legacy's tab order and labels verbatim (index.html #page-app-detail).
  // A tab the role can't see is dropped from the bar entirely, matching
  // applyTabVisibility(); Documents additionally reuses canTabDocuments,
  // which already gated the card before this change.
  // Emoji match Vanilla's loan-detail tab bar (index.html #edit-detail-tabs
  // + the detail view's switchTab labels): 📋 👤 🏠 💼 🤝 📁 🏦 🔵 📊.
  const detailTabs: { key: DetailTabKey; label: string; emoji: string; allowed: boolean }[] = [
    { key: 'overview',       label: 'Overview',         emoji: '📋', allowed: canOverviewTab },
    { key: 'personal',       label: 'Personal Details', emoji: '👤', allowed: canPersonalTab },
    { key: 'address',        label: 'Address',          emoji: '🏠', allowed: canAddressTab },
    { key: 'employment',     label: 'Employment',       emoji: '💼', allowed: canEmploymentTab },
    { key: 'references',     label: 'References',       emoji: '🤝', allowed: canReferencesTab },
    { key: 'documents',      label: 'Documents',        emoji: '📁', allowed: canDocumentsTab },
    { key: 'lender-details', label: 'Lender Details',   emoji: '🏦', allowed: canLenderTab },
    { key: 'offers',         label: 'Offers',           emoji: '📑', allowed: canOffersTab },
    { key: 'tracking',       label: 'Timeline',         emoji: '🔵', allowed: canTimelineTab },
    { key: 'reports',        label: 'Reports',          emoji: '📊', allowed: canReportsTab },
    // Vanilla has Tasks + Obligations as their own top-level detail tabs
    // (index.html #tab-tasks-tab / #tab-obligations-tab). Obligations reuses
    // the existing ObligationsTab (FOIR engine); Tasks reuses tasksApi.
    { key: 'tasks',          label: 'Tasks',            emoji: '📌', allowed: true },
    { key: 'obligations',    label: 'Obligations',      emoji: '💳', allowed: canObligationsTab },
  ]
  const visibleTabs = detailTabs.filter(t => t.allowed)
  // If the selected tab is hidden for this role, fall back to the first one
  // that isn't — never render an empty page.
  const activeDetailTab = visibleTabs.some(t => t.key === tab) ? tab : visibleTabs[0]?.key
  const canChangeStatus = useHasPermission('canChangeStatus')
  const canRejectApp    = useHasPermission('canRejectApp')
  const canHoldApp      = useHasPermission('canHoldApp')
  const closeAction = () => { setPendingAction(null); setActionReason(''); setActionError('') }

  // Header actions → each hits its own dedicated backend endpoint (unchanged):
  // PATCH /reject, /hold, /unhold and the Admin-only /reopen (backend enforces
  // the 45-day-from-creation window and restores the pre-rejection stage).
  const workflow = useMutation({
    mutationFn: async ({ label, loanId, reason }: { label: HeaderAction; loanId: number; reason: string }) => {
      switch (label) {
        case 'Reject':  return loansApi.reject(loanId, { reason: reason || undefined })
        case 'Hold':    return loansApi.hold(loanId, reason)
        case 'Un-hold': return loansApi.unhold(loanId, reason || undefined)
        case 'Re-open': return loansApi.reopen(loanId, reason)
        case 'Archive': return loansApi.archive(loanId, reason)
      }
    },
    onSuccess: () => {
      closeAction()
      qc.invalidateQueries({ queryKey: LOAN_KEYS.detail(Number(id)) })
      qc.invalidateQueries({ queryKey: ['loans'] })
      // Reject / hold / un-hold / re-open cascade server-side into the offer
      // workflow (deviations, sanction) and the application's tasks (pause, close).
      qc.invalidateQueries({ queryKey: workflowKey(Number(id)) })
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (err: unknown) => {
      const d = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      setActionError(d?.message || d?.errors?.join(' ') || 'This action could not be completed.')
    },
  })

  // The lender the application is actually going with: the active sanction's
  // lender, else the selected final offer's. Falls back to the first Lender
  // Details (bank) line before any offer is final.
  const { data: offerWorkflow } = useQuery({
    queryKey: workflowKey(Number(id)),
    queryFn: () => offerWorkflowApi.get(Number(id)).then(r => r.data.data ?? null),
    enabled: !!loan && ['Offer', 'Decision', 'Approved', 'Acceptance', 'Disbursed', 'Closed'].includes(loan.status),
    staleTime: 30_000,
  })
  const workflowLender = offerWorkflow?.sanctions.find(s => s.status === 'Active')?.lenderName
    ?? offerWorkflow?.offers.find(o => o.status === 'Final')?.lenderName

  if (isLoading) return <PageLoader />
  if (!loan) return <div className="p-8 text-center text-gray-500">Loan not found</div>

  // Header-action role gate. The status/permission routes these call are
  // [Authorize(Roles="Admin,Manager,LoginTeam,TeamLeader,LocationHead,
  // OperationManager")] on LoansController, so only those roles are offered
  // the buttons (Accounts / ProductTeam are authorised elsewhere, not here).
  const canAct = ['Admin', 'Manager', 'LoginTeam', 'TeamLeader', 'LocationHead', 'OperationManager']
    .includes(user?.role ?? '')

  // Re-open is Admin-only on the backend (PATCH /reopen); the UI mirrors that.
  const isAdmin = user?.role === 'Admin'

  // Reject — same stages the old Actions card offered it at, still gated on
  // the Roles & Permissions canRejectApp flag.
  const canReject = canAct && canRejectApp
    && ['Draft', 'Submitted', 'UnderReview', 'Offer', 'Decision', 'Approved', 'Acceptance'].includes(loan.status)

  // Hold / Un-hold — gated on canHoldApp (Roles & Permissions matrix) on top
  // of the same canAct role gate the transitions use, and on the loan's own
  // state: Hold only from an in-flight status, Un-hold only when held. The
  // backend enforces all of this independently (LoansController.Hold/Unhold).
  const canHold   = canAct && canHoldApp && ['Submitted', 'UnderReview', 'Offer', 'Decision', 'Approved', 'Acceptance'].includes(loan.status)
  const canUnhold = canAct && canHoldApp && loan.status === 'OnHold'

  // Re-open window (45 days from creation) — same rule the old Re-open card
  // showed; the backend re-enforces it.
  const reopenDaysElapsed = (Date.now() - new Date(loan.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  const reopenDaysLeft = Math.max(0, Math.ceil(45 - reopenDaysElapsed))
  // An archived application is final (no unarchive) — the backend refuses a
  // re-open, so the button isn't offered.
  const showReopen = isAdmin && loan.status === 'Rejected' && !loan.isArchived
  const reopenExpired = showReopen && reopenDaysElapsed > 45

  // Archive — only closed/rejected applications (the backend refuses an
  // active one with 409), only the roles PATCH /archive authorises.
  const canArchive = ARCHIVE_ROLES.includes(user?.role ?? '') && !loan.isArchived
    && (loan.status === 'Rejected' || loan.status === 'Closed')

  const copyLoanNumber = async () => {
    try {
      await navigator.clipboard.writeText(loan.loanNumber)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch { /* clipboard blocked — nothing to do */ }
  }

  // Header key facts — straight from the loan; Lender shows a muted
  // placeholder until one is assigned, the rest are hidden when empty.
  const tip = employmentTip(loan.customer.employmentType)
  const salesPerson = loan.assignedTo?.fullName ?? loan.createdBy?.fullName
  const lender = workflowLender ?? loan.bankLines?.[0]?.bankName
  const headerFacts: { label: string; value: string; muted?: boolean }[] = [
    { label: 'Requested amount', value: formatCurrency(loan.requestedAmount) },
    ...(loan.approvedAmount ? [{ label: 'Approved amount', value: formatCurrency(loan.approvedAmount) }] : []),
    { label: 'Lender', value: lender || 'Not assigned yet', muted: !lender },
    ...(salesPerson ? [{ label: 'Sales person', value: salesPerson }] : []),
    { label: 'Created', value: formatDate(loan.createdAt) },
  ]

  const openAction = (a: HeaderAction) => { setMoreOpen(false); setActionError(''); setActionReason(''); setPendingAction(a) }

  return (
    <div className="space-y-6">
      {/* ── Loan header ─────────────────────────────────────────────────
             Row 1: Back on the left, every action grouped on the right
                    (Raise Ticket · Un-hold / Re-open · More menu).
             Row 2: loan id (click-to-copy) + status, then loan type and
                    applicant.
             Row 3: key facts at a glance (amount, lender, sales person,
                    created) — read straight from the loan, empty ones hidden.
             Row 4: employment verification hint (Vanilla's header empNote).
             All handlers and permission gates are unchanged. */}
      <header className="relative bg-surface rounded-[18px] border border-token px-5 py-3.5 md:px-6 md:py-4" style={{ boxShadow: '0 2px 12px rgba(10,88,154,.05)' }}>
        {/* Row: Back (left) · ID + status + applicant (centre-left) · actions (right) — all on one line */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button onClick={() => navigate(-1)}
            className="-ml-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold transition-colors hover:bg-[color:var(--surface2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
            style={{ color: 'var(--text2)' }}>
            <ArrowLeft size={16} /> Back
          </button>

          {/* Identity — loan number + copy + status inline, applicant below */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="break-all text-xl md:text-2xl font-black leading-tight"
                style={{ fontFamily: 'var(--font-head)', color: 'var(--text)', letterSpacing: '-.4px' }}>
                {loan.loanNumber}
              </h1>
              <button type="button" onClick={copyLoanNumber}
                aria-label={copied ? 'Application ID copied' : 'Copy application ID'} title={copied ? 'Copied' : 'Copy application ID'}
                className="grid h-6 w-6 place-items-center rounded-lg border border-token transition-colors hover:bg-[color:var(--surface2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
                style={{ color: copied ? 'var(--success)' : 'var(--text3)' }}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
              <StatusBadge status={loan.status} />
              {loan.isArchived && (
                <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold"
                  style={{ background: 'var(--surface2)', color: 'var(--text2)' }}>
                  <Archive size={12} /> Archived
                </span>
              )}
            </div>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="rounded-md px-2 py-0.5 text-xs font-semibold" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
                {loan.loanType} Loan
              </span>
              <span className="font-semibold" style={{ color: 'var(--text2)' }}>{loan.customer.fullName}</span>
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            {/* Raise Ticket — parity with legacy openRaiseTicketFromApp
                (efin-app.js:7805): a helpdesk ticket pre-linked to this loan. */}
            <Button size="sm" variant="secondary"
              onClick={() => navigate('/tickets', { state: { loanId: loan.id, loanNumber: loan.loanNumber, applicantName: loan.customer?.fullName } })}>
              <LifeBuoy size={14} className="mr-1.5" />Raise Ticket
            </Button>
            {canUnhold && (
              <Button size="sm" variant="primary" onClick={() => openAction('Un-hold')}>
                <PlayCircle size={14} className="mr-1.5" />Un-hold
              </Button>
            )}
            {showReopen && !reopenExpired && (
              <Button size="sm" variant="primary" onClick={() => openAction('Re-open')}
                title={`${reopenDaysLeft} day${reopenDaysLeft === 1 ? '' : 's'} remaining to re-open`}>
                <RotateCcw size={14} className="mr-1.5" />Re-open ({reopenDaysLeft}d left)
              </Button>
            )}
            {reopenExpired && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-token px-3 py-1.5 text-xs" style={{ color: 'var(--text3)', background: 'var(--surface2)' }}>
                <Lock size={12} /> Re-open window expired
              </span>
            )}
            {(canHold || canReject || canArchive || isAdmin) && (
              <div className="relative">
                <Button size="sm" variant="secondary" aria-haspopup="menu" aria-expanded={moreOpen}
                  onClick={() => setMoreOpen(o => !o)}>
                  <Ellipsis size={15} className="mr-1.5" />More
                  <ChevronDown size={13} className={`ml-1 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
                </Button>
                {moreOpen && (
                  <>
                    <button type="button" aria-label="Close menu" tabIndex={-1} className="fixed inset-0 z-20 cursor-default" onClick={() => setMoreOpen(false)} />
                    <div role="menu" className="absolute right-0 top-full z-30 mt-2 w-[270px] max-w-[calc(100vw-2rem)] rounded-2xl border border-token bg-surface p-1.5"
                      style={{ boxShadow: '0 14px 36px rgba(10,40,90,.16), 0 2px 6px rgba(10,40,90,.06)' }}>
                      {(canHold || canReject || canArchive) && (
                        <p className="px-2.5 pb-1 pt-1.5 text-[11.5px] font-semibold" style={{ color: 'var(--text3)' }}>Application</p>
                      )}
                      {canHold && (
                        <button type="button" role="menuitem" onClick={() => openAction('Hold')}
                          className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-[color:var(--surface2)] focus:outline-none focus-visible:bg-[color:var(--surface2)]">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: 'rgba(230,126,0,.12)', color: 'var(--warn)' }}>
                            <PauseCircle size={16} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold" style={{ color: 'var(--text)' }}>Put on Hold</span>
                            <span className="block text-[11.5px] leading-snug" style={{ color: 'var(--text3)' }}>Pause it now, un-hold it later</span>
                          </span>
                        </button>
                      )}
                      {canReject && (
                        <button type="button" role="menuitem" onClick={() => openAction('Reject')}
                          className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-[color:var(--surface2)] focus:outline-none focus-visible:bg-[color:var(--surface2)]">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: 'rgba(227,30,37,.09)', color: 'var(--danger, #e31e25)' }}>
                            <XCircle size={16} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold" style={{ color: 'var(--text)' }}>Reject Application</span>
                            <span className="block text-[11.5px] leading-snug" style={{ color: 'var(--text3)' }}>Can be re-opened within 45 days</span>
                          </span>
                        </button>
                      )}
                      {canArchive && (
                        <button type="button" role="menuitem" onClick={() => openAction('Archive')}
                          className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-[color:var(--surface2)] focus:outline-none focus-visible:bg-[color:var(--surface2)]">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: 'var(--surface2)', color: 'var(--text2)' }}>
                            <Archive size={16} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold" style={{ color: 'var(--text)' }}>Archive Application</span>
                            <span className="block text-[11.5px] leading-snug" style={{ color: 'var(--text3)' }}>Hide from active lists — history is kept</span>
                          </span>
                        </button>
                      )}
                      {/* Permanent customer delete — Admin only, same as DELETE /api/customers/{id}. */}
                      {isAdmin && (<>
                        <div className="my-1.5 border-t border-token" />
                        <p className="px-2.5 pb-1 pt-0.5 text-[11.5px] font-semibold" style={{ color: 'var(--text3)' }}>Customer</p>
                        <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); setDeleteCustomerOpen(true) }}
                          className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-[color:var(--surface2)] focus:outline-none focus-visible:bg-[color:var(--surface2)]">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: 'rgba(227,30,37,.09)', color: 'var(--danger, #e31e25)' }}>
                            <Trash2 size={15} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold" style={{ color: 'var(--danger, #e31e25)' }}>Delete customer permanently</span>
                            <span className="block text-[11.5px] leading-snug" style={{ color: 'var(--text3)' }}>Admin only — this can't be undone</span>
                          </span>
                        </button>
                      </>)}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Key facts */}
        {headerFacts.length > 0 && (
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t border-token pt-3">
            {headerFacts.map(f => (
              <div key={f.label} className="min-w-[100px]">
                <dt className="text-[11px] font-medium" style={{ color: 'var(--text3)' }}>{f.label}</dt>
                <dd className="mt-0 text-sm font-bold" style={{ color: f.muted ? 'var(--text3)' : 'var(--text)' }}>{f.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {/* Archived — who / when / why, straight from the loan record. */}
        {loan.isArchived && (
          <div className="mt-2.5 flex items-start gap-2.5 rounded-lg py-1.5 pl-3 pr-4 text-[12.5px]"
            style={{ background: 'var(--surface2)', borderLeft: '3px solid var(--text3)', color: 'var(--text2)' }}>
            <Archive size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--text3)' }} />
            <span>
              <strong style={{ color: 'var(--text)' }}>Archived</strong>
              {loan.archivedAt ? ` on ${formatDate(loan.archivedAt)}` : ''}
              {loan.archivedByName ? ` by ${loan.archivedByName}` : ''}
              {loan.archiveReason ? ` — ${loan.archiveReason}` : ''}
            </span>
          </div>
        )}

        {/* Employment tip — Vanilla's header empNote (efin-app.js:27179),
            keyed by the applicant's employment type. */}
        {tip && (
          <div className="mt-2.5 flex items-center gap-2.5 rounded-lg py-1.5 pl-3 pr-4 text-[12.5px]"
            style={{ background: 'var(--accent-subtle)', borderLeft: '3px solid var(--accent)', color: 'var(--text2)' }}>
            <Lightbulb size={14} className="shrink-0" style={{ color: 'var(--accent)' }} />
            <span>
              {tip.includes(':')
                ? <><strong style={{ color: 'var(--text)' }}>{tip.slice(0, tip.indexOf(':') + 1)}</strong>{tip.slice(tip.indexOf(':') + 1)}</>
                : tip}
            </span>
          </div>
        )}
      </header>

      {deleteCustomerOpen && (
        <DeleteCustomerModal
          customerId={loan.customer.id}
          customerName={loan.customer.fullName ?? ''}
          onClose={() => setDeleteCustomerOpen(false)}
          onDeleted={() => { setDeleteCustomerOpen(false); navigate('/loans', { replace: true }) }}
        />
      )}

      {/* ── Tab bar — legacy #page-app-detail switchTab(), same nine tabs,
             same order and labels. Hidden tabs follow the Roles &
             Permissions editor, exactly like legacy's applyTabVisibility(). */}
      <DetailTabBar tabs={visibleTabs} active={activeDetailTab} onChange={setTab} />

      <div className="grid grid-cols-1 gap-6">
        {/* Main details — one full-width column. Vanilla has no side rail: the
            header action bar (Un-hold / Re-open / More) sits in the loan header
            above and the workflow Actions live in Timeline → Actions. */}
        <div className="space-y-5">
          {activeDetailTab === 'overview' && (<>
          <Card>
            <CardHeader title={<><span className="section-icon-badge"><Wallet size={15} /></span> Loan Details</>} />

            {/* Vanilla's read-only Overview meta grid — same fields, order,
                emoji and "—"/⏳Pending empty states as fieldGrid([...]) at
                efin-app.js:2480. Fields the React DTO doesn't carry (InCred
                RM, verification flags, active time) render "—"/Pending,
                exactly as Vanilla does for a loan with no such data yet. */}
            <div className="detail-fgrid">
              <FVal emoji="🔖" label="Application ID" value={loan.loanNumber} />
              <FVal emoji="🟣" label="Status" node={<StatusBadge status={loan.status} />} />
              <FVal emoji="💰" label="Loan Type" value={`${loan.loanType} Loan`} />
              <FVal emoji="💵" label="Loan Amount" value={formatCurrency(loan.requestedAmount)} />
              <FVal emoji="🏦" label="Bank/NBFC" value={workflowLender ?? loan.bankLines?.[0]?.bankName} />
              {/* Sales Person = the wizard's resolved Sales Person dropdown
                  choice (Loan.AssignedToUserId, ResolveSalesPersonAsync), not
                  whoever physically submitted the form (CreatedByUserId) —
                  those differ whenever one user completes the wizard on
                  another's behalf, which is the entire purpose of that
                  dropdown. assignedTo now takes priority; createdBy is only
                  the fallback for the rare loan with no resolved assignee. */}
              <FVal emoji="👤" label="Sales Person" value={loan.assignedTo?.fullName ?? loan.createdBy?.fullName} />
              <FVal emoji="📅" label="Created" value={formatDate(loan.createdAt)} />
              <FVal emoji="📈" label="Loan Rate" value={loan.interestRate != null ? `${loan.interestRate}%` : undefined} />
              <FVal emoji="⏱️" label="Tenure" value={loan.tenureMonths ? `${loan.tenureMonths} months` : undefined} />
              <FVal emoji="🎯" label="Purpose" value={loan.purpose} />
              <FVal emoji="📡" label="Loan Source" value={fromRemarks(loan.remarks, 'Source')} />
              <FVal emoji="📣" label="Lead Source" value={mapLabel(LEAD_SOURCE_LABELS, overviewProductData.leadsrc)} />
              <FVal emoji="🔗" label="Channel" value={mapLabel(CHANNEL_LABELS, fromRemarks(loan.remarks, 'Channel'))} />
              {/* Channel-conditional rows — verbatim parity with Vanilla
                  efin-app.js:2489-2492: DSA Name + Linked Partner (channel=dsa),
                  Partner / Agent (channel=agent), Sales Person (Direct)
                  (channel=direct). loan.dsaName/partnerName are already carried
                  by LoanDto (resolved from DsaId/PartnerId saved at wizard
                  submit); previously only the direct case was rendered. */}
              {fromRemarks(loan.remarks, 'Channel') === 'dsa' && loan.dsaName && (
                <FVal emoji="🤝" label="DSA Name" value={loan.dsaName} />
              )}
              {fromRemarks(loan.remarks, 'Channel') === 'dsa' && loan.partnerName && (
                <FVal emoji="🔗" label="Linked Partner" value={loan.partnerName} />
              )}
              {fromRemarks(loan.remarks, 'Channel') === 'agent' && loan.partnerName && (
                <FVal emoji="🤝" label="Partner / Agent" value={loan.partnerName} />
              )}
              {fromRemarks(loan.remarks, 'Channel') === 'direct' && (
                <FVal emoji="👤" label="Sales Person (Direct)" value={loan.assignedTo?.fullName ?? loan.createdBy?.fullName} />
              )}
              <FVal emoji="⚡" label="InCred RM" value={loan.incredRmName ?? undefined} />
              <FVal emoji="🏛️" label="Analytic Bank" value={loan.analyticBank ?? undefined} />
              {/* Verification-check badges — Vanilla shows these only when
                  rd.canViewBanks (efin-app.js:2495-2501). */}
              {canViewBanks && <>
                <FVal emoji="📋" label="Doc Checked" node={<CheckBadge done={!!loan.documentChecked} />} />
                <FVal emoji="💹" label="Income Checked" node={<CheckBadge done={!!loan.incomeChecked} />} />
                <FVal emoji="🏦" label="Bank Checked" node={<CheckBadge done={!!loan.bankChecked} />} />
                <FVal emoji="↩️" label="ECS Return" node={<CheckBadge done={!!loan.ecsReturn} />} />
                <FVal emoji="📝" label="FI Report" node={<CheckBadge done={!!loan.fiReportChecked} />} />
              </>}
              {/* Active Time — Vanilla getActiveTimeDisplay(app), efin-app.js:24104. */}
              <FVal emoji="⏳" label="Active Time" value={computeActiveTime(loan)} />
              <FVal emoji="⏸️" label="Hold Reason" value={loan.status === 'OnHold' ? 'On hold — see Timeline' : 'None'} />
              <FVal emoji="❌" label="Rejection Reason" value={loan.status === 'Rejected' ? 'Rejected — see Timeline' : 'None'} />
              <FVal emoji="📅" label="Disbursement Date" value={formatDate(loan.disbursedAt)} />
            </div>
          </Card>

          {/* Approval / Sanction Details — Vanilla renderDetailApproval hides this
              section until the loan has actually reached the Approved/Sanction
              stage. The stage is read from backend-persisted loan data
              (approvedAt / status), never guessed client-side; before that the
              Overview shows Loan Details only. */}
          {hasReachedSanctionStage(loan) && <SanctionDetailCard loan={loan} />}

          </>)}

          {/* Applicant sections — one legacy tab each. LoanApplicantTabs
              already accepts controlledTab and hides its own tab bar when
              driven from outside, so nothing here is duplicated. */}
          {(activeDetailTab === 'personal' || activeDetailTab === 'address'
            || activeDetailTab === 'employment' || activeDetailTab === 'references') && (
            <LoanApplicantTabs loan={loan} controlledTab={activeDetailTab} />
          )}

          {/* Documents */}
          {activeDetailTab === 'documents' && canDocumentsTab && (<>
            <RequiredDocumentsChecklist loanId={loan.id} />
            <LoanDocumentsCard loanId={loan.id} />
          </>)}

          {/* Lender Details — bank rows / InCred / obligations / emails */}
          {activeDetailTab === 'lender-details' && <BankIncredTabs loan={loan} />}

          {/* Offers — lender offers, deviation, credit approval, sanction and
              disbursement (all actions and figures from the API). */}
          {activeDetailTab === 'offers' && canOffersTab && (
            <OffersTab loanId={loan.id} requestedAmount={loan.requestedAmount} tenureMonths={loan.tenureMonths} />
          )}

          {/* Reports — Perfios + CIBIL */}
          {activeDetailTab === 'reports' && <ReportsPanel loan={loan} />}

          {/* Obligations — Vanilla's top-level tab (#tab-obligations-tab):
              the FOIR eligibility engine. Reuses the existing ObligationsTab
              (was a Lender-Details sub-tab). */}
          {activeDetailTab === 'obligations' && <ObligationsTab loanId={loan.id} loan={loan} />}

          {/* Tasks — Vanilla's top-level tab (#tab-tasks-tab): loan-scoped
              task assignments. Reuses tasksApi. */}
          {activeDetailTab === 'tasks' && <LoanTasksTab loanId={loan.id} />}

          {/* Timeline — the full tracking-entries audit trail (legacy's
              renderTrackingSection / #tab-tracking-tab), embedded via
              TrackingPage's embeddedLoanId prop exactly as its own doc
              comment describes. This tab is the tracking table ONLY, matching
              Vanilla 1:1 — the earlier React-only "Status History" list
              (loan.statusHistory) was removed so the tab has no non-Vanilla
              extra; status changes surface as tracking entries here just as
              they do in legacy, and loan.statusHistory itself is untouched. */}
          {activeDetailTab === 'tracking' && (
            <>
              {/* Legacy renderTrackingSection (efin-app.js:3142-3343) renders
                  ONLY: banner → Checks row → LEW bar → .tracking-actions bar →
                  tracking table — nothing else. So the Timeline tab shows just
                  that. TrackingPage owns banner + Checks + table; `actionsSlot`
                  carries the two Vanilla bars that sit between Checks and table:
                  - LenderEmailCard = the LEW bar (Send Enquiry / Log Reply /
                    View Thread / Update RM), post-underwriting stages only
                    (efin-app.js:3171-3211).
                  - LoanVerificationChecks = Vanilla's .tracking-actions bar
                    (Documents / Income / Bank / ECS / FI / NACH / Agreement /
                    Deal). (efin-app.js:3215-3256)
                  The former React-only extras (a Deviation-Check card, an
                  AI-Agent-Runs panel, and the Overview side rail: Actions /
                  Case Info / AI Insight / Admin Stage Override) are not part
                  of Vanilla and have been removed. */}
              <Suspense fallback={<LoadingSpinner />}>
                <TrackingPage
                  embeddedLoanId={loan.id}
                  status={String(loan.status)}
                  locked={['Disbursed', 'Rejected', 'Closed', 'OnHold'].includes(String(loan.status))}
                  checks={showTimelineChecks ? {
                    documentChecked: loan.documentChecked,
                    incomeChecked: loan.incomeChecked,
                    bankChecked: loan.bankChecked,
                    ecsReturn: loan.ecsReturn,
                    fiReportChecked: loan.fiReportChecked,
                  } : null}
                  actionsSlot={
                    <>
                      {/* Legacy hides the whole LEW bar for partner / dsa_user
                          (efin-app.js:3174) — showTimelineChecks is the same
                          Partner/Dsa exclusion, reused here. */}
                      {showTimelineChecks && LENDER_EMAIL_VISIBLE_STAGES.includes(loan.status) && <LenderEmailCard loan={loan} />}
                      <LoanVerificationChecks
                        loanId={loan.id}
                        customerId={loan.customer?.id}
                        customerName={loan.customer?.fullName}
                        customerEmail={loan.customer?.email}
                        employmentType={loan.customer?.employmentType}
                        loanStatus={String(loan.status)}
                        loanType={loan.loanType}
                        canChangeStatus={canChangeStatus}
                        onOpenOffers={canOffersTab ? () => setTab('offers') : undefined}
                        documentChecked={loan.documentChecked}
                        incomeChecked={loan.incomeChecked}
                        bankChecked={loan.bankChecked}
                        ecsReturn={loan.ecsReturn}
                        fiReportChecked={loan.fiReportChecked}
                        nachDone={loan.nachDone}
                        customerAgreementDone={loan.customerAgreementDone}
                      />
                    </>
                  }
                />
              </Suspense>
            </>
          )}
        </div>
      </div>

      {/* Header-action reason dialog (Reject / Hold / Un-hold / Re-open). */}
      {pendingAction && (() => {
        const meta = HEADER_ACTION_META[pendingAction]
        return (
          <Modal open onClose={closeAction} title={meta.title} subtitle={meta.hint} size="sm"
            footer={<>
              <Button size="sm" variant="secondary" onClick={closeAction}>Cancel</Button>
              <Button size="sm" variant={meta.variant}
                loading={workflow.isPending}
                disabled={workflow.isPending || (meta.required && !actionReason.trim())}
                onClick={() => workflow.mutate({ label: pendingAction, loanId: loan.id, reason: actionReason.trim() })}>
                {meta.confirm}
              </Button>
            </>}>
            {actionError && (
              <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{actionError}</div>
            )}
            <textarea value={actionReason} onChange={e => setActionReason(e.target.value)} rows={3}
              placeholder={meta.placeholder} className="efin-input" />
          </Modal>
        )
      })()}
    </div>
  )
}
