import { useState } from 'react'
import { roleTitle } from '@/pages/users/userConstants'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tasksApi, type Task, type TaskCreateRequest } from '@/api/tasksApi'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import DataTable, { type Column, sortRows } from '@/components/shared/DataTable'
import { useTableSort } from '@/hooks/useTableSort'
import { useHasPermission } from '@/hooks/usePermissions'
import PageHeader from '@/components/shared/PageHeader'
import MyApplicationsTab from '@/components/shared/MyApplicationsTab'
import { loansApi } from '@/api/loansApi'
import { useAuthStore } from '@/store/authStore'
import { formatDate } from '@/utils/format'
import { CheckCircle, Circle, Plus, X, Trash2, ArrowLeftRight } from 'lucide-react'
import { apiErrorMessage as errorMessage } from '@/utils/apiError'

const PAGE_SIZE = 20
const PRIORITIES = ['Low', 'Medium', 'High']

// Legacy's overdue rule (js/tasks.js): compare against *today at midnight*,
// not "now", so a task due today never reads as overdue.
function isOverdue(due: string): boolean {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(due); d.setHours(0, 0, 0, 0)
  return d < today
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[var(--z-modal)] p-4">
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

        <div className="flex justify-end gap-2 mt-5">
          <Button size="sm" loading={create.isPending} disabled={create.isPending} onClick={handleSubmit}>Create Task</Button>
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </Card>
    </div>
  )
}

// Transfer a task to another user — parity with legacy openTaskTransferModal /
// confirmTaskTransfer. Reuses the existing /api/users/lookup endpoint (same as
// the create modal's Assign-To field); the server enforces who may transfer.
function TransferTaskModal({ task, pending, onClose, onSubmit }: {
  task: Task; pending: boolean; onClose: () => void; onSubmit: (userId: number) => void
}) {
  const [userId, setUserId] = useState('')
  const [error, setError] = useState('')
  const { data: users, isLoading } = useQuery({
    queryKey: ['users-lookup'],
    queryFn: () => api.get<ApiResponse<{ id: number; fullName: string; role: string }[]>>('/api/users/lookup').then(r => r.data.data ?? []),
  })
  function confirm() {
    if (!userId) { setError('Select a user to transfer this task to.'); return }
    setError('')
    onSubmit(Number(userId))
  }
  return (
    <Modal open onClose={onClose} title="Transfer Task" subtitle={task.title} size="sm"
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" loading={pending} onClick={confirm}>Transfer</Button>
      </>}>
      {error && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <label className="block text-xs font-medium text-gray-600 mb-1">Transfer to *</label>
      <select value={userId} onChange={e => setUserId(e.target.value)} disabled={isLoading} className="efin-input">
        <option value="">— Select user —</option>
        {(users ?? []).filter(u => u.fullName !== task.assignedTo).map(u => (
          <option key={u.id} value={u.id}>{u.fullName} · {roleTitle(u.role)}</option>
        ))}
      </select>
      {task.assignedTo && <p className="text-[11px] text-gray-400 mt-2">Currently assigned to {task.assignedTo}.</p>}
    </Modal>
  )
}

export default function TasksPage() {
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  // canManageTasks IS a real frontend permission flag (constants/permissions
  // .ts) and the backend gates TasksController.Create/Delete on it. Gate the
  // Add-Task and delete-task actions on it too, so the button matches what
  // the backend accepts instead of showing to everyone and 403-ing.
  const canManageTasks = useHasPermission('canManageTasks')
  // Legacy's three tabs (switchTasksTab: mytasks / created / assigned) and
  // the summary pill row above them. It always reopens on My Tasks.
  const [tab, setTab] = useState<'mytasks' | 'created' | 'assigned'>('mytasks')
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()

  // BUGFIX (confirmed real, pre-existing gap — Phase 5 audit): see
  // tasksApi.ts's getAll() doc-comment. The `completed` value IS a real
  // server-side filter TasksController.GetAll honors, so it's still sent
  // to the backend — only page/pageSize (which the backend never read)
  // are dropped, with pagination now done client-side on the returned
  // array, same pattern already proven in UsersPage.tsx (Phase 4 Part C).
  // 'overdue' is the legacy filter (js/tasks.js: !t.done && due < today).
  // The backend only knows `completed`, so overdue asks the server for the
  // not-completed set and narrows it by due-date on the client — same rule
  // the legacy page used.
  const completedParam = filter === 'completed' ? true
    : (filter === 'pending' || filter === 'overdue') ? false
    : undefined
  const { data: allTasks, isLoading, error, refetch } = useQuery({
    queryKey: ['tasks', completedParam],
    queryFn: () => tasksApi.getAll({ completed: completedParam }).then(r => r.data.data),
  })

  const visibleTasks = (allTasks ?? []).filter(t =>
    filter !== 'overdue' ? true : !!t.dueDate && isOverdue(t.dueDate)
  )

  const { sortKey, sortDir, toggle: onSort } = useTableSort()
  const totalCount = visibleTasks.length
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  // Columns are declared below; sort+slice happens after them (see pageItems).

  // ── Summary pills (legacy renderTasksSummaryBar) ─────────────────────
  // Pending / Overdue come from this user's own open tasks; the two counts
  // on the right are application counts, matching legacy's pills exactly.
  const { data: allOpenTasks } = useQuery({
    queryKey: ['tasks', false],
    queryFn: () => tasksApi.getAll({ completed: false }).then(r => r.data.data ?? []),
  })
  const myOpen = (allOpenTasks ?? []).filter(t =>
    !t.assignedTo || t.assignedTo === user?.fullName)
  const pendingCount = myOpen.length
  const overdueCount = myOpen.filter(t => !!t.dueDate && isOverdue(t.dueDate)).length

  // One page of the visibility-scoped list is enough for both counts.
  const { data: myLoans } = useQuery({
    queryKey: ['my-applications-counts', user?.id],
    queryFn: () => loansApi.getAll({ page: 1, pageSize: 200 }).then(r => r.data.data),
    enabled: !!user?.id,
  })
  const createdCount  = (myLoans?.items ?? []).filter(l => l.createdByUserId === user?.id).length
  const assignedCount = (myLoans?.items ?? []).filter(l => l.assignedToUserId === user?.id).length

  // Status filter options rendered as Vanilla-style pills on the My Tasks tab.
  const STATUS_FILTERS: [string, string, number | null][] = [
    ['', 'All Tasks', null],
    ['pending', 'Pending', pendingCount],
    ['overdue', 'Overdue', overdueCount],
    ['completed', 'Completed', null],
  ]

  const TABS = [
    { key: 'mytasks'  as const, label: 'My Tasks',  count: null },
    { key: 'created'  as const, label: 'Created',   count: createdCount },
    { key: 'assigned' as const, label: 'Assigned',  count: assignedCount },
  ]

  const [actionError, setActionError] = useState('')
  const onActionError = (err: unknown) => setActionError(errorMessage(err, 'That action could not be completed.'))

  // PATCH /complete is a toggle server-side, so this is also how a completed
  // task is reopened (legacy's toggleGlobalTask did exactly the same).
  const toggle = useMutation({
    mutationFn: (id: number) => tasksApi.toggleComplete(id),
    onSuccess: () => { setActionError(''); qc.invalidateQueries({ queryKey: ['tasks'] }) },
    onError: onActionError,
  })

  const remove = useMutation({
    mutationFn: (id: number) => tasksApi.delete(id),
    onSuccess: () => { setActionError(''); qc.invalidateQueries({ queryKey: ['tasks'] }) },
    onError: onActionError,
  })

  // Task transfer (parity with legacy confirmTaskTransfer) — reassign a task
  // to another user. Server enforces "current assignee or canManageTasks".
  const [transferTask, setTransferTask] = useState<Task | null>(null)
  const reassign = useMutation({
    mutationFn: ({ id, userId }: { id: number; userId: number }) => tasksApi.reassign(id, userId),
    onSuccess: () => { setActionError(''); setTransferTask(null); qc.invalidateQueries({ queryKey: ['tasks'] }) },
    onError: onActionError,
  })

  const PRIORITY_VARIANT: Record<string, 'danger'|'warning'|'success'> = {
    High: 'danger', Medium: 'warning', Low: 'success'
  }

  const columns: Column<Task>[] = [
    // BUGFIX: this used to be `!t.isCompleted && complete.mutate(...)`, so a
    // completed task could never be un-completed from the UI even though the
    // backend route is a plain toggle — reopening a task was impossible.
    { key: 'status', label: '', render: (t: Task) => (
      <button onClick={() => toggle.mutate(t.id)} disabled={toggle.isPending}
        title={t.isCompleted ? 'Reopen task' : 'Mark complete'}
        className="text-gray-400 hover:text-green-500 disabled:opacity-50">
        {t.isCompleted ? <CheckCircle size={16} className="text-green-500" /> : <Circle size={16} />}
      </button>
    ), className: 'w-8' },
    { key: 'title', label: 'Task', sortable: true, sortValue: t => t.title, render: (t: Task) => (
      <div>
        <p className={`font-medium ${t.isCompleted ? 'line-through text-gray-400' : 'text-gray-900'}`}>{t.title}</p>
        {t.description && <p className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">{t.description}</p>}
      </div>
    )},
    // Sort by priority severity (High > Medium > Low), not alphabetically.
    { key: 'priority', label: 'Priority', sortable: true,
      sortValue: t => ({ High: 3, Medium: 2, Low: 1 } as Record<string, number>)[t.priority] ?? 0,
      render: (t: Task) => (
        <Badge variant={PRIORITY_VARIANT[t.priority] ?? 'default'}>{t.priority}</Badge>
      )},
    // BUGFIX (Phase 5): was 'assignedToName', a field that never existed
    // in the actual API response (see tasksApi.ts's doc-comment) — the
    // column always rendered blank. Corrected to the real field, assignedTo.
    { key: 'assignedTo', label: 'Assigned To', sortable: true, sortValue: t => t.assignedTo ?? '' },
    { key: 'dueDate', label: 'Due', sortable: true, sortValue: t => t.dueDate ?? null, render: (t: Task) => t.dueDate ? (
      <span className={!t.isCompleted && isOverdue(t.dueDate) ? 'text-red-600 font-medium' : ''}>
        {formatDate(t.dueDate)}
      </span>
    ) : '—' },
    // DELETE /api/tasks/{id} is a soft-delete gated behind canManageTasks
    // server-side — the delete affordance is shown only to users who hold
    // that permission (matching the backend), not to everyone with a 403
    // fallback.
    { key: 'actions', label: '', className: 'w-16', render: (t: Task) => (
      <div className="flex items-center gap-1.5">
        {/* Transfer — shown to the current assignee or a task manager; the
            server enforces the same rule regardless (parity with legacy's
            "only the current assignee can transfer this task"). */}
        {(canManageTasks || t.assignedTo === user?.fullName) && !t.isCompleted && (
          <button
            onClick={() => setTransferTask(t)}
            disabled={reassign.isPending}
            title="Transfer task"
            className="text-gray-400 hover:text-efin-blue disabled:opacity-50">
            <ArrowLeftRight size={15} />
          </button>
        )}
        {canManageTasks && (
          <button
            onClick={() => { if (window.confirm(`Delete task “${t.title}”?`)) remove.mutate(t.id) }}
            disabled={remove.isPending}
            title="Delete task"
            className="text-gray-400 hover:text-red-600 disabled:opacity-50">
            <Trash2 size={15} />
          </button>
        )}
      </div>
    )},
  ]

  // Sort the FULL visible list before slicing, so a sort spans every page.
  const pageItems = sortRows(visibleTasks, columns, sortKey, sortDir)
    .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle="All tasks across applications — assigned to your team."
        action={tab !== 'mytasks' || !canManageTasks ? null : (
          // Gated on canManageTasks — the same permission TasksController.Create
          // enforces server-side. The status filter moved to Vanilla-style pills
          // below (index.html Tasks page), so it is no longer a header dropdown.
          <Button size="sm" onClick={() => setShowCreate(true)}><Plus size={14} className="mr-1" />Add Task</Button>
        )}
      />

      {/* Tabs */}
      <div className="flex gap-6 border-b border-gray-200 mb-5">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`pb-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key ? 'border-efin-blue text-efin-blue' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
            {t.count ? <span className="ml-1.5 text-[11px] font-bold">{t.count}</span> : null}
          </button>
        ))}
      </div>
      {tab === 'created'  && <MyApplicationsTab mode="created" />}
      {tab === 'assigned' && <MyApplicationsTab mode="assigned" />}

      {tab === 'mytasks' && (<>
      {/* Status filter pills — legacy's Tasks status pills (All Tasks / …). */}
      <div className="flex flex-wrap gap-2 mb-5">
        {STATUS_FILTERS.map(([v, l, c]) => (
          <button key={v} type="button" onClick={() => { setFilter(v); setPage(1) }}
            className={`filter-chip ${filter === v ? 'active' : ''}`}>
            {l}{c != null ? ` (${c})` : ''}
          </button>
        ))}
      </div>
      {actionError && (
        <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{actionError}</div>
      )}
      <Card>
        <DataTable columns={columns} data={pageItems}
          isLoading={isLoading} error={error} onRetry={() => refetch()}
          emptyTitle="No tasks here"
          emptyDescription={filter === 'overdue' ? 'Nothing is past its due date.' : filter === 'completed' ? 'No tasks have been completed yet.' : 'You are all caught up.'}
          sortKey={sortKey} sortDir={sortDir} onSort={k => { onSort(k); setPage(1) }}
          totalPages={totalPages}
          currentPage={page} onPageChange={setPage} totalCount={totalCount}
        />
      </Card>
      </>)}

      {transferTask && (
        <TransferTaskModal
          task={transferTask}
          pending={reassign.isPending}
          onClose={() => setTransferTask(null)}
          onSubmit={(userId) => reassign.mutate({ id: transferTask.id, userId })}
        />
      )}

      {showCreate && (
        <CreateTaskModal
          onClose={() => setShowCreate(false)}
          onSuccess={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ['tasks'] }) }}
        />
      )}
    </div>
  )
}
