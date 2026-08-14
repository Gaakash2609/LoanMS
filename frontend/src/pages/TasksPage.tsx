import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tasksApi, type Task } from '@/api/tasksApi'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import DataTable, { type Column } from '@/components/shared/DataTable'
import PageHeader from '@/components/shared/PageHeader'
import { formatDate } from '@/utils/format'
import { CheckCircle, Circle } from 'lucide-react'

const PAGE_SIZE = 20

export default function TasksPage() {
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState('')
  const qc = useQueryClient()

  // BUGFIX (confirmed real, pre-existing gap — Phase 5 audit): see
  // tasksApi.ts's getAll() doc-comment. The `completed` value IS a real
  // server-side filter TasksController.GetAll honors, so it's still sent
  // to the backend — only page/pageSize (which the backend never read)
  // are dropped, with pagination now done client-side on the returned
  // array, same pattern already proven in UsersPage.tsx (Phase 4 Part C).
  const completedParam = filter === 'completed' ? true : filter === 'pending' ? false : undefined
  const { data: allTasks, isLoading } = useQuery({
    queryKey: ['tasks', completedParam],
    queryFn: () => tasksApi.getAll({ completed: completedParam }).then(r => r.data.data),
  })

  const totalCount = (allTasks ?? []).length
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const pageItems = (allTasks ?? []).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const complete = useMutation({
    mutationFn: (id: number) => tasksApi.complete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })

  const PRIORITY_VARIANT: Record<string, 'danger'|'warning'|'success'> = {
    High: 'danger', Medium: 'warning', Low: 'success'
  }

  const columns: Column<Task>[] = [
    { key: 'status', label: '', render: (t: Task) => (
      <button onClick={() => !t.isCompleted && complete.mutate(t.id)} className="text-gray-400 hover:text-green-500">
        {t.isCompleted ? <CheckCircle size={16} className="text-green-500" /> : <Circle size={16} />}
      </button>
    ), className: 'w-8' },
    { key: 'title', label: 'Task', render: (t: Task) => (
      <div>
        <p className={`font-medium ${t.isCompleted ? 'line-through text-gray-400' : 'text-gray-900'}`}>{t.title}</p>
        {t.description && <p className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">{t.description}</p>}
      </div>
    )},
    { key: 'priority', label: 'Priority', render: (t: Task) => (
      <Badge variant={PRIORITY_VARIANT[t.priority] ?? 'default'}>{t.priority}</Badge>
    )},
    // BUGFIX (Phase 5): was 'assignedToName', a field that never existed
    // in the actual API response (see tasksApi.ts's doc-comment) — the
    // column always rendered blank. Corrected to the real field, assignedTo.
    { key: 'assignedTo', label: 'Assigned To' },
    { key: 'dueDate', label: 'Due', render: (t: Task) => t.dueDate ? (
      <span className={new Date(t.dueDate) < new Date() && !t.isCompleted ? 'text-red-600 font-medium' : ''}>
        {formatDate(t.dueDate)}
      </span>
    ) : '—' },
  ]

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle={`${totalCount} tasks`}
        action={
          <select value={filter} onChange={e => { setFilter(e.target.value); setPage(1) }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {[['', 'All'], ['pending', 'Pending'], ['completed', 'Completed']].map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
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
