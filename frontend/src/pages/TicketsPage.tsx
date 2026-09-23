import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ticketsApi, type Ticket, type TicketCreateRequest } from '@/api/ticketsApi'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { formatDate } from '@/utils/format'
import { Plus, X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import TicketDetailModal from '@/components/shared/TicketDetailModal'

const STATUS_VARIANT: Record<string, 'warning'|'info'|'success'|'danger'> = {
  Open: 'warning', 'In Progress': 'info', Resolved: 'success', Closed: 'danger',
}

const PAGE_SIZE = 20
const PRIORITIES = ['Low', 'Medium', 'High']

function errorMessage(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
  return msg?.message || msg?.errors?.join(' ') || fallback
}

// ── Phase 17: Create Ticket modal ───────────────────────────────────────
// Uses the existing GET /api/users/lookup endpoint for the optional
// AssignedToUserId field (TicketCreateDto — unlike Task's, this is
// optional, so a ticket can genuinely be created unassigned).
function CreateTicketModal({ onClose, onSuccess, initialTitle, initialLoanId }: {
  onClose: () => void; onSuccess: () => void; initialTitle?: string; initialLoanId?: number
}) {
  const [title, setTitle] = useState(initialTitle ?? '')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('Medium')
  const [assignedToUserId, setAssignedToUserId] = useState('')
  const [error, setError] = useState('')

  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ['users-lookup'],
    queryFn: () => api.get<ApiResponse<{ id: number; fullName: string; role: string }[]>>('/api/users/lookup').then(r => r.data.data ?? []),
  })

  const create = useMutation({
    mutationFn: (payload: TicketCreateRequest) => ticketsApi.create(payload),
    onSuccess: () => onSuccess(),
    onError: (err: unknown) => setError(errorMessage(err, 'Could not create ticket. Please try again.')),
  })

  function handleSubmit() {
    if (!title.trim()) { setError('Title is required.'); return }
    if (!description.trim()) { setError('Description is required.'); return }
    setError('')
    if (create.isPending) return // duplicate-submission guard, same as the button's own disabled state below
    create.mutate({
      title: title.trim(),
      description: description.trim(),
      priority,
      assignedToUserId: assignedToUserId ? Number(assignedToUserId) : undefined,
      // Loan-link the ticket when raised from a loan detail page (parity with
      // legacy openRaiseTicketFromApp). Backend TicketCreateDto.LoanId already
      // supported this end-to-end; only the UI wasn't setting it.
      loanId: initialLoanId,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[var(--z-modal)] p-4">
      <Card className="w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold">New Ticket</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Title *</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Cannot access loan document" className="efin-input" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Description *</label>
            <input value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Describe the issue" className="efin-input" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Priority</label>
            <select value={priority} onChange={e => setPriority(e.target.value)}
              className="efin-input">
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Assign To</label>
            <select value={assignedToUserId} onChange={e => setAssignedToUserId(e.target.value)}
              disabled={usersLoading} className="efin-input">
              <option value="">{usersLoading ? 'Loading…' : 'Unassigned'}</option>
              {(users ?? []).map(u => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Button size="sm" loading={create.isPending} disabled={create.isPending} onClick={handleSubmit}>Create Ticket</Button>
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </Card>
    </div>
  )
}

export default function TicketsPage() {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [detailTicket, setDetailTicket] = useState<Ticket | null>(null)
  const qc = useQueryClient()
  const navigate = useNavigate()

  // Deep-link from a loan detail's "Raise Ticket" button (parity with legacy
  // openRaiseTicketFromApp): open the create modal pre-filled with the loan
  // context so the new ticket is linked to that loan. Consumed once, then
  // cleared from history state so a refresh/back doesn't re-open it.
  const location = useLocation()
  const loanCtx = location.state as { loanId?: number; loanNumber?: string; applicantName?: string } | null
  const [raiseFor, setRaiseFor] = useState<{ loanId: number; title: string } | null>(null)
  useEffect(() => {
    if (loanCtx?.loanId) {
      const who = loanCtx.applicantName ? ` — ${loanCtx.applicantName}` : ''
      setRaiseFor({ loanId: loanCtx.loanId, title: `Ticket for Loan: ${loanCtx.loanNumber ?? loanCtx.loanId}${who}` })
      setShowCreate(true)
      window.history.replaceState({}, '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loanCtx?.loanId])

  // BUGFIX (confirmed real, pre-existing gap — Phase 5 audit): see
  // ticketsApi.ts's getAll() doc-comment. `status` IS a real server-side
  // filter TicketsController.GetAll honors, so it's still sent to the
  // backend — only page/pageSize (which the backend never read) are
  // dropped, with pagination now done client-side, same pattern already
  // proven in UsersPage.tsx (Phase 4 Part C) and TasksPage.tsx (Phase 5).
  const { data: allTickets, isLoading, error, refetch } = useQuery({
    queryKey: ['tickets', status],
    queryFn: () => ticketsApi.getAll({ status: status || undefined }).then(r => r.data.data),
  })

  const totalCount = (allTickets ?? []).length
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const pageItems = (allTickets ?? []).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const priorityMeta = (p: string) => p === 'High'
    ? { accent: 'var(--danger)', tint: 'rgba(192,57,43,.1)' }
    : p === 'Medium' ? { accent: 'var(--warn)', tint: 'rgba(230,126,0,.12)' }
    : { accent: 'var(--success)', tint: 'rgba(26,115,64,.1)' }
  const FILTERS = ['', 'Open', 'In Progress', 'Resolved', 'Closed']

  // Inline row actions — parity with Vanilla's ✓ Resolve / ↩ Reopen / ✕
  // (tkRenderTable, efin-app.js:26516). All three hit endpoints that already
  // existed in ticketsApi and are used by the detail modal — no new backend.
  const invalidate = () => qc.invalidateQueries({ queryKey: ['tickets'] })
  const resolveM = useMutation({ mutationFn: (id: number) => ticketsApi.setStatus(id, 'Resolved'), onSuccess: invalidate })
  const reopenM  = useMutation({ mutationFn: (id: number) => ticketsApi.reopen(id), onSuccess: invalidate })
  const closeM   = useMutation({ mutationFn: (id: number) => ticketsApi.close(id), onSuccess: invalidate })

  return (
    <div className="space-y-5">
      {/* Vanilla header — plain title + subtitle + New Ticket button
          (index.html:4777). No gradient hero, no invented status-KPI strip;
          status is filtered via the chip row below, exactly as Vanilla. */}
      <PageHeader
        title="Helpdesk Tickets"
        subtitle="Support tickets linked to applications"
        action={<Button size="sm" onClick={() => setShowCreate(true)}><Plus size={14} className="mr-1" />New Ticket</Button>}
      />

      {/* Vanilla status filter — a plain .filter-chip row (index.html:4784),
          not a segmented "toolbar" surface. */}
      <div className="flex flex-wrap items-center gap-2.5 mb-1">
        {FILTERS.map(f => (
          <button key={f || 'all'} onClick={() => { setStatus(f); setPage(1) }}
            className={`filter-chip ${status === f ? 'active' : ''}`}>{f || 'All'}</button>
        ))}
        <span className="ml-auto text-xs" style={{ color: 'var(--text3)' }}>Showing {pageItems.length} of {totalCount}</span>
      </div>

      {/* Vanilla ticket table — .card > .table-wrap > table, 8 columns
          (Ticket ID / Subject / Linked Loan / Customer / Priority / Status /
          Created / Actions), matching tkRenderTable (efin-app.js:26504). */}
      {error ? (
        <Card><div className="text-center py-10"><p className="text-sm text-red-600 mb-3">Could not load tickets.</p><Button size="sm" variant="secondary" onClick={() => refetch()}>Retry</Button></div></Card>
      ) : (
        <div className="card">
          <div className="v-table-wrap">
            <table className="v-table">
              <thead>
                <tr>
                  <th>Ticket ID</th><th>Subject</th><th>Linked Loan</th><th>Customer</th>
                  <th>Priority</th><th>Status</th><th>Created</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={8}><LoadingSpinner /></td></tr>
                ) : pageItems.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text3)', padding: 40 }}>
                    {status ? `No ${status.toLowerCase()} tickets right now.` : 'No tickets found'}
                  </td></tr>
                ) : pageItems.map(t => {
                  const pm = priorityMeta(t.priority)
                  const closedOrResolved = t.status === 'Resolved' || t.status === 'Closed'
                  return (
                    <tr key={t.id}>
                      <td><span className="app-id">#{t.id}</span></td>
                      <td>
                        <strong style={{ color: 'var(--text)' }}>{t.title}</strong>
                        {t.description && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description}</div>}
                      </td>
                      <td>{t.loanId
                        ? <span className="app-id" style={{ cursor: 'pointer', color: 'var(--accent)' }} onClick={() => navigate(`/loans/${t.loanId}`)}>#{t.loanId}</span>
                        : '—'}</td>
                      {/* Vanilla's Customer column comes from the linked
                          loan; the tickets API projection carries no customer
                          name, so it shows "—" when unlinked (same as Vanilla).
                          createdBy is surfaced in the detail modal, not here. */}
                      <td>{t.loanId ? (t.createdBy ?? '—') : '—'}</td>
                      <td><span className="info-pill" style={{ ['--pill-fg' as string]: pm.accent, ['--pill-bg' as string]: pm.tint }}>{t.priority}</span></td>
                      <td><Badge variant={STATUS_VARIANT[t.status] ?? 'default'}>{t.status}</Badge></td>
                      <td style={{ fontSize: 12, color: 'var(--text3)' }}>{formatDate(t.createdAt)}</td>
                      <td onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <Button size="sm" variant="ghost" onClick={() => setDetailTicket(t)}>💬 Notes</Button>
                          {closedOrResolved
                            ? <Button size="sm" variant="ghost" disabled={reopenM.isPending} onClick={() => reopenM.mutate(t.id)}>↩ Reopen</Button>
                            : <Button size="sm" variant="success" disabled={resolveM.isPending} onClick={() => resolveM.mutate(t.id)}>✓ Resolve</Button>}
                          {t.status !== 'Closed' && <Button size="sm" variant="danger" disabled={closeM.isPending} onClick={() => closeM.mutate(t.id)}>✕</Button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--border)' }}>
              <span className="text-xs" style={{ color: 'var(--text3)' }}>Page {page} of {totalPages}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</Button>
                <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {detailTicket && (
        <TicketDetailModal
          key={detailTicket.id}
          ticket={detailTicket}
          onClose={() => setDetailTicket(null)}
        />
      )}

      {showCreate && (
        <CreateTicketModal
          key={raiseFor?.loanId ?? 'blank'}
          initialTitle={raiseFor?.title}
          initialLoanId={raiseFor?.loanId}
          onClose={() => { setShowCreate(false); setRaiseFor(null) }}
          onSuccess={() => { setShowCreate(false); setRaiseFor(null); qc.invalidateQueries({ queryKey: ['tickets'] }) }}
        />
      )}
    </div>
  )
}
