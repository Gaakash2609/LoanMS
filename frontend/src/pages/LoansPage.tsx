import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLoans } from '@/hooks/useLoans'
import { useLoanStore } from '@/store/loanStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { formatCurrency, formatDate } from '@/utils/format'
import { Plus, Search, RefreshCw, ChevronLeft, ChevronRight, FileClock, Play, Trash2 } from 'lucide-react'
import { listDrafts, deleteDraft, type WizardDraft } from '@/utils/draftStorage'

const STATUSES = ['', 'Draft', 'Submitted', 'UnderReview', 'Approved', 'Disbursed', 'Rejected', 'Closed']

export default function LoansPage() {
  const { filter, setFilter } = useLoanStore()
  const { data, isLoading, refetch } = useLoans(filter)
  const [search, setSearch] = useState(filter.search ?? '')
  const [section, setSection] = useState<'applications' | 'drafts'>('applications')
  const [drafts, setDrafts] = useState<WizardDraft[]>([])

  const refreshDrafts = () => setDrafts(listDrafts())

  useEffect(() => {
    if (section === 'drafts') refreshDrafts()
  }, [section])

  const handleDiscardDraft = (id: string) => {
    deleteDraft(id)
    refreshDrafts()
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setFilter({ search, page: 1 })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Loan Applications</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {data?.totalCount ?? 0} total applications
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            <RefreshCw size={14} className="mr-1.5" />Refresh
          </Button>
          <Link to="/loans/new">
            <Button size="sm">
              <Plus size={14} className="mr-1.5" />New Loan
            </Button>
          </Link>
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex gap-2">
        {([
          { key: 'applications', label: 'Applications' },
          { key: 'drafts', label: 'Drafts' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setSection(t.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
              section === t.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {t.key === 'drafts' && <FileClock size={14} />}
            {t.label}
            {t.key === 'drafts' && drafts.length > 0 && (
              <span className={`text-xs rounded-full px-1.5 ${section === 'drafts' ? 'bg-white/20' : 'bg-gray-200'}`}>
                {drafts.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {section === 'applications' && (
      <Card>
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              placeholder="Search loans, customers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue w-64"
            />
            <Button type="submit" variant="secondary" size="sm">
              <Search size={14} />
            </Button>
          </form>

          <select
            value={filter.status ?? ''}
            onChange={(e) => setFilter({ status: e.target.value as any || undefined })}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue"
          >
            {STATUSES.map((s) => <option key={s} value={s}>{s || 'All Status'}</option>)}
          </select>
        </div>

        {/* Table */}
        {isLoading ? <LoadingSpinner /> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-gray-100">
                    {['Loan #', 'Customer', 'Type', 'Amount', 'EMI/mo', 'Status', 'Agent', 'Date', ''].map((h) => (
                      <th key={h} className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data?.items?.map((loan) => (
                    <tr key={loan.id} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3 pr-4 font-mono text-xs text-gray-600">{loan.loanNumber}</td>
                      <td className="py-3 pr-4">
                        <p className="font-medium text-gray-900">{loan.customerName}</p>
                        <p className="text-xs text-gray-500">{loan.customerPhone}</p>
                      </td>
                      <td className="py-3 pr-4 text-gray-600">{loan.loanType}</td>
                      <td className="py-3 pr-4 font-medium">{formatCurrency(loan.requestedAmount)}</td>
                      <td className="py-3 pr-4 text-gray-600">{loan.monthlyEmi ? formatCurrency(loan.monthlyEmi) : '—'}</td>
                      <td className="py-3 pr-4"><StatusBadge status={loan.status} /></td>
                      <td className="py-3 pr-4 text-xs text-gray-500">{loan.createdByName}</td>
                      <td className="py-3 pr-4 text-xs text-gray-500">{formatDate(loan.createdAt)}</td>
                      <td className="py-3">
                        <Link to={`/loans/${loan.id}`} className="text-efin-blue hover:underline text-xs font-medium">
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {data && data.totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-500">
                  Page {data.page} of {data.totalPages} ({data.totalCount} total)
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" disabled={!data.hasPrev}
                    onClick={() => setFilter({ page: (filter.page ?? 1) - 1 })}>
                    <ChevronLeft size={14} />
                  </Button>
                  <Button variant="secondary" size="sm" disabled={!data.hasNext}
                    onClick={() => setFilter({ page: (filter.page ?? 1) + 1 })}>
                    <ChevronRight size={14} />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
      )}

      {section === 'drafts' && (
        <Card>
          <div className="mb-4">
            <p className="text-xs text-gray-500">
              In-progress applications are saved here automatically and kept for 7 days.
              Starting a new application never affects any draft below.
            </p>
          </div>

          {drafts.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              No active drafts. Drafts appear here automatically as you fill out a New Application.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-gray-100">
                    {['Applicant', 'Loan Type', 'Progress', 'Last Saved', ''].map((h) => (
                      <th key={h} className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {drafts.map((d) => (
                    <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3 pr-4 font-medium text-gray-900">{d.label}</td>
                      <td className="py-3 pr-4 text-gray-600">{d.loanType || '—'}</td>
                      <td className="py-3 pr-4 text-xs text-gray-500">Step {d.step} of 9</td>
                      <td className="py-3 pr-4 text-xs text-gray-500">{formatDate(new Date(d.updatedAt).toISOString())}</td>
                      <td className="py-3">
                        <div className="flex items-center gap-3">
                          <Link to={`/loans/new?draftId=${d.id}`} className="text-efin-blue hover:underline text-xs font-medium flex items-center gap-1">
                            <Play size={12} />Resume
                          </Link>
                          <button onClick={() => handleDiscardDraft(d.id)}
                            className="text-gray-400 hover:text-red-500 text-xs font-medium flex items-center gap-1">
                            <Trash2 size={12} />Discard
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
