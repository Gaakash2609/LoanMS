import api from './axios'

// ── Expert Export — ExpertExportController ──────────────────────────────────
// GET /access is open to any authenticated user (needed so the UI can decide
// whether to show the button). GET/POST /config and GET /data are re-checked
// server-side on every call — Admin is always implicitly allowed; additional
// roles/individual users can be granted via /config (Admin only).
export interface ExpertExportUser { id: number; name: string; email: string; role: string }
export interface ExpertExportConfig { roles: string[]; users: ExpertExportUser[]; allUsers: ExpertExportUser[] }

export const expertExportApi = {
  access: () => api.get<{ allowed: boolean }>('/api/expertexport/access'),

  getConfig: () => api.get<ExpertExportConfig>('/api/expertexport/config'),

  saveConfig: (roles: string[], userIds: number[]) =>
    api.post<{ success: boolean; roles: string[]; userIds: number[] }>('/api/expertexport/config', { roles, userIds }),

  // Response is a CSV file, not JSON — same as legacy's raw-Response fetch.
  downloadData: () => api.get('/api/expertexport/data', { responseType: 'blob' }),
}
