// Extended to match the full backend UserRole enum (LoanMS.Domain.Enums.
// UserRole — 11 values) — was previously only the 4 roles this page's own
// ROLE_VARIANTS badge-map happened to color, not the actual full set a
// user can be created/edited with.
export type UserRole = 'Admin' | 'Manager' | 'Sales' | 'Dsa' | 'Partner' |
  'LoginTeam' | 'TeamLeader' | 'Accounts' | 'LocationHead' | 'OperationManager' | 'ProductTeam'

export interface User {
  id: number
  fullName: string
  email: string
  role: UserRole
  isActive: boolean
  createdAt: string
  // Confirmed already present in the backend's UserDto (LoanMS.
  // Application/DTOs/User/UserDto.cs) and already returned by GET
  // /api/users — this type just didn't declare the field yet. Nullable —
  // users created before Employee Code generation existed may not have
  // one (see IEmployeeCodeGenerator's backfill routine).
  employeeCode?: string | null
}

// Shape of GET /users/{id}/locations-and-teams's response (Users
// Controller.GetLocationsAndTeams) — read-only display data for Part C,
// reusing this existing per-user endpoint as-is.
export interface UserLocationsAndTeams {
  locations: { locationId: number; name: string }[]
  salesTeams: { teamId: number; name: string }[]
  opTeams: { teamId: number; name: string }[]
}

// Minimal shapes for the dropdown/checklist option-lists — GET
// /api/locations and GET /api/teams already return more fields than
// this, but the mapping UI only needs id+name.
export interface LocationOption { id: number; name: string }
export interface TeamOption { id: number; name: string; type: 'Sales' | 'Login' }

export type LoanStatus = 'Draft'|'Submitted'|'UnderReview'|'Approved'|'Disbursed'|'Rejected'|'Closed'
export type LoanType = 'Personal'|'Business'|'Home'|'NewCar'|'UsedCar'|'Education'|'AgainstProperty'|'Insurance'

export interface Customer {
  id: number; fullName: string; email: string; phone: string
  panNumber?: string; aadhaarNumber?: string; dateOfBirth?: string
  address?: string; city?: string; state?: string; pinCode?: string
  monthlyIncome?: number; monthlyObligations?: number; employmentType?: string; companyName?: string
  cibilScore?: number; gender?: string; fatherName?: string; residenceType?: string
  totalLoans: number; createdAt: string
}

export interface LoanStatusHistory {
  id: number; fromStatus: LoanStatus; toStatus: LoanStatus
  comment?: string; changedBy: string; changedAt: string
}

export interface Loan {
  id: number; loanNumber: string; loanType: string; status: LoanStatus
  requestedAmount: number; approvedAmount?: number; interestRate: number
  tenureMonths: number; monthlyEmi?: number; purpose?: string; remarks?: string
  approvedAt?: string; disbursedAt?: string; createdAt: string
  customer: Customer; createdBy: User; assignedTo?: User
  statusHistory: LoanStatusHistory[]
}

export interface LoanListItem {
  id: number; loanNumber: string; loanType: string; status: LoanStatus
  requestedAmount: number; approvedAmount?: number; interestRate: number
  tenureMonths: number; monthlyEmi?: number; customerName: string
  customerPhone: string; createdByName: string; assignedToName?: string; createdAt: string
}

export interface LoanOffer {
  id: number; offerType?: string; loanAmount: number
  loanMaxTenure: number; loanRate: number; processingFee: number
}

export interface IncredLoanInfo {
  loanId: number; isIncredApplication: boolean; applicationSource?: string
  incredApplicationId?: string; incredCustomerId?: string; incredRequestId?: string
  incredOfferStatus?: string; incredErrorMessage?: string; incredRejectReason?: string
  incredLastWebhookEvent?: string; incredLastWebhookStatus?: string
  incredLastSyncedAt?: string; offers: LoanOffer[]
}

export interface DashboardStats {
  totalLoans: number; totalCustomers: number; pendingLoans: number
  approvedLoans: number; rejectedLoans: number; disbursedLoans: number
  totalRequestedAmount: number; totalApprovedAmount: number
  totalDisbursedAmount: number; recentLoans: LoanListItem[]
}

export interface PagedResult<T> {
  items: T[]; totalCount: number; page: number
  pageSize: number; totalPages: number; hasNext: boolean; hasPrev: boolean
}

export interface ApiResponse<T> {
  success: boolean; message?: string; data?: T; errors: string[]
}

export interface LoginRequest { email: string; password: string }
export interface LoginResponse {
  accessToken: string; refreshToken: string; expiresAt: string; user: User
}

export interface AIInsightResponse {
  success: boolean; insight?: string; error?: string; aiEnabled: boolean
}

export interface LoanFilter {
  page?: number; pageSize?: number; search?: string; status?: LoanStatus
  loanType?: string; dateFrom?: string; dateTo?: string; assignedToUserId?: number
}

export interface CreateLoanRequest {
  customerId: number; loanType: number; requestedAmount: number
  interestRate: number; tenureMonths: number; purpose?: string
  remarks?: string; assignedToUserId?: number
}

export interface CreateCustomerRequest {
  fullName: string; email: string; phone: string; panNumber?: string
  aadhaarNumber?: string; dateOfBirth?: string; address?: string
  city?: string; state?: string; pinCode?: string
  monthlyIncome?: number; monthlyObligations?: number; employmentType?: string; companyName?: string
  cibilScore?: number
}

// ── Additional API types ──────────────────────────────────────────────────────
export interface UpdateLoanStatusRequest {
  newStatus: string
  comment?: string
  approvedAmount?: number
}
