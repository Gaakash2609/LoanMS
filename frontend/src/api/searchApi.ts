import api from './axios'
import type { ApiResponse } from '@/types'

// GET /api/Search — SearchController.cs. One box across Loans/Customers/
// DSA/Partners, role-scoped the same way each entity's own dedicated
// endpoint already is (see the controller's own comment). Nothing added
// here can surface a record the caller couldn't already reach on that
// record's own page.
export interface SearchLoanHit {
  id: number
  loanNumber: string
  customerName: string
  status: string
  requestedAmount: number
}
export interface SearchCustomerHit {
  id: number
  fullName: string
  phone: string
}
export interface SearchDsaPartnerHit {
  id: number
  name: string
  code: string | null
  partnerType: string
}
export interface SearchResult {
  loans: SearchLoanHit[]
  customers: SearchCustomerHit[]
  dsaPartners: SearchDsaPartnerHit[]
}

export const searchApi = {
  query: (q: string) =>
    api.get<ApiResponse<SearchResult>>('/api/Search', { params: { q } }),
}
