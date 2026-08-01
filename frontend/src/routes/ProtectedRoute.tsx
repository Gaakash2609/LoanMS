import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import type { UserRole } from '@/types'

interface Props {
  allowedRoles?: UserRole[]
}

export default function ProtectedRoute({ allowedRoles }: Props) {
  const { isAuthenticated, user, hasHydrated } = useAuthStore()
  const location = useLocation()

  // On a hard refresh, the persisted session is read back from localStorage
  // asynchronously. Until that finishes, `isAuthenticated` is still at its
  // default `false` — checking it here would redirect an already-logged-in
  // user to /login for one tick on every refresh, which is exactly the
  // "gets logged out / bounced to a different page on refresh" bug. Show a
  // loader instead of deciding anything until rehydration has actually run.
  if (!hasHydrated) return <PageLoader />

  // Preserve the exact page the user refreshed on so, once we redirect them
  // to /login (e.g. session genuinely expired), a subsequent login can send
  // them back to where they were instead of always landing on /dashboard.
  // useLocation() is basename-relative (BrowserRouter basename="/app"),
  // unlike window.location — using the raw browser path here would double
  // up the "/app" prefix once useLogin() calls navigate(from) below.
  if (!isAuthenticated) {
    const from = `${location.pathname}${location.search}`
    return <Navigate to="/login" replace state={{ from }} />
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role as UserRole)) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}
