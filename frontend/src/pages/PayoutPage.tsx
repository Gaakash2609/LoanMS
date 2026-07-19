import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { payoutApi, type PayoutClaim } from '@/api/payoutApi'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import DataTable, { type Column } from '@/components/shared/DataTable'
import { formatCurrency, formatDate } from '@/utils/format'
import { TrendingUp, CheckCircle, Clock, XCircle, DollarSign, BarChart3, Download, Plus, Search } from 'lucide-react'

const STATUS_VARIANTS: Record<string, 'default'|'success'|'warning'|'danger'|'info'> = {
  Pending: 'warning', Approved: 'success', Paid: 'info', Rejected: 'danger',
}

interface StatCardProps {
  icon: React.ReactNode
  label: string
  value: string | number
  subtext?: string
  bgColor: string
  textColor: string
  accentColor: string
}

function StatCard({ icon, label, value, subtext, bgColor, textColor, accentColor }: StatCardProps) {
  return (
    <div className={`${bgColor} rounded-2xl p-6 border-2 ${accentColor} shadow-sm hover:shadow-md transition-shadow`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`${textColor} p-2.5 bg-white rounded-lg`}>
          {icon}
        </div>
        <TrendingUp size={18} className={`${textColor} opacity-50`} />
      </div>
      <p className="text-sm font-medium text-gray-600 mb-1">{label}</p>
      <p className={`text-3xl font-bold ${textColor} mb-1`}>{value}</p>
      {subtext && <p className="text-xs text-gray-500">{subtext}</p>}
    </div>
  )
}

interface StatusCardProps {
  icon: string
  count: number
  label: string
  description: string
  color: string
}

function StatusCard({ icon, count, label, description, color }: StatusCardProps) {
  return (
    <div className="bg-white rounded-lg p-4 border border-gray-200 hover:shadow-md transition-shadow">
      <div className={`text-2xl font-bold mb-1 ${color}`}>{icon}</div>
      <div className="text-2xl font-bold text-gray-900 mb-1">{count}</div>
      <div className="text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">{label}</div>
      <div className="text-xs text-gray-500">{description}</div>
    </div>
  )
}

export default function PayoutPage() {
  const [activeTab, setActiveTab] = useState<'claims' | 'management'>('claims')
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterMonth, setFilterMonth] = useState('')
  const [page, setPage] = useState(1)
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['payouts', page, filterStatus],
    queryFn: () => payoutApi.getClaims({ page, pageSize: 20, status: filterStatus || undefined }).then(r => r.data.data),
  })

  const update = useMutation({
    mutationFn: ({ id, newStatus }: { id: number; newStatus: string }) =>
      payoutApi.updateClaimStatus(id, newStatus),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payouts'] }),
  })

  // Calculate statistics for both tabs
  const claimsStats = useMemo(() => ({
    pending: data?.items?.filter(c => c.status === 'Pending').length ?? 0,
    approved: data?.items?.filter(c => c.status === 'Approved').length ?? 0,
    paid: data?.items?.filter(c => c.status === 'Paid').length ?? 0,
    rejected: data?.items?.filter(c => c.status === 'Rejected').length ?? 0,
    totalDisbursed: data?.items?.reduce((sum, c) => sum + (c.claimAmount || 0), 0) ?? 0,
  }), [data])

  const columns: Column<PayoutClaim>[] = [
    { key: 'loanNumber',    label: 'LOAN / APAC',   className: 'font-mono text-xs font-semibold' },
    { key: 'customerName',  label: 'CUSTOMER', className: 'font-medium' },
    { key: 'claimedByName', label: 'AGENT',    className: 'text-gray-700' },
    { key: 'month',         label: 'MONTH',    render: (r: PayoutClaim) => r.month ?? '—', className: 'text-gray-600' },
    { key: 'claimAmount',   label: 'AMOUNT',   render: (r: PayoutClaim) => <span className="font-semibold text-green-700">{formatCurrency(r.claimAmount)}</span> },
    { key: 'status',        label: 'STATUS',   render: (r: PayoutClaim) => (
      <Badge variant={STATUS_VARIANTS[r.status] ?? 'default'}>{r.status}</Badge>
    )},
    { key: 'createdAt',     label: 'DATE',     render: (r: PayoutClaim) => formatDate(r.createdAt), className: 'text-gray-600' },
    { key: 'actions',       label: 'ACTIONS',  render: (r: PayoutClaim) => activeTab === 'management' && r.status === 'Pending' ? (
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={() => update.mutate({ id: r.id, newStatus: 'Approved' })} className="text-xs">
          Approve
        </Button>
        <Button size="sm" variant="danger" onClick={() => update.mutate({ id: r.id, newStatus: 'Rejected' })} className="text-xs">
          Reject
        </Button>
      </div>
    ) : <span className="text-blue-600 cursor-pointer hover:underline text-sm">View</span> },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 size={28} className="text-blue-600" />
            Payout
          </h1>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="flex items-center gap-8 border-b border-gray-200 mb-8">
          <button
            onClick={() => { setActiveTab('claims'); setPage(1) }}
            className={`pb-3 px-1 font-medium transition-colors ${
              activeTab === 'claims'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <span className="flex items-center gap-2">🔥 My Claims</span>
          </button>
          <button
            onClick={() => { setActiveTab('management'); setPage(1) }}
            className={`pb-3 px-1 font-medium transition-colors ${
              activeTab === 'management'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <span className="flex items-center gap-2">📊 Management</span>
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'claims' ? (
          // My Claims Tab
          <div className="space-y-8">
            {/* Title & Actions */}
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Payout — My Claims</h2>
                <p className="text-gray-600 text-sm mt-1">Track your commission claims, disbursements and payment receipts</p>
              </div>
              <div className="flex gap-3">
                <button className="flex items-center gap-2 px-4 py-2 text-blue-600 font-medium hover:bg-blue-50 rounded-lg transition-colors">
                  <Download className="w-4 h-4" />
                  Earnings
                </button>
                <button className="flex items-center gap-2 px-4 py-2 text-blue-600 font-medium hover:bg-blue-50 rounded-lg transition-colors">
                  📋 Export
                </button>
                <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                  <Plus className="w-4 h-4" />
                  New Claim
                </button>
              </div>
            </div>

            {/* KPI Cards - Clean Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-blue-50 rounded-lg p-6 border border-blue-200">
                <div className="text-gray-600 text-xs font-semibold uppercase tracking-wide mb-2">TOTAL DISBURSED</div>
                <div className="text-3xl font-bold text-blue-600 mb-1">{formatCurrency(claimsStats.totalDisbursed)}</div>
                <div className="text-xs text-gray-500">{data?.items?.length ?? 0} claims</div>
              </div>

              <div className="bg-green-50 rounded-lg p-6 border border-green-200">
                <div className="text-gray-600 text-xs font-semibold uppercase tracking-wide mb-2">TOTAL PAYOUT</div>
                <div className="text-3xl font-bold text-green-600 mb-1">{formatCurrency(claimsStats.paid)}</div>
                <div className="text-xs text-gray-500">Approved + Paid</div>
              </div>

              <div className="bg-purple-50 rounded-lg p-6 border border-purple-200">
                <div className="text-gray-600 text-xs font-semibold uppercase tracking-wide mb-2">APPROVAL RATE</div>
                <div className="text-3xl font-bold text-purple-600 mb-1">
                  {data?.items && data.items.length > 0 
                    ? Math.round((claimsStats.paid / (claimsStats.pending + claimsStats.approved + claimsStats.paid)) * 100) 
                    : 0}%
                </div>
                <div className="text-xs text-gray-500">Based on submitted claims</div>
              </div>
            </div>

            {/* Status Cards - Five Column Grid */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <StatusCard
                icon="🔄"
                count={claimsStats.pending}
                label="PENDING"
                description="Awaiting review"
                color="text-orange-600"
              />
              <StatusCard
                icon="✓"
                count={claimsStats.approved}
                label="APPROVED"
                description="₹0 sanctioned"
                color="text-blue-600"
              />
              <StatusCard
                icon="💳"
                count={claimsStats.paid}
                label="PAID"
                description={formatCurrency(claimsStats.paid) + ' disbursed'}
                color="text-teal-600"
              />
              <StatusCard
                icon="✕"
                count={claimsStats.rejected}
                label="REJECTED"
                description="Claims declined"
                color="text-red-600"
              />
              <StatusCard
                icon="📅"
                count={0}
                label="THIS MONTH"
                description="₹0 claimed"
                color="text-blue-600"
              />
            </div>

            {/* Search */}
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search by Loan ID, Customer, Bank..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Filters - Organized Section */}
              <div className="space-y-3">
                <select
                  value={filterStatus}
                  onChange={(e) => { setFilterStatus(e.target.value); setPage(1) }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white cursor-pointer hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="paid">Paid</option>
                  <option value="rejected">Rejected</option>
                </select>

                <select
                  value={filterMonth}
                  onChange={(e) => setFilterMonth(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white cursor-pointer hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Months</option>
                  <option value="june2026">June 2026</option>
                  <option value="may2026">May 2026</option>
                </select>

                <div className="flex gap-2">
                  <button className="flex-1 px-4 py-2 text-red-600 font-medium hover:bg-red-50 rounded-lg transition-colors">
                    ✕ Clear
                  </button>
                </div>
              </div>
            </div>

            {/* Table */}
            <Card>
              <CardHeader title="My Claims" />
              <DataTable
                columns={columns}
                data={data?.items}
                isLoading={isLoading}
                totalPages={data?.totalPages}
                currentPage={page}
                onPageChange={setPage}
                totalCount={data?.totalCount}
              />
            </Card>
          </div>
        ) : (
          // Management Tab
          <div className="space-y-8">
            {/* Title & Actions */}
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Payout — Management</h2>
                <p className="text-gray-600 text-sm mt-1">Review, approve and process all partner commission claims</p>
              </div>
              <div className="flex gap-3">
                <button className="flex items-center gap-2 px-4 py-2 text-blue-600 font-medium hover:bg-blue-50 rounded-lg transition-colors">
                  📊 Analytics
                </button>
                <button className="flex items-center gap-2 px-4 py-2 text-blue-600 font-medium hover:bg-blue-50 rounded-lg transition-colors">
                  📥 Export CSV
                </button>
                <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                  <Plus className="w-4 h-4" />
                  New Claim
                </button>
              </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-blue-50 rounded-lg p-6 border border-blue-200">
                <div className="text-gray-600 text-xs font-semibold uppercase tracking-wide mb-2">TOTAL DISBURSED</div>
                <div className="text-3xl font-bold text-blue-600 mb-1">{formatCurrency(claimsStats.totalDisbursed)}</div>
                <div className="text-xs text-gray-500">{data?.items?.length ?? 0} claims</div>
              </div>

              <div className="bg-green-50 rounded-lg p-6 border border-green-200">
                <div className="text-gray-600 text-xs font-semibold uppercase tracking-wide mb-2">TOTAL PAYOUT</div>
                <div className="text-3xl font-bold text-green-600 mb-1">{formatCurrency(claimsStats.paid)}</div>
                <div className="text-xs text-gray-500">Approved + Paid</div>
              </div>

              <div className="bg-purple-50 rounded-lg p-6 border border-purple-200">
                <div className="text-gray-600 text-xs font-semibold uppercase tracking-wide mb-2">SUCCESS RATE</div>
                <div className="text-3xl font-bold text-purple-600 mb-1">
                  {data?.items && data.items.length > 0
                    ? Math.round((claimsStats.paid / (claimsStats.pending + claimsStats.approved + claimsStats.paid)) * 100)
                    : 0}%
                </div>
                <div className="text-xs text-gray-500">Paid / Total</div>
              </div>
            </div>

            {/* Status Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <StatusCard
                icon="🔄"
                count={claimsStats.pending}
                label="PENDING"
                description="Declining review"
                color="text-orange-600"
              />
              <StatusCard
                icon="✓"
                count={claimsStats.approved}
                label="APPROVED"
                description="₹1,35,000 sanctioned"
                color="text-blue-600"
              />
              <StatusCard
                icon="💳"
                count={claimsStats.paid}
                label="PAID"
                description={formatCurrency(claimsStats.paid) + ' disbursed'}
                color="text-teal-600"
              />
              <StatusCard
                icon="✕"
                count={claimsStats.rejected}
                label="REJECTED"
                description="Declined"
                color="text-red-600"
              />
              <StatusCard
                icon="💰"
                count={0}
                label="TOTAL PAYOUT"
                description="Approved + Paid"
                color="text-blue-600"
              />
            </div>

            {/* Search & Filters */}
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search partner / loan / customer..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Filters - Organized Section */}
              <div className="space-y-3">
                <select
                  value={filterStatus}
                  onChange={(e) => { setFilterStatus(e.target.value); setPage(1) }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white cursor-pointer hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="paid">Paid</option>
                  <option value="rejected">Rejected</option>
                </select>

                <select
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white cursor-pointer hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  defaultValue="allPartners"
                >
                  <option value="allPartners">All Partners</option>
                  <option value="partnerA">Partner A</option>
                  <option value="partnerB">Partner B</option>
                </select>

                <select
                  value={filterMonth}
                  onChange={(e) => setFilterMonth(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white cursor-pointer hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Months</option>
                  <option value="june2026">June 2026</option>
                  <option value="may2026">May 2026</option>
                </select>

                <div className="flex gap-2">
                  <button className="flex-1 px-4 py-2 text-red-600 font-medium hover:bg-red-50 rounded-lg transition-colors">
                    ✕ Clear
                  </button>
                </div>
              </div>
            </div>

            {/* Table */}
            <Card>
              <CardHeader title="All Claims" />
              <DataTable
                columns={columns}
                data={data?.items}
                isLoading={isLoading}
                totalPages={data?.totalPages}
                currentPage={page}
                onPageChange={setPage}
                totalCount={data?.totalCount}
              />
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
