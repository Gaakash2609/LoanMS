import api from './axios'
import type { ApiResponse } from '@/types'

// The 9 loan products from the legacy Lender Configuration product picker
// (efin-app.js's lcSelectProduct). `personal` is special: its rules live on
// the BankMaster row itself (the base MinCibil/MaxLoanAmt/... columns),
// while every other product stores them in BankProductRule keyed by
// productKey — that split is the backend's own data model, mirrored here.
export const LOAN_PRODUCTS = [
  { key: 'personal',   name: 'Personal Loan',        icon: '💰', desc: 'Unsecured · Quick disbursal' },
  { key: 'business',   name: 'Business Loan',        icon: '🏦', desc: 'Self-employed · MSME' },
  { key: 'lap',        name: 'LAP',                  icon: '🏠', desc: 'Loan Against Property' },
  { key: 'home',       name: 'Home Loan',            icon: '🏡', desc: 'Purchase · Construction' },
  { key: 'education',  name: 'Education Loan',       icon: '🎓', desc: 'Domestic · Abroad study' },
  { key: 'newcar',     name: 'New Car Loan',         icon: '🚗', desc: 'New vehicle finance' },
  { key: 'usedcar',    name: 'Used Car Loan',        icon: '🚙', desc: 'Pre-owned vehicle finance' },
  { key: 'overdraft',  name: 'Overdraft / CC',       icon: '💳', desc: 'Business cash credit' },
  { key: 'insurance',  name: 'Insurance',            icon: '🛡️', desc: 'Life · General · Health' },
] as const

export type ProductKey = typeof LOAN_PRODUCTS[number]['key']

export const EMP_TYPES = ['SALARIED', 'SELFEMP', 'SENP']
export const COMPANY_TYPES = ['Pvt Ltd', 'Public Ltd', 'LLP', 'Government', 'PSU', 'Proprietorship', 'Partnership', 'Other']
export const HOME_TYPES = ['Owned (Self/Spouse)', 'Owned by Parents', 'Rented', 'Paying Guest', 'Company Provided', 'Other']

// Per-product override row — matches BankProductRule's projection in
// BanksController.GetAll.
export interface BankProductRule {
  productKey: string
  minCibil?: number | null
  acceptNtc?: boolean | null
  maxLoanAmt?: number | null
  minTenure?: number | null
  maxTenure?: number | null
  foirLimit?: number | null
  pfRequired?: boolean | null
  minAge?: number | null
  maxAge?: number | null
  minExpMonths?: number | null
  empTypesJson?: string | null
  compTypesJson?: string | null
  homeTypesJson?: string | null
  // Bank Rules extras (multi-config)
  minVintage?: number | null
  minTurnover?: number | null
  // Banking / Credit Score rules (multi-config)
  minAcctVintage?: number | null
  minAvgBalance?: number | null
  minCreditScore?: number | null
  bankStmtMonths?: number | null
  bounceTolerance?: number | null
}

// Matches BanksController.GetAll's projection.
export interface BankConfig {
  id: number
  bankName: string
  ifscPrefix?: string | null
  empCode?: string | null
  location?: string | null
  rmName?: string | null
  rmMobile?: string | null
  email?: string | null
  remarks?: string | null
  isActive: boolean
  isIncred?: boolean | null
  isElite?: boolean | null
  minCibil?: number | null
  acceptNtc?: boolean | null
  maxLoanAmt?: number | null
  minTenure?: number | null
  maxTenure?: number | null
  foirLimit?: number | null
  pfRequired?: boolean | null
  minAge?: number | null
  maxAge?: number | null
  minExpMonths?: number | null
  empTypesJson?: string | null
  compTypesJson?: string | null
  loanTypesJson?: string | null
  serviceablePinsJson?: string | null
  homeTypesJson?: string | null
  /** Default offer validity (days) for Offers of this lender; null = no default. */
  offerValidityDays?: number | null
  productRules?: BankProductRule[]
  lines?: { id: number; companyId: number; categoryId: number; pinCode?: string; pf?: boolean }[]
  createdAt?: string
  updatedAt?: string
}

// Matches BankDto — every field optional, so a partial save never clobbers
// unrelated columns (the controller only assigns HasValue/non-null fields).
export interface BankSaveRequest {
  bankName: string
  isIncred?: boolean | null
  isElite?: boolean | null
  minCibil?: number | null
  acceptNtc?: boolean | null
  maxLoanAmt?: number | null
  minTenure?: number | null
  maxTenure?: number | null
  foirLimit?: number | null
  pfRequired?: boolean | null
  minAge?: number | null
  maxAge?: number | null
  minExpMonths?: number | null
  empTypes?: string[] | null
  compTypes?: string[] | null
  loanTypes?: string[] | null
  serviceablePins?: string[] | null
  homeTypes?: string[] | null
  /** 1–365 sets the lender's default offer validity; 0 clears it. */
  offerValidityDays?: number | null
}

// Matches BankProductRuleDto.
export interface ProductRuleSaveRequest {
  minCibil?: number | null
  acceptNtc?: boolean | null
  maxLoanAmt?: number | null
  minTenure?: number | null
  maxTenure?: number | null
  foirLimit?: number | null
  pfRequired?: boolean | null
  minAge?: number | null
  maxAge?: number | null
  minExpMonths?: number | null
  empTypes?: string[] | null
  compTypes?: string[] | null
  homeTypes?: string[] | null
  // Bank Rules extras (multi-config)
  minVintage?: number | null
  minTurnover?: number | null
  // Banking / Credit Score rules (multi-config)
  minAcctVintage?: number | null
  minAvgBalance?: number | null
  minCreditScore?: number | null
  bankStmtMonths?: number | null
  bounceTolerance?: number | null
}

// Canonicalise a loan-type token so per-bank product assignment (loanTypes)
// matches regardless of caller key scheme — React LOAN_PRODUCTS keys
// ('personal','newcar','lap'), wizard keys ('personal_loan','new_car'), legacy
// keys ('loan_against_property','over_draft') and the LoanType enum
// ('Personal','NewCar','AgainstProperty'). MUST mirror the backend
// NormalizeLoanType (LenderConfigController.cs): lower-case, strip
// non-alphanumerics, drop a trailing "loan", then alias the LAP variants.
export function normalizeLoanType(s?: string | null): string {
  if (!s) return ''
  let x = s.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (x.length > 4 && x.endsWith('loan')) x = x.slice(0, -4)
  if (x === 'loanagainstproperty' || x === 'againstproperty') return 'lap'
  return x
}

/** Safely parse one of the *Json columns into a string[]. */
export function parseJsonList(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

// A bank "offers" a product iff its loanTypes list is empty (→ all products,
// legacy's null case) OR contains the product (normalised). Mirrors legacy
// lcRenderProductBanks / laLoadEligibility's `bank.loanTypes.includes(loanType)`
// gate. Single source of truth for the Analytic-Banks Offered filter AND the
// per-product multi-config bulk grids (which edit only the assigned banks,
// legacy `_prBanks`).
export function offersProduct(b: BankConfig, pk: string): boolean {
  const lt = parseJsonList(b.loanTypesJson)
  return lt.length === 0 || lt.map(normalizeLoanType).includes(normalizeLoanType(pk))
}

// STRICT per-product assignment (legacy LA_DB.productBanks[pk] Set): a bank is
// "assigned" to a product only if its loanTypes list EXPLICITLY contains it.
// Empty loanTypes = not assigned to any specific product (shown as 0 assigned),
// unlike offersProduct which treats empty as "offered everywhere" for the
// backward-compatible eligibility engine. The Assigned-Banks section uses this.
export function assignedToProduct(b: BankConfig, pk: string): boolean {
  const lt = parseJsonList(b.loanTypesJson)
  return lt.length > 0 && lt.map(normalizeLoanType).includes(normalizeLoanType(pk))
}

export const banksApi = {
  getAll: () => api.get<ApiResponse<BankConfig[]>>('/api/banks'),

  // Same data as getAll, but for wizard/offer-making flows reachable by any role
  // (e.g. Sales) — GET /api/banks is gated behind the "banks" management menu
  // permission, which Sales isn't in by default, so BankEligibilityMatch (Step9,
  // Initial Offer) was silently falling back to no-config defaults on a 403
  // instead of using real bank eligibility rules.
  getLookup: () => api.get<ApiResponse<BankConfig[]>>('/api/banks/lookup'),
  create: (data: BankSaveRequest) =>
    api.post<ApiResponse<{ id: number }>>('/api/banks', data),
  update: (id: number, data: BankSaveRequest) =>
    api.put<ApiResponse<boolean>>(`/api/banks/${id}`, data),
  remove: (id: number) =>
    api.delete<ApiResponse<boolean>>(`/api/banks/${id}`),
  upsertProductRule: (id: number, productKey: string, data: ProductRuleSaveRequest) =>
    api.put<ApiResponse<boolean>>(`/api/banks/${id}/product-rules/${productKey}`, data),
}
