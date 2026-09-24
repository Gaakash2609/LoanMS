import { useQuery } from '@tanstack/react-query'
import { permissionsApi, type RolePermissionsMap, type MenuVisibilityMap } from '@/api/permissionsApi'
import { dsaApi, type DsaPartner } from '@/api/dsaApi'
import {
  BACKEND_TO_ROLE_KEY, DEFAULT_ROLES, NAV_PERM_KEY_BY_MENU_ID,
  type RoleKey, type RolePermissionFlags,
} from '@/constants/permissions'
import { useAuthStore } from '@/store/authStore'
import type { UserRole } from '@/types'

export function useRolePermissionsQuery() {
  return useQuery({ queryKey: ['rolePermissions'], queryFn: permissionsApi.getRolePermissions, staleTime: 60_000 })
}

export function useMenuVisibilityQuery() {
  return useQuery({ queryKey: ['menuVisibility'], queryFn: permissionsApi.getMenuVisibility, staleTime: 60_000 })
}

// Same precedence as legacy's applySession(): a dedicated canNav* flag (if
// defined) wins; otherwise fall back to Menu Access Control's per-item role
// set; otherwise `undefined` (no dynamic opinion — caller should fall back
// to its own static default).
export function canAccessMenuItem(
  menuId: string,
  backendRole: UserRole | undefined,
  rolePermissions: RolePermissionsMap | undefined,
  menuVisibility: MenuVisibilityMap | undefined,
): boolean | undefined {
  if (!backendRole) return undefined
  const roleKey: RoleKey = BACKEND_TO_ROLE_KEY[backendRole]
  if (!roleKey) return undefined
  if (roleKey === 'admin') return true // admin card is always locked/full in legacy

  const navKey = NAV_PERM_KEY_BY_MENU_ID[menuId]
  if (rolePermissions && navKey) {
    const flag = rolePermissions[roleKey]?.[navKey]
    if (typeof flag === 'boolean') return flag
  }
  if (menuVisibility && menuVisibility[menuId]) {
    return menuVisibility[menuId].includes(roleKey)
  }
  return undefined
}

// Sidebar visibility of one nav item. The static `roles` list is a hard
// ceiling (it mirrors the route guard); inside it the dynamic canNav*/menu
// visibility answer can only hide an item, never reveal one the route refuses.
export function isNavItemVisible(
  roles: readonly UserRole[] | undefined,
  menuId: string | string[] | undefined,
  backendRole: UserRole | undefined,
  rolePermissions: RolePermissionsMap | undefined,
  menuVisibility: MenuVisibilityMap | undefined,
): boolean {
  const staticAllowed = !roles || (!!backendRole && roles.includes(backendRole))
  if (!menuId) return staticAllowed
  const menuIds = Array.isArray(menuId) ? menuId : [menuId]
  const dynamicResults = menuIds.map(id => canAccessMenuItem(id, backendRole, rolePermissions, menuVisibility))
  if (dynamicResults.every(r => r === undefined)) return staticAllowed
  return staticAllowed && dynamicResults.some(r => r === true)
}

// Vanilla hides Payout from a Partner who is mapped to a DSA — that Partner's
// payout is tracked by the mapped DSA user (efin-app.js :1349-1353, and the
// showPage guard at :1839). `undefined` while the Partner's own record is
// still loading; always false for every other role.
export function isPartnerMappedToDsa(
  backendRole: UserRole | undefined,
  userId: number | undefined,
  partners: DsaPartner[] | undefined,
): boolean | undefined {
  if (backendRole !== 'Partner') return false
  if (!partners || userId == null) return undefined
  return partners.some(p => p.partnerType === 'Partner' && p.linkedUserId === userId && p.mappedDsaId != null)
}

export function usePartnerMappedToDsa(): boolean | undefined {
  const user = useAuthStore(s => s.user)
  const isPartner = user?.role === 'Partner'
  // GET /api/dsa returns a Partner login only its own record (DsaController).
  const { data, isError } = useQuery({
    queryKey: ['dsa', 'partner-mapping'],
    queryFn: () => dsaApi.getAll().then(r => r.data.data ?? []),
    enabled: isPartner,
    staleTime: 60_000,
  })
  // A failed lookup must not leave Payout on a spinner — PayoutController
  // still refuses a DSA-mapped Partner server-side.
  if (isError) return false
  return isPartnerMappedToDsa(user?.role, user?.id, data)
}

/**
 * Reads a single permission flag for the signed-in user out of the synced
 * role-permissions blob — the same data the Settings → Roles & Permissions
 * editor writes. This is what extends that editor beyond sidebar nav to the
 * things legacy also gated with it: application-detail tabs (canTab*),
 * action buttons (canCreateApp/canDisburse/…), and PII masking
 * (canMaskPersonal).
 *
 * `fallback` is returned while the permissions query is still loading or
 * when the role has no explicit value for the key — matching legacy's
 * fail-open behaviour (a missing flag never silently locks a user out of
 * something they could previously do). Admin is always allowed, mirroring
 * the locked/full Admin card in the editor.
 */
export function useHasPermission(
  permKey: keyof RolePermissionFlags,
  fallback = true,
): boolean {
  const user = useAuthStore(s => s.user)
  const { data: rolePermissions } = useRolePermissionsQuery()

  if (!user?.role) return fallback
  const roleKey: RoleKey = BACKEND_TO_ROLE_KEY[user.role as UserRole]
  if (!roleKey) return fallback
  if (roleKey === 'admin') {
    // Admin is "locked/full" in legacy, but a blanket `return true` was WRONG
    // for canMaskPersonal — an INVERTED flag meaning "PII is masked FOR this
    // role". Vanilla sets admin.canMaskPersonal=false (efin-app.js ROLES) so
    // Admin sees PAN/Aadhaar/Mobile UNMASKED; the blanket true was masking
    // Admin's own Personal/Overview view. Return Admin's real per-flag default
    // (every positive perm is true; only canMaskPersonal is false) so masking
    // is correct while nothing else changes.
    const adminVal = DEFAULT_ROLES.admin[permKey]
    return typeof adminVal === 'boolean' ? adminVal : true
  }
  if (!rolePermissions) return fallback

  const value = rolePermissions[roleKey]?.[permKey]
  return typeof value === 'boolean' ? value : fallback
}

// ── Phase 3 (RBAC) centralized role/permission helpers ──────────────────────
// One place for the STEP-2 vocabulary (hasRole / hasAnyRole / hasAnyPermission
// / hasAllPermissions / canPerformStageAction). These build ON the same
// useHasPermission + role source above — they never invent a second
// authorization opinion, and the backend stays authoritative.

/** The signed-in user's backend role (PascalCase UserRole), or undefined. */
export function useCurrentRole(): UserRole | undefined {
  return useAuthStore(s => s.user?.role) as UserRole | undefined
}

/**
 * The signed-in user's role department label — legacy's
 * `ROLES[currentUser.role].dept` (efin-app.js, read into the readonly
 * `tm-stage` field on every tracking-entry-posting modal: Income/Bank/ECS/
 * FI checks, Documents, Manual Comment, etc). `dept` is static per-role
 * metadata (not an admin-configurable permission flag), so this reads
 * straight from DEFAULT_ROLES rather than the synced permissions blob.
 * Falls back to 'Admin', matching legacy's `rd.dept || 'Admin'`.
 */
export function useCurrentUserDept(): string {
  const role = useCurrentRole()
  if (!role) return 'Admin'
  const roleKey: RoleKey = BACKEND_TO_ROLE_KEY[role]
  return DEFAULT_ROLES[roleKey]?.dept || 'Admin'
}

export function useHasAnyRole(roles: readonly UserRole[]): boolean {
  const current = useCurrentRole()
  return !!current && roles.includes(current)
}

// The processing roles the backend role-gates the document verify/reject
// endpoints to (LoansController: Admin,Manager,LoginTeam,TeamLeader,
// LocationHead,OperationManager). The UI must mirror BOTH this role set AND the
// canVerifyDocs flag, because the backend enforces both — showing the control
// to a role outside this set would be a dead button (guaranteed 403).
export const DOC_VERIFIER_ROLES: readonly UserRole[] = [
  'Admin', 'Manager', 'LoginTeam', 'TeamLeader', 'LocationHead', 'OperationManager',
]

/**
 * Whether the current user may Verify/Reject documents in the UI. Mirrors the
 * exact Phase 2 backend gate: role ∈ DOC_VERIFIER_ROLES AND canVerifyDocs.
 * Backend remains authoritative; this only prevents dead buttons.
 */
export function useCanVerifyDocs(): boolean {
  const inRole = useHasAnyRole(DOC_VERIFIER_ROLES)
  const flag = useHasPermission('canVerifyDocs')
  return inRole && flag
}
