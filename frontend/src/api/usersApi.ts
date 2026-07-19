import api from './axios'
import type { ApiResponse, User, PagedResult } from '@/types'

export const usersApi = {
  getAll: (page = 1, pageSize = 50, search?: string) =>
    api.get<ApiResponse<PagedResult<User>>>('/api/users', { params: { page, pageSize, search } }),
  getById: (id: number) => api.get<ApiResponse<User>>(`/api/users/${id}`),
  create: (data: Partial<User> & { password?: string }) =>
    api.post<ApiResponse<User>>('/api/users', data),
  update: (id: number, data: Partial<User>) =>
    api.put<ApiResponse<User>>(`/api/users/${id}`, data),
  toggleActive: (id: number) =>
    api.patch<ApiResponse<User>>(`/api/users/${id}/toggle-active`),
}
