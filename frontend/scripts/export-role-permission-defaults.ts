// Writes the backend's secure-default permission set from the frontend's own
// defaults, so both sides enforce the same matrix when an Admin has never saved
// Settings -> Roles & Permissions (master prompt Part 4). Re-run after changing
// DEFAULT_ROLES / ALL_MENU_ITEMS / NAV_PERM_KEY_BY_MENU_ID:
//   node scripts/export-role-permission-defaults.ts
// src/test/role-permission-defaults.test.ts fails if the JSON drifts.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildRolePermissionDefaults } from '../src/constants/rolePermissionDefaults.ts'

const out = fileURLToPath(new URL('../../LoanMS.API/Services/RolePermissionDefaults.json', import.meta.url))
writeFileSync(out, JSON.stringify(buildRolePermissionDefaults(), null, 2) + '\n')
console.log('wrote', out)
