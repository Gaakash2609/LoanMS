import api from './axios'
import type { ApiResponse } from '@/types'

export interface WizardSubmitPayload {
  // When resuming a previously-saved draft, pass its loan id so the wizard
  // completes/updates that same record instead of creating a new one.
  loanId?: number
  // Which wizard step (1-based) this draft was last saved on — persisted
  // server-side on Loan.WizardStep so resume/list-drafts never need
  // browser localStorage.
  step?: number
  // Step 1 — Contact & Assignment
  mobile: string
  pan: string
  location?: string
  salesPerson?: string
  channel?: string
  dsaName?: string
  // Phase 2A — ids actually persisted onto the Loan record. `location`/`dsaName`
  // above stay as-is (display/legacy fields); these carry the real FKs.
  dsaId?: number
  partnerId?: number
  locationId?: number
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
  // Existing monthly EMI/debt obligations — persisted onto Customer.MonthlyObligations
  // (Phase 5A). Was previously captured in the wizard UI but silently dropped before
  // reaching the API; now sent through on both draft-save and final submit.
  obligations?: number
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

// One entry in the Applications → Drafts list. Comes entirely from the
// database (GET /api/wizard/drafts) — replaces the old localStorage-only
// WizardDraftMeta index, so drafts started on one device show up on every
// other device/browser too.
export interface WizardDraftSummary {
  loanId: number
  step: number | null
  loanType: string
  label: string
  createdAt: string
  updatedAt: string
}

export const wizardApi = {
  submit: (data: WizardSubmitPayload) =>
    api.post<ApiResponse<WizardSubmitResponse>>('/api/wizard/submit', data),

  // Persists in-progress wizard data as a real Draft Loan+Customer record so
  // it can be resumed from the database, not just from browser localStorage.
  // Pass back the loanId this returns on subsequent calls (and in the final
  // submit) to keep updating the same record instead of creating duplicates.
  saveDraft: (data: Partial<WizardSubmitPayload>) =>
    api.post<ApiResponse<WizardSubmitResponse>>('/api/wizard/draft', data),

  // Resume: reads the full in-progress form (PAN, Aadhar, address, employment,
  // references, ...) back from the database record — this is the server-side
  // source of truth used to resume a draft, so the browser never needs to
  // hold that data itself.
  getDraft: (loanId: number) =>
    api.get<ApiResponse<WizardSubmitPayload>>(`/api/wizard/draft/${loanId}`),

  // Applications → Drafts list, read live from the database every time —
  // no local index to keep in sync.
  listDrafts: () =>
    api.get<ApiResponse<WizardDraftSummary[]>>('/api/wizard/drafts'),

  // On failure the backend returns { success: false, errors: string[] } (no
  // `data` payload) rather than `{ valid, errors }` — ApiResponse already
  // models that shape via `errors`/`success`.
  validate: (data: Partial<WizardSubmitPayload>) =>
    api.post<ApiResponse<{ valid: boolean; emi: number; totalPayable: number; totalInterest: number }>>(
      '/api/wizard/validate', data
    ),

  getLocations: () =>
    api.get<ApiResponse<Array<{ id: number; name: string; city: string; state: string }>>>('/api/locations'),

  // Uses the non-Admin-only lookup endpoint (id/fullName/role only) so Sales and
  // Manager users can populate the Sales Person dropdown — GET /api/users is
  // Admin-only and used to 403 for everyone else.
  getUsers: () =>
    api.get<ApiResponse<Array<{ id: number; fullName: string; role: string }>>>('/api/users/lookup'),

  getDsaPartners: () =>
    api.get<ApiResponse<Array<{ id: number; name: string; code: string; partnerType: string }>>>('/api/dsa'),
}
