export type UserRole = 'Admin' | 'Manager' | 'Sales' | 'Partner'

export interface User {
  id: number
  fullName: string
  email: string
  role: UserRole
  isActive: boolean
  createdAt: string
}

export type LoanStatus = 'Draft'|'Submitted'|'UnderReview'|'Approved'|'Disbursed'|'Rejected'|'Closed'
export type LoanType = 'Personal'|'Business'|'Home'|'NewCar'|'UsedCar'|'Education'|'AgainstProperty'|'Insurance'

export interface Customer {
  id: number; fullName: string; email: string; phone: string
  panNumber?: string; aadhaarNumber?: string; dateOfBirth?: string
  address?: string; city?: string; state?: string; pinCode?: string
  monthlyIncome?: number; employmentType?: string; companyName?: string
  cibilScore?: number; totalLoans: number; createdAt: string
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
  monthlyIncome?: number; employmentType?: string; companyName?: string
  cibilScore?: number
}

// ── Additional API types ──────────────────────────────────────────────────────
export interface UpdateLoanStatusRequest {
  newStatus: string
  comment?: string
  approvedAmount?: number
}
