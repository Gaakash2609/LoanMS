import api from './axios'

// ── Per-user settings — UserSettingsController ──────────────────────────────
// Generic per-user key/value store (GET 404s if the key was never saved;
// POST upserts). Scoped server-side to the caller's own JWT user id.
export interface UserSetting { key: string; value: string; category?: string }

export const userSettingsApi = {
  get: (key: string) => api.get<{ data: UserSetting }>(`/api/user-settings/${key}`),
  save: (key: string, value: string, category?: string) =>
    api.post<{ success: boolean }>('/api/user-settings', { key, value, category }),
}
