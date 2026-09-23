import api from './axios'
import type { ApiResponse } from '@/types'

export interface Task {
  id: number; title: string; description?: string; priority: string
  isCompleted: boolean; dueDate?: string; loanId?: number
  // BUGFIX (confirmed real, pre-existing gap — Phase 5 audit): field-names
  // corrected to match TasksController.GetAll's actual Select() shape
  // (AssignedTo/CreatedBy — plain strings, camelCase-serialized to
  // assignedTo/createdBy) — assignedToName/createdByName never existed in
  // any real response, so those columns always rendered blank.
  assignedTo?: string; createdBy?: string
  createdAt: string
}

// Exact shape of TaskCreateDto (LoanMS.API/Controllers/TasksController.cs)
// — genuinely different from the Task list-shape above (that one has
// assignedTo as a resolved name-string; the backend's create-DTO wants
// AssignedToUserId as a required number).
export interface TaskCreateRequest {
  title: string
  description?: string
  priority?: string
  dueDate?: string
  loanId?: number
  assignedToUserId: number
}

export const tasksApi = {
  // BUGFIX (confirmed real, pre-existing gap — Phase 5 audit, same
  // root-cause class as Phase 4 Part C's UsersController fix):
  // TasksController.GetAll (LoanMS.API/Controllers/TasksController.cs)
  // returns a plain ApiResponseDto<object> wrapping a raw array — not a
  // paged shape — so data?.items/totalCount/totalPages were always
  // undefined and the table showed zero tasks regardless of how many
  // existed. Unlike UsersController.GetAll, this endpoint DOES honor
  // loanId/completed as real server-side filters (confirmed in the
  // controller body) — those are kept and sent as query params; only the
  // page/pageSize illusion is removed, since the backend never paginates.
  getAll: (params?: { loanId?: number; completed?: boolean }) =>
    api.get<ApiResponse<Task[]>>('/api/tasks', { params }),
  create: (data: TaskCreateRequest) => api.post<ApiResponse<{ id: number }>>('/api/tasks', data),

  // NOTE: there is deliberately no update() here. TasksController exposes only
  // GET / POST / PATCH {id}/complete / PATCH {id}/reassign / DELETE {id} — no
  // general PUT — so a full `update()` could only ever have 404'd.

  // Reassign a task to another user (parity with legacy confirmTaskTransfer).
  // Backend enforces "current assignee or canManageTasks".
  reassign: (id: number, assignedToUserId: number) =>
    api.patch<ApiResponse<{ id: number; assignedTo: string }>>(`/api/tasks/${id}/reassign`, { assignedToUserId }),

  // This is a TOGGLE on the backend (task.IsCompleted = !task.IsCompleted),
  // which is how a completed task gets reopened — there is no separate
  // reopen route. The UI must therefore allow clicking a checked task too.
  toggleComplete: (id: number) => api.patch<ApiResponse<boolean>>(`/api/tasks/${id}/complete`),

  // Soft-delete (sets IsDeleted); gated behind canManageTasks on the server.
  delete: (id: number) => api.delete<ApiResponse<boolean>>(`/api/tasks/${id}`),
}
