import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ticketsApi, type Ticket } from '@/api/ticketsApi'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import DataTable, { type Column } from '@/components/shared/DataTable'
import PageHeader from '@/components/shared/PageHeader'
import { formatDate } from '@/utils/format'

const STATUS_VARIANT: Record<string, 'warning'|'info'|'success'|'danger'> = {
  Open: 'warning', 'In Progress': 'info', Resolved: 'success', Closed: 'danger',
}

const PAGE_SIZE = 20

export default function TicketsPage() {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
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
          <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {['', 'Open', 'In Progress', 'Resolved', 'Closed'].map(s => (
              <option key={s} value={s}>{s || 'All'}</option>
            ))}
          </select>
        }
      />
      <Card>
        <DataTable columns={columns} data={pageItems}
          isLoading={isLoading} totalPages={totalPages}
          currentPage={page} onPageChange={setPage} totalCount={totalCount}
        />
      </Card>
    </div>
  )
}
