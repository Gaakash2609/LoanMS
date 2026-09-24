import type { UserRole } from '@/types'
import type { MenuVisibilityMap, RolePermissionsMap } from '@/api/permissionsApi'
import { isNavItemVisible } from '@/hooks/usePermissions'

// Page-level role gates shared by the route guards (AppRoutes.tsx) and the
// sidebar ceiling (AppLayout.tsx), so the two lists can no longer drift apart.
// A role is listed when Vanilla grants the page (efin-app.js ROLES canNav*,
// :160-640) AND the backend serves that page's data to the role. Inside this
// ceiling the sidebar still honours each role's canNav* flag, and every page
// keeps its own write gate (canManage), so read-only roles see no edit
// controls the API would refuse.
export const PAGE_ROLES = {
  // Vanilla canNavPayout: every role except ProductTeam (a Partner mapped to a
  // DSA is excluded separately — see usePartnerMappedToDsa). PayoutController
  // serves claims self-scoped to any authenticated role.
  payout: ['Admin', 'Manager', 'Accounts', 'Sales', 'Dsa', 'Partner', 'LoginTeam', 'TeamLeader', 'LocationHead', 'OperationManager'],
  // Vanilla canNavBanks; GET /api/banks follows the same banks menu
  // permission, writes stay Admin/ProductTeam (BanksPage canManage).
  banks: ['Admin', 'Manager', 'ProductTeam', 'TeamLeader', 'LocationHead', 'OperationManager'],
  // Vanilla canNavIncred; /api/incred/status, /applications (visibility-scoped)
  // and /rm are open to all roles, RM writes stay Admin (IncredRmTab canManage).
  incred: ['Admin', 'Manager', 'LoginTeam', 'TeamLeader', 'LocationHead', 'OperationManager', 'ProductTeam'],
  // canNavDSA/canNavPartner: Vanilla's Admin, LocationHead, ProductTeam plus
  // Manager and TeamLeader (business-owner decision 2026-09-24: read access to
  // follow up DSA/Partner-sourced files); writes stay per DsaPage/PartnerPage.
  // Sales is out (master prompt Part 7) — not even by direct URL.
  dsaPartners: ['Admin', 'Manager', 'TeamLeader', 'ProductTeam', 'LocationHead'],
  // Lender Configuration: Admin/ProductTeam (master prompt Part 7 — never
  // granted to Manager; LenderConfigController follows the policy-product menu).
  lenderConfig: ['Admin', 'ProductTeam'],
  // Vanilla canNavReports — the six roles defaulting to true.
  reports: ['Admin', 'Manager', 'TeamLeader', 'LoginTeam', 'LocationHead', 'OperationManager'],
  // Policy & Product: Vanilla defaultRoles ['admin','product_team'].
  policyProduct: ['Admin', 'ProductTeam'],
  adminOnly: ['Admin'],
  // Vanilla canNavLocations (Admin, LocationHead, ProductTeam) plus Manager;
  // GET /api/locations lists only the caller's own Locations except for
  // Admin/ProductTeam/Manager, writes stay Admin/ProductTeam.
  locations: ['Admin', 'Manager', 'ProductTeam', 'LocationHead'],
  // Team Overview / Sales Teams / Login Teams (master prompt Part 5): Admin and
  // ProductTeam manage them; Manager, TeamLeader, LocationHead and
  // OperationManager read their own teams / Location (TeamsController scope).
  teams: ['Admin', 'Manager', 'ProductTeam', 'TeamLeader', 'LocationHead', 'OperationManager'],
  // Users (master prompt Part 5): Admin and ProductTeam manage accounts (only
  // an Admin touches an Admin); LocationHead reads its own Location's users.
  users: ['Admin', 'ProductTeam', 'LocationHead'],
} satisfies Record<string, UserRole[]>

// Master prompt Part 6 — roles that receive DSA/Partner PAN, contact details
// and KYC files (DsaController.FullDetailRoles; a DSA/Partner only for its own
// records). Any other role on the DSA/Partner pages gets the lookup directory
// only (id, name, code, type — active records), so those pages drop the
// detail columns, documents and management controls for it.
export const DSA_FULL_DETAIL_ROLES: readonly UserRole[] = ['Admin', 'ProductTeam', 'Manager', 'TeamLeader', 'Dsa', 'Partner']

/** One page's gate: the role ceiling plus the sidebar menu whose canNav* flag
 *  (else Menu Access Control entry) must also allow the role. */
export interface PageGuard { roles?: readonly UserRole[]; menuId?: string }

// Master prompt Part 7 — the sidebar (AppLayout) and the router (RouteGuard)
// read these same entries, so a page hidden from a role's sidebar cannot be
// opened by typing its URL either. Pages with no sidebar item of their own
// (loan detail, tracking, profile) need only a signed-in user.
export const PAGE_GUARDS = {
  '/dashboard':       { menuId: 'dashboard' },
  '/loans':           { menuId: 'applications' },
  '/new-application': { menuId: 'new-application' },
  '/calculator':      { menuId: 'calculator' },
  '/tasks':           { menuId: 'tasks-page' },
  '/payout':          { roles: PAGE_ROLES.payout, menuId: 'payout' },
  '/banks':           { roles: PAGE_ROLES.banks, menuId: 'banks' },
  '/incred':          { roles: PAGE_ROLES.incred, menuId: 'incred' },
  '/lender-config':   { roles: PAGE_ROLES.lenderConfig, menuId: 'lender-config' },
  '/dsa':             { roles: PAGE_ROLES.dsaPartners, menuId: 'dsa-mgmt' },
  '/partners':        { roles: PAGE_ROLES.dsaPartners, menuId: 'partner-mgmt' },
  '/teams':           { roles: PAGE_ROLES.teams, menuId: 'team-overview' },
  '/sales-teams':     { roles: PAGE_ROLES.teams, menuId: 'sales-teams' },
  '/login-teams':     { roles: PAGE_ROLES.teams, menuId: 'login-teams' },
  '/locations':       { roles: PAGE_ROLES.locations, menuId: 'locations-mgmt' },
  '/users':           { roles: PAGE_ROLES.users, menuId: 'users-mgmt' },
  '/reports':         { roles: PAGE_ROLES.reports, menuId: 'reports' },
  '/tickets':         { menuId: 'tickets' },
  '/policy-product':  { roles: PAGE_ROLES.policyProduct, menuId: 'policy-product' },
  '/settings':        { roles: PAGE_ROLES.adminOnly },
  '/audit':           { roles: PAGE_ROLES.adminOnly },
  '/security-roles':  { roles: PAGE_ROLES.adminOnly },
} satisfies Record<string, PageGuard>

/** Where a refused page sends the user. */
export const LANDING_PATH = '/dashboard'

/** The sidebar's own rule (isNavItemVisible): role ceiling AND canNav* / menu permission. */
export function canOpenPage(
  guard: PageGuard,
  role: UserRole | undefined,
  rolePermissions: RolePermissionsMap | undefined,
  menuVisibility: MenuVisibilityMap | undefined,
): boolean {
  return isNavItemVisible(guard.roles, guard.menuId, role, rolePermissions, menuVisibility)
}
