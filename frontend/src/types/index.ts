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
  // The user's PRIMARY location name (UserDto.LocationName, already returned
  // by GET /api/users — just undeclared here). Legacy's team member-picker
  // filters candidates by this single location (api-bridge maps
  // `locs = locationName ? [locationName] : []`), NOT the full many-to-many
  // set, so this one field is enough to match that filter exactly.
  locationName?: string | null
  // Primary phone / sales-team / operation-team — all already returned by
  // GET /api/users (UserDto.PhoneNumber/SalesTeam/OpTeam), just undeclared.
  // Legacy's Users table + View Details show these primary values (its
  // `u.locs/salesTeams/opTeams` are api-bridge-mapped to the single
  // primary string), and its user modal edits them.
  phoneNumber?: string | null
  salesTeam?: string | null
  opTeam?: string | null
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

export type LoanStatus = 'Draft'|'Submitted'|'UnderReview'|'Approved'|'Disbursed'|'Rejected'|'Closed'|'OnHold'|'Decision'|'Acceptance'
export type LoanType = 'Personal'|'Business'|'Home'|'Car'|'NewCar'|'UsedCar'|'Education'|'LAP'|'AgainstProperty'|'Overdraft'|'Insurance'

export interface Customer {
  id: number; fullName: string; email: string; phone: string
  panNumber?: string; aadhaarNumber?: string; dateOfBirth?: string
  address?: string; city?: string; state?: string; pinCode?: string
  monthlyIncome?: number; monthlyObligations?: number; employmentType?: string; companyName?: string
  cibilScore?: number; gender?: string; fatherName?: string; residenceType?: string
  // Applicant-tab parity fields (Vanilla loan-detail Personal/Address/Employment).
  motherName?: string; alternatePhone?: string; houseNo?: string
  permanentHouseNo?: string; permanentAddress?: string; permanentCity?: string
  permanentState?: string; permanentPinCode?: string; permanentResidenceType?: string
  designation?: string; companyType?: string; officialEmail?: string
  officeAddress?: string; officePinCode?: string
  totalLoans: number; createdAt: string
}

export interface LoanStatusHistory {
  id: number; fromStatus: LoanStatus; toStatus: LoanStatus
  comment?: string; changedBy: string; changedAt: string
}

export interface LoanBankLine { id: number; bankName: string; tempApplicationNumber: string; applicationNumber?: string; approvedLoan?: number; remarks?: string }

// Matches LoanReferenceDto — returned inside GET /api/loans/{id} and
// replaced whole-set via PUT /api/loans/{id}/references.
export interface LoanReference {
  id?: number; name?: string; mobile?: string; relation?: string; address?: string; refNumber: number
}

export interface Loan {
  id: number; loanNumber: string; loanType: string; status: LoanStatus
  requestedAmount: number; approvedAmount?: number; interestRate: number
  tenureMonths: number; monthlyEmi?: number; purpose?: string; remarks?: string
  approvedAt?: string; disbursedAt?: string; createdAt: string
  customer: Customer
  // `createdBy` is optional here on purpose. LoanDto declares it non-nullable
  // server-side (`UserDto CreatedBy = null!`), but that is an assertion, not a
  // guarantee the client can rely on — a projection that forgets the
  // .Include, an older deployed backend, or a permission-filtered payload can
  // all arrive without it, and an unguarded read blanked the entire detail
  // page. Typing it optional makes the compiler require the guard.
  createdBy?: User
  assignedTo?: User
  // Assignment fields the backend LoanDto already returns (AssignedTo above +
  // these) but the React model never declared, so no UI could show or set the
  // loan's routing. Written via PATCH /api/loans/{id}/assignment.
  loginUser?: User
  opsManager?: User
  locationName?: string | null
  salesTeamName?: string | null
  // Per-loan Lender RM override (Lender Email Workflow) — internal-only, set
  // via PATCH /api/loans/{id}/lender-rm ("Update Lender RM").
  lenderRmName?: string | null
  lenderRmEmail?: string | null
  lenderRmMobile?: string | null
  // Overview parity fields (Vanilla efin-app.js:2479) — InCred RM, Analytic
  // Bank, and the five underwriting verification flags. Returned by
  // GET /api/loans/{id}; written via PATCH /api/loans/{id}/overview.
  incredRmName?: string | null
  analyticBank?: string | null
  // Channel Overview display (Vanilla app.channelDSA/channelPartner) —
  // resolved by LoanDto from Loan.DsaId/PartnerId; used by the Overview
  // channel-conditional rows.
  dsaName?: string | null
  partnerName?: string | null
  // Free-form product-specific bag (Business/Property/Vehicle/Education/
  // Co-Applicant/Insurance fields captured by the wizard). Rendered on the
  // Employment tab's product-detail groups (Vanilla efin-app.js:2598-2660).
  productDataJson?: string | null
  documentChecked?: boolean
  incomeChecked?: boolean
  bankChecked?: boolean
  ecsReturn?: boolean
  fiReportChecked?: boolean
  nachDone?: boolean
  customerAgreementDone?: boolean
  statusHistory: LoanStatusHistory[]
  // Already returned by GET /api/loans/{id} (LoanDetailDto.References) —
  // this type just never declared it, so the References tab had no data.
  references?: LoanReference[]
  // Confirmed already present in the backend's LoanDetailDto
  // (LoanMS.Application/DTOs/LoanBankLineDto.cs) and already returned by
  // GET /api/loans/{id} — matches legacy's app.bank (bank/lender the
  // application was submitted to), except this data model supports
  // multiple simultaneous bank submissions per loan instead of a single
  // bank field.
  bankLines?: LoanBankLine[]
  // Returned by GET /api/loans/{id} (LoanDto.SanctionDetail →
  // LoanSanctionDetailDto) and written by PUT /api/loans/{id}/sanction-detail.
  // Carries the sanction-time bundling inputs (processing fee %, GST %,
  // insurance, and the two "finance-it-into-the-loan" toggles) that legacy's
  // Loan-Amount editor used to compute the bundled loan amount and the
  // bundled-EMI. Optional: a loan has no row until sanction details are saved.
  sanctionDetail?: LoanSanctionDetail
}

export interface LoanSanctionDetail {
  // Sanctioned loan terms — the CAM's Loan Amount / Tenure / ROI / EMI, which
  // may differ from the customer's requested terms. Persisted on the
  // LoanSanctionDetail row (PUT /sanction-detail); fall back to the loan's
  // approved/requested figures when null.
  sanctionLoanAmt?: number | null
  sanctionTenureMonths?: number | null
  sanctionRoi?: number | null
  sanctionEmi?: number | null
  stampDuty?: string | null
  gst?: number | null
  insurance?: number | null
  pfPercent?: number | null
  insuranceInBundled?: boolean | null
  pfInBundled?: boolean | null
  isBundled?: boolean | null
  isBt?: boolean | null
  flatRate?: number | null
  emiDate?: string | null
}

export interface LoanListItem {
  id: number; loanNumber: string; loanType: string; status: LoanStatus
  requestedAmount: number; approvedAmount?: number; interestRate: number
  tenureMonths: number; monthlyEmi?: number; customerName: string
  customerPhone: string; createdByName: string; assignedToName?: string; createdAt: string
  loginUserName?: string
  /** Letter grade from the latest bureau report, not a raw score. */
  riskGrade?: string
  /** Customer.CibilScore — added to LoanListDto for the CIBIL band filter. */
  customerCibilScore?: number | null
  // Advanced-filter fields, all existing columns newly surfaced on LoanListDto.
  locationName?: string | null
  purpose?: string | null
  /** "Source: x | Channel: y | Lead Source: z" — see LoanListDto.Remarks. */
  remarks?: string | null
  selectedLenderNames?: string | null
  dsaName?: string | null
  partnerName?: string | null
  customerCity?: string | null
  customerState?: string | null
  customerGender?: string | null
  customerEmploymentType?: string | null
  customerCompanyName?: string | null
  customerMonthlyIncome?: number | null
  // Tasks page Created / Assigned buckets — id-based, so a shared display
  // name can never put a loan in the wrong tab.
  createdByUserId?: number
  assignedToUserId?: number | null
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
  // Gap 2 — real persisted status-transition feed (LoanStatusHistory-backed,
  // see RecentActivityDto), separate from recentLoans' creation-date list.
  recentActivity: RecentActivityItem[]
}

export interface RecentActivityItem {
  // 'Loan' = LoanStatusHistory-sourced (loanId/loanNumber/customerName/status
  // populated). 'Audit' = AuditLogs-sourced, Admin-only (entityName/action/
  // description populated instead) — see RecentActivityDto on the backend
  // for exactly what this does and doesn't cover.
  type: 'Loan' | 'Audit'
  loanId?: number; loanNumber?: string; customerName?: string
  status?: LoanStatus
  entityName?: string; action?: string; description?: string
  changedAt: string
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
  // Gap 1 — multi-status filtering (Dashboard "In Process" drill-down).
  // Mutually exclusive with `status` — see loanStore.setFilter, which clears
  // whichever of the two isn't the one being set.
  statuses?: LoanStatus[]
  // Vanilla's topbar search-scope dropdown (#topbar-search-field). Empty/absent
  // = all fields. Sent to the server because the list is paged server-side, so
  // a scoped search evaluated on the client would only see the current page.
  searchField?: string
  loanType?: string; dateFrom?: string; dateTo?: string; assignedToUserId?: number
  // LoanFilterDto already accepts CustomerId server-side (used by the
  // Customer Detail page's "linked loans" list) — this was simply never
  // surfaced on the frontend filter type before.
  customerId?: number
  // Phase 1 (DSA parity) — backs the DSA Management "Apps" drill-down.
  dsaId?: number
  partnerId?: number
  // Applications Advanced Filter — all evaluated server-side (LoanFilterDto).
  minAmount?: number; maxAmount?: number
  minCibil?: number; maxCibil?: number
  minSalary?: number; maxSalary?: number
  salesPerson?: string; location?: string; channel?: string; bank?: string
  purpose?: string; empType?: string; city?: string; state?: string; gender?: string
  dsaName?: string; partnerName?: string; companyName?: string
}

/** GET /api/loans/filter-options — distinct values across the caller's visible loans. */
export interface LoanFilterOptions {
  salesPeople: string[]; locations: string[]; channels: string[]; banks: string[]
  purposes: string[]; empTypes: string[]; cities: string[]; states: string[]
  genders: string[]; dsaNames: string[]; partners: string[]; companies: string[]
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
  cibilScore?: number; gender?: string; fatherName?: string; residenceType?: string
  // Applicant-tab parity fields.
  motherName?: string; alternatePhone?: string; houseNo?: string
  permanentHouseNo?: string; permanentAddress?: string; permanentCity?: string
  permanentState?: string; permanentPinCode?: string; permanentResidenceType?: string
  designation?: string; companyType?: string; officialEmail?: string
  officeAddress?: string; officePinCode?: string
}

// ── Additional API types ──────────────────────────────────────────────────────
export interface UpdateLoanStatusRequest {
  newStatus: string
  comment?: string
  approvedAmount?: number
}
