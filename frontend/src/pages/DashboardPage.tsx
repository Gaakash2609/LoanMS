import { useDashboard } from '@/hooks/useLoans'
import { Card, CardHeader } from '@/components/ui/Card'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { StatusBadge } from '@/components/ui/Badge'
import { formatCurrency, formatDate } from '@/utils/format'
import { TrendingUp, Users, CreditCard, CheckCircle, XCircle, Banknote, Brain } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useQuery, useMutation } from '@tanstack/react-query'
import { expertExportApi } from '@/api/expertExportApi'
import { Button } from '@/components/ui/Button'
import { useState } from 'react'

// ── Expert Export button — ExpertExportController's /access gate (matches
// legacy's expertExportCheckAccess/_expertExportApplyVisibility: hidden
// entirely if not allowed) + /data download (matches expertExportRun:
// disable-while-pending, blob download, same filename pattern, distinct
// 403 vs generic-failure messaging).
function ExpertExportButton() {
  const [error, setError] = useState('')
  const { data: access } = useQuery({
    queryKey: ['expertExportAccess'],
    queryFn: () => expertExportApi.access().then(r => r.data),
    staleTime: 30_000, // matches legacy's 30s access-check cache
  })

  const download = useMutation({
    mutationFn: () => expertExportApi.downloadData(),
    onSuccess: (res) => {
      const blob = new Blob([res.data], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `expert-export-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setError('')
    },
    onError: (e: unknown) => {
      const status = (e as { response?: { status?: number } })?.response?.status
      setError(status === 403 ? 'You do not have permission for Expert Export' : 'Expert Export failed')
    },
  })

  if (!access?.allowed) return null

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" loading={download.isPending} onClick={() => download.mutate()}>
        <Brain size={14} className="mr-1.5" />Expert Export
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

export default function DashboardPage() {
  const { data: stats, isLoading } = useDashboard()
  const user = useAuthStore((s) => s.user)

  if (isLoading) return <LoadingSpinner size="lg" />

  const statCards = [
    { label: 'Total Loans',     value: stats?.totalLoans ?? 0,       icon: CreditCard,  color: 'text-blue-600',   bg: 'bg-blue-50' },
    { label: 'Total Customers', value: stats?.totalCustomers ?? 0,   icon: Users,       color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: 'Pending Review',  value: stats?.pendingLoans ?? 0,     icon: TrendingUp,  color: 'text-yellow-600', bg: 'bg-yellow-50' },
    { label: 'Approved',        value: stats?.approvedLoans ?? 0,    icon: CheckCircle, color: 'text-green-600',  bg: 'bg-green-50' },
    { label: 'Disbursed',       value: stats?.disbursedLoans ?? 0,   icon: Banknote,    color: 'text-emerald-600',bg: 'bg-emerald-50' },
    { label: 'Rejected',        value: stats?.rejectedLoans ?? 0,    icon: XCircle,     color: 'text-red-600',    bg: 'bg-red-50' },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Welcome back, {user?.fullName}</p>
        </div>
        <ExpertExportButton />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {statCards.map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label} className="p-4">
            <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center mb-3`}>
              <Icon size={18} className={color} />
            </div>
            <p className="text-2xl font-bold text-gray-900">{value.toLocaleString('en-IN')}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </Card>
        ))}
      </div>

      {/* Amount cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Requested</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(stats?.totalRequestedAmount)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Approved</p>
          <p className="text-xl font-bold text-green-600 mt-1">{formatCurrency(stats?.totalApprovedAmount)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Disbursed</p>
          <p className="text-xl font-bold text-emerald-600 mt-1">{formatCurrency(stats?.totalDisbursedAmount)}</p>
        </Card>
      </div>

      {/* Recent loans */}
      <Card>
        <CardHeader title="Recent Loans" subtitle="Last 10 applications" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-gray-100">
                {['Loan #', 'Customer', 'Type', 'Amount', 'Status', 'Date'].map((h) => (
                  <th key={h} className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {stats?.recentLoans?.map((loan) => (
                <tr key={loan.id} className="hover:bg-gray-50 transition-colors">
                  <td className="py-3 pr-4 font-mono text-xs text-gray-600">{loan.loanNumber}</td>
                  <td className="py-3 pr-4 text-gray-900">{loan.customerName}</td>
                  <td className="py-3 pr-4 text-gray-600">{loan.loanType}</td>
                  <td className="py-3 pr-4 font-medium">{formatCurrency(loan.requestedAmount)}</td>
                  <td className="py-3 pr-4"><StatusBadge status={loan.status} /></td>
                  <td className="py-3 text-gray-500 text-xs">{formatDate(loan.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
