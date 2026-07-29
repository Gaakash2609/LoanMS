import api from './axios'
import type { ApiResponse, CreateLoanRequest, Loan, LoanFilter, LoanListItem, PagedResult, DashboardStats } from '@/types'

export const loansApi = {
  getAll: (filter: LoanFilter) =>
    api.get<ApiResponse<PagedResult<LoanListItem>>>('/api/loans', { params: filter }),

  getById: (id: number) =>
    api.get<ApiResponse<Loan>>(`/api/loans/${id}`),

  create: (data: CreateLoanRequest) =>
    api.post<ApiResponse<Loan>>('/api/loans', data),

  update: (id: number, data: Partial<CreateLoanRequest>) =>
    api.put<ApiResponse<Loan>>(`/api/loans/${id}`, data),

  updateStatus: (id: number, data: { newStatus: string; comment?: string; approvedAmount?: number }) =>
    api.patch<ApiResponse<Loan>>(`/api/loans/${id}/status`, data),

  delete: (id: number) =>
    api.delete<ApiResponse<boolean>>(`/api/loans/${id}`),

  getDashboard: () =>
    api.get<ApiResponse<DashboardStats>>('/api/loans/dashboard'),

  uploadDocument: (loanId: number, file: File, documentType: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('documentType', documentType)
    return api.post<ApiResponse<{
      id: number; documentName: string; documentType: string
      fileRef: string; fileSizeBytes: number; uploadedAt: string
    }>>(`/api/loans/${loanId}/documents`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  getDocuments: (loanId: number) =>
    api.get<ApiResponse<Array<{
      id: number; documentName: string; documentType: string
      fileRef: string; fileSizeBytes: number; uploadedAt: string
    }>>>(`/api/loans/${loanId}/documents`),
}
