import { useParams, useNavigate } from 'react-router-dom'
import { useLoan, useUpdateLoanStatus } from '@/hooks/useLoans'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { formatCurrency, formatDate, formatDateTime } from '@/utils/format'
import { ArrowLeft, User, Upload, Loader, CheckCircle2, Landmark, Zap, Search, AlertTriangle, Mail } from 'lucide-react'
import type { Loan } from '@/types'
import { useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import AIInsightPanel from '@/features/ai/AIInsightPanel'
import { accountDetailsApi } from '@/api/accountDetailsApi'
import { extractAccountDetails } from '@/utils/accountExtraction'
import { obligationsApi, type LoanObligation } from '@/api/obligationsApi'
import { Plus, Trash2, Pencil } from 'lucide-react'
import IncredTab from './IncredTab'
import LenderEmailCard from '@/components/shared/LenderEmailCard'
import { perfiosApi } from '@/api/perfiosApi'
import { FileCheck } from 'lucide-react'
import PerfiosWorkflow from '@/components/shared/PerfiosWorkflow'

const TRANSITIONS: Record<string, { label: string; variant: 'primary' | 'danger' | 'secondary' }[]> = {
  Draft:       [{ label: 'Submit', variant: 'primary' }, { label: 'Reject', variant: 'danger' }],
  Submitted:   [{ label: 'Review', variant: 'secondary' }, { label: 'Reject', variant: 'danger' }],
  UnderReview: [{ label: 'Approve', variant: 'primary' }, { label: 'Reject', variant: 'danger' }],
  Approved:    [{ label: 'Disburse', variant: 'primary' }],
  Disbursed:   [{ label: 'Close', variant: 'secondary' }],
}

const STATUS_MAP: Record<string, string> = {
  Submit: 'Submitted', Review: 'UnderReview', Approve: 'Approved',
  Disburse: 'Disbursed', Close: 'Closed', Reject: 'Rejected',
}

function AccountDetailsCard() {
  const [statementImages, setStatementImages] = useState<File[]>([])
  const [accountData, setAccountData] = useState({
    accountHolder: '',
    bank: '',
    accountNumber: '',
    accountType: '',
    ifsc: '',
    branch: '',
    pan: '',
    mobile: '',
  })
  const [extractionStatus, setExtractionStatus] = useState<{
    status: 'idle' | 'loading' | 'success' | 'error'
    message?: string
  }>({ status: 'idle' })

  const { data: accountStatus } = useQuery({
    queryKey: ['account-extraction-status'],
    queryFn: () => accountDetailsApi.status().then(r => r.data),
    staleTime: 300_000,
  })

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1] || '')
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const extractAccount = useMutation({
    mutationFn: async () => {
      if (!statementImages.length) throw new Error('No statement images selected')
      setExtractionStatus({ status: 'loading' })

      try {
        const base64Images = await Promise.all(statementImages.map(fileToBase64))
        const response = await accountDetailsApi.extractFromStatement({
          images: base64Images.map((data, i) => ({
            mediaType: statementImages[i].type,
            data,
          })),
          prompt: `Extract bank account information from this bank statement. Return ONLY the following fields in this exact format:
ACCOUNT HOLDER: <account holder name>
BANK: <bank name>
ACCOUNT NUMBER: <account number>
ACCOUNT TYPE: <Savings/Current/Checking/Salary>
IFSC: <IFSC code>
BRANCH: <branch name>
PAN: <PAN number or —>
MOBILE: <mobile number or —>

Extract exactly what is on the statement. Be accurate.`,
        })

        if (!response.data.success) {
          throw new Error(response.data.error || 'Extraction failed')
        }

        const extracted = extractAccountDetails(response.data.text || '')
        setAccountData(extracted)
        setExtractionStatus({ status: 'success', message: 'Account details extracted successfully' })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Extraction failed'
        setExtractionStatus({ status: 'error', message })
        throw err
      }
    },
  })

  const handleFilesSelect = (files: FileList | null) => {
    if (!files) return
    setStatementImages(Array.from(files))
    setExtractionStatus({ status: 'idle' })
  }

  const handleFieldChange = (field: keyof typeof accountData, value: string) => {
    setAccountData(prev => ({ ...prev, [field]: value }))
  }

  return (
    <Card>
      <CardHeader title={<><Landmark size={16} className="text-gray-500" /> Account Details</>} />
      
      <div className="space-y-4">
        {/* Document Upload Section */}
        <div className="p-4 border border-dashed border-gray-300 rounded-lg bg-gray-50">
          <p className="text-xs font-semibold text-gray-600 mb-3">Upload Bank Statement</p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
                <Upload size={20} className="mx-auto mb-2 text-gray-400" />
                <p className="text-xs font-medium text-gray-600">Click to upload statement</p>
                <p className="text-xs text-gray-400 mt-1">PDF or image file</p>
              </div>
              <input
                type="file"
                multiple
                accept="image/*,.pdf"
                onChange={e => handleFilesSelect(e.target.files)}
                className="hidden"
              />
            </label>

            <div className="flex items-end">
              <button
                onClick={() => extractAccount.mutate()}
                disabled={!statementImages.length || extractAccount.isPending || !accountStatus?.configured}
                className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
              >
                {extractAccount.isPending ? (
                  <>
                    <Loader size={14} className="animate-spin" /> Extracting...
                  </>
                ) : (
                  <>
                    <Search size={14} /> Extract Details
                  </>
                )}
              </button>
            </div>
          </div>

          {statementImages.length > 0 && (
            <div className="text-xs text-gray-600 mt-2 flex items-center gap-1">
              <CheckCircle2 size={14} className="text-green-600" /> {statementImages.length} file(s) selected
            </div>
          )}

          {extractionStatus.message && (
            <div
              className={`mt-3 p-2 rounded text-xs ${
                extractionStatus.status === 'success'
                  ? 'bg-green-100 text-green-700'
                  : extractionStatus.status === 'error'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-yellow-100 text-yellow-700'
              }`}
            >
              {extractionStatus.status === 'success' && <CheckCircle2 size={14} className="inline mr-1" />}
              {extractionStatus.message}
            </div>
          )}
        </div>

        {/* Account Details Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { label: 'Account Holder', field: 'accountHolder' as const },
            { label: 'Bank', field: 'bank' as const },
            { label: 'Account Number', field: 'accountNumber' as const },
            { label: 'Account Type', field: 'accountType' as const },
            { label: 'IFSC Code', field: 'ifsc' as const },
            { label: 'Branch', field: 'branch' as const },
            { label: 'PAN', field: 'pan' as const },
            { label: 'Mobile', field: 'mobile' as const },
          ].map(({ label, field }) => (
            <div key={field}>
              <label className="text-xs font-semibold text-gray-600 uppercase block mb-1">{label}</label>
              <input
                type="text"
                value={accountData[field]}
                onChange={e => handleFieldChange(field, e.target.value)}
                placeholder={label}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          ))}
        </div>

        {!accountStatus?.configured && (
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-700 flex items-center gap-1.5">
            <AlertTriangle size={14} /> Account extraction is not configured. Please enter details manually.
          </div>
        )}
      </div>
    </Card>
  )
}

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

const EMPTY_OBL_FORM = {
  loanType: '', financerName: '', sanctionAmount: '', loanEmi: '',
  amountOutstanding: '', loanClosureDate: '', loanAccountNumber: '', selectBT: false,
}

function ObligationsTab({ loanId }: { loanId: number }) {
  const user = useAuthStore(s => s.user)
  const canEdit = ['Admin', 'Manager', 'Sales'].includes(user?.role ?? '')
  const canDelete = user?.role === 'Admin'
  const qc = useQueryClient()

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(EMPTY_OBL_FORM)
  const [error, setError] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['obligations', loanId],
    queryFn: () => obligationsApi.getByLoan(loanId).then(r => r.data.data ?? []),
  })
  const obligations = data ?? []

  function invalidate() { qc.invalidateQueries({ queryKey: ['obligations', loanId] }) }

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
    }
  }

  const create = useMutation({
    mutationFn: () => obligationsApi.create(toPayload()),
    onSuccess: (res) => {
      if (!res.data.success) { setError(res.data.message || 'Could not save obligation.'); return }
      invalidate(); closeForm()
    },
    onError: () => setError('Could not save obligation.'),
  })
  const update = useMutation({
    mutationFn: (id: number) => obligationsApi.update(id, toPayload()),
    onSuccess: (res) => {
      if (!res.data.success) { setError(res.data.message || 'Could not update obligation.'); return }
      invalidate(); closeForm()
    },
    onError: () => setError('Could not update obligation.'),
  })
  const remove = useMutation({
    mutationFn: (id: number) => obligationsApi.delete(id),
    onSuccess: () => invalidate(),
  })

  function openCreate() {
    setEditingId(null); setForm(EMPTY_OBL_FORM); setError(''); setShowForm(true)
  }
  function openEdit(o: LoanObligation) {
    setEditingId(o.id)
    setForm({
      loanType: o.loanType,
      financerName: o.financerName || '',
      sanctionAmount: String(o.sanctionAmount ?? ''),
      loanEmi: String(o.loanEmi ?? ''),
      amountOutstanding: String(o.amountOutstanding ?? ''),
      loanClosureDate: o.loanClosureDate ? o.loanClosureDate.slice(0, 10) : '',
      loanAccountNumber: o.loanAccountNumber || '',
      selectBT: o.selectBT,
    })
    setError(''); setShowForm(true)
  }
  function closeForm() {
    setShowForm(false); setEditingId(null); setForm(EMPTY_OBL_FORM); setError('')
  }
  function save() {
    if (!form.loanType) { setError('Loan Type is required'); return }
    if (editingId) update.mutate(editingId)
    else create.mutate()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">Running loan obligations used for FOIR (Fixed Obligation to Income Ratio)</p>
        {canEdit && (
          <Button size="sm" onClick={openCreate}><Plus size={14} className="mr-1" />Add Obligation</Button>
        )}
      </div>

      {showForm && canEdit && (
        <Card className="mb-4 p-5">
          <p className="text-sm font-semibold mb-4">{editingId ? 'Edit Running Loan Obligation' : 'Add Running Loan Obligation'}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Loan Type *</label>
              <select value={form.loanType} onChange={e => setForm(p => ({ ...p, loanType: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <option value="">— Select —</option>
                {LOAN_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Financer Name</label>
              <input value={form.financerName} onChange={e => setForm(p => ({ ...p, financerName: e.target.value }))}
                placeholder="Bank / NBFC name" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Sanction Amount (₹)</label>
              <input type="number" value={form.sanctionAmount} onChange={e => setForm(p => ({ ...p, sanctionAmount: e.target.value }))}
                placeholder="e.g. 500000" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Loan EMI (₹/month)</label>
              <input type="number" value={form.loanEmi} onChange={e => setForm(p => ({ ...p, loanEmi: e.target.value }))}
                placeholder="e.g. 8000" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Outstanding Amount (₹)</label>
              <input type="number" value={form.amountOutstanding} onChange={e => setForm(p => ({ ...p, amountOutstanding: e.target.value }))}
                placeholder="e.g. 200000" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Closure Date</label>
              <input type="date" value={form.loanClosureDate} onChange={e => setForm(p => ({ ...p, loanClosureDate: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Loan Account No.</label>
              <input value={form.loanAccountNumber} onChange={e => setForm(p => ({ ...p, loanAccountNumber: e.target.value }))}
                placeholder="Account number" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={form.selectBT} onChange={e => setForm(p => ({ ...p, selectBT: e.target.checked }))} />
                Select for BT (Balance Transfer)
              </label>
            </div>
          </div>
          {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" loading={editingId ? update.isPending : create.isPending} onClick={save}>
              {editingId ? 'Update Obligation' : 'Add Obligation'}
            </Button>
            <Button size="sm" variant="secondary" onClick={closeForm}>Cancel</Button>
          </div>
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-400 py-4">Loading…</p>
      ) : obligations.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">No obligations recorded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 text-gray-500">
                <th className="py-2 pr-3 text-left font-medium">Loan Type</th>
                <th className="py-2 pr-3 text-left font-medium">Financer</th>
                <th className="py-2 pr-3 text-left font-medium">Sanction (₹)</th>
                <th className="py-2 pr-3 text-left font-medium">EMI (₹)</th>
                <th className="py-2 pr-3 text-left font-medium">Outstanding (₹)</th>
                <th className="py-2 pr-3 text-left font-medium">Closure Date</th>
                <th className="py-2 pr-3 text-left font-medium">Account No.</th>
                <th className="py-2 pr-3 text-left font-medium">BT</th>
                <th className="py-2 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {obligations.map(o => (
                <tr key={o.id}>
                  <td className="py-2 pr-3">{LOAN_TYPE_LABEL[o.loanType] ?? o.loanType}</td>
                  <td className="py-2 pr-3">{o.financerName || '—'}</td>
                  <td className="py-2 pr-3">{formatCurrency(o.sanctionAmount)}</td>
                  <td className="py-2 pr-3">{formatCurrency(o.loanEmi)}</td>
                  <td className="py-2 pr-3">{formatCurrency(o.amountOutstanding)}</td>
                  <td className="py-2 pr-3">{o.loanClosureDate ? formatDate(o.loanClosureDate) : '—'}</td>
                  <td className="py-2 pr-3">{o.loanAccountNumber || '—'}</td>
                  <td className="py-2 pr-3">{o.selectBT ? 'Yes' : '—'}</td>
                  <td className="py-2">
                    {(canEdit || canDelete) && (
                      <div className="flex gap-1">
                        {canEdit && (
                          <button onClick={() => openEdit(o)} className="text-gray-400 hover:text-gray-700 p-1"><Pencil size={13} /></button>
                        )}
                        {canDelete && (
                          <button onClick={() => { if (confirm('Delete this obligation?')) remove.mutate(o.id) }}
                            className="text-red-400 hover:text-red-600 p-1"><Trash2 size={13} /></button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function BankIncredTabs({ loan }: { loan: Loan }) {
  const loanId = loan.id
  const [tab, setTab] = useState<'bank' | 'incred' | 'obligations' | 'lenderEmail'>('bank')

  const tabs = [
    { key: 'bank' as const, label: 'Bank Details', icon: Landmark },
    { key: 'incred' as const, label: 'InCred', icon: Zap },
    { key: 'obligations' as const, label: 'FOIR / Obligations', icon: AlertTriangle },
    { key: 'lenderEmail' as const, label: 'Lender Emails', icon: Mail },
  ]

  return (
    <div>
      <div className="flex gap-6 border-b border-gray-200 mb-5">
        {tabs.map(t => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 pb-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                active ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon size={15} className={active ? 'text-blue-600' : 'text-gray-400'} />
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'bank' ? (
        <div className="space-y-6">
          <AccountDetailsCard />
          <PerfiosReportCard loanId={loanId} />
          <Card>
            <CardHeader title="Run New Perfios Analysis" subtitle="Upload a bank statement to verify and update the report above" />
            <PerfiosWorkflow loanId={loanId} />
          </Card>
        </div>
      ) : tab === 'incred' ? <IncredTab loanId={loanId} /> : tab === 'obligations' ? <ObligationsTab loanId={loanId} /> : <LenderEmailCard loan={loan} />}
    </div>
  )
}

// ── Perfios bank-statement verification (read-only) ─────────────────────────
// Displays the latest saved Perfios report for this loan via
// PerfiosController's GetLatest — the only backend-supported piece of the
// legacy Perfios workflow (see api/perfiosApi.ts doc comment). The actual
// upload/statement-parsing/analysis step is NOT reproduced: that runs
// entirely inside legacy's own client-side PDF-parsing engine
// (wwwroot/perfios/js/perfios-core.js) with no backend endpoint to call —
// porting it would mean re-implementing that parsing engine's transaction
// extraction and balance/salary/staleness calculations from scratch in
// React, which is exactly the kind of invented calculation this task rules
// out. This card only surfaces whatever result was already saved.
function PerfiosReportCard({ loanId }: { loanId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['perfiosReport', loanId],
    queryFn: () => perfiosApi.getLatest(loanId).then(r => r.data.data),
  })

  return (
    <Card>
      <CardHeader title="Bank Statement Verification (Perfios)" subtitle="Most recent verified bank-statement analysis for this loan" />
      {isLoading ? (
        <p className="text-sm text-gray-400 py-4">Loading…</p>
      ) : !data ? (
        <p className="text-sm text-gray-400 py-4">No bank-statement verification recorded for this loan yet.</p>
      ) : (
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
      )}
    </Card>
  )
}

export default function LoanDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: loan, isLoading } = useLoan(Number(id))
  const updateStatus = useUpdateLoanStatus()
  const user = useAuthStore(s => s.user)
  const [comment, setComment] = useState('')

  if (isLoading) return <LoadingSpinner size="lg" />
  if (!loan) return <div className="p-8 text-center text-gray-500">Loan not found</div>

  const actions = TRANSITIONS[loan.status] ?? []
  // BUGFIX (confirmed real, pre-existing gap — Phase 11 audit): every
  // status-transition button below (Submit/Approve/Reject/Disburse, via
  // handleAction → updateStatus.mutate) goes through the SAME, single,
  // generic PATCH /api/loans/{id}/status endpoint (loansApi.updateStatus)
  // — confirmed the dedicated /submit,/approve,/reject,/disburse routes
  // on LoansController exist but are never called from this page at all.
  // That one endpoint's actual [Authorize(Roles=...)] is
  // "Admin,Manager,LoginTeam,TeamLeader,LocationHead,OperationManager" —
  // canAct previously only checked Admin/Manager, hiding these buttons
  // entirely from LoginTeam/TeamLeader/LocationHead/OperationManager even
  // though the backend already lets them act. Accounts and ProductTeam
  // are deliberately NOT added here — they're authorized on
  // /assignment,/bank-lines,/sanction-detail, none of which this page has
  // any UI for; adding them to canAct would show status-transition
  // buttons that call an endpoint they're not actually authorized on.
  const canAct = ['Admin', 'Manager', 'LoginTeam', 'TeamLeader', 'LocationHead', 'OperationManager']
    .includes(user?.role ?? '')

  const handleAction = (label: string) => {
    const newStatus = STATUS_MAP[label]
    if (!newStatus) return
    updateStatus.mutate({ id: loan.id, newStatus, comment: comment || undefined })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">{loan.loanNumber}</h1>
          <p className="text-sm text-gray-500">{loan.loanType}</p>
        </div>
        <StatusBadge status={loan.status} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main details */}
        <div className="lg:col-span-2 space-y-5">
          <Card>
            <CardHeader title="Loan Details" />
            <div className="grid grid-cols-2 gap-4 text-sm">
              {[
                ['Requested Amount', formatCurrency(loan.requestedAmount)],
                ['Approved Amount', formatCurrency(loan.approvedAmount)],
                ['Interest Rate', `${loan.interestRate}% p.a.`],
                ['Tenure', `${loan.tenureMonths} months`],
                ['Monthly EMI', formatCurrency(loan.monthlyEmi)],
                ['Applied On', formatDate(loan.createdAt)],
                ['Approved On', formatDate(loan.approvedAt)],
                ['Disbursed On', formatDate(loan.disbursedAt)],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-gray-500 text-xs">{label}</p>
                  <p className="font-medium text-gray-900 mt-0.5">{value || '—'}</p>
                </div>
              ))}
            </div>
            {loan.purpose && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-500 mb-1">Purpose</p>
                <p className="text-sm text-gray-700">{loan.purpose}</p>
              </div>
            )}
          </Card>

          {/* Customer */}
          <Card>
            <CardHeader title="Customer" action={
              <button onClick={() => navigate(`/customers/${loan.customer.id}`)}
                className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                <User size={12} /> View Profile
              </button>
            } />
            <div className="grid grid-cols-2 gap-4 text-sm">
              {[
                ['Name', loan.customer.fullName],
                ['Phone', loan.customer.phone],
                ['Email', loan.customer.email],
                ['PAN', loan.customer.panNumber],
                ['CIBIL Score', loan.customer.cibilScore?.toString()],
                ['Monthly Income', formatCurrency(loan.customer.monthlyIncome)],
                ['Monthly Obligations', formatCurrency(loan.customer.monthlyObligations)],
                ['Employment', loan.customer.employmentType],
                ['Company', loan.customer.companyName],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-gray-500 text-xs">{label}</p>
                  <p className="font-medium text-gray-900 mt-0.5">{value || '—'}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* Bank Details / InCred */}
          <BankIncredTabs loan={loan} />

          {/* Status history */}
          <Card>
            <CardHeader title="Status History" />
            <div className="space-y-3">
              {loan.statusHistory.map(h => (
                <div key={h.id} className="flex gap-3 text-sm">
                  <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-gray-900 font-medium">
                      {h.fromStatus} → {h.toStatus}
                    </p>
                    {h.comment && <p className="text-gray-500 text-xs mt-0.5">{h.comment}</p>}
                    <p className="text-gray-400 text-xs mt-0.5">
                      {h.changedBy} · {formatDateTime(h.changedAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          {/* Actions */}
          {canAct && actions.length > 0 && (
            <Card>
              <CardHeader title="Actions" />
              <div className="space-y-3">
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Add a comment (optional)"
                  rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex flex-col gap-2">
                  {actions.map(action => (
                    <Button
                      key={action.label}
                      variant={action.variant}
                      size="sm"
                      className="w-full"
                      loading={updateStatus.isPending}
                      onClick={() => handleAction(action.label)}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {/* AI Insights */}
          <AIInsightPanel loanId={loan.id} currentStage={loan.status} />

          {/* Team */}
          <Card>
            <CardHeader title="Assignment" />
            <div className="space-y-2 text-sm">
              <div>
                <p className="text-gray-500 text-xs">Created By</p>
                <p className="font-medium">{loan.createdBy.fullName}</p>
              </div>
              {loan.assignedTo && (
                <div>
                  <p className="text-gray-500 text-xs">Assigned To</p>
                  <p className="font-medium">{loan.assignedTo.fullName}</p>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
