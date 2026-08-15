import api from './axios'
import type { ApiResponse } from '@/types'

// ── Mail & Email Provider Configuration ─────────────────────────────────────
// Matches SettingsController's email-config endpoints exactly (Admin only,
// class-level [Authorize(Roles = "Admin")]). GET never returns real secrets
// — only hasApiKey/hasSmtpPass booleans and a masked placeholder string; POST
// treats an unchanged masked placeholder as "keep existing secret" (see
// SettingsController.IsMasked), so the UI must send the mask back untouched
// when the admin hasn't retyped the secret.
export interface EmailConfigResponse {
  configured: boolean
  provider?: 'smtp' | 'brevo' | string
  fromEmail?: string
  name?: string
  cc?: string
  replyTo?: string
  signature?: string
  smtpHost?: string
  smtpPort?: string
  smtpUser?: string
  smtpUseSsl?: boolean
  invEnabled?: boolean
  invSubject?: string
  invBody?: string
  hasApiKey?: boolean
  hasSmtpPass?: boolean
  apiKeyMasked?: string
  smtpPassMasked?: string
}

export interface EmailConfigRequest {
  provider: 'smtp' | 'brevo'
  fromEmail: string
  name: string
  cc?: string
  replyTo?: string
  signature?: string
  smtpHost?: string
  smtpPort?: string
  smtpUseSsl?: boolean
  apiKey?: string
  smtpUser?: string
  smtpPass?: string
  invEnabled?: boolean
  invSubject?: string
  invBody?: string
}

export const emailConfigApi = {
  get: () => api.get<ApiResponse<EmailConfigResponse>>('/api/settings/email-config'),

  save: (data: EmailConfigRequest) =>
    api.post<ApiResponse<boolean>>('/api/settings/email-config', data),

  clear: () => api.delete<ApiResponse<boolean>>('/api/settings/email-config'),

  test: (toEmail: string) =>
    api.post<ApiResponse<boolean>>('/api/settings/email-config/test', { toEmail }),
}
