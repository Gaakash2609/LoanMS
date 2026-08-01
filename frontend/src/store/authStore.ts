import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { User } from '@/types'

interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  // Zustand's `persist` middleware reads localStorage asynchronously (it goes
  // through a Promise even though localStorage itself is synchronous). That
  // means on a hard refresh there is one real render — the very first one,
  // before React has flushed a single microtask — where `user`/`accessToken`
  // are still at their default (null/false) values, *before* the persisted
  // session has been read back in. Any route guard that reads
  // `isAuthenticated` during that window sees "logged out" and redirects to
  // /login, even though the session is perfectly valid and about to load one
  // tick later. That redirect is exactly the "refresh throws me back to
  // login / a different page" bug. `hasHydrated` lets consumers (see
  // ProtectedRoute) wait for that one tick instead of guessing.
  hasHydrated: boolean
  setAuth: (user: User, accessToken: string, refreshToken: string) => void
  setTokens: (accessToken: string, refreshToken: string) => void
  logout: () => void
  setHasHydrated: (value: boolean) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      hasHydrated: false,

      setAuth: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken, isAuthenticated: true }),

      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken }),

      logout: () =>
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false }),

      setHasHydrated: (value) => set({ hasHydrated: value }),
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
        // hasHydrated is deliberately excluded — it describes the state of
        // *this page load's* rehydration, not something that should ever be
        // read back out of localStorage (it must always start false again on
        // the next load so ProtectedRoute waits for the real rehydrate).
      }),
      // Fires once the persisted session (or lack thereof) has actually been
      // read back from localStorage into the store — on both success and
      // failure, so a corrupt/blocked storage doesn't hang the app on the
      // loading screen forever. Until this fires, `isAuthenticated` cannot be
      // trusted as "logged out"; it just hasn't been checked yet.
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          // Corrupt/unreadable localStorage value — treat as "nothing to
          // restore" rather than hanging on the loading screen forever.
          useAuthStore.getState().setHasHydrated(true)
          return
        }
        state?.setHasHydrated(true)
      },
    }
  )
)
