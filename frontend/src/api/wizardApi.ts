import api from './axios'
import type { ApiResponse } from '@/types'

export interface WizardSubmitPayload {
  // When resuming a previously-saved draft, pass its loan id so the wizard
  // completes/updates that same record instead of creating a new one.
  loanId?: number
  // Step 1 — Contact & Assignment
  mobile: string
  pan: string
  location?: string
  salesPerson?: string
  channel?: string
  dsaName?: string
  // Step 3 — Personal
  fullName: string
  email?: string
  dob?: string
  gender?: string
  aadhar?: string
  fatherName?: string
  // Step 4 — Address (current)
  street1?: string
  street2?: string
  city?: string
  state?: string
  zip?: string
  homeType?: string
  // Step 5 — Employment
  empType?: string
  compName?: string
  compType?: string
  salary: number
  desig?: string
  officeEmail?: string
  // Step 6 — Loan offer
  loanType: string
  amount: number
  loanRate: number
  tenure: number
  purpose?: string
  cibil?: number
  // Step 7 — References
  r1Name?: string
  r1Mobile?: string
  r1Relation?: string
  r2Name?: string
  r2Mobile?: string
  r2Relation?: string
  // Meta
  source?: string
  lenderName?: string
  eFinId?: string
}

export interface WizardSubmitResponse {
  eFinId: string
  loanId: number
  customerId: number
  loanNumber: string
  monthlyEmi: number
  status: string
}

export const wizardApi = {
  submit: (data: WizardSubmitPayload) =>
    api.post<ApiResponse<WizardSubmitResponse>>('/api/wizard/submit', data),

  validate: (data: Partial<WizardSubmitPayload>) =>
    api.post<ApiResponse<{ valid: boolean; errors: string[] }>>('/api/wizard/validate', data),

  getLocations: () =>
    api.get<ApiResponse<Array<{ id: number; name: string; city: string; state: string }>>>('/api/locations'),

  getUsers: (role?: string) =>
    api.get<ApiResponse<Array<{ id: number; fullName: string; role: string }>>>('/api/users', {
      params: { role, pageSize: 200 },
    }),

  getDsaPartners: () =>
    api.get<ApiResponse<Array<{ id: number; name: string; code: string }>>>('/api/dsa'),
}
