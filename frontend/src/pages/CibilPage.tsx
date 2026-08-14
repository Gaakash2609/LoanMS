import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import PageHeader from '@/components/shared/PageHeader'
import { 
  AlertCircle, Clock, TrendingUp, 
  Download, RefreshCw, PrinterIcon, Shield,
  BarChart3, User, Landmark, ClipboardList, AlertTriangle
} from 'lucide-react'

interface CibilReport {
  creditScore: { score: number; category: string; generatedDate: string }
  customerProfile: { fullName: string; pan: string; dateOfBirth: string }
  accountSummary: { totalAccounts: number; activeAccounts: number; currentOutstanding: number }
  riskAnalysis: { riskLevel: string; riskGrade: string; approvalProbability: number }
  paymentHistory: { dpdHeatmap: { healthStatus: string; last3MonthsDPD: number } }
}

// Exact shape of CibilAccountDto (LoanMS.Application/DTOs/Cibil) — as
// returned by GET /cibil/accounts.
interface CibilAccount {
  id: number
  lenderName?: string
  loanType?: string
  ownership?: string
  accountNumberMasked?: string
  openDate?: string
  closedDate?: string
  reportDate?: string
  lastPaymentDate?: string
  sanctionAmount?: number
  currentBalance?: number
  emiAmount?: number
  tenureMonths?: number
  remainingTenure?: number
  paymentFrequency?: string
  accountStatus?: string
  currentDPD?: number
  isWrittenOff?: boolean
  isSettled?: boolean
}

// Exact shape of CibilPaymentHistoryDto / CibilMonthlyPaymentStatusDto /
// CibilDPDHeatmapDto (LoanMS.Application/DTOs/Cibil) — as returned by
// GET /cibil/payment-history.
interface CibilPaymentHistory {
  monthly: {
    reportMonth: string
    dpdStatus?: string
    daysOverdue: number
    isMissedPayment: boolean
    isWriteOff: boolean
    isSettlement: boolean
  }[]
  dpdHeatmap: {
    last3MonthsDPD: number
    last6MonthsDPD: number
    last12MonthsDPD: number
    healthStatus?: string
  }
  missedPaymentAlerts: string[]
}

// Exact shape of CibilRiskAnalysisDto / CibilRiskFactorDto
// (LoanMS.Application/DTOs/Cibil) — as returned by GET /cibil/risk-analysis.
interface CibilRiskAnalysis {
  riskLevel?: string
  riskGrade?: string
  bureauRiskScore: number
  approvalProbability: number
  lendingRecommendation?: string
  riskFactors: { factor?: string; impact?: string; weight: number; description?: string }[]
  riskWarnings: string[]
  recommendations: string[]
}

export default function CibilPage() {
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'accounts' | 'history' | 'risk'>('overview')
  // Confirmed real, pre-existing gap (Phase 14 audit): GET /cibil/accounts
  // genuinely paginates server-side (page/pageSize, default 1/10 — see
  // CibilController.GetAccounts) — this page never sent either param, so
  // any customer with more than 10 accounts silently had the rest hidden,
  // with no pagination UI at all. accountsPage resets to 1 whenever the
  // customer changes (see the effect below), so switching customers never
  // leaves a stale page-number applied to the new customer's accounts.
  const [accountsPage, setAccountsPage] = useState(1)
  const ACCOUNTS_PAGE_SIZE = 10

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const cId = params.get('customerId')
    if (cId) setCustomerId(parseInt(cId))
  }, [])

  // Customer change → pagination reset, so a previously-viewed customer's
  // page-number is never silently applied to a different customer.
  useEffect(() => { setAccountsPage(1) }, [customerId])

  const { data: reportData, isLoading, error, refetch } = useQuery({
    queryKey: ['cibil-report', customerId],
    queryFn: async () => {
      if (!customerId) return null
      const res = await api.get<ApiResponse<CibilReport>>(`/api/cibil/full-report?customerId=${customerId}`)
      return res.data.data
    },
    enabled: !!customerId,
  })

  // BUGFIX (Phase 14): query key now includes accountsPage/pageSize, so a
  // page-change genuinely triggers a fresh fetch (and each page's result
  // is cached separately) instead of silently reusing page-1's cached
  // response.
  const { data: accountsData, isLoading: accountsLoading, isError: accountsError } = useQuery({
    queryKey: ['cibil-accounts', customerId, accountsPage],
    queryFn: async () => {
      if (!customerId) return []
      const res = await api.get<ApiResponse<CibilAccount[]>>(
        `/api/cibil/accounts?customerId=${customerId}&page=${accountsPage}&pageSize=${ACCOUNTS_PAGE_SIZE}`
      )
      return res.data.data ?? []
    },
    enabled: !!customerId && activeTab === 'accounts',
  })

  // BUGFIX (Phase 14): the response was fetched but never captured/used —
  // History tab always showed a hardcoded "Loading payment history..."
  // placeholder even after this genuinely succeeded. Now captured and
  // rendered below. No .items/array assumption — CibilPaymentHistoryDto
  // is a single object ({monthly, dpdHeatmap, missedPaymentAlerts}), not
  // a list.
  const { data: historyData, isLoading: historyLoading, isError: historyError } = useQuery({
    queryKey: ['cibil-history', customerId],
    queryFn: async () => {
      if (!customerId) return null
      const res = await api.get<ApiResponse<CibilPaymentHistory>>(`/api/cibil/payment-history?customerId=${customerId}`)
      return res.data.data ?? null
    },
    enabled: !!customerId && activeTab === 'history',
  })

  // BUGFIX (Phase 14): same issue as History above — response fetched but
  // discarded. Now captured and rendered below.
  const { data: riskData, isLoading: riskLoading, isError: riskError } = useQuery({
    queryKey: ['cibil-risk', customerId],
    queryFn: async () => {
      if (!customerId) return null
      const res = await api.get<ApiResponse<CibilRiskAnalysis>>(`/api/cibil/risk-analysis?customerId=${customerId}`)
      return res.data.data ?? null
    },
    enabled: !!customerId && activeTab === 'risk',
  })

  if (!customerId) {
    return (
      <div className="max-w-4xl">
        <PageHeader title="CIBIL Report" subtitle="Credit bureau score analysis" />
        <Card>
          <CardHeader title="Customer ID Required" />
          <div className="p-6 text-center text-gray-500">
            Please select a customer to view their CIBIL report.
          </div>
        </Card>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="max-w-4xl">
        <PageHeader title="CIBIL Report" subtitle="Loading..." />
        <Card>
          <div className="p-12 text-center text-gray-400">
            <Clock className="w-12 h-12 mx-auto animate-spin mb-4" />
            Loading CIBIL report...
          </div>
        </Card>
      </div>
    )
  }

  if (error || !reportData) {
    return (
      <div className="max-w-4xl">
        <PageHeader title="CIBIL Report" subtitle="Error loading report" />
        <Card>
          <div className="p-6 bg-red-50 rounded-xl border border-red-200">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-red-900">Failed to load CIBIL report</p>
                <p className="text-sm text-red-700 mt-1">Please try again or contact support.</p>
              </div>
            </div>
            <Button onClick={() => refetch()} className="mt-4 bg-red-600 hover:bg-red-700">
              <RefreshCw className="w-4 h-4 mr-2" /> Retry
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  const scoreColor = (score: number) => {
    if (score >= 750) return 'text-green-600'
    if (score >= 700) return 'text-blue-600'
    if (score >= 650) return 'text-yellow-600'
    return 'text-red-600'
  }

  const scoreRingColor = (score: number) => {
    if (score >= 750) return 'text-green-500'
    if (score >= 700) return 'text-blue-500'
    if (score >= 650) return 'text-yellow-500'
    return 'text-red-500'
  }

  const riskBadgeColor = (level: string) => {
    const l = level?.toLowerCase() || ''
    if (l === 'low') return 'bg-green-100 text-green-800'
    if (l.includes('medium')) return 'bg-yellow-100 text-yellow-800'
    if (l === 'high') return 'bg-orange-100 text-orange-800'
    return 'bg-red-100 text-red-800'
  }

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <PageHeader title={<><BarChart3 size={22} className="text-gray-700" /> CIBIL Report</>} subtitle={`${reportData.customerProfile?.fullName || 'Customer'}'s Credit Profile`} />
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
          <Button variant="secondary" size="sm">
            <PrinterIcon className="w-4 h-4 mr-2" /> Print
          </Button>
          <Button variant="secondary" size="sm">
            <Download className="w-4 h-4 mr-2" /> Export PDF
          </Button>
        </div>
      </div>

      {/* Score Gauge Section */}
      <Card className="mb-6 bg-gradient-to-r from-slate-50 to-slate-100">
        <div className="p-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="flex flex-col items-center p-6 bg-white rounded-xl shadow-sm">
              <div className="relative w-32 h-32 mb-4">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="45" fill="none" stroke="#e5e7eb" strokeWidth="8" />
                  <circle
                    cx="50" cy="50" r="45" fill="none"
                    stroke={scoreRingColor(reportData.creditScore.score)}
                    strokeWidth="8"
                    strokeDasharray={`${(reportData.creditScore.score / 900) * 283} 283`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className={`text-3xl font-bold ${scoreColor(reportData.creditScore.score)}`}>
                    {reportData.creditScore.score}
                  </div>
                  <div className="text-xs text-gray-600">/ 900</div>
                </div>
              </div>
              <p className={`text-lg font-semibold ${scoreColor(reportData.creditScore.score)}`}>
                {reportData.creditScore.category}
              </p>
              <p className="text-xs text-gray-500 mt-2">{reportData.creditScore.generatedDate}</p>
            </div>

            <div className="flex flex-col justify-center p-6 bg-white rounded-xl shadow-sm">
              <div className="mb-4">
                <p className="text-sm text-gray-600 font-semibold mb-2">Risk Level</p>
                <div className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${riskBadgeColor(reportData.riskAnalysis.riskLevel)}`}>
                  {reportData.riskAnalysis.riskLevel}
                </div>
              </div>
              <div>
                <p className="text-sm text-gray-600 font-semibold mb-2">Risk Grade</p>
                <div className="text-4xl font-bold text-slate-700">{reportData.riskAnalysis.riskGrade}</div>
              </div>
            </div>

            <div className="flex flex-col justify-center p-6 bg-white rounded-xl shadow-sm">
              <div className="flex items-end gap-2 mb-4">
                <TrendingUp className="w-5 h-5 text-blue-600" />
                <p className="text-sm text-gray-600 font-semibold">Approval Probability</p>
              </div>
              <div className="text-4xl font-bold text-blue-600 mb-2">
                {reportData.riskAnalysis.approvalProbability}%
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full"
                  style={{ width: `${reportData.riskAnalysis.approvalProbability}%` }}
                />
              </div>
            </div>

            <div className="flex flex-col justify-center p-6 bg-white rounded-xl shadow-sm">
              <div className="flex items-end gap-2 mb-4">
                <Shield className="w-5 h-5 text-slate-600" />
                <p className="text-sm text-gray-600 font-semibold">DPD Health (3M)</p>
              </div>
              <div className={`text-4xl font-bold mb-2 ${
                reportData.paymentHistory?.dpdHeatmap?.healthStatus === 'Green' ? 'text-green-600' :
                reportData.paymentHistory?.dpdHeatmap?.healthStatus === 'Yellow' ? 'text-yellow-600' :
                'text-red-600'
              }`}>
                {reportData.paymentHistory?.dpdHeatmap?.last3MonthsDPD || 0} DPD
              </div>
              <div className={`text-xs font-semibold px-2 py-1 rounded ${
                reportData.paymentHistory?.dpdHeatmap?.healthStatus === 'Green' ? 'bg-green-100 text-green-800' :
                reportData.paymentHistory?.dpdHeatmap?.healthStatus === 'Yellow' ? 'bg-yellow-100 text-yellow-800' :
                'bg-red-100 text-red-800'
              }`}>
                {reportData.paymentHistory?.dpdHeatmap?.healthStatus}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-6 border-b border-gray-200">
        {['overview', 'accounts', 'history', 'risk'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            className={`px-4 py-3 font-semibold text-sm border-b-2 transition ${
              activeTab === tab
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <Card>
            <CardHeader title={<><User size={16} className="text-gray-500" /> Customer Information</>} />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6">
              <div>
                <p className="text-sm text-gray-600 mb-1">Full Name</p>
                <p className="font-semibold text-lg">{reportData.customerProfile?.fullName}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">PAN</p>
                <p className="font-mono font-semibold">{reportData.customerProfile?.pan}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Date of Birth</p>
                <p className="font-semibold">{reportData.customerProfile?.dateOfBirth}</p>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title={<><Landmark size={16} className="text-gray-500" /> Account Summary</>} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6">
              <div className="bg-blue-50 p-4 rounded-lg">
                <p className="text-xs text-gray-600 mb-1">Total Accounts</p>
                <p className="text-2xl font-bold text-blue-600">{reportData.accountSummary?.totalAccounts}</p>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <p className="text-xs text-gray-600 mb-1">Active Accounts</p>
                <p className="text-2xl font-bold text-green-600">{reportData.accountSummary?.activeAccounts}</p>
              </div>
              <div className="bg-yellow-50 p-4 rounded-lg">
                <p className="text-xs text-gray-600 mb-1">Closed</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {(reportData.accountSummary?.totalAccounts || 0) - (reportData.accountSummary?.activeAccounts || 0)}
                </p>
              </div>
              <div className="bg-red-50 p-4 rounded-lg">
                <p className="text-xs text-gray-600 mb-1">Outstanding</p>
                <p className="text-lg font-bold text-red-600">₹{(reportData.accountSummary?.currentOutstanding || 0).toLocaleString()}</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Other tabs - placeholder for brevity */}
      {activeTab === 'accounts' && (
        <Card>
          <CardHeader title={<><ClipboardList size={16} className="text-gray-500" /> Loan Accounts</>} />
          {accountsLoading ? (
            <div className="p-6 text-center text-gray-500">Loading accounts...</div>
          ) : accountsError ? (
            <div className="p-6 text-center text-red-600">Failed to load accounts.</div>
          ) : !accountsData?.length ? (
            <div className="p-6 text-center text-gray-500">No accounts found.</div>
          ) : (
            <>
              <div className="divide-y divide-gray-100">
                {accountsData.map(acc => (
                  <div key={acc.id} className="p-4 flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium text-gray-900">{acc.lenderName ?? '—'}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{acc.loanType ?? '—'} · {acc.accountStatus ?? '—'}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">₹{(acc.currentBalance ?? 0).toLocaleString('en-IN')}</p>
                      <p className="text-xs text-gray-500 mt-0.5">EMI ₹{(acc.emiAmount ?? 0).toLocaleString('en-IN')}</p>
                    </div>
                  </div>
                ))}
              </div>
              {/* BUGFIX (Phase 14): the backend paginates but returns no
                  total-count/total-pages metadata (confirmed — plain
                  List<CibilAccountDto>) — no fabricated total is shown.
                  Next is only enabled when this page came back full,
                  which is the only safe signal that another page might
                  exist. */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <button
                  disabled={accountsPage <= 1}
                  onClick={() => setAccountsPage(p => Math.max(1, p - 1))}
                  className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Previous
                </button>
                <span className="text-xs text-gray-500">Page {accountsPage}</span>
                <button
                  disabled={accountsData.length < ACCOUNTS_PAGE_SIZE}
                  onClick={() => setAccountsPage(p => p + 1)}
                  className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Next
                </button>
              </div>
            </>
          )}
        </Card>
      )}

      {activeTab === 'history' && (
        <Card>
          <CardHeader title={<><TrendingUp size={16} className="text-gray-500" /> Payment History</>} />
          {historyLoading ? (
            <div className="p-6 text-center text-gray-500">Loading payment history...</div>
          ) : historyError ? (
            <div className="p-6 text-center text-red-600">Failed to load payment history.</div>
          ) : !historyData ? (
            <div className="p-6 text-center text-gray-500">No payment history available.</div>
          ) : (
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gray-50 p-4 rounded-lg text-center">
                  <p className="text-xs text-gray-600 mb-1">Last 3 Months DPD</p>
                  <p className="text-xl font-bold">{historyData.dpdHeatmap.last3MonthsDPD}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg text-center">
                  <p className="text-xs text-gray-600 mb-1">Last 6 Months DPD</p>
                  <p className="text-xl font-bold">{historyData.dpdHeatmap.last6MonthsDPD}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg text-center">
                  <p className="text-xs text-gray-600 mb-1">Last 12 Months DPD</p>
                  <p className="text-xl font-bold">{historyData.dpdHeatmap.last12MonthsDPD}</p>
                </div>
              </div>

              {historyData.missedPaymentAlerts.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm font-semibold text-red-800 mb-2">Missed Payment Alerts</p>
                  <ul className="text-sm text-red-700 space-y-1 list-disc list-inside">
                    {historyData.missedPaymentAlerts.map((alert, i) => <li key={i}>{alert}</li>)}
                  </ul>
                </div>
              )}

              {historyData.monthly.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-2">Monthly Status</p>
                  <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
                    {historyData.monthly.map((m, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span>{m.reportMonth}</span>
                        <span className="text-gray-500">{m.dpdStatus ?? '—'} · {m.daysOverdue} DPD</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {activeTab === 'risk' && (
        <Card>
          <CardHeader title={<><AlertTriangle size={16} className="text-amber-500" /> Risk Assessment</>} />
          {riskLoading ? (
            <div className="p-6 text-center text-gray-500">Loading risk analysis...</div>
          ) : riskError ? (
            <div className="p-6 text-center text-red-600">Failed to load risk analysis.</div>
          ) : !riskData ? (
            <div className="p-6 text-center text-gray-500">No risk analysis available.</div>
          ) : (
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gray-50 p-4 rounded-lg text-center">
                  <p className="text-xs text-gray-600 mb-1">Risk Level</p>
                  <p className="text-lg font-bold">{riskData.riskLevel ?? '—'}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg text-center">
                  <p className="text-xs text-gray-600 mb-1">Risk Grade</p>
                  <p className="text-lg font-bold">{riskData.riskGrade ?? '—'}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg text-center">
                  <p className="text-xs text-gray-600 mb-1">Bureau Risk Score</p>
                  <p className="text-lg font-bold">{riskData.bureauRiskScore}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg text-center">
                  <p className="text-xs text-gray-600 mb-1">Approval Probability</p>
                  <p className="text-lg font-bold">{riskData.approvalProbability}%</p>
                </div>
              </div>

              {riskData.lendingRecommendation && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm font-semibold text-blue-900">Recommendation: {riskData.lendingRecommendation}</p>
                </div>
              )}

              {riskData.riskFactors.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-2">Risk Factors</p>
                  <div className="space-y-1.5">
                    {riskData.riskFactors.map((f, i) => (
                      <div key={i} className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                        <span>{f.factor ?? '—'}{f.description ? ` — ${f.description}` : ''}</span>
                        <span className={`text-xs font-medium ${f.impact === 'Positive' ? 'text-green-600' : f.impact === 'Negative' ? 'text-red-600' : 'text-gray-500'}`}>
                          {f.impact ?? '—'} ({f.weight})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {riskData.riskWarnings.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm font-semibold text-red-800 mb-2">Warnings</p>
                  <ul className="text-sm text-red-700 space-y-1 list-disc list-inside">
                    {riskData.riskWarnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}

              {riskData.recommendations.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-2">Recommendations</p>
                  <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
                    {riskData.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
