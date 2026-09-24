import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { authApi } from '@/api/authApi'
import { useAuthStore } from '@/store/authStore'

export function useLogin() {
  const setAuth  = useAuthStore((s) => s.setAuth)
  const navigate = useNavigate()
  const location = useLocation()
  const qc       = useQueryClient()

  return useMutation({
    // Account lockout (AuthController: 5 failures in the window) answers
    // HTTP 200 with success:false + "Too many failed attempts. Try again in
    // N minutes." — throw it so LoginPage's error box shows that message
    // instead of the Sign In click silently doing nothing.
    mutationFn: async (req: Parameters<typeof authApi.login>[0]) => {
      const res = await authApi.login(req)
      if (!res.data.success) throw new Error(res.data.message || 'Sign-in failed. Please try again.')
      return res
    },
    // LoginPage renders its own error box — no duplicate toast.
    meta: { errorToast: false, successToast: false },
    onSuccess: ({ data }) => {
      if (data.success && data.data) {
        const { user, accessToken, refreshToken } = data.data
        // Wipe any cached data from a previous session before switching the
        // store over to the new user. Without this, if a session merely
        // expired (no explicit logout) and a *different* user then logs in
        // on the same browser, that user's screens could briefly render the
        // previous account's cached dashboard/loans/etc. data.
        qc.clear()
        setAuth(user, accessToken, refreshToken)
        // If we got sent here by ProtectedRoute (session expired mid-page),
        // it stashes the page the user was on in location.state.from — send
        // them straight back there instead of always resetting to /dashboard.
        const from = (location.state as { from?: string } | null)?.from
        navigate(from || '/dashboard', { replace: true })
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
    meta: { silent: true },
    onSettled: () => {
      logout()
      qc.clear()
      navigate('/login')
    },
  })
}
