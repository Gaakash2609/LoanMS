import api from './axios'
import type { ApiResponse } from '@/types'

// ── Companies (GET/POST/PUT/DELETE /api/LenderConfig/companies) ────────────
// Exact fields from LenderConfigController.GetCompanies's Select() —
// {Id, Name, EmpTypesJson, CompType} — and AnalyticCompanyDto for
// create/update ({Name, EmpTypes: string[], CompType}).
export interface Company {
  id: number
  name: string
  empTypesJson: string
  compType?: string
}
export interface CompanyRequest {
  name: string
  empTypes?: string[]
  compType?: string
}

// ── Categories (GET/POST/PUT/DELETE /api/LenderConfig/categories) ──────────
// Exact fields from GetCategories's Select() — {Id, Name, Salary} — and
// AnalyticCategoryDto ({Name, Salary}).
export interface Category {
  id: number
  name: string
  salary: number
}
export interface CategoryRequest {
  name: string
  salary: number
}

// ── Eligibility Lines ────────────────────────────────────────────────────
// Confirmed: LenderConfigController has POST/DELETE for lines but NO GET
// list endpoint. The genuine, existing read-contract is
// BanksController.GetAll's embedded `Lines` array per bank
// ({Id, CompanyId, CategoryId, PinCode, Pf}) — reused here as-is, not
// invented. BankEligibilityLineDto for create
// ({BankId, CompanyId, CategoryId, PinCode?, Pf}).
export interface Bank {
  id: number
  bankName: string
  isActive: boolean
  lines: EligibilityLine[]
}
export interface EligibilityLine {
  id: number
  companyId: number
  categoryId: number
  pinCode?: string
  pf: boolean
}
export interface LineRequest {
  bankId: number
  companyId: number
  categoryId: number
  pinCode?: string
  pf: boolean
}

// ── Matching (POST /api/LenderConfig/match) ─────────────────────────────
// Exact fields from LenderMatchRequestDto / the Match() method's actual
// response shape (not LenderMatchResultDto's raw properties, but the
// wrapping object Match() actually returns).
export interface MatchRequest {
  loanType?: string
  salary: number
  obligations?: number
  empType?: string
  compType?: string
  companyId?: number
  cibil?: number
  loanAmount?: number
  tenure?: number
  pinCode?: string
  age?: number
}
export interface MatchResultRow {
  bankId: number
  bankName: string
  eligible: boolean
  reason?: string
  score: number
}
export interface MatchResponse {
  awaitingDetails: boolean
  totalBanksConfigured: number
  eligibleCount: number
  results: MatchResultRow[]
}

export const lenderConfigApi = {
  getCompanies: () => api.get<ApiResponse<Company[]>>('/api/LenderConfig/companies'),
  createCompany: (data: CompanyRequest) => api.post<ApiResponse<{ id: number }>>('/api/LenderConfig/companies', data),
  updateCompany: (id: number, data: CompanyRequest) => api.put<ApiResponse<boolean>>(`/api/LenderConfig/companies/${id}`, data),
  deleteCompany: (id: number) => api.delete<ApiResponse<boolean>>(`/api/LenderConfig/companies/${id}`),

  getCategories: () => api.get<ApiResponse<Category[]>>('/api/LenderConfig/categories'),
  createCategory: (data: CategoryRequest) => api.post<ApiResponse<{ id: number }>>('/api/LenderConfig/categories', data),
  updateCategory: (id: number, data: CategoryRequest) => api.put<ApiResponse<boolean>>(`/api/LenderConfig/categories/${id}`, data),
  deleteCategory: (id: number) => api.delete<ApiResponse<boolean>>(`/api/LenderConfig/categories/${id}`),

  // Reuses the existing /api/banks endpoint (BanksPage.tsx's own data
  // source) purely for its embedded Lines — no separate/fake lines-list
  // endpoint invented.
  getBanksWithLines: () => api.get<ApiResponse<Bank[]>>('/api/banks'),
  createLine: (data: LineRequest) => api.post<ApiResponse<{ id: number }>>('/api/LenderConfig/lines', data),
  deleteLine: (id: number) => api.delete<ApiResponse<boolean>>(`/api/LenderConfig/lines/${id}`),

  match: (data: MatchRequest) => api.post<ApiResponse<MatchResponse>>('/api/LenderConfig/match', data),
}
