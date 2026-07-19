import api from './axios'
import type { ApiResponse, PagedResult } from '@/types'

export interface Ticket {
  id: number; title: string; description: string; status: string
  priority: string; loanId?: number; createdByName?: string
  assignedToName?: string; createdAt: string; closedAt?: string
}

export const ticketsApi = {
  getAll: (params?: Record<string, unknown>) =>
    api.get<ApiResponse<PagedResult<Ticket>>>('/api/tickets', { params }),
  create: (data: Partial<Ticket>) => api.post<ApiResponse<Ticket>>('/api/tickets', data),
  update: (id: number, data: Partial<Ticket>) =>
    api.put<ApiResponse<Ticket>>(`/api/tickets/${id}`, data),
  close: (id: number) => api.patch<ApiResponse<Ticket>>(`/api/tickets/${id}/close`),
}
