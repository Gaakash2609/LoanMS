import api from './axios'
import type { ApiResponse } from '@/types'

// ── Rejection Reasons (Policy & Product page) ───────────────────────────────
// Mirrors RejectionReasonsController exactly: GET is open to any
// authenticated user (the Reject Application modal needs it for every role
// that can reject a loan); Create/Update/Reorder/Delete are Admin-only on
// the backend. Delete is a soft delete server-side.
export interface RejectionReason {
  id: number
  key: string
  label: string
  sortOrder: number
  createdAt: string
  updatedAt?: string | null
}

export interface RejectionReasonRequest {
  key?: string
  label: string
  sortOrder?: number
}

export const rejectionReasonsApi = {
  getAll: () =>
    api.get<ApiResponse<RejectionReason[]>>('/api/rejectionreasons'),

  create: (data: RejectionReasonRequest) =>
    api.post<ApiResponse<{ id: number; key: string }>>('/api/rejectionreasons', data),

  update: (id: number, data: RejectionReasonRequest) =>
    api.put<ApiResponse<boolean>>(`/api/rejectionreasons/${id}`, data),

  reorder: (orderedIds: number[]) =>
    api.put<ApiResponse<boolean>>('/api/rejectionreasons/reorder', orderedIds),

  delete: (id: number) =>
    api.delete<ApiResponse<boolean>>(`/api/rejectionreasons/${id}`),
}
