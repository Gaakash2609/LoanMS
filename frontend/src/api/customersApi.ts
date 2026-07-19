import api from './axios'
import type { ApiResponse, CreateCustomerRequest, Customer, PagedResult } from '@/types'

export const customersApi = {
  getAll: (page = 1, pageSize = 20, search?: string) =>
    api.get<ApiResponse<PagedResult<Customer>>>('/api/customers', {
      params: { page, pageSize, search },
    }),

  getById: (id: number) =>
    api.get<ApiResponse<Customer>>(`/api/customers/${id}`),

  create: (data: CreateCustomerRequest) =>
    api.post<ApiResponse<Customer>>('/api/customers', data),

  update: (id: number, data: Partial<CreateCustomerRequest>) =>
    api.put<ApiResponse<Customer>>(`/api/customers/${id}`, data),

  delete: (id: number) =>
    api.delete<ApiResponse<boolean>>(`/api/customers/${id}`),
}
