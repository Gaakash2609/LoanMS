import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ticketsApi, type Ticket, type TicketCreateRequest } from '@/api/ticketsApi'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import DataTable, { type Column } from '@/components/shared/DataTable'
import PageHeader from '@/components/shared/PageHeader'
import { formatDate } from '@/utils/format'
import { Plus, X } from 'lucide-react'

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
function CreateTicketModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [title, setTitle] = useState('')
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
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
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
              placeholder="e.g. Cannot access loan document" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Description *</label>
            <input value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Describe the issue" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Priority</label>
            <select value={priority} onChange={e => setPriority(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Assign To</label>
            <select value={assignedToUserId} onChange={e => setAssignedToUserId(e.target.value)}
              disabled={usersLoading} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">{usersLoading ? 'Loading…' : 'Unassigned'}</option>
              {(users ?? []).map(u => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </select>
          </div>
        </div>

        <div className="flex gap-2 mt-5">
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
  const qc = useQueryClient()

  // BUGFIX (confirmed real, pre-existing gap — Phase 5 audit): see
  // ticketsApi.ts's getAll() doc-comment. `status` IS a real server-side
  // filter TicketsController.GetAll honors, so it's still sent to the
  // backend — only page/pageSize (which the backend never read) are
  // dropped, with pagination now done client-side, same pattern already
  // proven in UsersPage.tsx (Phase 4 Part C) and TasksPage.tsx (Phase 5).
  const { data: allTickets, isLoading } = useQuery({
    queryKey: ['tickets', status],
    queryFn: () => ticketsApi.getAll({ status: status || undefined }).then(r => r.data.data),
  })

  const totalCount = (allTickets ?? []).length
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const pageItems = (allTickets ?? []).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const close = useMutation({
    mutationFn: (id: number) => ticketsApi.close(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets'] }),
  })

  const columns: Column<Ticket>[] = [
    { key: 'title', label: 'Title', render: (t: Ticket) => (
      <div>
        <p className="font-medium">{t.title}</p>
        <p className="text-xs text-gray-500 truncate max-w-xs">{t.description}</p>
      </div>
    )},
    { key: 'priority', label: 'Priority', render: (t: Ticket) => (
      <Badge variant={t.priority === 'High' ? 'danger' : t.priority === 'Medium' ? 'warning' : 'success'}>
        {t.priority}
      </Badge>
    )},
    { key: 'status', label: 'Status', render: (t: Ticket) => (
      <Badge variant={STATUS_VARIANT[t.status] ?? 'default'}>{t.status}</Badge>
    )},
    // BUGFIX (Phase 5): was 'createdByName'/'assignedToName', fields that
    // never existed in the actual API response (see ticketsApi.ts's
    // doc-comment — the real fields are createdBy/assignedTo) — these
    // columns always rendered blank.
    { key: 'createdBy', label: 'Raised By' },
    { key: 'assignedTo', label: 'Assigned To', render: (t: Ticket) => t.assignedTo ?? '—' },
    { key: 'createdAt', label: 'Date', render: (t: Ticket) => formatDate(t.createdAt) },
    { key: 'actions', label: '', render: (t: Ticket) =>
      t.status !== 'Closed' ? (
        <Button size="sm" variant="secondary" onClick={() => close.mutate(t.id)}>Close</Button>
      ) : null
    },
  ]

  return (
    <div>
      <PageHeader
        title="Support Tickets"
        subtitle={`${totalCount} tickets`}
        action={
          <>
            <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {['', 'Open', 'In Progress', 'Resolved', 'Closed'].map(s => (
                <option key={s} value={s}>{s || 'All'}</option>
              ))}
            </select>
            {/* Phase 17: TicketsController.Create has no permission-gate
                beyond the controller's own class-level [Authorize]
                (confirmed by inspection) — genuinely open to every
                authenticated user, so no role/permission list needed here. */}
            <Button size="sm" onClick={() => setShowCreate(true)}><Plus size={14} className="mr-1" />Add Ticket</Button>
          </>
        }
      />
      <Card>
        <DataTable columns={columns} data={pageItems}
          isLoading={isLoading} totalPages={totalPages}
          currentPage={page} onPageChange={setPage} totalCount={totalCount}
        />
      </Card>

      {showCreate && (
        <CreateTicketModal
          onClose={() => setShowCreate(false)}
          onSuccess={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ['tickets'] }) }}
        />
      )}
    </div>
  )
}
