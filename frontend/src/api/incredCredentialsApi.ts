import api from './axios'
import type { ApiResponse } from '@/types'

// ── InCred API Credentials ──────────────────────────────────────────────────
// Matches SettingsController's incred-credentials endpoints exactly. The whole
// controller is [Authorize(Roles = "Admin")] (SettingsController.cs:12), so
// every call here is Admin-only — the same gate the legacy screen enforced
// client-side in efin-app.js:13920.
//
// GET never returns the real secret: SettingsController.GetIncredCredentials
// (SettingsController.cs:75) deliberately returns a fixed masked placeholder
// so the UI can show that a secret exists without exposing it. The plaintext
// is only ever read server-side by GetDecryptedIncredCredentials, for
// IncredController's own use.
//
// NOTE ON SAVE: unlike the email-config endpoint, POST here does NOT support
// "keep the existing secret" — SaveIncredCredentials (SettingsController.cs:52)
// rejects the request unless BaseUrl, ClientId AND ClientSecret are all
// non-empty, then re-encrypts whatever secret it was given. So changing only
// the Base URL still requires re-entering the secret; the card surfaces that
// instead of silently sending the mask back as if it were a real value.
export interface IncredCredentialsResponse {
  configured: boolean
  baseUrl: string
  clientId: string
  clientSecretMasked: string
}

export interface IncredCredentialsRequest {
  baseUrl: string
  clientId: string
  clientSecret: string
}

export const incredCredentialsApi = {
  get: () => api.get<ApiResponse<IncredCredentialsResponse>>('/api/settings/incred-credentials'),

  save: (data: IncredCredentialsRequest) =>
    api.post<ApiResponse<boolean>>('/api/settings/incred-credentials', data),

  clear: () => api.delete<ApiResponse<boolean>>('/api/settings/incred-credentials'),
}
