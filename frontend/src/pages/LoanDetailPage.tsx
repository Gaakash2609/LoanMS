import { useParams, useNavigate } from 'react-router-dom'
import { useLoan, useUpdateLoanStatus } from '@/hooks/useLoans'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { formatCurrency, formatDate, formatDateTime } from '@/utils/format'
import { ArrowLeft, User, Upload, Loader, CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import AIInsightPanel from '@/features/ai/AIInsightPanel'
import { accountDetailsApi } from '@/api/accountDetailsApi'
import { extractAccountDetails } from '@/utils/accountExtraction'

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
      <CardHeader title="🏦 Account Details" />
      
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
                  '🔍 Extract Details'
                )}
              </button>
            </div>
          </div>

          {statementImages.length > 0 && (
            <div className="text-xs text-gray-600 mt-2">
              ✅ {statementImages.length} file(s) selected
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
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-700">
            ⚠️ Account extraction is not configured. Please enter details manually.
          </div>
        )}
      </div>
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
  const canAct = user?.role === 'Admin' || user?.role === 'Manager'

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

          {/* Account Details */}
          <AccountDetailsCard />

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
