import api from './axios'
import type { ApiResponse, LoginRequest, LoginResponse } from '@/types'

export const authApi = {
  login: (data: LoginRequest) =>
    api.post<ApiResponse<LoginResponse>>('/api/auth/login', data),

  logout: () =>
    api.post<ApiResponse<boolean>>('/api/auth/logout'),

  refresh: (refreshToken: string) =>
    api.post<ApiResponse<LoginResponse>>('/api/auth/refresh', { refreshToken }),
}
