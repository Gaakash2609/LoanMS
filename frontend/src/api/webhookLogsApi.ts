import api from './axios'

// ── InCred Webhook Logs ─────────────────────────────────────────────────
// GET /api/settings/webhook-logs (SettingsController:320) has had no React
// caller. Legacy renders it as "Folder 13 — Webhook Logs" on the Settings
// page (stgRenderWebhookLogs, efin-app.js:37114).
//
// Two contract details that differ from every other endpoint in this app:
//
//  1. It returns a RAW `{ logs: [...] }` object, NOT the usual
//     ApiResponseDto envelope — so there is no `.data.data` to unwrap here.
//  2. It never fails on bad data. Missing or unparseable storage comes back
//     as `{ logs: [] }`, so an empty list genuinely means "no events yet",
//     not "something went wrong".
//
// The entries are written by the inbound webhook receiver
// (IncredController's WebhookLogEntry): newest first, capped at 100.
// SettingsController is [Authorize(Roles = "Admin")] at class level, so this
// is Admin-only.

export interface WebhookLogEntry {
  /** InCred's APPLICATION_ID from the callback payload. */
  appId?: string | null
  /** PARTNER_REFERENCE — our own loan reference echoed back. */
  ref?: string | null
  event?: string | null
  status?: string | null
  /** Formatted timestamp string as recorded by the receiver. */
  time?: string | null
  /** true when the receiver matched the event to a loan (200), false when not (404). */
  ok: boolean
}

interface WebhookLogsResponse {
  logs: WebhookLogEntry[]
}

export const webhookLogsApi = {
  getAll: () => api.get<WebhookLogsResponse>('/api/settings/webhook-logs'),
}
