import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import PageHeader from '@/components/shared/PageHeader'
import { 
  AlertCircle, CheckCircle, Clock, TrendingDown, TrendingUp, 
  Download, RefreshCw, PrinterIcon, Copy, FileText, AlertTriangle,
  DollarSign, Calendar, Building, User, MapPin, Phone, Mail,
  BarChart3, PieChart, LineChart, Shield, Zap
} from 'lucide-react'

interface CibilReport {
  creditScore: { score: number; category: string; generatedDate: string }
  customerProfile: { fullName: string; pan: string; dateOfBirth: string }
  accountSummary: { totalAccounts: number; activeAccounts: number; currentOutstanding: number }
  riskAnalysis: { riskLevel: string; riskGrade: string; approvalProbability: number }
  paymentHistory: { dpdHeatmap: { healthStatus: string; last3MonthsDPD: number } }
}

export default function CibilPage() {
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'accounts' | 'history' | 'risk'>('overview')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const cId = params.get('customerId')
    if (cId) setCustomerId(parseInt(cId))
  }, [])

  const { data: reportData, isLoading, error, refetch } = useQuery({
    queryKey: ['cibil-report', customerId],
    queryFn: async () => {
      if (!customerId) return null
      const res = await api.get<ApiResponse<CibilReport>>(`/api/cibil/full-report?customerId=${customerId}`)
      return res.data.data
    },
    enabled: !!customerId,
  })

  const { data: accountsData } = useQuery({
    queryKey: ['cibil-accounts', customerId],
    queryFn: async () => {
      if (!customerId) return []
      const res = await api.get(`/api/cibil/accounts?customerId=${customerId}`)
      return res.data.data
    },
    enabled: !!customerId && activeTab === 'accounts',
  })

  const { data: historyData } = useQuery({
    queryKey: ['cibil-history', customerId],
    queryFn: async () => {
      if (!customerId) return null
      const res = await api.get(`/api/cibil/payment-history?customerId=${customerId}`)
      return res.data.data
    },
    enabled: !!customerId && activeTab === 'history',
  })

  const { data: riskData } = useQuery({
    queryKey: ['cibil-risk', customerId],
    queryFn: async () => {
      if (!customerId) return null
      const res = await api.get(`/api/cibil/risk-analysis?customerId=${customerId}`)
      return res.data.data
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
        <PageHeader title="📊 CIBIL Report" subtitle={`${reportData.customerProfile?.fullName || 'Customer'}'s Credit Profile`} />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
          <Button variant="outline" size="sm">
            <PrinterIcon className="w-4 h-4 mr-2" /> Print
          </Button>
          <Button variant="outline" size="sm">
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
            <CardHeader title="👤 Customer Information" />
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
            <CardHeader title="🏦 Account Summary" />
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
          <CardHeader title="📋 Loan Accounts" />
          <div className="p-6 text-center text-gray-500">
            {accountsData && accountsData.length > 0 ? `${accountsData.length} accounts` : 'No accounts found'}
          </div>
        </Card>
      )}

      {activeTab === 'history' && (
        <Card>
          <CardHeader title="📈 Payment History" />
          <div className="p-6 text-center text-gray-500">Loading payment history...</div>
        </Card>
      )}

      {activeTab === 'risk' && (
        <Card>
          <CardHeader title="⚠️ Risk Assessment" />
          <div className="p-6 text-center text-gray-500">Loading risk analysis...</div>
        </Card>
      )}
    </div>
  )
}
