import { describe, it, expect } from 'vitest'
import { DSA_FULL_DETAIL_ROLES, PAGE_GUARDS, PAGE_ROLES, canOpenPage, type PageGuard } from '@/routes/pageAccess'
import { isNavItemVisible, isPartnerMappedToDsa } from '@/hooks/usePermissions'
import {
  ALL_MENU_ITEMS, ALL_ROLE_KEYS, BACKEND_TO_ROLE_KEY, DEFAULT_ROLES,
  type RolePermissionFlags,
} from '@/constants/permissions'
import type { RolePermissionsMap, MenuVisibilityMap } from '@/api/permissionsApi'
import type { DsaPartner } from '@/api/dsaApi'
import type { UserRole } from '@/types'

// Page access for the roles audit (AUDIT_PROGRESS.md §R #1/#4): route guard and
// sidebar share PAGE_ROLES, which must follow Vanilla's canNav* grants
// (DEFAULT_ROLES is flag-for-flag equal to efin-app.js ROLES).
const ROLES = Object.keys(BACKEND_TO_ROLE_KEY) as UserRole[]
const perms = structuredClone(DEFAULT_ROLES) as RolePermissionsMap
const menuVis: MenuVisibilityMap = Object.fromEntries(
  ALL_MENU_ITEMS.map(m => [m.id, m.canHide ? (m.defaultRoles ?? []) : [...ALL_ROLE_KEYS]]))

const vanillaGrants = (flag: keyof RolePermissionFlags) =>
  ROLES.filter(r => DEFAULT_ROLES[BACKEND_TO_ROLE_KEY[r]][flag] === true).sort()
const sorted = (a: readonly string[]) => [...a].sort()
const visible = (roles: readonly UserRole[], menuId: string) =>
  ROLES.filter(r => isNavItemVisible(roles, menuId, r, perms, menuVis)).sort()

describe('PAGE_ROLES follows Vanilla canNav grants', () => {
  it('payout: every role Vanilla shows it to (all except ProductTeam)', () => {
    expect(sorted(PAGE_ROLES.payout)).toEqual(vanillaGrants('canNavPayout'))
    expect(PAGE_ROLES.payout).not.toContain('ProductTeam')
  })
  it('banks and incred: exactly the Vanilla roles', () => {
    expect(sorted(PAGE_ROLES.banks)).toEqual(vanillaGrants('canNavBanks'))
    expect(sorted(PAGE_ROLES.incred)).toEqual(vanillaGrants('canNavIncred'))
  })
  it('dsa/partners and locations: every flag-granted role, plus only the access React already had', () => {
    for (const flag of ['canNavDSA', 'canNavPartner'] as const)
      for (const r of vanillaGrants(flag)) expect(PAGE_ROLES.dsaPartners).toContain(r)
    // Manager + TeamLeader now hold canNavDSA/canNavPartner (owner decision) and
    // Sales is out (Part 7), so the ceiling is exactly the flag-granted roles.
    expect(sorted(PAGE_ROLES.dsaPartners)).toEqual(vanillaGrants('canNavDSA'))
    for (const r of vanillaGrants('canNavLocations')) expect(PAGE_ROLES.locations).toContain(r)
    expect(PAGE_ROLES.locations.filter(r => !vanillaGrants('canNavLocations').includes(r))).toEqual(['Manager'])
  })
})

describe('sidebar with default permissions', () => {
  it('shows Payout to the seven roles that could not reach it before', () => {
    const shown = visible(PAGE_ROLES.payout, 'payout')
    for (const r of ['Sales', 'Dsa', 'Partner', 'LoginTeam', 'TeamLeader', 'LocationHead', 'OperationManager'])
      expect(shown).toContain(r)
    expect(shown).not.toContain('ProductTeam')
  })
  it('shows InCred / Banks / DSA / Partners / Locations exactly per Vanilla', () => {
    expect(visible(PAGE_ROLES.incred, 'incred')).toEqual(vanillaGrants('canNavIncred'))
    expect(visible(PAGE_ROLES.banks, 'banks')).toEqual(vanillaGrants('canNavBanks'))
    expect(visible(PAGE_ROLES.dsaPartners, 'dsa-mgmt')).toEqual(vanillaGrants('canNavDSA'))
    expect(visible(PAGE_ROLES.dsaPartners, 'partner-mgmt')).toEqual(vanillaGrants('canNavPartner'))
    expect(visible(PAGE_ROLES.locations, 'locations-mgmt')).toEqual(vanillaGrants('canNavLocations'))
  })
  it('keeps the static list as a hard ceiling (a true canNav flag never reveals a refused route)', () => {
    // LocationHead has canNavSecurity=true in Vanilla, but /security-roles stays Admin-only.
    expect(isNavItemVisible(['Admin'], 'security-roles', 'LocationHead', perms, menuVis)).toBe(false)
    expect(isNavItemVisible(['Admin'], 'security-roles', 'Admin', perms, menuVis)).toBe(true)
    // Items without a menu id fall back to the static list alone.
    expect(isNavItemVisible(['Admin'], undefined, 'Manager', perms, menuVis)).toBe(false)
    expect(isNavItemVisible(undefined, undefined, 'Sales', perms, menuVis)).toBe(true)
  })
})

describe('team pages and users (master prompt Part 5)', () => {
  it('team pages: Admin/ProductTeam manage, Manager and the three supervising roles read', () => {
    expect(sorted(PAGE_ROLES.teams)).toEqual(
      sorted(['Admin', 'Manager', 'ProductTeam', 'TeamLeader', 'LocationHead', 'OperationManager']))
    expect(sorted(PAGE_ROLES.users)).toEqual(sorted(['Admin', 'ProductTeam', 'LocationHead']))
  })
  it('the sidebar then follows each role own canNav flag', () => {
    expect(visible(PAGE_ROLES.teams, 'team-overview')).toEqual(vanillaGrants('canNavTeamOverview'))
    expect(visible(PAGE_ROLES.teams, 'sales-teams')).toEqual(vanillaGrants('canNavSalesTeams'))
    expect(visible(PAGE_ROLES.teams, 'login-teams')).toEqual(vanillaGrants('canNavLoginTeams'))
    expect(visible(PAGE_ROLES.users, 'users-mgmt')).toEqual(vanillaGrants('canNavUsers'))
  })
})

describe('DSA/Partner detail (master prompt Part 6)', () => {
  it('full PAN/contact details only for the four working roles plus a DSA/Partner itself', () => {
    expect(sorted(DSA_FULL_DETAIL_ROLES)).toEqual(sorted(['Admin', 'ProductTeam', 'Manager', 'TeamLeader', 'Dsa', 'Partner']))
    // LocationHead opens the pages (Vanilla canNavDSA) but only as a directory.
    expect(PAGE_ROLES.dsaPartners).toContain('LocationHead')
    expect(DSA_FULL_DETAIL_ROLES).not.toContain('LocationHead')
  })
})

describe('direct URL access (master prompt Part 7)', () => {
  const guards = PAGE_GUARDS as Record<string, PageGuard>
  // Every canNav* flag and every menu list switched on — the most an Admin
  // could ever grant through Settings.
  const allOn = structuredClone(DEFAULT_ROLES) as RolePermissionsMap
  for (const k of ALL_ROLE_KEYS)
    for (const f of Object.keys(allOn[k])) if (f.startsWith('canNav')) (allOn[k] as unknown as Record<string, unknown>)[f] = true
  const allMenus: MenuVisibilityMap = Object.fromEntries(ALL_MENU_ITEMS.map(m => [m.id, [...ALL_ROLE_KEYS]]))
  const opens = (path: string, role: UserRole, p = perms, v = menuVis) => canOpenPage(guards[path], role, p, v)

  it('Sales never reaches /dsa, /partners or /lender-config — even with every flag on', () => {
    for (const path of ['/dsa', '/partners', '/lender-config']) {
      expect(opens(path, 'Sales'), path).toBe(false)
      expect(opens(path, 'Sales', allOn, allMenus), path).toBe(false)
    }
  })
  it('Manager reaches /dsa and /partners but never /lender-config', () => {
    expect(opens('/dsa', 'Manager')).toBe(true)
    expect(opens('/partners', 'Manager')).toBe(true)
    expect(opens('/lender-config', 'Manager')).toBe(false)
    expect(opens('/lender-config', 'Manager', allOn, allMenus)).toBe(false)
    expect(opens('/lender-config', 'ProductTeam')).toBe(true)
  })
  it('every page follows the role canNav flag, not just the three above', () => {
    expect(opens('/tasks', 'Sales')).toBe(false)         // canNavTasks off
    expect(opens('/loans', 'Accounts')).toBe(false)      // canNavApplications off
    expect(opens('/calculator', 'ProductTeam')).toBe(false)
    expect(opens('/loans', 'Sales')).toBe(true)
    // An Admin switching a flag off closes the URL as well as the menu item.
    const noReports = structuredClone(DEFAULT_ROLES) as RolePermissionsMap
    noReports.manager.canNavReports = false
    expect(opens('/reports', 'Manager')).toBe(true)
    expect(opens('/reports', 'Manager', noReports)).toBe(false)
  })
  it('Admin opens every page; admin-only pages stay admin-only', () => {
    for (const path of Object.keys(guards)) expect(opens(path, 'Admin'), path).toBe(true)
    for (const path of ['/settings', '/audit', '/security-roles'])
      for (const r of ROLES.filter(r => r !== 'Admin')) expect(opens(path, r, allOn, allMenus), `${r} ${path}`).toBe(false)
  })
  it('every sidebar menu has a route guard on the same menu id', () => {
    const guarded = new Set(Object.values(guards).map(g => g.menuId).filter(Boolean))
    for (const m of ALL_MENU_ITEMS)
      if (m.id !== 'security-roles') expect(guarded.has(m.id), m.id).toBe(true) // /security-roles is Admin-only
  })
})

describe('Partner mapped to a DSA (Vanilla hides Payout)', () => {
  const rec = (over: Partial<DsaPartner>) =>
    ({ id: 1, name: 'P', partnerType: 'Partner', linkedUserId: 7, mappedDsaId: null, ...over }) as DsaPartner
  it('is never true for other roles', () => {
    expect(isPartnerMappedToDsa('Sales', 7, [rec({ mappedDsaId: 3 })])).toBe(false)
    expect(isPartnerMappedToDsa('Dsa', 7, undefined)).toBe(false)
  })
  it('is unknown while the Partner record loads, then reflects mappedDsaId', () => {
    expect(isPartnerMappedToDsa('Partner', 7, undefined)).toBeUndefined()
    expect(isPartnerMappedToDsa('Partner', 7, [rec({ mappedDsaId: 3 })])).toBe(true)
    expect(isPartnerMappedToDsa('Partner', 7, [rec({})])).toBe(false)
    // another Partner's mapping does not count
    expect(isPartnerMappedToDsa('Partner', 7, [rec({ linkedUserId: 8, mappedDsaId: 3 })])).toBe(false)
  })
})
