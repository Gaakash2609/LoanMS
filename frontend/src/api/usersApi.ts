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
  // Primary Location / Sales-Team / Operation-Team the legacy user modal
  // captures on create (CreateUserRequestDto.LocationName/SalesTeam/OpTeam,
  // persisted onto the user as denormalised strings by UserService).
  locationName?: string
  salesTeam?: string
  opTeam?: string
}

export interface UpdateUserRequest {
  fullName: string
  isActive: boolean
  role: UserRole
  phoneNumber?: string
  // Same primary Location / Sales-Team / Operation-Team fields the legacy
  // user modal edits (UpdateUserRequestDto.LocationName/SalesTeam/OpTeam).
  locationName?: string
  salesTeam?: string
  opTeam?: string
}

// Self-service profile — GET/PUT /api/users/profile. Both routes already
// existed on UsersController (own-record-only; id always comes from the
// caller's JWT), and UserDto/UpdateProfileRequestDto already carried the
// photo, address and bank fields — but nothing in the React app ever
// called them, so ProfilePage could only show name/email/role off the JWT.
export interface UserProfile {
  id: number
  fullName: string
  email: string
  role: string
  isActive: boolean
  createdAt: string
  employeeCode?: string | null
  phoneNumber?: string | null
  locationName?: string | null
  salesTeam?: string | null
  opTeam?: string | null
  photoData?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  addressCity?: string | null
  addressState?: string | null
  addressPostalCode?: string | null
  bankAccountHolderName?: string | null
  bankName?: string | null
  bankAccountType?: string | null
  bankAccountNumber?: string | null
  bankIfscCode?: string | null
}

// Matches UpdateProfileRequestDto exactly. Every field optional — the
// service only assigns what's sent, so a partial save can't blank the rest.
export interface UpdateProfileRequest {
  phoneNumber?: string | null
  photoData?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  addressCity?: string | null
  addressState?: string | null
  addressPostalCode?: string | null
  bankAccountHolderName?: string | null
  bankName?: string | null
  bankAccountType?: string | null
  bankAccountNumber?: string | null
  bankIfscCode?: string | null
}

export const usersApi = {
  getProfile: () => api.get<ApiResponse<UserProfile>>('/api/users/profile'),
  updateProfile: (data: UpdateProfileRequest) =>
    api.put<ApiResponse<UserProfile>>('/api/users/profile', data),

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

  // Both Admin-only routes already existed on UsersController with no
  // React caller — the Users page had no delete and no way for an admin to
  // reset another user's password.
  // Delete refuses self-deletion server-side ("Cannot delete your own
  // account."); the UI hides the button for the signed-in user too.
  delete: (id: number) => api.delete<ApiResponse<boolean>>(`/api/users/${id}`),
  // AdminResetPasswordRequestDto — { NewPassword } only, min length 6. No
  // current password is required (that's the point of an admin reset).
  adminResetPassword: (id: number, newPassword: string) =>
    api.post<ApiResponse<boolean>>(`/api/users/${id}/reset-password`, { newPassword }),

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
