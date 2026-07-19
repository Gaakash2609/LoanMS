import api from './axios'
import type { ApiResponse, PagedResult } from '@/types'

export interface Task {
  id: number; title: string; description?: string; priority: string
  isCompleted: boolean; dueDate?: string; loanId?: number
  assignedToUserId: number; assignedToName?: string; createdByName?: string
  createdAt: string
}

export const tasksApi = {
  getAll: (params?: Record<string, unknown>) =>
    api.get<ApiResponse<PagedResult<Task>>>('/api/tasks', { params }),
  create: (data: Partial<Task>) => api.post<ApiResponse<Task>>('/api/tasks', data),
  update: (id: number, data: Partial<Task>) => api.put<ApiResponse<Task>>(`/api/tasks/${id}`, data),
  complete: (id: number) => api.patch<ApiResponse<Task>>(`/api/tasks/${id}/complete`),
  delete: (id: number) => api.delete(`/api/tasks/${id}`),
}
