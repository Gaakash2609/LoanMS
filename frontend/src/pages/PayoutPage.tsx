import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { payoutApi, type PayoutClaim } from '@/api/payoutApi'
import { useAuthStore } from '@/store/authStore'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import DataTable, { type Column } from '@/components/shared/DataTable'
import { formatCurrency, formatDate } from '@/utils/format'
import { BarChart3, Download, Plus, Search, RefreshCw, CheckCircle2, CreditCard, XCircle, Calendar, IndianRupee, Flame, ClipboardList, X } from 'lucide-react'
import type { ReactNode } from 'react'

const STATUS_VARIANTS: Record<string, 'default'|'success'|'warning'|'danger'|'info'> = {
  Pending: 'warning', Approved: 'success', Paid: 'info', Rejected: 'danger',
}

interface StatusCardProps {
  icon: ReactNode
  count: number
  label: string
  description: string
  color: string
}

function StatusCard({ icon, count, label, description, color }: StatusCardProps) {
  return (
    <div className="bg-white rounded-lg p-4 border border-gray-200 hover:shadow-md transition-shadow">
      <div className={`mb-1 ${color}`}>{icon}</div>
      <div className="text-2xl font-bold text-gray-900 mb-1">{count}</div>
      <div className="text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">{label}</div>
      <div className="text-xs text-gray-500">{description}</div>
    </div>
  )
}

const PAGE_SIZE = 20

// ── Phase 11 Priority-2: New Claim modal ────────────────────────────────────
// Reuses the existing POST /api/payout endpoint exactly as-is (ClaimCreateDto
// — see payoutApi.ts's doc-comment). claimAmount/claimType are only shown
// for Admin/Manager, matching the backend's own documented behavior that
// these fields are ignored for every other role (server computes the amount
// from the configured PayoutRule and derives claimType from the caller's own
// role instead).
function NewClaimModal({ isAdminOrManager, onClose, onSuccess }: {
  isAdminOrManager: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const [loanId, setLoanId] = useState('')
  const [claimAmount, setClaimAmount] = useState('')
  const [claimType, setClaimType] = useState('')
  const [month, setMonth] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  const submit = useMutation({
    mutationFn: () => payoutApi.submitClaim({
      loanId: Number(loanId),
      claimAmount: claimAmount ? Number(claimAmount) : undefined,
      claimType: claimType || undefined,
      month: month || undefined,
      notes: notes || undefined,
    }),
    onSuccess: () => onSuccess(),
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      setError(msg?.message || msg?.errors?.join(' ') || 'Could not submit claim. Please try again.')
    },
  })

  function handleSubmit() {
    const idNum = Number(loanId)
    if (!loanId || !Number.isFinite(idNum) || idNum <= 0) { setError('Enter a valid Loan ID.'); return }
    setError('')
    // disabled-while-pending on the button below is the actual duplicate-
    // submission guard — this early return is a defensive second layer.
    if (submit.isPending) return
    submit.mutate()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold">New Payout Claim</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {error && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
        )}

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Loan ID *</label>
            <input type="number" value={loanId} onChange={e => setLoanId(e.target.value)}
              placeholder="e.g. 1042" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>

          {isAdminOrManager && (
            <>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Claim Amount (optional — within rule bounds)</label>
                <input type="number" value={claimAmount} onChange={e => setClaimAmount(e.target.value)}
                  placeholder="Leave blank to use the configured rule" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Claim Type (reconciling on another claimant's behalf)</label>
                <select value={claimType} onChange={e => setClaimType(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">Self (default)</option>
                  {['Sales', 'Dsa', 'Partner', 'Login', 'Manager', 'Admin'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </>
          )}

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Month</label>
            <input value={month} onChange={e => setMonth(e.target.value)}
              placeholder="e.g. Aug 2026" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Optional" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <Button size="sm" loading={submit.isPending} disabled={submit.isPending} onClick={handleSubmit}>Submit Claim</Button>
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </Card>
    </div>
  )
}

// ── Phase 11 Priority-2: Earnings modal ─────────────────────────────────────
// Reuses the existing GET /api/payout/my-earnings endpoint exactly as-is —
// server-scoped to the caller's own claims, grouped by status.
function EarningsModal({ onClose }: { onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['payout-earnings'],
    queryFn: () => payoutApi.getMyEarnings().then(r => r.data.data ?? []),
  })

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold">My Earnings</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {isLoading ? (
          <p className="text-sm text-gray-400 py-6 text-center">Loading…</p>
        ) : !data?.length ? (
          <p className="text-sm text-gray-400 py-6 text-center">No claims yet.</p>
        ) : (
          <div className="space-y-2">
            {data.map(g => (
              <div key={g.status} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <Badge variant={STATUS_VARIANTS[g.status] ?? 'default'}>{g.status}</Badge>
                  <span className="text-xs text-gray-500 ml-2">{g.count} claim{g.count !== 1 ? 's' : ''}</span>
                </div>
                <span className="font-semibold text-green-700">{formatCurrency(g.total)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
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
  const user = useAuthStore(s => s.user)
  const isAdminOrManager = user?.role === 'Admin' || user?.role === 'Manager'

  // Phase 11 Priority-2 — New Claim / Earnings modal visibility. Kept as
  // simple local state, same convention as the show/hide modals already
  // used elsewhere in this app (e.g. UsersPage.tsx's mapping modal).
  const [showNewClaim, setShowNewClaim] = useState(false)
  const [showEarnings, setShowEarnings] = useState(false)

  // BUGFIX (confirmed real, pre-existing gap — Phase 7 audit): see
  // payoutApi.ts's getClaims() doc-comment. PayoutController.GetAll
  // returns a plain array, not a paged shape — data?.items was always
  // undefined, so every KPI card, status card, and the table itself
  // always showed zero regardless of how many real claims existed.
  // Corrected to fetch the full (already status-filtered server-side)
  // array once and paginate client-side, same pattern already proven in
  // UsersPage.tsx/TasksPage.tsx/TicketsPage.tsx.
  const { data: allClaims, isLoading } = useQuery({
    queryKey: ['payouts', filterStatus],
    queryFn: () => payoutApi.getClaims({ status: filterStatus || undefined }).then(r => r.data.data),
  })
  const claims = allClaims ?? []
  const totalCount = claims.length
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const pageItems = claims.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const update = useMutation({
    mutationFn: ({ id, newStatus }: { id: number; newStatus: string }) =>
      payoutApi.updateClaimStatus(id, newStatus),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payouts'] }),
  })

  // Calculate statistics for both tabs
  const claimsStats = useMemo(() => ({
    pending: claims.filter(c => c.status === 'Pending').length,
    approved: claims.filter(c => c.status === 'Approved').length,
    paid: claims.filter(c => c.status === 'Paid').length,
    rejected: claims.filter(c => c.status === 'Rejected').length,
    totalDisbursed: claims.reduce((sum, c) => sum + (c.claimAmount || 0), 0),
  }), [claims])

  const columns: Column<PayoutClaim>[] = [
    { key: 'loanNumber',    label: 'LOAN / APAC',   className: 'font-mono text-xs font-semibold' },
    { key: 'customerName',  label: 'CUSTOMER', className: 'font-medium' },
    // BUGFIX (Phase 7): was 'claimedByName', a field that never existed
    // in the actual API response (see payoutApi.ts's doc-comment — the
    // real field is claimedBy) — this column always rendered blank.
    { key: 'claimedBy', label: 'AGENT',    className: 'text-gray-700' },
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
            <span className="flex items-center gap-2"><Flame size={16} /> My Claims</span>
          </button>
          <button
            onClick={() => { setActiveTab('management'); setPage(1) }}
            className={`pb-3 px-1 font-medium transition-colors ${
              activeTab === 'management'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <span className="flex items-center gap-2"><BarChart3 size={16} /> Management</span>
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
                <button onClick={() => setShowEarnings(true)} className="flex items-center gap-2 px-4 py-2 text-blue-600 font-medium hover:bg-blue-50 rounded-lg transition-colors">
                  <Download className="w-4 h-4" />
                  Earnings
                </button>
                <button className="flex items-center gap-2 px-4 py-2 text-blue-600 font-medium hover:bg-blue-50 rounded-lg transition-colors">
                  <ClipboardList className="w-4 h-4" />
                  Export
                </button>
                <button onClick={() => setShowNewClaim(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
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
                <div className="text-xs text-gray-500">{totalCount} claims</div>
              </div>

              <div className="bg-green-50 rounded-lg p-6 border border-green-200">
                <div className="text-gray-600 text-xs font-semibold uppercase tracking-wide mb-2">TOTAL PAYOUT</div>
                <div className="text-3xl font-bold text-green-600 mb-1">{formatCurrency(claimsStats.paid)}</div>
                <div className="text-xs text-gray-500">Approved + Paid</div>
              </div>

              <div className="bg-purple-50 rounded-lg p-6 border border-purple-200">
                <div className="text-gray-600 text-xs font-semibold uppercase tracking-wide mb-2">APPROVAL RATE</div>
                <div className="text-3xl font-bold text-purple-600 mb-1">
                  {claims.length > 0 
                    ? Math.round((claimsStats.paid / (claimsStats.pending + claimsStats.approved + claimsStats.paid)) * 100) 
                    : 0}%
                </div>
                <div className="text-xs text-gray-500">Based on submitted claims</div>
              </div>
            </div>

            {/* Status Cards - Five Column Grid */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <StatusCard
                icon={<RefreshCw size={24} />}
                count={claimsStats.pending}
                label="PENDING"
                description="Awaiting review"
                color="text-orange-600"
              />
              <StatusCard
                icon={<CheckCircle2 size={24} />}
                count={claimsStats.approved}
                label="APPROVED"
                description="₹0 sanctioned"
                color="text-blue-600"
              />
              <StatusCard
                icon={<CreditCard size={24} />}
                count={claimsStats.paid}
                label="PAID"
                description={formatCurrency(claimsStats.paid) + ' disbursed'}
                color="text-teal-600"
              />
              <StatusCard
                icon={<XCircle size={24} />}
                count={claimsStats.rejected}
                label="REJECTED"
                description="Claims declined"
                color="text-red-600"
              />
              <StatusCard
                icon={<Calendar size={24} />}
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
                  <button className="flex-1 px-4 py-2 text-red-600 font-medium hover:bg-red-50 rounded-lg transition-colors flex items-center justify-center gap-1.5">
                    <X size={16} /> Clear
                  </button>
                </div>
              </div>
            </div>

            {/* Table */}
            <Card>
              <CardHeader title="My Claims" />
              <DataTable
                columns={columns}
                data={pageItems}
                isLoading={isLoading}
                totalPages={totalPages}
                currentPage={page}
                onPageChange={setPage}
                totalCount={totalCount}
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
                  <BarChart3 className="w-4 h-4" />
                  Analytics
                </button>
                <button className="flex items-center gap-2 px-4 py-2 text-blue-600 font-medium hover:bg-blue-50 rounded-lg transition-colors">
                  <Download className="w-4 h-4" />
                  Export CSV
                </button>
                <button onClick={() => setShowNewClaim(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
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
                <div className="text-xs text-gray-500">{totalCount} claims</div>
              </div>

              <div className="bg-green-50 rounded-lg p-6 border border-green-200">
                <div className="text-gray-600 text-xs font-semibold uppercase tracking-wide mb-2">TOTAL PAYOUT</div>
                <div className="text-3xl font-bold text-green-600 mb-1">{formatCurrency(claimsStats.paid)}</div>
                <div className="text-xs text-gray-500">Approved + Paid</div>
              </div>

              <div className="bg-purple-50 rounded-lg p-6 border border-purple-200">
                <div className="text-gray-600 text-xs font-semibold uppercase tracking-wide mb-2">SUCCESS RATE</div>
                <div className="text-3xl font-bold text-purple-600 mb-1">
                  {claims.length > 0
                    ? Math.round((claimsStats.paid / (claimsStats.pending + claimsStats.approved + claimsStats.paid)) * 100)
                    : 0}%
                </div>
                <div className="text-xs text-gray-500">Paid / Total</div>
              </div>
            </div>

            {/* Status Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <StatusCard
                icon={<RefreshCw size={24} />}
                count={claimsStats.pending}
                label="PENDING"
                description="Declining review"
                color="text-orange-600"
              />
              <StatusCard
                icon={<CheckCircle2 size={24} />}
                count={claimsStats.approved}
                label="APPROVED"
                description="₹1,35,000 sanctioned"
                color="text-blue-600"
              />
              <StatusCard
                icon={<CreditCard size={24} />}
                count={claimsStats.paid}
                label="PAID"
                description={formatCurrency(claimsStats.paid) + ' disbursed'}
                color="text-teal-600"
              />
              <StatusCard
                icon={<XCircle size={24} />}
                count={claimsStats.rejected}
                label="REJECTED"
                description="Declined"
                color="text-red-600"
              />
              <StatusCard
                icon={<IndianRupee size={24} />}
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
                  <button className="flex-1 px-4 py-2 text-red-600 font-medium hover:bg-red-50 rounded-lg transition-colors flex items-center justify-center gap-1.5">
                    <X size={16} /> Clear
                  </button>
                </div>
              </div>
            </div>

            {/* Table */}
            <Card>
              <CardHeader title="All Claims" />
              <DataTable
                columns={columns}
                data={pageItems}
                isLoading={isLoading}
                totalPages={totalPages}
                currentPage={page}
                onPageChange={setPage}
                totalCount={totalCount}
              />
            </Card>
          </div>
        )}
      </div>

      {showNewClaim && (
        <NewClaimModal
          isAdminOrManager={isAdminOrManager}
          onClose={() => setShowNewClaim(false)}
          onSuccess={() => {
            setShowNewClaim(false)
            // Same invalidation-key the existing status-update mutation
            // already uses — refreshes the list/KPI-cards/status-cards on
            // both tabs, since they all derive from the same ['payouts']
            // query.
            qc.invalidateQueries({ queryKey: ['payouts'] })
          }}
        />
      )}
      {showEarnings && <EarningsModal onClose={() => setShowEarnings(false)} />}
    </div>
  )
}
