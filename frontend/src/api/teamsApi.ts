import api from './axios'
import type { ApiResponse } from '@/types'

export interface Team {
  id: number; name: string; type: string; locationId?: number
  teamLeadUserId?: number; memberCount: number; createdAt: string
  teamLeadName?: string; locationName?: string
}
export interface TeamMember { id: number; userId: number; teamId: number; userName: string }

export const teamsApi = {
  getAll: () => api.get<ApiResponse<Team[]>>('/api/teams'),
  create: (data: Partial<Team>) => api.post<ApiResponse<Team>>('/api/teams', data),
  update: (id: number, data: Partial<Team>) => api.put<ApiResponse<Team>>(`/api/teams/${id}`, data),
  addMember: (teamId: number, userId: number) =>
    api.post<ApiResponse<TeamMember>>(`/api/teams/${teamId}/members`, { userId }),
  removeMember: (teamId: number, memberId: number) =>
    api.delete(`/api/teams/${teamId}/members/${memberId}`),
}
