import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { ShieldOff } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/States'
import { useMenuVisibilityQuery, useRolePermissionsQuery } from '@/hooks/usePermissions'
import { DEFAULT_ROLES } from '@/constants/permissions'
import { defaultMenuVisibility, type RolePermissionsMap } from '@/api/permissionsApi'
import { canOpenPage, LANDING_PATH, type PageGuard } from './pageAccess'
import type { UserRole } from '@/types'

// Page-level guard (master prompt Part 7): a page opens only when its sidebar
// item would be shown to this role — the same role ceiling and canNav* / Menu
// Access Control check (canOpenPage), so typing a URL can't reach a page the
// sidebar hides. Waits for the permission data instead of guessing, and falls
// back to the default permissions (never to "allowed") if it can't load.
// Rendered inside the signed-in layout, so ProtectedRoute has already handled
// the session.
export default function RouteGuard({ guard }: { guard: PageGuard }) {
  const role = useAuthStore(s => s.user?.role) as UserRole | undefined
  const { pathname } = useLocation()
  const perms = useRolePermissionsQuery()
  const menus = useMenuVisibilityQuery()

  if (guard.menuId && (perms.isLoading || menus.isLoading)) return <PageLoader />

  const allowed = canOpenPage(guard, role,
    perms.data ?? (structuredClone(DEFAULT_ROLES) as RolePermissionsMap),
    menus.data ?? defaultMenuVisibility())
  if (allowed) return <Outlet />

  // Refused: go to the landing page — unless this IS the landing page, which
  // shows a notice instead (no redirect loop).
  if (pathname !== LANDING_PATH) return <Navigate to={LANDING_PATH} replace />
  return (
    <EmptyState icon={ShieldOff} title="You don't have access to this page"
      description="Use the menu to open a page your role can access, or ask your Chief Administrator." />
  )
}
