import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { authApi } from '@/api/authApi'
import { useAuthStore } from '@/store/authStore'

export function useLogin() {
  const setAuth  = useAuthStore((s) => s.setAuth)
  const navigate = useNavigate()

  return useMutation({
    mutationFn: authApi.login,
    onSuccess: ({ data }) => {
      if (data.success && data.data) {
        const { user, accessToken, refreshToken } = data.data
        setAuth(user, accessToken, refreshToken)
        navigate('/dashboard')
      }
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
