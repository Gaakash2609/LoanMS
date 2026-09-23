import api from './axios'
import type { ApiResponse } from '@/types'
import type { AdvFilter } from '@/constants/advFilter'

// ── Saved filter presets ────────────────────────────────────────────────
// Legacy stores these through the generic per-user settings endpoint
// (efin-app.js: stgPushFilterPresetsToServer) under key 'filter_presets',
// category 'filters' — the same endpoint ExportLoansModal already uses for
// its column presets, scoped server-side to the Bearer token's own user.
//
// Legacy ALSO mirrors them into localStorage ('efin_filter_presets') as an
// instant-render cache. That mirror is deliberately not reproduced: it is the
// browser-storage pattern this migration has been removing everywhere else,
// and the server copy is the one that follows the user across devices.

export const FILTER_PRESETS_KEY = 'filter_presets'
export const FILTER_PRESETS_CATEGORY = 'filters'

export interface FilterPreset {
  name: string
  filters: AdvFilter
}

interface UserSetting { key: string; value: string; category?: string }

export const filterPresetsApi = {
  /**
   * Returns [] when the key has never been written, or when the stored value
   * is unreadable — a corrupt preset blob must not break the filter panel.
   */
  getAll: async (): Promise<FilterPreset[]> => {
    try {
      const res = await api.get<ApiResponse<UserSetting>>(`/api/user-settings/${FILTER_PRESETS_KEY}`)
      const raw = res.data.data?.value
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as FilterPreset[]) : []
    } catch {
      return []
    }
  },

  /** Whole-list write — the endpoint stores one JSON blob per key. */
  saveAll: (presets: FilterPreset[]) =>
    api.post<ApiResponse<boolean>>('/api/user-settings', {
      key: FILTER_PRESETS_KEY,
      value: JSON.stringify(presets),
      category: FILTER_PRESETS_CATEGORY,
    }),
}
