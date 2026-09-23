import api from './axios'
import type { ApiResponse } from '@/types'

export interface TeamMemberInfo { userId: number; fullName: string; email: string }

// Matches TeamsController.GetAll's projection exactly (LoanMS.API/
// Controllers/TeamsController.cs) — locationName/teamLeadUserId/isActive
// were previously missing from this type even though earlier versions of
// the endpoint already returned locationName/isActive; teamLeadUserId was
// genuinely absent from the backend response until this pass (see the
// controller's own comment) since the edit form needs it to pre-select the
// current leader, not just display their name.
export interface Team {
  id: number
  name: string
  type: 'Sales' | 'Login' | string
  locationId?: number | null
  locationName?: string | null
  teamLead?: string | null
  teamLeadUserId?: number | null
  isActive: boolean
  members: TeamMemberInfo[]
}

export interface TeamSaveRequest {
  name: string
  type: 'Sales' | 'Login'
  locationId?: number | null
  teamLeadUserId?: number | null
}

export const teamsApi = {
  getAll: (params?: { type?: 'Sales' | 'Login' }) =>
    api.get<ApiResponse<Team[]>>('/api/teams', { params }),
  create: (data: TeamSaveRequest) => api.post<ApiResponse<{ id: number }>>('/api/teams', data),
  update: (id: number, data: TeamSaveRequest) => api.put<ApiResponse<boolean>>(`/api/teams/${id}`, data),
  setStatus: (id: number, isActive: boolean) =>
    api.patch<ApiResponse<boolean>>(`/api/teams/${id}/status`, { isActive }),
  delete: (id: number) => api.delete<ApiResponse<boolean>>(`/api/teams/${id}`),
  addMember: (teamId: number, userId: number) =>
    api.post<ApiResponse<boolean>>(`/api/teams/${teamId}/members`, { userId }),
  // BUGFIX (confirmed real, pre-existing gap): took a `memberId` distinct
  // from `userId`, but the backend route is DELETE /api/teams/{id}/members/
  // {userId} — there is no separate member-record id anywhere in the
  // Members payload (just userId/fullName/email), so the old signature
  // could never have worked correctly. Renamed to `userId` to match what
  // the route actually expects and what TeamMemberInfo actually has.
  removeMember: (teamId: number, userId: number) =>
    api.delete<ApiResponse<boolean>>(`/api/teams/${teamId}/members/${userId}`),
}
