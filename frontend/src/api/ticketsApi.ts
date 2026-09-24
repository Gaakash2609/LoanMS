import api from './axios'
import type { ApiResponse } from '@/types'

export interface Ticket {
  id: number; title: string; description: string; status: string
  priority: string; loanId?: number
  // BUGFIX (confirmed real, pre-existing gap — Phase 5 audit): field-names
  // corrected to match TicketsController.GetAll's actual Select() shape
  // (CreatedBy/AssignedTo — plain strings) — createdByName/assignedToName
  // never existed in any real response, so those columns always rendered
  // blank.
  createdBy?: string; assignedTo?: string
  createdAt: string; updatedAt?: string; closedAt?: string
}

// Exact shape of TicketCreateDto (LoanMS.API/Controllers/TicketsController.cs)
// — Description is required (non-nullable) unlike Task's, and
// AssignedToUserId is optional here (unlike Task's required field).
export interface TicketCreateRequest {
  title: string
  description: string
  priority?: string
  loanId?: number
  assignedToUserId?: number
}

export const ticketsApi = {
  // BUGFIX (confirmed real, pre-existing gap — Phase 5 audit, same
  // root-cause class as Phase 4 Part C's UsersController fix):
  // TicketsController.GetAll returns a plain ApiResponseDto<object>
  // wrapping a raw array — not a paged shape — so data?.items/totalCount/
  // totalPages were always undefined and the table showed zero tickets
  // regardless of how many existed. status IS a real server-side filter
  // this endpoint honors (confirmed in the controller body) and is kept;
  // only the page/pageSize illusion is removed.
  getAll: (params?: { status?: string }) =>
    api.get<ApiResponse<Ticket[]>>('/api/tickets', { params }),
  create: (data: TicketCreateRequest) => api.post<ApiResponse<{ id: number }>>('/api/tickets', data),
  close: (id: number) => api.patch<ApiResponse<Ticket>>(`/api/tickets/${id}/close`),

  // ── Routes that already existed but had no React caller ────────────────
  // Reopen is its own PATCH so it can clear ClosedAt and write an Activity
  // record; Close deliberately stays separate too (Admin/Manager only).
  reopen: (id: number) => api.patch<ApiResponse<boolean>>(`/api/tickets/${id}/reopen`),

  // "Resolve" has no dedicated endpoint by design — the controller routes it
  // through PUT /{id} as a plain status change (allowed values there are
  // Open / In Progress / Resolved; Closed and reopening-from-Closed are
  // rejected and must use the Close/Reopen actions).
  setStatus: (id: number, status: 'Open' | 'In Progress' | 'Resolved') =>
    api.put<ApiResponse<boolean>>(`/api/tickets/${id}`, { status }),

  getComments: (id: number) =>
    api.get<ApiResponse<TicketComment[]>>(`/api/tickets/${id}/comments`),
  addComment: (id: number, content: string) =>
    api.post<ApiResponse<{ id: number }>>(`/api/tickets/${id}/comments`, { content }),
}

// Matches GetComments' projection. `type` is "Comment" for user notes and
// "Activity" for system-written entries (status changes, reassignment,
// close/reopen) — rendered differently in the thread.
export interface TicketComment {
  id: number
  content: string
  type: 'Comment' | 'Activity' | string
  user: string
  createdAt: string
}
