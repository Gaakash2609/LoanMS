import api from './axios'
import type { ApiResponse } from '@/types'

// ── Generic transactional email (EmailController) ──────────────────────────
export interface EmailSendRequest {
  to: string
  toName?: string
  subject: string
  html: string
  cc?: string
  replyTo?: string
}

export const emailApi = {
  send: (data: EmailSendRequest) =>
    api.post<ApiResponse<boolean>>('/api/email/send', data),
}

// ── Lender email thread log (LenderEmailThreadsController) ─────────────────
// Append-only audit trail for the lender-email workflow: what was sent to
// which lender RM, when, at what loan stage.
export interface LenderEmailThreadEntry {
  id: number
  direction: 'sent' | 'received' | string
  stage?: string | null
  rmName?: string | null
  rmEmail?: string | null
  subject?: string | null
  bodyText?: string | null
  source?: string | null
  parsedDataJson?: string | null
  createdAt: string
}

export interface LenderEmailThreadEntryRequest {
  loanApplicationId: number
  direction: 'sent' | 'received'
  stage?: string
  rmName?: string
  rmEmail?: string
  subject?: string
  bodyText?: string
  source?: string
}

export const lenderEmailThreadsApi = {
  getThread: (loanApplicationId: number) =>
    api.get<ApiResponse<LenderEmailThreadEntry[]>>(`/api/lenderemailthreads/${loanApplicationId}`),

  addEntry: (data: LenderEmailThreadEntryRequest) =>
    api.post<ApiResponse<{ id: number }>>('/api/lenderemailthreads', data),
}
