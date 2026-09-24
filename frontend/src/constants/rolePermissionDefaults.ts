import { ALL_MENU_ITEMS, ALL_ROLE_KEYS, DEFAULT_ROLES, NAV_PERM_KEY_BY_MENU_ID } from './permissions.ts'

// The secure-default permission set the backend falls back to when the Admin
// has never saved (or the store holds an unreadable) permission matrix / menu
// visibility map. Derived only from this file's sources of truth, and emitted
// to LoanMS.API/Services/RolePermissionDefaults.json by
// scripts/export-role-permission-defaults.ts.
export interface RolePermissionDefaults {
  roles: Record<string, Record<string, boolean>>
  menus: Record<string, string[]>
  navKeyByMenuId: Record<string, string>
}

export function buildRolePermissionDefaults(): RolePermissionDefaults {
  const roles: Record<string, Record<string, boolean>> = {}
  for (const roleKey of Object.keys(DEFAULT_ROLES).sort()) {
    const record = DEFAULT_ROLES[roleKey as keyof typeof DEFAULT_ROLES] as unknown as Record<string, unknown>
    const flags: Record<string, boolean> = {}
    for (const k of Object.keys(record).filter(k => k.startsWith('can')).sort())
      if (typeof record[k] === 'boolean') flags[k] = record[k] as boolean
    roles[roleKey] = flags
  }
  const menus: Record<string, string[]> = {}
  for (const m of [...ALL_MENU_ITEMS].sort((a, b) => a.id.localeCompare(b.id)))
    menus[m.id] = [...(m.canHide ? (m.defaultRoles ?? []) : ALL_ROLE_KEYS)].sort()
  const navKeyByMenuId: Record<string, string> = {}
  for (const id of Object.keys(NAV_PERM_KEY_BY_MENU_ID).sort())
    navKeyByMenuId[id] = NAV_PERM_KEY_BY_MENU_ID[id] as string
  return { roles, menus, navKeyByMenuId }
}
