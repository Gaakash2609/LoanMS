import api from './axios'
import type { ApiResponse, LoginRequest, LoginResponse } from '@/types'

export interface ForgotPasswordRequest { email: string }
export interface ResetPasswordRequest {
  token: string
  email: string
  newPassword: string
  confirmPassword: string
}

export const authApi = {
  login: (data: LoginRequest) =>
    api.post<ApiResponse<LoginResponse>>('/api/auth/login', data),

  logout: () =>
    api.post<ApiResponse<boolean>>('/api/auth/logout'),

  refresh: (refreshToken: string) =>
    api.post<ApiResponse<LoginResponse>>('/api/auth/refresh', { refreshToken }),

  // Backend has always had these two endpoints (AuthController.cs /
  // PasswordResetService.cs) — the frontend just never called them, so
  // "Forgot password?" had nowhere to go. Wiring them up here.
  forgotPassword: (data: ForgotPasswordRequest) =>
    api.post<ApiResponse<boolean>>('/api/auth/forgot-password', data),

  resetPassword: (data: ResetPasswordRequest) =>
    api.post<ApiResponse<boolean>>('/api/auth/reset-password', data),
}
