import api from './axios'
import { settingsApi } from './settingsApi'
import type { ApiResponse } from '@/types'
import { useAuthStore } from '@/store/authStore'
import {
  DEFAULT_ROLES, ALL_MENU_ITEMS, ALL_ROLE_KEYS,
  type RoleKey, type RoleRecord,
} from '@/constants/permissions'

// Mirrors efin-app.js's STG_PERM_SETTINGS_KEY / STG_MENU_VIS_SETTINGS_KEY
// exactly — same generic /api/settings key/value store, same category.
const PERM_KEY = 'efin_role_permissions'
const MENU_VIS_KEY = 'efin_menu_visibility'
const SETTINGS_CATEGORY = 'Permissions'

export type RolePermissionsMap = Record<RoleKey, RoleRecord>
export type MenuVisibilityMap = Record<string, RoleKey[]>

export function defaultMenuVisibility(): MenuVisibilityMap {
  const vis: MenuVisibilityMap = {}
  ALL_MENU_ITEMS.forEach(item => {
    vis[item.id] = item.canHide ? (item.defaultRoles ?? []) : [...ALL_ROLE_KEYS]
  })
  return vis
}

// The generic settings read of these two keys is Admin-only on purpose, so a
// non-Admin UI gets just its own role's slice of what the Admin saved from
// GET /api/users/me/permissions (RolePermissionService.GetOwnPermissionsAsync).
// Before this, every non-Admin UI silently ran on the hard-coded defaults while
// the backend enforced the saved map.
interface OwnPermissions {
  roleKey: RoleKey | null
  permissions: Partial<Record<keyof RoleRecord, boolean>> | null
  menuVisibility: Record<string, boolean>
}

const isAdminSession = () => useAuthStore.getState().user?.role === 'Admin'

async function fetchOwnPermissions(): Promise<OwnPermissions | null> {
  try {
    const res = await api.get<ApiResponse<OwnPermissions>>('/api/users/me/permissions')
    return res.data.data ?? null
  } catch {
    return null // defaults apply, as before
  }
}

async function fetchSettingValue(key: string): Promise<string | null> {
  try {
    const res = await settingsApi.getByKey(key)
    return res.data.data?.value ?? null
  } catch {
    // Key doesn't exist yet (first run) — legacy treats this as "use
    // hardcoded defaults", not an error.
    return null
  }
}

export const permissionsApi = {
  // GET — merges server overrides into DEFAULT_ROLES per-role, same shallow
  // Object.assign semantics as stgSyncPermissionsFromServer().
  getRolePermissions: async (): Promise<RolePermissionsMap> => {
    const merged = structuredClone(DEFAULT_ROLES) as RolePermissionsMap
    if (!isAdminSession()) {
      const own = await fetchOwnPermissions()
      if (own?.roleKey && own.permissions && merged[own.roleKey]) Object.assign(merged[own.roleKey], own.permissions)
      return merged
    }
    const raw = await fetchSettingValue(PERM_KEY)
    if (raw) {
      try {
        const saved = JSON.parse(raw) as Partial<Record<RoleKey, Partial<RoleRecord>>>
        ;(Object.keys(saved) as RoleKey[]).forEach(roleKey => {
          if (merged[roleKey] && saved[roleKey]) Object.assign(merged[roleKey], saved[roleKey])
        })
      } catch { /* malformed stored value — fall back to defaults */ }
    }
    return merged
  },

  // POST — value is the whole RolePermissionsMap, JSON.stringify'd, exactly
  // like legacy's JSON.stringify(ROLES).
  saveRolePermissions: (roles: RolePermissionsMap) =>
    settingsApi.update(PERM_KEY, JSON.stringify(roles), SETTINGS_CATEGORY),

  getMenuVisibility: async (): Promise<MenuVisibilityMap> => {
    const merged = defaultMenuVisibility()
    if (!isAdminSession()) {
      // Same result for this role as merging the full saved map: a saved list
      // replaces the default list, so the role is listed iff the Admin listed it.
      const own = await fetchOwnPermissions()
      const roleKey = own?.roleKey
      if (roleKey) {
        Object.entries(own.menuVisibility ?? {}).forEach(([itemId, allowed]) => {
          const others = (merged[itemId] ?? []).filter(k => k !== roleKey)
          merged[itemId] = allowed ? [...others, roleKey] : others
        })
      }
      return merged
    }
    const raw = await fetchSettingValue(MENU_VIS_KEY)
    if (raw) {
      try {
        const saved = JSON.parse(raw) as Record<string, RoleKey[]>
        Object.keys(saved).forEach(itemId => { merged[itemId] = saved[itemId] })
      } catch { /* malformed stored value — fall back to defaults */ }
    }
    return merged
  },

  saveMenuVisibility: (vis: MenuVisibilityMap) =>
    settingsApi.update(MENU_VIS_KEY, JSON.stringify(vis), SETTINGS_CATEGORY),

  // Permission Change History — efin-app.js:37215-37275's exact two audit
  // queries, client-side filtered to permission/menu/expert-export rows,
  // sorted desc, top 25.
  getPermissionHistory: async () => {
    interface AuditRow {
      id: number; entityName: string; action: string; entityId?: string
      userName?: string; createdAt: string; oldValues?: string; newValues?: string
    }
    const [settingsRows, eeRows] = await Promise.all([
      api.get<ApiResponse<{ items: AuditRow[] }>>('/api/audit', { params: { entity: 'Settings', pageSize: 40 } })
        .then(r => r.data.data?.items ?? []).catch(() => [] as AuditRow[]),
      api.get<ApiResponse<{ items: AuditRow[] }>>('/api/audit', { params: { entity: 'Expertexport', pageSize: 20 } })
        .then(r => r.data.data?.items ?? []).catch(() => [] as AuditRow[]),
    ])
    const keys = ['efin_role_permissions', 'efin_menu_visibility', 'expertexport', 'expert_export']
    const combined = [...settingsRows, ...eeRows].filter(it => {
      if (it.entityName === 'Expertexport') return true
      const haystack = `${it.newValues ?? ''} ${it.action ?? ''}`.toLowerCase()
      return keys.some(k => haystack.includes(k))
    })
    combined.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return combined.slice(0, 25)
  },
}
