import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/api/axios'
import { loansApi } from '@/api/loansApi'
import { banksApi } from '@/api/banksApi'
import { useAuthStore } from '@/store/authStore'
import { useToast } from '@/store/toastStore'
import { useHasPermission } from '@/hooks/usePermissions'
import { LOAN_KEYS } from '@/hooks/useLoans'
import { SimpleActionModal } from '@/components/shared/LoanVerificationChecks'
import type { ApiResponse, Loan } from '@/types'

// ════════════════════════════════════════════════════════════════════════════
// Lender Details → Bank Details panel.
// SOURCE OF TRUTH: Vanilla (LoanMS.API/wwwroot)
//   • markup   — index.html #lender-panel-banks (toolbar + table)
//   • rows     — efin-app.js renderBankBody()            (~line 21033)
//   • edit     — efin-app.js bankDetailsSetEditMode()    (~line 21124)
//   • save     — efin-app.js bankDetailsSave()           (~line 21147)
//   • lines    — efin-app.js addBankLine / removeBankLine / generateTempAppNo (~7840)
//   • checklist— efin-app.js _renderDisburseChecklist()  (~line 39064)
// Behaviour carried over 1:1:
//   – toolbar shown only to roles that may edit (canChangeStatus / admin / login_team)
//   – Edit → snapshot; Cancel → restore snapshot; Save → whole-table PUT
//   – Bank = dropdown of configured banks; Remarks = fixed status dropdown
//   – Temporary Application Number is auto-generated (APP-XXXXXXXX) and read-only
//   – a row can be removed only while more than one line exists
//   – an application with no lines shows one default line (IN PROCESS)
//   – Partner never sees the Application Number column
//   – Disbursement Pre-Conditions with ▶ action buttons / ✓ Done
// ════════════════════════════════════════════════════════════════════════════

type Row = { key: string; bankName: string; tempAppNo: string; applicationNumber: string; approvedLoan: string; remarks: string }

// Vanilla's Remarks <select> options, verbatim (value → label).
const REMARK_OPTIONS: [string, string][] = [
  ['IN PROCESS', 'In Process'], ['Draft', 'Draft'], ['Personal Details', 'Personal Details'],
  ['Recommendation', 'Recommendation'], ['Module', 'Module'], ['Income Verified', 'Income Verified'],
  ['Assign Lender', 'Assign Lender'], ['Underwriting', 'Underwriting'], ['Offer', 'Offer'],
  ['Approved', 'Approved'], ['Deviation', 'Deviation'], ['Approved Deviation', 'Approved Deviation'],
  ['Acceptance', 'Acceptance'], ['Disbursed', 'Disbursed'], ['Hold', 'Hold'], ['Rejected', 'Rejected'],
  ['NI', 'NI'], ['Cancelled', 'Cancelled'],
]

// Roles the backend accepts on PUT /api/loans/{id}/bank-lines (plus canAddBank).
const BACKEND_EDIT_ROLES = ['Admin', 'Manager', 'LoginTeam', 'TeamLeader', 'LocationHead', 'OperationManager', 'Accounts', 'ProductTeam']

// Vanilla generateTempAppNo(): 'APP-' + 8 chars from A–Z0–9, unique among lines.
function generateTempAppNo(existing: Set<string>): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  for (;;) {
    let r = 'APP-'
    for (let i = 0; i < 8; i++) r += chars[Math.floor(Math.random() * chars.length)]
    if (!existing.has(r)) return r
  }
}

function inr(n: number) { return '₹' + Number(n).toLocaleString('en-IN') }

export default function BankDetailsPanel({ loan }: { loan: Loan }) {
  const qc = useQueryClient()
  const toast = useToast()
  const role = useAuthStore(s => s.user?.role) ?? ''
  const isPartner = role === 'Partner'

  const canViewBanks = useHasPermission('canViewBanks')
  const canChangeStatus = useHasPermission('canChangeStatus')
  const canAddBank = useHasPermission('canAddBank')
  const canPostTracking = useHasPermission('canPostTracking')
  // Vanilla canEditRole = rd.canChangeStatus || admin || login_team — intersected
  // with what the API will actually accept, so we never show a button that 403s.
  const canEditRole = (canChangeStatus || role === 'Admin' || role === 'LoginTeam')
    && BACKEND_EDIT_ROLES.includes(role) && canAddBank

  // Vanilla renderBankBody(): no lines → one default line (bank / temp no / IN PROCESS).
  const serverRows = useMemo<Row[]>(() => {
    const lines = loan.bankLines ?? []
    if (lines.length === 0) {
      return [{ key: 'default', bankName: '', tempAppNo: `APP-${loan.loanNumber}`, applicationNumber: '', approvedLoan: '0', remarks: 'IN PROCESS' }]
    }
    return lines.map(l => ({
      key: String(l.id), bankName: l.bankName ?? '', tempAppNo: l.tempApplicationNumber ?? '',
      applicationNumber: l.applicationNumber ?? '', approvedLoan: String(l.approvedLoan ?? 0),
      // api-bridge maps an empty remark to 'IN PROCESS'.
      remarks: l.remarks || 'IN PROCESS',
    }))
  }, [loan.bankLines, loan.loanNumber])

  const [editMode, setEditMode] = useState(false)
  const [rows, setRows] = useState<Row[]>(serverRows)
  const [error, setError] = useState('')
  const [modal, setModal] = useState<'nach' | 'agreement' | 'docs' | null>(null)
  const canEdit = canEditRole && editMode
  const shown = canEdit ? rows : serverRows

  // Configured banks for the Bank dropdown (Vanilla BANKS_STORE).
  const { data: banks } = useQuery({
    queryKey: ['banks', 'lookup'],
    queryFn: () => banksApi.getLookup().then(r => r.data.data ?? []),
    enabled: canEdit,
    staleTime: 5 * 60_000,
  })
  const bankNames = useMemo(() => (banks ?? []).filter(b => b.isActive !== false).map(b => b.bankName), [banks])

  // Checklist state: persisted flags, with the tracking entry as fallback for
  // older loans (Vanilla sets nach_done / customer_agreement_done when the
  // EFIN-Nach / EFIN-Customer Agreement entry is posted).
  const { data: tracking } = useQuery({
    queryKey: ['tracking', loan.id],
    queryFn: () => api.get<ApiResponse<{ name: string }[]>>(`/api/loans/${loan.id}/tracking`).then(r => r.data.data ?? []),
  })
  const trk = tracking ?? []

  const save = useMutation({
    mutationFn: () => loansApi.updateBankLines(loan.id, rows.map(r => ({
      bankName: r.bankName || '',
      tempApplicationNumber: r.tempAppNo || '',
      applicationNumber: r.applicationNumber || undefined,
      approvedLoan: parseFloat(r.approvedLoan) || undefined,
      remarks: r.remarks || undefined,
    }))),
    onSuccess: () => {
      setEditMode(false); setError('')
      qc.invalidateQueries({ queryKey: LOAN_KEYS.detail(loan.id) })
      toast.success('Bank Details saved ✓')
    },
    onError: (err: unknown) => {
      const d = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      setError(d?.message || d?.errors?.[0] || 'Could not save Bank Details.')
    },
  })

  function setEdit(on: boolean) {
    if (on && !canEditRole) { toast.warn('You do not have permission to edit Bank Details'); return }
    // Edit takes a snapshot of the current lines; Cancel restores it.
    setRows(serverRows.map(r => ({ ...r })))
    setError('')
    setEditMode(on)
  }
  const update = (i: number, k: keyof Row, v: string) => setRows(p => p.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  function addLine() {
    const existing = new Set(rows.map(r => r.tempAppNo))
    setRows(p => [...p, { key: `new-${Date.now()}`, bankName: '', tempAppNo: generateTempAppNo(existing), applicationNumber: '', approvedLoan: '0', remarks: '' }])
    toast.success('Bank line added')
  }
  function removeLine(i: number) {
    if (rows.length <= 1) { toast.warn('At least one bank line required'); return }
    setRows(p => p.filter((_, j) => j !== i))
    toast.info('Bank line removed')
  }

  const checklist = [
    { key: 'nach' as const, icon: '🏦', label: 'NACH / eMandate Setup', desc: 'Register NACH mandate for auto-debit of EMIs', btn: 'Mark NACH Done',
      done: !!loan.nachDone || trk.some(e => e.name === 'EFIN-Nach') },
    { key: 'agreement' as const, icon: '📝', label: 'Customer Agreement Signed', desc: 'Loan agreement signed by customer', btn: 'Record Agreement',
      done: !!loan.customerAgreementDone || trk.some(e => e.name === 'EFIN-Customer Agreement') },
    { key: 'docs' as const, icon: '📄', label: 'Document Check Complete', desc: 'All KYC and income documents verified', btn: 'Complete Doc Check',
      done: !!loan.documentChecked },
  ]
  const pending = checklist.filter(c => !c.done).length
  const colCount = isPartner ? 5 : 6

  return (
    <div className="bankd">
      {canEditRole && (
        <div className="bankd-toolbar">
          <div className="bankd-status">
            <span className="bankd-dot" style={{ background: canEdit ? '#f59e0b' : 'var(--text3)' }} />
            <span>{canEdit ? 'Edit mode — changes not yet saved' : 'View mode'}</span>
          </div>
          <div className="bankd-actions">
            {!canEdit && <button type="button" className="bankd-btn bankd-btn--edit" onClick={() => setEdit(true)}>✏ Edit</button>}
            {canEdit && <button type="button" className="bankd-btn bankd-btn--save" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : '💾 Save'}</button>}
            {canEdit && <button type="button" className="bankd-btn bankd-btn--cancel" disabled={save.isPending} onClick={() => setEdit(false)}>✕ Cancel</button>}
          </div>
        </div>
      )}
      {error && <div className="bankd-error">{error}</div>}

      <div className="bankd-table-wrap">
        <table className="bankd-table">
          <thead>
            <tr>
              <th style={{ minWidth: 220 }}>Bank</th>
              <th style={{ minWidth: 180 }}>Temporary Application Number</th>
              {!isPartner && <th style={{ minWidth: 160 }}>Application Number</th>}
              <th style={{ minWidth: 160 }}>Approved Loan Amount</th>
              <th style={{ minWidth: 160 }}>Remarks</th>
              <th style={{ width: 48 }} />
            </tr>
          </thead>
          <tbody>
            {!canViewBanks ? (
              <tr><td colSpan={colCount} className="bankd-restricted">🔒 Bank Details — your role does not have access to this section.</td></tr>
            ) : shown.map((line, idx) => (
              <tr key={line.key}>
                <td>
                  {canEdit ? (
                    <select className="bankd-input" value={line.bankName} onChange={e => update(idx, 'bankName', e.target.value)}>
                      <option value="">— Select Bank —</option>
                      {line.bankName && !bankNames.includes(line.bankName) && <option value={line.bankName}>{line.bankName}</option>}
                      {bankNames.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  ) : <strong className="bankd-bank">{line.bankName || '—'}</strong>}
                </td>
                <td className="bankd-temp">{line.tempAppNo || '—'}</td>
                {!isPartner && (
                  <td>
                    {canEdit
                      ? <input className="bankd-input" value={line.applicationNumber} placeholder="Enter application no." onChange={e => update(idx, 'applicationNumber', e.target.value)} />
                      : <span className="bankd-cell">{line.applicationNumber || '—'}</span>}
                  </td>
                )}
                <td>
                  {canEdit
                    ? <input className="bankd-input bankd-input--num" type="text" inputMode="decimal" value={line.approvedLoan} placeholder="0"
                        onChange={e => update(idx, 'approvedLoan', e.target.value.replace(/[^0-9.]/g, ''))} />
                    : <span className="bankd-cell">{Number(line.approvedLoan) ? inr(Number(line.approvedLoan)) : '0'}</span>}
                </td>
                <td>
                  {canEdit ? (
                    <select className="bankd-input" value={line.remarks} onChange={e => update(idx, 'remarks', e.target.value)}>
                      <option value="">— Select Status —</option>
                      {line.remarks && !REMARK_OPTIONS.some(([v]) => v === line.remarks) && <option value={line.remarks}>{line.remarks}</option>}
                      {REMARK_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  ) : <span className="bankd-cell bankd-cell--muted">{line.remarks || '—'}</span>}
                </td>
                <td className="bankd-del-cell">
                  {canEdit && shown.length > 1 && (
                    <button type="button" className="bankd-del" title="Remove row" onClick={() => removeLine(idx)}>✕</button>
                  )}
                </td>
              </tr>
            ))}
            {canViewBanks && canEdit && (
              <tr className="bankd-add-row">
                <td colSpan={colCount}>
                  <button type="button" className="bankd-add" onClick={addLine}>＋ Add Bank Line</button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Vanilla _renderDisburseChecklist — appended inside the Bank Details panel. */}
      <div className="disburse-checklist">
        <div className="disburse-checklist-title">
          <span>🔒 Disbursement Pre-Conditions</span>
          <span className={`disburse-checklist-pill ${pending ? 'is-pending' : 'is-clear'}`}>{pending ? `${pending} Pending` : '✓ All Clear'}</span>
        </div>
        {checklist.map(c => (
          <div key={c.key} className="disburse-check-row">
            <span className={`disburse-check-icon ${c.done ? 'done' : 'pending'}`}>{c.done ? '✓' : c.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="disburse-check-label">{c.label}</div>
              <div className="disburse-check-desc">{c.desc}</div>
            </div>
            {c.done
              ? <span className="disburse-action-btn done-btn">✓ Done</span>
              : canPostTracking
                ? <button type="button" className="disburse-action-btn pending-btn" onClick={() => setModal(c.key)}>▶ {c.btn}</button>
                : <span className="disburse-action-btn waiting-btn">Pending</span>}
          </div>
        ))}
      </div>

      {modal === 'nach' && <SimpleActionModal loanId={loan.id} title="NACH / E-Mandate" subtitle="Mark the NACH mandate as registered"
        entryName="EFIN-Nach" confirmLabel="Mark NACH Done" overviewFlag="nachDone" onClose={() => setModal(null)} />}
      {modal === 'agreement' && <SimpleActionModal loanId={loan.id} title="Customer Agreement" subtitle="Record the signed customer agreement"
        entryName="EFIN-Customer Agreement" confirmLabel="Mark Agreement Done" overviewFlag="customerAgreementDone" onClose={() => setModal(null)} />}
      {modal === 'docs' && <SimpleActionModal loanId={loan.id} title="Documents Check" subtitle="Record document verification for this application"
        entryName="EFIN — Documents" confirmLabel="Mark Documents Checked" overviewFlag="documentChecked" onClose={() => setModal(null)} />}
    </div>
  )
}
