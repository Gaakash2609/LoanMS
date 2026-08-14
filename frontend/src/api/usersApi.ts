import api from './axios'
import type { ApiResponse, User, UserRole, UserLocationsAndTeams, LocationOption, TeamOption } from '@/types'

// Exact shape of CreateUserRequestDto / UpdateUserRequestDto (LoanMS.
// Application/DTOs/User) — replaces the previous loose Partial<User>
// typing, which didn't match either DTO precisely (User has no
// phoneNumber field at all, and Partial<User> would have wrongly allowed
// id/createdAt to be sent).
export interface CreateUserRequest {
  fullName: string
  email: string
  password: string
  role: UserRole
  phoneNumber?: string
}

export interface UpdateUserRequest {
  fullName: string
  isActive: boolean
  role: UserRole
  phoneNumber?: string
}

export const usersApi = {
  // BUGFIX (confirmed real, pre-existing gap — Phase 4 Part C audit):
  // this was typed/handled as ApiResponse<PagedResult<User>>
  // ({items, totalCount, totalPages}), but UsersController.GetAll()
  // (LoanMS.API/Controllers/UsersController.cs) takes no page/pageSize/
  // search parameters at all and returns a plain ApiResponseDto<
  // IEnumerable<UserDto>> — a raw array, not a paged shape. That mismatch
  // meant data?.items was always undefined and the table showed zero
  // users regardless of how many actually existed. Corrected to the
  // actual response shape; page/pageSize/search parameters are dropped
  // from the call (the backend never read them either) rather than
  // silently implying server-side paging/search that doesn't exist.
  getAll: () =>
    api.get<ApiResponse<User[]>>('/api/users'),
  getById: (id: number) => api.get<ApiResponse<User>>(`/api/users/${id}`),
  // Read-only Location/Team display data for Part C — reuses the
  // existing per-user endpoint UsersController.GetLocationsAndTeams
  // already exposes (built for the legacy "Manage Locations & Teams"
  // panel) as-is; no new mapping endpoint.
  getLocationsAndTeams: (id: number) =>
    api.get<ApiResponse<UserLocationsAndTeams>>(`/api/users/${id}/locations-and-teams`),
  create: (data: CreateUserRequest) =>
    api.post<ApiResponse<User>>('/api/users', data),
  update: (id: number, data: UpdateUserRequest) =>
    api.put<ApiResponse<User>>(`/api/users/${id}`, data),
  // BUGFIX (confirmed real bug — Phase 4 Part A): this called
  // PATCH /api/users/{id}/toggle-active, a route that never existed in
  // UsersController.cs — every click genuinely 404'd. The real, existing
  // endpoint is PATCH /api/users/{id}/status, which (unlike the old,
  // imagined route) doesn't flip state server-side — it requires the
  // caller to send the target isActive value explicitly (see
  // UsersController.SetStatus's SetUserStatusRequestDto). Signature
  // changed to accept that value; UsersPage.tsx passes the flipped
  // current state when calling this. Name kept as toggleActive (not
  // renamed) — it's still the one function the toggle-button calls, only
  // its internal contract changed.
  toggleActive: (id: number, isActive: boolean) =>
    api.patch<ApiResponse<boolean>>(`/api/users/${id}/status`, { isActive }),

  // ── Part D: Location/Team multi-select mapping ──────────────────────────
  // Both endpoints already existed (UsersController.SetLocations/SetTeams —
  // built earlier for the legacy "Manage Locations & Teams" panel) — reused
  // exactly as-is, whole-replace semantics (send the FULL desired set each
  // time), no new backend endpoint.
  setLocations: (id: number, locationIds: number[]) =>
    api.put<ApiResponse<boolean>>(`/api/users/${id}/locations`, locationIds),
  setTeams: (id: number, salesTeamIds: number[], operationTeamIds: number[]) =>
    api.put<ApiResponse<boolean>>(`/api/users/${id}/teams`, { salesTeamIds, operationTeamIds }),

  // Option-lists for the mapping UI's checklists — reuses the existing
  // Locations/Teams management endpoints (GET /api/locations, GET
  // /api/teams) rather than inventing a users-scoped variant.
  getAllLocations: () =>
    api.get<ApiResponse<LocationOption[]>>('/api/locations'),
  getAllTeams: (type: 'Sales' | 'Login') =>
    api.get<ApiResponse<TeamOption[]>>('/api/teams', { params: { type } }),
}
