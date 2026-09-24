import api from './axios'
import type { ApiResponse, CreateCustomerRequest, Customer, PagedResult } from '@/types'

/** DELETE /api/customers/{id} — what the permanent delete removed. */
export interface CustomerDeletionResult {
  customerId: number; loans: number; documents: number; payoutClaims: number
  bureauReports: number; auditEntries: number
  /** Stored files that could not be removed after the DB delete committed. */
  storageFailures: string[]
}

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

  /** PERMANENT: removes the customer and everything linked to them (Admin only). */
  delete: (id: number) =>
    api.delete<ApiResponse<CustomerDeletionResult>>(`/api/customers/${id}`),
}
