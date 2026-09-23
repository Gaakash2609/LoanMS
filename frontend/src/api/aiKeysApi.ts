import api from './axios'
import type { ApiResponse } from '@/types'

// ── AI Provider Keys — Gemini & OpenAI (Settings → AI & KYC Vision) ─────────
// Ports legacy's "AI Provider Keys — KYC Vision & AI Features" panel
// (efin-app.js:26406 _renderKycProxySettingsCard / :26463 _aiKeySave /
// :26485 _aiKeyClear) onto SettingsController's ai-keys endpoints
// (SettingsController.cs:267-320). These are the real, server-side keys
// that authenticate PAN/Aadhaar KYC-vision auto-fill and other AI text
// features against Google Gemini (primary) / OpenAI (failover) — separate
// from the static AI:Enabled/AI:ApiKey env-var gate shown by aiApi.status(),
// which only gates text-completion features. Saving here takes effect on
// the very next request, no restart needed. Whole controller is
// [Authorize(Roles = "Admin")].
//
// GET never returns the real key — only whether one is configured and a
// fixed masked placeholder, same shape as the InCred credentials endpoint.

export type AiKeyProvider = 'gemini' | 'openai'

export interface AiKeyProviderStatus {
  configured: boolean
  masked: string
}

export interface AiKeysStatusResponse {
  gemini: AiKeyProviderStatus
  openai: AiKeyProviderStatus
}

export const aiKeysApi = {
  get: () => api.get<ApiResponse<AiKeysStatusResponse>>('/api/settings/ai-keys'),

  save: (provider: AiKeyProvider, apiKey: string) =>
    api.post<ApiResponse<boolean>>('/api/settings/ai-keys', { provider, apiKey }),

  clear: (provider: AiKeyProvider) =>
    api.delete<ApiResponse<boolean>>(`/api/settings/ai-keys/${provider}`),
}
