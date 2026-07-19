import api from './axios'
import type { ApiResponse } from '@/types'

export interface AppSetting { key: string; value: string; category?: string }

export const settingsApi = {
  getAll: () => api.get<ApiResponse<AppSetting[]>>('/api/settings'),
  update: (key: string, value: string) =>
    api.put<ApiResponse<AppSetting>>(`/api/settings/${key}`, { value }),
}
