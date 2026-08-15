import api from './axios'
import type { ApiResponse } from '@/types'

// ── Product-specific First Offer Matrices (Policy & Product page) ──────────
// Mirrors ProductOfferMatrixController exactly: GET open to any authenticated
// user (the offer calculator needs it for every role that can generate a
// first offer); PUT (upsert per product key) is Admin,ProductTeam only.
// Matrix shape is an opaque JSON blob server-side — these types/defaults are
// copied as-is from legacy product-offer-matrix.js (PP_PRODUCTS/PP_DEFAULTS),
// not invented.

export interface OfferBand {
  label: string
  salaryMin: number
  salaryMax: number
  rateMin: number
  rateMax: number
  tenureMin: number
  tenureMax: number
  foir: number
}

export interface ProductOfferMatrixRecord {
  productKey: string
  matrixJson: string
  updatedAt?: string | null
}

export interface ProductInfo {
  key: string
  icon: string
  name: string
  desc: string
  color: string
}

export const PP_PRODUCTS: ProductInfo[] = [
  { key: 'business_loan',         icon: '🏦', name: 'Business Loan',           desc: 'Self-employed · MSME',           color: '#1a4fa3,#3b82f6' },
  { key: 'loan_against_property', icon: '🏠', name: 'LAP',                     desc: 'Loan Against Property',          color: '#7c3aed,#a78bfa' },
  { key: 'home_loan',             icon: '🏡', name: 'Home Loan',               desc: 'Purchase · Construction',        color: '#059669,#34d399' },
  { key: 'education_loan',        icon: '🎓', name: 'Education Loan',          desc: 'Domestic · Abroad study',        color: '#d97706,#fbbf24' },
  { key: 'new_car_loan',          icon: '🚗', name: 'New Car Loan',            desc: 'New vehicle finance',            color: '#0891b2,#22d3ee' },
  { key: 'used_car_loan',         icon: '🚙', name: 'Used Car Loan',           desc: 'Pre-owned vehicle finance',      color: '#be185d,#f472b6' },
  { key: 'over_draft',            icon: '💳', name: 'Overdraft / Cash Credit', desc: 'Business cash credit · OD / CC', color: '#6d28d9,#c4b5fd' },
  { key: 'insurance',             icon: '🛡️', name: 'Insurance',               desc: 'Life · General · Health',        color: '#b45309,#fcd34d' },
]

export const PP_DEFAULTS: Record<string, OfferBand[]> = {
  business_loan: [
    { label: '20K to 30K', salaryMin: 20000,  salaryMax: 30000,  rateMin: 18, rateMax: 24, tenureMin: 12, tenureMax: 36, foir: 0.40 },
    { label: '30K to 50K', salaryMin: 30000,  salaryMax: 50000,  rateMin: 16, rateMax: 22, tenureMin: 12, tenureMax: 48, foir: 0.45 },
    { label: '50K to 1L',  salaryMin: 50000,  salaryMax: 100000, rateMin: 14, rateMax: 18, tenureMin: 24, tenureMax: 60, foir: 0.50 },
    { label: '1L to 2L',   salaryMin: 100000, salaryMax: 200000, rateMin: 13, rateMax: 16, tenureMin: 24, tenureMax: 60, foir: 0.55 },
    { label: '2L+ >',      salaryMin: 200000, salaryMax: 999999, rateMin: 11, rateMax: 15, tenureMin: 24, tenureMax: 84, foir: 0.60 },
  ],
  loan_against_property: [
    { label: '25K to 50K', salaryMin: 25000,  salaryMax: 50000,  rateMin: 10, rateMax: 14, tenureMin: 60, tenureMax: 120, foir: 0.50 },
    { label: '50K to 1L',  salaryMin: 50000,  salaryMax: 100000, rateMin: 9,  rateMax: 13, tenureMin: 60, tenureMax: 180, foir: 0.55 },
    { label: '1L to 2L',   salaryMin: 100000, salaryMax: 200000, rateMin: 9,  rateMax: 12, tenureMin: 60, tenureMax: 180, foir: 0.60 },
    { label: '2L+ >',      salaryMin: 200000, salaryMax: 999999, rateMin: 8,  rateMax: 11, tenureMin: 84, tenureMax: 240, foir: 0.65 },
  ],
  home_loan: [
    { label: '20K to 35K', salaryMin: 20000,  salaryMax: 35000,  rateMin: 8.5, rateMax: 10,  tenureMin: 60,  tenureMax: 180, foir: 0.40 },
    { label: '35K to 60K', salaryMin: 35000,  salaryMax: 60000,  rateMin: 8.5, rateMax: 9.5, tenureMin: 120, tenureMax: 240, foir: 0.45 },
    { label: '60K to 1L',  salaryMin: 60000,  salaryMax: 100000, rateMin: 8.4, rateMax: 9.5, tenureMin: 120, tenureMax: 300, foir: 0.50 },
    { label: '1L+ >',      salaryMin: 100000, salaryMax: 999999, rateMin: 8.3, rateMax: 9,   tenureMin: 120, tenureMax: 300, foir: 0.55 },
  ],
  education_loan: [
    { label: '15K to 25K', salaryMin: 15000, salaryMax: 25000,  rateMin: 10, rateMax: 14, tenureMin: 12, tenureMax: 60, foir: 0.35 },
    { label: '25K to 50K', salaryMin: 25000, salaryMax: 50000,  rateMin: 9,  rateMax: 12, tenureMin: 12, tenureMax: 84, foir: 0.40 },
    { label: '50K+ >',     salaryMin: 50000, salaryMax: 999999, rateMin: 8,  rateMax: 11, tenureMin: 12, tenureMax: 84, foir: 0.45 },
  ],
  new_car_loan: [
    { label: '15K to 25K', salaryMin: 15000, salaryMax: 25000,  rateMin: 8,   rateMax: 11, tenureMin: 12, tenureMax: 48, foir: 0.40 },
    { label: '25K to 50K', salaryMin: 25000, salaryMax: 50000,  rateMin: 7.5, rateMax: 10, tenureMin: 12, tenureMax: 60, foir: 0.50 },
    { label: '50K+ >',     salaryMin: 50000, salaryMax: 999999, rateMin: 7,   rateMax: 9,  tenureMin: 12, tenureMax: 84, foir: 0.55 },
  ],
  used_car_loan: [
    { label: '15K to 25K', salaryMin: 15000, salaryMax: 25000,  rateMin: 12, rateMax: 18, tenureMin: 12, tenureMax: 36, foir: 0.40 },
    { label: '25K to 50K', salaryMin: 25000, salaryMax: 50000,  rateMin: 11, rateMax: 16, tenureMin: 12, tenureMax: 48, foir: 0.45 },
    { label: '50K+ >',     salaryMin: 50000, salaryMax: 999999, rateMin: 10, rateMax: 14, tenureMin: 12, tenureMax: 60, foir: 0.50 },
  ],
  over_draft: [
    { label: '30K to 75K',  salaryMin: 30000,  salaryMax: 75000,  rateMin: 14, rateMax: 18, tenureMin: 12, tenureMax: 24, foir: 0.40 },
    { label: '75K to 1.5L', salaryMin: 75000,  salaryMax: 150000, rateMin: 13, rateMax: 16, tenureMin: 12, tenureMax: 24, foir: 0.45 },
    { label: '1.5L+ >',     salaryMin: 150000, salaryMax: 999999, rateMin: 11, rateMax: 14, tenureMin: 12, tenureMax: 36, foir: 0.50 },
  ],
  insurance: [
    { label: '1L to 3L PA', salaryMin: 100000, salaryMax: 300000,  rateMin: 1,   rateMax: 3, tenureMin: 12, tenureMax: 60,  foir: 0.05 },
    { label: '3L to 6L PA', salaryMin: 300000, salaryMax: 600000,  rateMin: 1,   rateMax: 2, tenureMin: 12, tenureMax: 120, foir: 0.04 },
    { label: '6L+ PA >',    salaryMin: 600000, salaryMax: 9999999, rateMin: 0.5, rateMax: 2, tenureMin: 12, tenureMax: 240, foir: 0.03 },
  ],
}

export const productOfferMatrixApi = {
  getAll: () =>
    api.get<ApiResponse<ProductOfferMatrixRecord[]>>('/api/productoffermatrix'),

  upsert: (productKey: string, matrixJson: string) =>
    api.put<ApiResponse<boolean>>(`/api/productoffermatrix/${productKey}`, { matrixJson }),
}
