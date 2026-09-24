import { describe, it, expect } from 'vitest'
import shipped from '../../../LoanMS.API/Services/RolePermissionDefaults.json?raw'
import { buildRolePermissionDefaults } from '@/constants/rolePermissionDefaults'
import { ALL_ROLE_KEYS } from '@/constants/permissions'

// The backend falls back to RolePermissionDefaults.json whenever the Admin has
// never saved (or the store holds an unreadable) permission matrix (master
// prompt Part 4). It must be exactly what the UI itself defaults to — regenerate
// with `node scripts/export-role-permission-defaults.ts` after changing
// DEFAULT_ROLES / ALL_MENU_ITEMS / NAV_PERM_KEY_BY_MENU_ID.
describe('backend secure-default permission set', () => {
  const built = buildRolePermissionDefaults()

  it('matches the frontend defaults exactly', () => {
    expect(JSON.parse(shipped)).toEqual(built)
  })

  it('covers every role and never grants a non-admin every permission', () => {
    expect(Object.keys(built.roles).sort()).toEqual([...ALL_ROLE_KEYS].sort())
    for (const [role, flags] of Object.entries(built.roles)) {
      if (role === 'admin') continue
      expect(Object.values(flags).some(v => v === false), role).toBe(true)
    }
  })
})
