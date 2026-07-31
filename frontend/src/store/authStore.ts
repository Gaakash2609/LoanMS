import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { User } from '@/types'

interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  setAuth: (user: User, accessToken: string, refreshToken: string) => void
  setTokens: (accessToken: string, refreshToken: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,

      setAuth: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken, isAuthenticated: true }),

      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken }),

      logout: () =>
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false }),
    }),
    {
      // IMPORTANT: must be localStorage, not sessionStorage.
      // sessionStorage is cleared the moment the browser tab/window is closed,
      // which silently discarded the (correctly 7-day-lived, per Jwt:RefreshExpiryDays)
      // refreshToken on every "browser close/reopen" — the user was bounced back
      // to a logged-out/empty screen and it *looked* like "all data disappeared",
      // even though nothing was ever deleted server-side. localStorage persists
      // across tab/browser restarts (still per-origin, still cleared on logout()),
      // matching the backend's actual session lifetime intent.
      name: 'efin_auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)
