import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { authApi } from '@/api/authApi'
import { useAuthStore } from '@/store/authStore'

export function useLogin() {
  const setAuth  = useAuthStore((s) => s.setAuth)
  const navigate = useNavigate()

  return useMutation({
    mutationFn: async (payload: Parameters<typeof authApi.login>[0]) => {
      const response = await authApi.login(payload)
      const body = response.data

      if (!body.success || !body.data) {
        const message = body.message || body.errors?.[0] || 'Login failed. Please try again.'
        throw new Error(message)
      }

      return body.data
    },
    onSuccess: (data) => {
      const { user, accessToken, refreshToken } = data
      setAuth(user, accessToken, refreshToken)
      navigate('/dashboard')
    },
  })
}

export function useLogout() {
  const logout   = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const qc       = useQueryClient()

  return useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      logout()
      qc.clear()
      navigate('/login')
    },
  })
}
