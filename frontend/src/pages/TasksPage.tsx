import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tasksApi, type Task } from '@/api/tasksApi'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import DataTable, { type Column } from '@/components/shared/DataTable'
import PageHeader from '@/components/shared/PageHeader'
import { formatDate } from '@/utils/format'
import { CheckCircle, Circle } from 'lucide-react'

export default function TasksPage() {
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState('')
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', page, filter],
    queryFn: () => tasksApi.getAll({ page, pageSize: 20, isCompleted: filter === 'completed' ? true : filter === 'pending' ? false : undefined }).then(r => r.data.data),
  })

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
    { key: 'assignedToName', label: 'Assigned To' },
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
        subtitle={`${data?.totalCount ?? 0} tasks`}
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
        <DataTable columns={columns} data={data?.items}
          isLoading={isLoading} totalPages={data?.totalPages}
          currentPage={page} onPageChange={setPage} totalCount={data?.totalCount}
        />
      </Card>
    </div>
  )
}
