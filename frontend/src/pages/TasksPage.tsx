import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tasksApi, type Task, type TaskCreateRequest } from '@/api/tasksApi'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import DataTable, { type Column } from '@/components/shared/DataTable'
import PageHeader from '@/components/shared/PageHeader'
import { formatDate } from '@/utils/format'
import { CheckCircle, Circle, Plus, X } from 'lucide-react'

const PAGE_SIZE = 20
const PRIORITIES = ['Low', 'Medium', 'High']

function errorMessage(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
  return msg?.message || msg?.errors?.join(' ') || fallback
}

// ── Phase 17: Create Task modal ─────────────────────────────────────────
// Uses the existing GET /api/users/lookup endpoint (non-Admin-accessible —
// same one the legacy Wizard's Sales-Person dropdown already uses) to
// populate the required AssignedToUserId field, since TaskCreateDto
// requires a real user id, not a name-string.
function CreateTaskModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('Medium')
  const [dueDate, setDueDate] = useState('')
  const [assignedToUserId, setAssignedToUserId] = useState('')
  const [error, setError] = useState('')

  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ['users-lookup'],
    queryFn: () => api.get<ApiResponse<{ id: number; fullName: string; role: string }[]>>('/api/users/lookup').then(r => r.data.data ?? []),
  })

  const create = useMutation({
    mutationFn: (payload: TaskCreateRequest) => tasksApi.create(payload),
    onSuccess: () => onSuccess(),
    onError: (err: unknown) => setError(errorMessage(err, 'Could not create task. Please try again.')),
  })

  function handleSubmit() {
    if (!title.trim()) { setError('Title is required.'); return }
    if (!assignedToUserId) { setError('Please assign this task to a user.'); return }
    setError('')
    if (create.isPending) return // duplicate-submission guard, same as the button's own disabled state below
    create.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      dueDate: dueDate || undefined,
      assignedToUserId: Number(assignedToUserId),
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold">New Task</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Title *</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Follow up with customer" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Description</label>
            <input value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Optional" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Due Date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Assign To *</label>
            <select value={assignedToUserId} onChange={e => setAssignedToUserId(e.target.value)}
              disabled={usersLoading} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">{usersLoading ? 'Loading…' : 'Select user…'}</option>
              {(users ?? []).map(u => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </select>
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <Button size="sm" loading={create.isPending} disabled={create.isPending} onClick={handleSubmit}>Create Task</Button>
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </Card>
    </div>
  )
}

export default function TasksPage() {
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)
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
          <>
            <select value={filter} onChange={e => { setFilter(e.target.value); setPage(1) }}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {[['', 'All'], ['pending', 'Pending'], ['completed', 'Completed']].map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            {/* Phase 17: TasksController.Create is gated behind a dynamic
                canManageTasks permission with no frontend-facing lookup for
                it (confirmed by inspection — no permissions API exists for
                this). Per the approved approach, the button is shown to
                every authenticated user and a real backend 403 is
                surfaced as a normal error rather than the frontend
                guessing/duplicating the permission rule. */}
            <Button size="sm" onClick={() => setShowCreate(true)}><Plus size={14} className="mr-1" />Add Task</Button>
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
        <CreateTaskModal
          onClose={() => setShowCreate(false)}
          onSuccess={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ['tasks'] }) }}
        />
      )}
    </div>
  )
}
