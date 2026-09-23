import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Search, Flag } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { loansApi } from '@/api/loansApi'
import { tasksApi } from '@/api/tasksApi'
import { formatCurrency, formatDate, LOAN_TYPE_LABELS } from '@/utils/format'
import { useAuthStore } from '@/store/authStore'
import type { LoanListItem, LoanStatus } from '@/types'

// ── Tasks → Created / Assigned tabs ─────────────────────────────────────
// Ports legacy's renderAppTasks('created' | 'assigned') (efin-app.js:12270).
//
// Worth being explicit, because the tab names mislead: these two tabs list
// **applications**, not tasks. "Created" is the loans this user raised;
// "Assigned" is the loans where they are the sales person. Only the first
// tab ("My Tasks") is an actual task list.
//
// Legacy buckets by display name (_appCreatedBy(a) === uname). This uses the
// ids instead — see LoanListDto's note — so two users sharing a name can't
// see each other's rows.
//
// Each card carries the chips legacy shows for that loan's own open tasks.
// Those come from one GET /api/tasks grouped by loanId, not a call per row.

const STATUSES: LoanStatus[] = [
  'Draft', 'Submitted', 'UnderReview', 'Approved', 'Rejected', 'Disbursed', 'Closed',
] as LoanStatus[]

const PRIORITY_CHIP: Record<string, string> = {
  High:   'bg-red-50 text-red-700',
  Medium: 'bg-amber-50 text-amber-700',
  Low:    'bg-green-50 text-green-700',
}

export default function MyApplicationsTab({ mode }: { mode: 'created' | 'assigned' }) {
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')

  // "Assigned" is a real server-side filter (LoanFilterDto.AssignedToUserId).
  // "Created" has no server param, so that bucket is narrowed on the rows the
  // visibility scope already returned — which for a Sales user is their own
  // created + assigned loans anyway.
  const { data, isLoading, error } = useQuery({
    queryKey: ['my-applications', mode, user?.id],
    queryFn: () => loansApi.getAll({
      page: 1,
      pageSize: 200,
      ...(mode === 'assigned' && user?.id ? { assignedToUserId: user.id } : {}),
    }).then(r => r.data.data),
    enabled: !!user?.id,
  })

  // One fetch for every open task, then grouped by loan — legacy reads the
  // same "not done, belongs to this app" set for its chips.
  const { data: openTasks } = useQuery({
    queryKey: ['tasks', false],
    queryFn: () => tasksApi.getAll({ completed: false }).then(r => r.data.data ?? []),
  })
  const tasksByLoan = new Map<number, { id: number; title: string; priority: string }[]>()
  for (const t of openTasks ?? []) {
    if (t.loanId == null) continue
    const list = tasksByLoan.get(t.loanId) ?? []
    list.push({ id: t.id, title: t.title, priority: t.priority })
    tasksByLoan.set(t.loanId, list)
  }

  const mine = (data?.items ?? []).filter((l: LoanListItem) =>
    mode === 'created'
      ? l.createdByUserId === user?.id
      : l.assignedToUserId === user?.id,
  )

  const q = search.trim().toLowerCase()
  const rows = mine.filter(l => {
    if (status && l.status !== status) return false
    if (!q) return true
    // Legacy searches customer name and application id only.
    return (l.customerName ?? '').toLowerCase().includes(q)
        || (l.loanNumber ?? '').toLowerCase().includes(q)
  })

  const emptyCopy = mode === 'created'
    ? { icon: '📝', line: 'You have not created any applications yet.' }
    : { icon: '📌', line: 'No applications are currently assigned to you.' }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name or application ID"
            className="w-full rounded-lg border border-gray-300 bg-gray-50 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue focus:bg-white"
          />
        </div>
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue">
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="text-xs" style={{ color: 'var(--text3)' }}>
          {rows.length} of {mine.length}
        </span>
      </div>

      {error != null && (
        <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          Could not load applications.
        </div>
      )}

      {isLoading ? <LoadingSpinner /> : rows.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <div className="text-4xl mb-2.5">{emptyCopy.icon}</div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text2)' }}>No applications found</p>
            <p className="text-[12.5px] mt-1" style={{ color: 'var(--text3)' }}>{emptyCopy.line}</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map(l => {
            const chips = tasksByLoan.get(l.id) ?? []
            return (
              <button
                key={l.id}
                onClick={() => navigate(`/loans/${l.id}`)}
                className="w-full text-left bg-surface border border-token rounded-[14px] px-[18px] py-4 transition-shadow hover:shadow-[0_4px_20px_rgba(8,88,151,.1)] hover:border-[color:var(--accent)]"
              >
                <div className="flex items-start gap-3 flex-wrap">
                  <span
                    className="w-10 h-10 rounded-[10px] flex items-center justify-center text-sm font-extrabold shrink-0"
                    style={{ background: 'var(--accent-subtle)', color: 'var(--accent)', fontFamily: 'var(--font-head)' }}>
                    {(l.customerName || '?')[0].toUpperCase()}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-bold text-sm" style={{ color: 'var(--text)' }}>{l.customerName || '—'}</span>
                      <span className="text-[11px]" style={{ color: 'var(--text3)', fontFamily: 'var(--font-head)' }}>{l.loanNumber}</span>
                      <StatusBadge status={l.status} />
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs" style={{ color: 'var(--text2)' }}>
                      <span>🏦 {LOAN_TYPE_LABELS[l.loanType] ?? l.loanType ?? '—'}</span>
                      <span>💰 {formatCurrency(l.requestedAmount)}</span>
                      <span>📅 {formatDate(l.createdAt)}</span>
                    </div>

                    {chips.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2.5">
                        {chips.map(t => (
                          <span key={t.id} title={t.title}
                            className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2.5 py-0.5 ${PRIORITY_CHIP[t.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                            <Flag size={10} />
                            {t.title.length > 38 ? t.title.slice(0, 38) + '…' : t.title}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
