import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, RefreshCw, Printer } from 'lucide-react'
import { formatCurrency, formatDate } from '@/utils/format'

// API Interface
const bureauApi = {
  getReport: async (customerId: number) => {
    const response = await fetch(`/api/bureau/${customerId}/report`)
    if (!response.ok) throw new Error('Failed to fetch bureau report')
    return response.json()
  },
  exportPDF: async (bureauReportId: number) => {
    const response = await fetch(`/api/bureau/${bureauReportId}/export-pdf`, { method: 'POST' })
    if (!response.ok) throw new Error('Failed to export PDF')
    return response.blob()
  }
}

interface BureauReportPageProps {
  customerId: number
  applicationId: string
}

export default function BureauReportPage({ customerId, applicationId }: BureauReportPageProps) {
  const [activeSection, setActiveSection] = useState<'overview' | 'accounts' | 'payments' | 'risk'>('overview')

  const { data: reportData, isLoading, refetch } = useQuery({
    queryKey: ['bureau', customerId],
    queryFn: () => bureauApi.getReport(customerId),
    enabled: !!customerId,
  })

  const report = reportData?.data

  const handleExportPDF = async () => {
    try {
      const blob = await bureauApi.exportPDF(report.id)
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `Bureau_Report_${report.id}.pdf`)
      document.body.appendChild(link)
      link.click()
      link.parentNode?.removeChild(link)
    } catch (error) {
      console.error('Export failed:', error)
    }
  }

  const handlePrint = () => {
    window.print()
  }

  const handleCopySummary = () => {
    const summary = `
Bureau Report Summary
Score: ${report.creditScore.score}/900 (${report.creditScore.category})
Risk Level: ${report.riskAnalysis.riskLevel}
Approval Probability: ${report.riskAnalysis.approvalProbability}%
Customer: ${report.customerProfile.fullName}
Generated: ${new Date(report.generatedAt).toLocaleString()}
    `
    navigator.clipboard.writeText(summary)
    alert('Summary copied to clipboard')
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!report) {
    return <div className="text-center py-12 text-gray-500">No bureau report available</div>
  }

  return (
    <div className="space-y-6 print:space-y-3">
      {/* Header with Actions */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 print:border-0 print:p-4">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Bureau Report</h2>
            <p className="text-sm text-gray-500 mt-1">
              Generated: {new Date(report.generatedAt).toLocaleString()}
            </p>
          </div>
          <div className="flex gap-2 print:hidden">
            <button
              onClick={handleCopySummary}
              className="flex items-center gap-2 px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors text-sm"
              title="Copy Summary"
            >
              <Download className="w-4 h-4" />
              Copy Summary
            </button>
            <button
              onClick={() => refetch()}
              className="flex items-center gap-2 px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors text-sm"
              title="Refresh Report"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors text-sm"
              title="Print Report"
            >
              <Printer className="w-4 h-4" />
              Print
            </button>
          </div>
        </div>

        {/* Bureau Score Card Section */}
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4 mt-6 print:gap-2">
          {/* Credit Score Gauge */}
          <div className="md:col-span-2 bg-gradient-to-br from-blue-50 to-green-50 rounded-lg p-6 print:p-3 border border-blue-100 print:border-gray-300">
            <div className="text-center">
              {/* Semicircle Gauge */}
              <div className="relative w-32 h-16 mx-auto mb-2 print:mb-1">
                <svg viewBox="0 0 200 100" className="w-full">
                  {/* Background arc */}
                  <path
                    d="M 20 100 A 80 80 0 0 1 180 100"
                    fill="none"
                    stroke="#e5e7eb"
                    strokeWidth="8"
                    strokeLinecap="round"
                  />
                  {/* Score arc */}
                  <path
                    d="M 20 100 A 80 80 0 0 1 180 100"
                    fill="none"
                    stroke="#22c55e"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={`${(report.creditScore.score / 900) * 251.3} 251.3`}
                  />
                  {/* Score text */}
                  <text x="100" y="60" textAnchor="middle" className="text-2xl font-bold fill-green-600">
                    {report.creditScore.score}
                  </text>
                </svg>
              </div>
              <div className="text-xs text-gray-600 print:text-xs">out of 900</div>
              <div className="text-lg font-bold text-green-600 mt-1 print:mt-0 print:text-base">
                {report.creditScore.category}
              </div>
              <div className="text-xs text-green-600 mt-2 print:text-xs">✓ Live CIBIL Score</div>
              <div className="text-xs text-green-600 print:text-xs">✓ Eligible for Loan</div>
            </div>
          </div>

          {/* Quick Info Cards */}
          <div className="md:col-span-4 grid grid-cols-2 gap-3 print:gap-2">
            {/* Risk Level */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 print:p-2">
              <div className="text-xs text-gray-600 font-semibold print:text-xs">RISK LEVEL</div>
              <div className="text-lg font-bold text-green-600 mt-1 print:mt-0 print:text-base">
                {report.riskAnalysis.riskLevel}
              </div>
            </div>

            {/* Approval Probability */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 print:p-2">
              <div className="text-xs text-gray-600 font-semibold print:text-xs">APPROVAL PROB.</div>
              <div className="text-lg font-bold text-blue-600 mt-1 print:mt-0 print:text-base">
                {report.riskAnalysis.approvalProbability}%+
              </div>
            </div>

            {/* PAN */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 print:p-2">
              <div className="text-xs text-gray-600 font-semibold print:text-xs">PAN</div>
              <div className="text-sm font-mono text-gray-900 mt-1 print:mt-0 print:text-xs">
                {report.customerProfile.pan}
              </div>
            </div>

            {/* Name */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 print:p-2">
              <div className="text-xs text-gray-600 font-semibold print:text-xs">NAME</div>
              <div className="text-sm font-semibold text-gray-900 mt-1 print:mt-0 print:text-xs">
                {report.customerProfile.fullName}
              </div>
            </div>

            {/* DOB */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 print:p-2">
              <div className="text-xs text-gray-600 font-semibold print:text-xs">DATE OF BIRTH</div>
              <div className="text-sm text-gray-900 mt-1 print:mt-0 print:text-xs">
                {formatDate(report.customerProfile.dateOfBirth, 'YYYY-MM-DD')}
              </div>
            </div>

            {/* Report Time */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 print:p-2">
              <div className="text-xs text-gray-600 font-semibold print:text-xs">REPORT TIME</div>
              <div className="text-sm text-gray-900 mt-1 print:mt-0 print:text-xs">
                {new Date(report.creditScore.generatedDate).toLocaleTimeString('en-IN')}
                <br />
                {formatDate(report.creditScore.generatedDate, 'DD/MM/YYYY')}
              </div>
            </div>
          </div>
        </div>

        {/* Score vs Benchmarks */}
        <div className="mt-6 print:mt-3">
          <h3 className="text-sm font-semibold text-gray-600 mb-2 print:mb-1 uppercase">Score vs Benchmarks</h3>
          <div className="flex items-center gap-4 print:gap-2">
            <div className="flex-1 bg-gray-200 rounded-full h-2 print:h-1 overflow-hidden">
              <div
                className="bg-green-500 h-full transition-all"
                style={{ width: `${(report.creditScore.score / 900) * 100}%` }}
              ></div>
            </div>
            <span className="text-sm font-semibold text-gray-900 print:text-xs">
              {report.creditScore.score}
            </span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-white border-b border-gray-200 print:hidden">
        <div className="flex gap-6 px-6">
          {[
            { id: 'overview', label: '📊 Overview' },
            { id: 'accounts', label: '💼 Accounts' },
            { id: 'payments', label: '📅 Payment History' },
            { id: 'risk', label: '⚠️ Risk Analysis' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveSection(tab.id as any)}
              className={`py-4 px-1 border-b-2 font-medium transition-colors ${
                activeSection === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content Sections */}
      <div className="print:block">
        {activeSection === 'overview' && (
          <>
            {/* Account Summary */}
            <AccountSummarySection summary={report.accountSummary} />

            {/* Score Factors */}
            <ScoreFactorsSection creditScore={report.creditScore} />

            {/* Customer Profile */}
            <CustomerProfileSection profile={report.customerProfile} />
          </>
        )}

        {activeSection === 'accounts' && <AccountsSection accounts={report.accounts} />}

        {activeSection === 'payments' && <PaymentHistorySection payment={report.paymentHistory} />}

        {activeSection === 'risk' && <RiskAnalysisSection risk={report.riskAnalysis} behaviour={report.behaviourAnalysis} enquiry={report.enquiryAnalysis} />}
      </div>
    </div>
  )
}

// ===== SECTION COMPONENTS =====

function AccountSummarySection({ summary }: any) {
  const cards = [
    { label: 'TOTAL ACCOUNTS', value: summary.totalAccounts, icon: '📊' },
    { label: 'ACTIVE ACCOUNTS', value: summary.activeAccounts, icon: '✓' },
    { label: 'CLOSED ACCOUNTS', value: summary.closedAccounts, icon: '✕' },
    { label: 'TOTAL SANCTION', value: formatCurrency(summary.totalSanctionAmount), icon: '💰' },
    { label: 'CURRENT OUTSTANDING', value: formatCurrency(summary.currentOutstanding), icon: '💳' },
    { label: 'OVERDUE AMOUNT', value: formatCurrency(summary.overdueAmount), icon: '⚠️', color: 'red' },
  ]

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 print:border-gray-300 print:p-4 mb-6 print:mb-3 print:break-inside-avoid">
      <h2 className="text-xl font-bold text-gray-900 mb-4 print:mb-2 print:text-lg">Account Summary</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 print:gap-2">
        {cards.map((card, i) => (
          <div key={i} className="bg-gray-50 rounded-lg p-4 print:p-2 border border-gray-200 print:border-gray-300">
            <div className="text-2xl mb-1 print:text-xl">{card.icon}</div>
            <div className="text-xs text-gray-600 font-semibold print:text-xs">{card.label}</div>
            <div className={`text-lg font-bold mt-1 print:text-base ${
              card.color === 'red' ? 'text-red-600' : 'text-gray-900'
            }`}>
              {card.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ScoreFactorsSection({ creditScore }: any) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 print:border-gray-300 print:p-4 mb-6 print:mb-3 print:break-inside-avoid">
      <h2 className="text-xl font-bold text-gray-900 mb-4 print:mb-2 print:text-lg">Score Factors</h2>
      <div className="grid md:grid-cols-2 gap-6 print:gap-3">
        {/* Positive Factors */}
        <div>
          <h3 className="font-semibold text-green-600 mb-3 print:mb-2 print:text-sm flex items-center gap-2">
            <span>✓</span> Positive Factors
          </h3>
          <div className="space-y-2 print:space-y-1">
            {creditScore.positiveFactors?.map((factor: any, i: number) => (
              <div key={i} className="bg-green-50 border border-green-200 rounded p-3 print:p-2">
                <div className="font-semibold text-sm text-gray-900 print:text-xs">{factor.factor}</div>
                <div className="text-xs text-gray-600 mt-1 print:mt-0">{factor.description}</div>
                <div className="text-xs font-semibold text-green-600 mt-1 print:mt-0">+{factor.impactScore} points</div>
              </div>
            ))}
          </div>
        </div>

        {/* Negative Factors */}
        <div>
          <h3 className="font-semibold text-red-600 mb-3 print:mb-2 print:text-sm flex items-center gap-2">
            <span>✕</span> Negative Factors
          </h3>
          <div className="space-y-2 print:space-y-1">
            {creditScore.negativeFactors?.map((factor: any, i: number) => (
              <div key={i} className="bg-red-50 border border-red-200 rounded p-3 print:p-2">
                <div className="font-semibold text-sm text-gray-900 print:text-xs">{factor.factor}</div>
                <div className="text-xs text-gray-600 mt-1 print:mt-0">{factor.description}</div>
                <div className="text-xs font-semibold text-red-600 mt-1 print:mt-0">-{factor.impactScore} points</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function CustomerProfileSection({ profile }: any) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 print:border-gray-300 print:p-4 mb-6 print:mb-3 print:break-inside-avoid">
      <h2 className="text-xl font-bold text-gray-900 mb-4 print:mb-2 print:text-lg">Customer Profile</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 print:gap-2 print:text-sm">
        <div>
          <div className="text-xs text-gray-600 font-semibold print:text-xs">FULL NAME</div>
          <div className="text-gray-900 mt-1 print:mt-0">{profile.fullName}</div>
        </div>
        <div>
          <div className="text-xs text-gray-600 font-semibold print:text-xs">DATE OF BIRTH</div>
          <div className="text-gray-900 mt-1 print:mt-0">{formatDate(profile.dateOfBirth, 'DD-MM-YYYY')}</div>
        </div>
        <div>
          <div className="text-xs text-gray-600 font-semibold print:text-xs">GENDER</div>
          <div className="text-gray-900 mt-1 print:mt-0">{profile.gender}</div>
        </div>
        <div>
          <div className="text-xs text-gray-600 font-semibold print:text-xs">PAN</div>
          <div className="text-gray-900 font-mono mt-1 print:mt-0">{profile.pan}</div>
        </div>
        <div>
          <div className="text-xs text-gray-600 font-semibold print:text-xs">AADHAAR</div>
          <div className="text-gray-900 font-mono mt-1 print:mt-0">{profile.aadhaarMasked}</div>
        </div>
        <div>
          <div className="text-xs text-gray-600 font-semibold print:text-xs">CKYC NUMBER</div>
          <div className="text-gray-900 font-mono mt-1 print:mt-0">{profile.cKYCNumber || '—'}</div>
        </div>
        <div>
          <div className="text-xs text-gray-600 font-semibold print:text-xs">OCCUPATION TYPE</div>
          <div className="text-gray-900 mt-1 print:mt-0">{profile.occupationType}</div>
        </div>
        <div>
          <div className="text-xs text-gray-600 font-semibold print:text-xs">ANNUAL INCOME</div>
          <div className="text-gray-900 mt-1 print:mt-0">{formatCurrency(profile.annualIncome)}</div>
        </div>
      </div>
      {profile.mobileNumbers?.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-200 print:mt-2 print:pt-2">
          <div className="text-xs text-gray-600 font-semibold mb-1 print:text-xs">MOBILE NUMBERS</div>
          <div className="text-sm text-gray-900">{profile.mobileNumbers.join(', ')}</div>
        </div>
      )}
      {profile.emailAddresses?.length > 0 && (
        <div className="mt-2">
          <div className="text-xs text-gray-600 font-semibold mb-1 print:text-xs">EMAIL ADDRESSES</div>
          <div className="text-sm text-gray-900">{profile.emailAddresses.join(', ')}</div>
        </div>
      )}
    </div>
  )
}

function AccountsSection({ accounts }: any) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden print:border-gray-300 print:break-inside-avoid">
      <div className="p-6 print:p-4 border-b border-gray-200 print:border-gray-300">
        <h2 className="text-xl font-bold text-gray-900 print:text-lg">Loan Accounts ({accounts?.length || 0})</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm print:text-xs">
          <thead className="bg-gray-50 print:bg-gray-100 border-b border-gray-200 print:border-gray-300">
            <tr>
              <th className="px-4 py-2 text-left font-semibold text-gray-700 print:px-2 print:py-1">LENDER</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-700 print:px-2 print:py-1">LOAN TYPE</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-700 print:px-2 print:py-1">ACCOUNT #</th>
              <th className="px-4 py-2 text-right font-semibold text-gray-700 print:px-2 print:py-1">SANCTION</th>
              <th className="px-4 py-2 text-right font-semibold text-gray-700 print:px-2 print:py-1">BALANCE</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-700 print:px-2 print:py-1">STATUS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 print:divide-gray-300">
            {accounts?.map((account: any, i: number) => (
              <tr key={i} className="hover:bg-gray-50 print:hover:bg-white">
                <td className="px-4 py-2 text-gray-900 print:px-2 print:py-1">{account.lenderName}</td>
                <td className="px-4 py-2 text-gray-700 print:px-2 print:py-1">{account.loanType}</td>
                <td className="px-4 py-2 text-gray-700 font-mono print:px-2 print:py-1">{account.accountNumberMasked}</td>
                <td className="px-4 py-2 text-right text-gray-700 print:px-2 print:py-1">{formatCurrency(account.sanctionAmount)}</td>
                <td className="px-4 py-2 text-right text-gray-700 print:px-2 print:py-1">{formatCurrency(account.currentBalance)}</td>
                <td className="px-4 py-2 print:px-2 print:py-1">
                  <span className={`px-2 py-1 rounded text-xs font-semibold print:px-1 print:py-0 ${
                    account.accountStatus === 'Active' ? 'bg-green-100 text-green-800' :
                    account.accountStatus === 'Closed' ? 'bg-gray-100 text-gray-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {account.accountStatus}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PaymentHistorySection({ payment }: any) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 print:border-gray-300 print:p-4 print:break-inside-avoid">
      <h2 className="text-xl font-bold text-gray-900 mb-4 print:mb-2 print:text-lg">Payment History & DPD Analysis</h2>
      
      {/* DPD Heatmap */}
      <div className="mb-6 print:mb-3">
        <h3 className="font-semibold text-gray-900 mb-3 print:mb-2 print:text-sm">DPD Status Heatmap</h3>
        <div className="grid grid-cols-4 gap-2 print:gap-1">
          {[
            { label: 'Last 3M', value: payment.dpdHeatmap.last3MonthsDPD },
            { label: 'Last 6M', value: payment.dpdHeatmap.last6MonthsDPD },
            { label: 'Last 12M', value: payment.dpdHeatmap.last12MonthsDPD },
            { label: 'Status', value: payment.dpdHeatmap.healthStatus },
          ].map((item, i) => (
            <div key={i} className="bg-gray-50 rounded p-3 print:p-2 border border-gray-200 print:border-gray-300">
              <div className="text-xs text-gray-600 font-semibold print:text-xs">{item.label}</div>
              <div className={`text-lg font-bold mt-1 print:mt-0 print:text-base ${
                item.value === 'Red' ? 'text-red-600' : 'text-green-600'
              }`}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Monthly Timeline */}
      <div>
        <h3 className="font-semibold text-gray-900 mb-3 print:mb-2 print:text-sm">Monthly Payment Status</h3>
        <div className="space-y-2 print:space-y-1 max-h-96 overflow-y-auto">
          {payment.monthly?.map((m: any, i: number) => (
            <div key={i} className="flex items-center gap-3 print:gap-2 text-sm print:text-xs">
              <div className="min-w-20 text-gray-600">{new Date(m.reportMonth).toLocaleString('en-IN', { month: 'short', year: 'numeric' })}</div>
              <div className={`px-2 py-1 rounded font-semibold print:px-1 print:py-0 ${
                m.daysOverdue === 0 ? 'bg-green-100 text-green-800' :
                m.daysOverdue <= 30 ? 'bg-yellow-100 text-yellow-800' :
                m.daysOverdue <= 90 ? 'bg-orange-100 text-orange-800' :
                'bg-red-100 text-red-800'
              }`}>
                {m.dpdStatus}
              </div>
              {m.isMissedPayment && <span className="text-red-600 font-semibold">⚠️ Missed</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function RiskAnalysisSection({ risk, behaviour, enquiry }: any) {
  return (
    <div className="space-y-6 print:space-y-3">
      {/* Risk Grade */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 print:border-gray-300 print:p-4 print:break-inside-avoid">
        <h2 className="text-xl font-bold text-gray-900 mb-4 print:mb-2 print:text-lg">Risk Assessment</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 print:gap-2">
          <div className="bg-blue-50 border border-blue-200 rounded p-4 print:p-2">
            <div className="text-xs text-gray-600 font-semibold print:text-xs">RISK LEVEL</div>
            <div className="text-2xl font-bold text-blue-600 mt-2 print:mt-1 print:text-lg">{risk.riskLevel}</div>
          </div>
          <div className="bg-purple-50 border border-purple-200 rounded p-4 print:p-2">
            <div className="text-xs text-gray-600 font-semibold print:text-xs">RISK GRADE</div>
            <div className="text-2xl font-bold text-purple-600 mt-2 print:mt-1 print:text-lg">{risk.riskGrade}</div>
          </div>
          <div className="bg-green-50 border border-green-200 rounded p-4 print:p-2">
            <div className="text-xs text-gray-600 font-semibold print:text-xs">BUREAU RISK SCORE</div>
            <div className="text-2xl font-bold text-green-600 mt-2 print:mt-1 print:text-lg">{risk.bureauRiskScore.toFixed(0)}/100</div>
          </div>
          <div className="bg-orange-50 border border-orange-200 rounded p-4 print:p-2">
            <div className="text-xs text-gray-600 font-semibold print:text-xs">APPROVAL PROB.</div>
            <div className="text-2xl font-bold text-orange-600 mt-2 print:mt-1 print:text-lg">{risk.approvalProbability}%</div>
          </div>
        </div>
      </div>

      {/* Risk Factors */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 print:border-gray-300 print:p-4 print:break-inside-avoid">
        <h2 className="text-lg font-bold text-gray-900 mb-4 print:mb-2 print:text-base">Risk Factors</h2>
        <div className="space-y-2 print:space-y-1">
          {risk.riskFactors?.map((factor: any, i: number) => (
            <div key={i} className="flex items-start gap-3 print:gap-2">
              <span className={`text-lg print:text-base ${factor.impact === 'Positive' ? '✓' : '✕'}`}></span>
              <div className="flex-1 text-sm print:text-xs">
                <div className="font-semibold text-gray-900">{factor.factor}</div>
                <div className="text-gray-600">{factor.description}</div>
              </div>
              <span className={`px-2 py-1 rounded text-xs font-semibold print:px-1 print:py-0 ${
                factor.impact === 'Positive' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}>
                {factor.impact}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Behaviour Analysis */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 print:border-gray-300 print:p-4 print:break-inside-avoid">
        <h2 className="text-lg font-bold text-gray-900 mb-4 print:mb-2 print:text-base">Credit Behaviour</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 print:gap-2 mb-4 print:mb-2">
          <div className="bg-blue-50 rounded p-3 print:p-2 border border-blue-200 print:border-gray-300">
            <div className="text-xs text-gray-600 print:text-xs">Repayment Discipline</div>
            <div className="text-xl font-bold text-blue-600 mt-1 print:mt-0 print:text-base">{behaviour.repaymentDisciplineScore}/100</div>
          </div>
          <div className="bg-purple-50 rounded p-3 print:p-2 border border-purple-200 print:border-gray-300">
            <div className="text-xs text-gray-600 print:text-xs">Account Age</div>
            <div className="text-xl font-bold text-purple-600 mt-1 print:mt-0 print:text-base">{behaviour.accountAgeMonths}M</div>
          </div>
          <div className="bg-green-50 rounded p-3 print:p-2 border border-green-200 print:border-gray-300">
            <div className="text-xs text-gray-600 print:text-xs">Credit Maturity</div>
            <div className="text-xl font-bold text-green-600 mt-1 print:mt-0 print:text-base">{behaviour.creditMaturity}</div>
          </div>
          <div className="bg-orange-50 rounded p-3 print:p-2 border border-orange-200 print:border-gray-300">
            <div className="text-xs text-gray-600 print:text-xs">Delinquency</div>
            <div className="text-xl font-bold text-orange-600 mt-1 print:mt-0 print:text-base">{behaviour.delinquencyFrequency}</div>
          </div>
        </div>
        {behaviour.autoGeneratedInsights?.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded p-4 print:p-2 print:bg-white print:border-gray-300">
            <div className="font-semibold text-gray-900 mb-2 print:mb-1 print:text-sm">Insights</div>
            <ul className="space-y-1 print:space-y-0">
              {behaviour.autoGeneratedInsights.map((insight: string, i: number) => (
                <li key={i} className="text-sm text-gray-700 print:text-xs flex gap-2">
                  <span>•</span> {insight}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Enquiry Analysis */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 print:border-gray-300 print:p-4 print:break-inside-avoid">
        <h2 className="text-lg font-bold text-gray-900 mb-4 print:mb-2 print:text-base">Enquiry Analysis</h2>
        <div className="grid grid-cols-4 gap-2 print:gap-1 mb-4 print:mb-2">
          <div className="bg-gray-50 rounded p-3 print:p-2 border border-gray-200 print:border-gray-300">
            <div className="text-xs text-gray-600 print:text-xs">30 Days</div>
            <div className="text-xl font-bold text-gray-900 mt-1 print:mt-0 print:text-base">{enquiry.count30Days}</div>
          </div>
          <div className="bg-gray-50 rounded p-3 print:p-2 border border-gray-200 print:border-gray-300">
            <div className="text-xs text-gray-600 print:text-xs">90 Days</div>
            <div className="text-xl font-bold text-gray-900 mt-1 print:mt-0 print:text-base">{enquiry.count90Days}</div>
          </div>
          <div className="bg-gray-50 rounded p-3 print:p-2 border border-gray-200 print:border-gray-300">
            <div className="text-xs text-gray-600 print:text-xs">12 Months</div>
            <div className="text-xl font-bold text-gray-900 mt-1 print:mt-0 print:text-base">{enquiry.count12Months}</div>
          </div>
          <div className="bg-gray-50 rounded p-3 print:p-2 border border-gray-200 print:border-gray-300">
            <div className="text-xs text-gray-600 print:text-xs">24 Months</div>
            <div className="text-xl font-bold text-gray-900 mt-1 print:mt-0 print:text-base">{enquiry.count24Months}</div>
          </div>
        </div>
        {(enquiry.highEnquiryFrequency || enquiry.loanShoppingDetected || enquiry.creditHungryCustomer) && (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-4 print:p-2 print:bg-white print:border-gray-300">
            <div className="font-semibold text-yellow-900 mb-2 print:mb-1 print:text-sm text-yellow-900">⚠️ Warnings</div>
            <ul className="space-y-1 print:space-y-0 text-sm print:text-xs text-yellow-900">
              {enquiry.highEnquiryFrequency && <li>• High enquiry frequency detected</li>}
              {enquiry.loanShoppingDetected && <li>• Loan shopping behavior detected</li>}
              {enquiry.creditHungryCustomer && <li>• Customer appears credit-hungry</li>}
            </ul>
          </div>
        )}
      </div>

      {/* Lending Recommendation */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 print:border-gray-300 print:p-4 print:break-inside-avoid">
        <h2 className="text-lg font-bold text-gray-900 mb-4 print:mb-2 print:text-base">Lending Recommendation</h2>
        <div className={`p-4 print:p-3 rounded-lg border-2 print:border text-center print:text-center ${
          risk.lendingRecommendation === 'Approve' ? 'bg-green-50 border-green-300 print:border-green-600' :
          risk.lendingRecommendation === 'Review' ? 'bg-yellow-50 border-yellow-300 print:border-yellow-600' :
          'bg-red-50 border-red-300 print:border-red-600'
        }`}>
          <div className={`text-3xl font-bold print:text-2xl ${
            risk.lendingRecommendation === 'Approve' ? 'text-green-700' :
            risk.lendingRecommendation === 'Review' ? 'text-yellow-700' :
            'text-red-700'
          }`}>
            {risk.lendingRecommendation}
          </div>
        </div>
        {risk.recommendations?.length > 0 && (
          <div className="mt-4 print:mt-2 space-y-2 print:space-y-1">
            {risk.recommendations.map((rec: string, i: number) => (
              <div key={i} className="flex gap-2 text-sm print:text-xs">
                <span className="text-blue-600">→</span>
                <span className="text-gray-700">{rec}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
