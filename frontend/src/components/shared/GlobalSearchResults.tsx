import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Building2 } from 'lucide-react'
import { useGlobalSearch } from '@/hooks/useSearch'
import { StatusBadge } from '@/components/ui/Badge'
import { InlineLoader } from '@/components/ui/LoadingSpinner'
import { formatCurrency } from '@/utils/format'

/**
 * Results dropdown for the topbar search box. Previously the box only wrote
 * the raw text into the loan-list filter and navigated to /loans — a
 * real cross-entity Search API (SearchController.cs: loans + customers +
 * DSA/partners, role-scoped) existed on the backend the whole time with no
 * caller anywhere in the frontend. This is that caller.
 *
 * DSA/Partner hits link to the list page rather than a per-record detail —
 * neither page has an id-based deep link today, so this doesn't invent one.
 */
export function GlobalSearchResults({
  query,
  onNavigate,
}: {
  query: string
  onNavigate: () => void
}) {
  const navigate = useNavigate()
  const [debounced, setDebounced] = useState(query)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 200)
    return () => clearTimeout(t)
  }, [query])

  const { data, isLoading, isError } = useGlobalSearch(debounced)

  const q = query.trim()
  if (q.length < 2) return null

  const go = (path: string) => {
    navigate(path)
    onNavigate()
  }

  const hasAny =
    !!data && (data.loans.length > 0 || data.dsaPartners.length > 0)

  return (
    <div
      className="lms-menu-in absolute left-0 right-0 top-full mt-2 rounded-lg border bg-white shadow-lg overflow-hidden z-50"
      style={{ borderColor: 'var(--border)', maxHeight: 420, overflowY: 'auto' }}
      role="listbox"
    >
      {isLoading && (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-gray-500">
          <InlineLoader size={14} /> Searching…
        </div>
      )}

      {isError && (
        <div className="px-4 py-3 text-sm text-red-600">Search failed. Try again.</div>
      )}

      {!isLoading && !isError && !hasAny && (
        <div className="px-4 py-3 text-sm text-gray-500">No matches for "{q}"</div>
      )}

      {data && data.loans.length > 0 && (
        <div className="py-1">
          <div className="px-4 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">
            Loans
          </div>
          {data.loans.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => go(`/loans/${l.id}`)}
              className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-gray-50"
            >
              <FileText size={14} className="text-gray-400 shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-gray-900 truncate">
                  {l.loanNumber} — {l.customerName}
                </span>
                <span className="block text-xs text-gray-500">{formatCurrency(l.requestedAmount)}</span>
              </span>
              <StatusBadge status={l.status} />
            </button>
          ))}
        </div>
      )}

      {data && data.dsaPartners.length > 0 && (
        <div className="py-1 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="px-4 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">
            DSA / Partners
          </div>
          {data.dsaPartners.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => go(d.partnerType === 'Partner' ? '/partners' : '/dsa')}
              className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-gray-50"
            >
              <Building2 size={14} className="text-gray-400 shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-gray-900 truncate">{d.name}</span>
                <span className="block text-xs text-gray-500">{d.code ?? d.partnerType}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
