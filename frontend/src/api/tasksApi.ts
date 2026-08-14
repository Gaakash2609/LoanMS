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
  create: (data: Partial<Task>) => api.post<ApiResponse<Task>>('/api/tasks', data),
  update: (id: number, data: Partial<Task>) => api.put<ApiResponse<Task>>(`/api/tasks/${id}`, data),
  complete: (id: number) => api.patch<ApiResponse<Task>>(`/api/tasks/${id}/complete`),
  delete: (id: number) => api.delete(`/api/tasks/${id}`),
}
