import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useCustomers } from '@/hooks/useCustomers'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { formatCurrency, formatDate } from '@/utils/format'
import { Plus, Search, ChevronLeft, ChevronRight } from 'lucide-react'

export default function CustomersPage() {
  const [page, setPage]     = useState(1)
  const [search, setSearch] = useState('')
  const [query, setQuery]   = useState('')
  const { data, isLoading } = useCustomers(page, 20, query)

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault(); setQuery(search); setPage(1)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
          <p className="text-sm text-gray-500 mt-0.5">{data?.totalCount ?? 0} registered customers</p>
        </div>
        <Link to="/customers/new">
          <Button size="sm"><Plus size={14} className="mr-1.5" />Add Customer</Button>
        </Link>
      </div>

      <Card>
        <form onSubmit={handleSearch} className="flex gap-2 mb-5">
          <input
            type="text" placeholder="Search by name, email, phone, PAN..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue flex-1 max-w-sm"
          />
          <Button type="submit" variant="secondary" size="sm"><Search size={14} /></Button>
        </form>

        {isLoading ? <LoadingSpinner /> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-gray-100">
                    {['Name', 'Phone', 'PAN', 'CIBIL', 'Income/mo', 'City', 'Loans', 'Since', ''].map((h) => (
                      <th key={h} className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data?.items?.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3 pr-4">
                        <p className="font-medium text-gray-900">{c.fullName}</p>
                        <p className="text-xs text-gray-500">{c.email}</p>
                      </td>
                      <td className="py-3 pr-4 text-gray-600">{c.phone}</td>
                      <td className="py-3 pr-4 font-mono text-xs text-gray-600">{c.panNumber ?? '—'}</td>
                      <td className="py-3 pr-4">
                        {c.cibilScore != null ? (
                          <span className={`font-medium ${c.cibilScore >= 750 ? 'text-green-600' : c.cibilScore >= 650 ? 'text-yellow-600' : 'text-red-600'}`}>
                            {c.cibilScore}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-3 pr-4">{c.monthlyIncome ? formatCurrency(c.monthlyIncome) : '—'}</td>
                      <td className="py-3 pr-4 text-gray-600">{c.city ?? '—'}</td>
                      <td className="py-3 pr-4 text-center">
                        <span className={`font-medium ${c.totalLoans > 0 ? 'text-blue-600' : 'text-gray-400'}`}>{c.totalLoans}</span>
                      </td>
                      <td className="py-3 pr-4 text-xs text-gray-500">{formatDate(c.createdAt)}</td>
                      <td className="py-3">
                        <Link to={`/customers/${c.id}`} className="text-efin-blue hover:underline text-xs font-medium">View</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {data && data.totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-500">Page {data.page} of {data.totalPages}</p>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" disabled={!data.hasPrev} onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft size={14} />
                  </Button>
                  <Button variant="secondary" size="sm" disabled={!data.hasNext} onClick={() => setPage(p => p + 1)}>
                    <ChevronRight size={14} />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
