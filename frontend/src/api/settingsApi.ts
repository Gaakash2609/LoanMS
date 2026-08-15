import api from './axios'
import type { ApiResponse } from '@/types'

export interface AppSetting { key: string; value: string; category?: string }

export const settingsApi = {
  getAll: () => api.get<ApiResponse<AppSetting[]>>('/api/settings'),
  // BUGFIX (confirmed real, pre-existing bug — Phase 12 audit): called
  // PUT /api/settings/{key} with body { value } — this route never
  // existed in SettingsController.cs, every save genuinely 405'd. The
  // real, only save-endpoint is POST /api/settings (SettingsController.
  // Upsert), which takes the whole SettingDto { Key, Value, Category } —
  // Key IN the body (not the URL), and Category is REQUIRED here even
  // though it's optional on the DTO: Upsert does an UNCONDITIONAL
  // `existing.Category = dto.Category` with no null-check (confirmed by
  // inspection, unlike e.g. BanksController's IsActive which is
  // null-guarded) — omitting it would silently wipe the setting's
  // existing category. Callers of this function must always pass the
  // setting's current category back, not just the new value.
  update: (key: string, value: string, category?: string) =>
    api.post<ApiResponse<boolean>>('/api/settings', { key, value, category }),
  // Dedicated GET-by-key route. Most keys are Admin-only there, but a
  // small explicit whitelist (branding + efin_cam_matrix +
  // efin_incred_comment_templates) is readable by any authenticated user —
  // see SettingsController.Get's doc comment.
  getByKey: (key: string) =>
    api.get<ApiResponse<AppSetting>>(`/api/settings/${key}`),
  // Sign-in logo has its own dedicated endpoint (SettingsController's
  // GetSigninLogoPublic/SaveSigninLogo) — AllowAnonymous on GET since the
  // login page needs it before authentication, unlike the generic
  // /api/settings/{key} route.
  signinLogo: {
    get: () => api.get<{ logo: string | null }>('/api/settings/signin-logo'),
    set: (logo: string) => api.post<ApiResponse<boolean>>('/api/settings/signin-logo', { logo }),
  },
}

