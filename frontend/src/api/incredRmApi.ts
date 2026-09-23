import api from './axios'
import type { ApiResponse } from '@/types'

// ── InCred Relationship Managers ────────────────────────────────────────
// /api/incred/rm (IncredController:1204-1275) has had full CRUD since the RM
// list was moved off the legacy in-memory `var RM_EMAILS = []`, with no React
// caller — the master list could only be managed from the legacy shell.
//
// Read is open to any authenticated user (same as GET /api/dsa); create,
// update and delete are all [Authorize(Roles = "Admin")]. Delete is a soft
// delete, and the entity carries a !IsDeleted query filter, so a removed RM
// stops appearing in the list.
//
// Note the field-name shape: the API returns camelCase `contactNo`. Legacy
// remaps it to `contact_no` for its own local array (_rmToLocal in
// api-bridge.js:1209) — that snake_case name is legacy-local only and is
// deliberately not reproduced here.

export interface IncredRm {
  id: number
  name: string
  location?: string | null
  email: string
  contactNo?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

/** Exact shape of RmEmailUpsertDto. Name and Email are required server-side. */
export interface IncredRmUpsertRequest {
  name: string
  location?: string | null
  email: string
  contactNo?: string | null
}

/** Server column limits (AppDbContext:336) — mirrored as input maxLengths. */
export const RM_FIELD_LIMITS = { name: 150, location: 100, email: 200, contactNo: 15 }

export const incredRmApi = {
  // Ordered by Name server-side.
  getAll: () => api.get<ApiResponse<IncredRm[]>>('/api/incred/rm'),

  create: (data: IncredRmUpsertRequest) =>
    api.post<ApiResponse<{ id: number }>>('/api/incred/rm', data),

  update: (id: number, data: IncredRmUpsertRequest) =>
    api.put<ApiResponse<boolean>>(`/api/incred/rm/${id}`, data),

  delete: (id: number) =>
    api.delete<ApiResponse<boolean>>(`/api/incred/rm/${id}`),
}
