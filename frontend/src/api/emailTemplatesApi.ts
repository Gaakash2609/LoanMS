import api from './axios'
import type { ApiResponse } from '@/types'

// ── Email Templates (Settings → Templates) ──────────────────────────────
// EmailTemplatesController has had full GET/PUT/DELETE since the templates
// were moved off localStorage, with no React caller — the nine system
// templates could only be edited from the legacy shell.
//
// The API stores *overrides only*. A key absent from GET means "this template
// is still on its built-in default" (EMAIL_TEMPLATE_DEFAULTS), and DELETE is
// how a key goes back to that state — it is a reset, not a destroy.
//
// Reads are open to any authenticated user (server-side auto-sends need
// them); PUT and DELETE are [Authorize(Roles = "Admin")].

export interface EmailTemplateOverride {
  templateKey: string
  subject: string
  body: string
  updatedAt?: string | null
}

/** Exact shape of EmailTemplateDto — both fields are required server-side. */
export interface EmailTemplateSaveRequest {
  subject: string
  body: string
}

export const emailTemplatesApi = {
  getAll: () => api.get<ApiResponse<EmailTemplateOverride[]>>('/api/emailtemplates'),

  // Upsert: creates the override row on first save, updates it afterwards.
  // The server rejects an empty subject or body with a 400.
  save: (templateKey: string, data: EmailTemplateSaveRequest) =>
    api.put<ApiResponse<boolean>>(`/api/emailtemplates/${templateKey}`, data),

  // Soft-deletes the override so the built-in default applies again. Safe to
  // call for a key that was never customised — the server returns OK with
  // "Already using default."
  reset: (templateKey: string) =>
    api.delete<ApiResponse<boolean>>(`/api/emailtemplates/${templateKey}`),
}
