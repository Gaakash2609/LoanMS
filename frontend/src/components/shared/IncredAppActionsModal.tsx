import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, XCircle, Upload, FileClock, Wallet, RefreshCcw, Ban } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { InlineLoader } from '@/components/ui/LoadingSpinner'
import { Button } from '@/components/ui/Button'
import { loansApi } from '@/api/loansApi'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { incredAppActionsApi } from '@/api/incredLoanApi'
import { useToast } from '@/store/toastStore'
import { formatCurrency } from '@/utils/format'

interface IncredStatus { partnerId?: string }

/**
 * Per-application InCred actions — eligibility check, document upload,
 * cancel, repayment schedule, applicant sync, disbursement lookup. All six
 * backend endpoints (IncredController.cs) already existed with zero React
 * caller; legacy had a real onclick button for every one of them
 * (efin-app.js:14623-14995). This is that caller.
 *
 * Every call here mirrors the legacy function's payload shape exactly
 * (partner_id + the same field names), sourced from real loan/customer
 * data via GET /api/loans/{id} and the already-public partnerId from
 * GET /api/incred/status — nothing here is invented or hardcoded.
 */
export function IncredAppActionsModal({
  loanId,
  incredAppId,
  applicantName,
  onClose,
}: {
  loanId: number
  incredAppId?: string | null
  applicantName: string
  onClose: () => void
}) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [docType, setDocType] = useState('PAN Card')
  const [cancelReason, setCancelReason] = useState('')
  const [showCancelInput, setShowCancelInput] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [eligibility, setEligibility] = useState<Record<string, unknown> | null>(null)
  const [schedule, setSchedule] = useState<Record<string, unknown> | null>(null)
  const [disbursement, setDisbursement] = useState<Record<string, unknown> | null>(null)

  const { data: loan } = useQuery({
    queryKey: ['loans', 'detail', loanId],
    queryFn: () => loansApi.getById(loanId).then(r => r.data.data),
  })
  const { data: status } = useQuery({
    queryKey: ['incred-status'],
    // `?? null` — React Query forbids an undefined return (see IncredPage).
    queryFn: () => api.get<ApiResponse<IncredStatus>>('/api/incred/status').then(r => r.data.data ?? null),
    staleTime: 60_000,
  })

  const partnerId = status?.partnerId ?? ''
  const customer = loan?.customer

  if (!incredAppId) {
    return (
      <Modal open onClose={onClose} title="InCred Application Actions" subtitle={applicantName}>
        <p className="text-sm text-gray-500 py-6 text-center">
          No InCred App ID on this application — create the application first.
        </p>
      </Modal>
    )
  }

  const run = async (key: string, fn: () => Promise<unknown>, successMsg?: string) => {
    setBusy(key)
    try {
      const result = await fn()
      if (successMsg) toast.success(successMsg)
      return result
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } }; message?: string })
      toast.error(msg?.response?.data?.message || msg?.message || `${key} failed`)
      return null
    } finally {
      setBusy(null)
    }
  }

  const checkEligibility = () =>
    run('eligibility', async () => {
      const { data } = await incredAppActionsApi.checkEligibility({
        partner_id: partnerId,
        pan: customer?.panNumber,
        mobile: customer?.phone,
        monthly_income: customer?.monthlyIncome,
        loan_amount: loan?.approvedAmount ?? loan?.requestedAmount ?? 0,
        loan_type: loan?.loanType ?? '',
        cibil_score: customer?.cibilScore,
        employment_type: customer?.employmentType,
      })
      setEligibility(data)
    })

  const uploadDocument = () =>
    run('upload', async () => {
      const file = fileRef.current?.files?.[0]
      if (!file) { toast.warn('Choose a file first'); return }
      const base64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = () => reject(new Error('File read failed'))
        reader.readAsDataURL(file)
      })
      await incredAppActionsApi.uploadDocument(incredAppId, {
        partner_id: partnerId,
        document_type: docType,
        file_name: file.name,
        file_data: base64,
        mime_type: file.type || 'application/octet-stream',
      })
      if (fileRef.current) fileRef.current.value = ''
    }, `${docType} uploaded to InCred`)

  const cancelApplication = () =>
    run('cancel', async () => {
      await incredAppActionsApi.cancel(incredAppId, {
        partner_id: partnerId,
        reason: cancelReason.trim() || 'Cancelled by EFIN operator',
        ref_id: loanId,
      })
      setShowCancelInput(false)
      setCancelReason('')
    }, `InCred App ${incredAppId} cancelled`)

  const fetchSchedule = () =>
    run('schedule', async () => {
      const { data } = await incredAppActionsApi.getRepaymentSchedule(incredAppId)
      setSchedule(data)
    })

  const syncApplicant = () =>
    run('applicant', () =>
      incredAppActionsApi.updateApplicant(incredAppId, {
        partner_id: partnerId,
        applicant: { name: customer?.fullName, pan: customer?.panNumber, mobile: customer?.phone, email: customer?.email },
        employment: { type: customer?.employmentType, company: customer?.companyName, monthly_income: customer?.monthlyIncome },
        cibil_score: customer?.cibilScore,
      }),
      `Applicant details synced to InCred for ${incredAppId}`
    )

  const fetchDisbursement = () =>
    run('disbursement', async () => {
      const { data } = await incredAppActionsApi.getDisbursement(incredAppId)
      setDisbursement(data)
    })

  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0)
  const str = (v: unknown, ...fallbacks: unknown[]) =>
    (v ?? fallbacks.find(f => f != null)) as string | undefined

  return (
    <Modal open onClose={onClose} title="InCred Application Actions" subtitle={applicantName + ' — ' + incredAppId} size="lg">
      <div className="space-y-5">
        {/* Eligibility */}
        <div className="border rounded-lg p-4" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-800">Eligibility</h4>
            <Button size="sm" variant="secondary" onClick={checkEligibility} disabled={busy === 'eligibility'}>
              {busy === 'eligibility' ? <InlineLoader size={14} /> : 'Check Eligibility'}
            </Button>
          </div>
          {eligibility && (
            <div className="flex items-start gap-2 text-sm mt-2">
              {(eligibility.eligible === true || eligibility.status === 'eligible') ? (
                <CheckCircle2 size={16} className="text-green-600 shrink-0 mt-0.5" />
              ) : (
                <XCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
              )}
              <span className="text-gray-700">
                {(eligibility.eligible === true || eligibility.status === 'eligible')
                  ? 'Eligible — up to ' + formatCurrency(num(str(eligibility.max_loan_amount, eligibility.eligible_amount))) +
                    (eligibility.rate_from ?? eligibility.interest_rate_from ? ', rate from ' + (eligibility.rate_from ?? eligibility.interest_rate_from) + '%' : '')
                  : 'Not eligible — ' + (str(eligibility.reason, eligibility.rejection_reason) || 'Policy criteria not met')}
              </span>
            </div>
          )}
        </div>

        {/* Document upload */}
        <div className="border rounded-lg p-4" style={{ borderColor: 'var(--border)' }}>
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Upload Document</h4>
          <div className="flex flex-wrap items-center gap-2">
            <select value={docType} onChange={e => setDocType(e.target.value)} className="efin-select text-sm">
              {['PAN Card', 'Aadhaar Front', 'Aadhaar Back', 'Salary Slips', 'Bank Statement', 'Photo', 'Other'].map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <input ref={fileRef} type="file" className="text-sm" />
            <Button size="sm" variant="secondary" onClick={uploadDocument} disabled={busy === 'upload'}>
              {busy === 'upload' ? <InlineLoader size={14} /> : <><Upload size={14} className="mr-1" />Upload</>}
            </Button>
          </div>
        </div>

        {/* Cancel */}
        <div className="border rounded-lg p-4" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-800">Cancel Application</h4>
            {!showCancelInput && (
              <Button size="sm" variant="danger" onClick={() => setShowCancelInput(true)}>
                <Ban size={14} className="mr-1" />Cancel
              </Button>
            )}
          </div>
          {showCancelInput && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="Reason (optional)"
                className="efin-input text-sm flex-1 min-w-[180px]"
              />
              <Button
                size="sm"
                variant="danger"
                disabled={busy === 'cancel'}
                onClick={() => {
                  if (window.confirm('Cancel InCred application ' + incredAppId + ' for ' + applicantName + '?')) cancelApplication()
                }}
              >
                {busy === 'cancel' ? <InlineLoader size={14} /> : 'Confirm Cancel'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowCancelInput(false)}>Back</Button>
            </div>
          )}
        </div>

        {/* Repayment schedule */}
        <div className="border rounded-lg p-4" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-800">Repayment Schedule</h4>
            <Button size="sm" variant="secondary" onClick={fetchSchedule} disabled={busy === 'schedule'}>
              {busy === 'schedule' ? <InlineLoader size={14} /> : <><FileClock size={14} className="mr-1" />Fetch</>}
            </Button>
          </div>
          {schedule && (() => {
            const rows = (schedule.schedule ?? schedule.repayment_schedule ?? []) as Record<string, unknown>[]
            return (
              <div className="mt-2">
                <div className="flex flex-wrap gap-3 mb-3 text-sm">
                  <span className="text-gray-600">EMI: <strong>{formatCurrency(num(schedule.emi ?? schedule.monthly_emi))}</strong></span>
                  <span className="text-gray-600">Total Interest: <strong>{formatCurrency(num(schedule.total_interest))}</strong></span>
                  <span className="text-gray-600">Total Payable: <strong>{formatCurrency(num(schedule.total_amount))}</strong></span>
                </div>
                {rows.length > 0 ? (
                  <div className="overflow-x-auto border rounded" style={{ borderColor: 'var(--border)', maxHeight: 240, overflowY: 'auto' }}>
                    <table className="w-full text-xs">
                      <thead style={{ background: 'var(--surface2)' }}>
                        <tr>
                          <th className="px-2 py-1.5 text-center">#</th>
                          <th className="px-2 py-1.5 text-left">Due Date</th>
                          <th className="px-2 py-1.5 text-right">EMI</th>
                          <th className="px-2 py-1.5 text-right">Principal</th>
                          <th className="px-2 py-1.5 text-right">Interest</th>
                          <th className="px-2 py-1.5 text-right">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 24).map((row, i) => (
                          <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                            <td className="px-2 py-1.5 text-center text-gray-400">{Number(row.installment_no ?? i + 1)}</td>
                            <td className="px-2 py-1.5">{String(row.due_date ?? '—')}</td>
                            <td className="px-2 py-1.5 text-right">{formatCurrency(num(row.emi ?? row.installment_amount))}</td>
                            <td className="px-2 py-1.5 text-right">{formatCurrency(num(row.principal))}</td>
                            <td className="px-2 py-1.5 text-right">{formatCurrency(num(row.interest))}</td>
                            <td className="px-2 py-1.5 text-right">{formatCurrency(num(row.outstanding_balance ?? row.balance))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">No schedule data returned by InCred.</p>
                )}
              </div>
            )
          })()}
        </div>

        {/* Applicant sync + Disbursement, side by side */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="border rounded-lg p-4" style={{ borderColor: 'var(--border)' }}>
            <h4 className="text-sm font-semibold text-gray-800 mb-2">Sync Applicant Details</h4>
            <p className="text-xs text-gray-500 mb-2">Pushes the customer's current name/PAN/mobile/employment to InCred.</p>
            <Button size="sm" variant="secondary" onClick={syncApplicant} disabled={busy === 'applicant'}>
              {busy === 'applicant' ? <InlineLoader size={14} /> : <><RefreshCcw size={14} className="mr-1" />Sync</>}
            </Button>
          </div>
          <div className="border rounded-lg p-4" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-gray-800">Disbursement</h4>
              <Button size="sm" variant="secondary" onClick={fetchDisbursement} disabled={busy === 'disbursement'}>
                {busy === 'disbursement' ? <InlineLoader size={14} /> : <><Wallet size={14} className="mr-1" />Fetch</>}
              </Button>
            </div>
            {disbursement && (
              <dl className="text-xs space-y-1 text-gray-600">
                <div>Amount: <strong>{formatCurrency(num(disbursement.disbursement_amount ?? disbursement.amount))}</strong></div>
                <div>Date: {String(str(disbursement.disbursement_date, disbursement.date) ?? '—')}</div>
                <div>Txn Ref: {String(str(disbursement.transaction_ref, disbursement.txn_id) ?? '—')}</div>
                <div>Account: {String(disbursement.account_number ?? '—')}</div>
              </dl>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
