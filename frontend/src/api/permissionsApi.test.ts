import { describe, it, expect, vi, beforeEach } from 'vitest'

// Roles audit R#3: a non-Admin UI must apply what the Admin saved (its own role
// slice from /api/users/me/permissions) instead of silently using defaults.
const get = vi.fn()
vi.mock('./axios', () => ({ default: { get: (...a: unknown[]) => get(...a), post: vi.fn() } }))

import { permissionsApi } from './permissionsApi'
import { useAuthStore } from '@/store/authStore'
import { DEFAULT_ROLES } from '@/constants/permissions'
import type { User } from '@/types'

const loginAs = (role: string) =>
  useAuthStore.setState({ user: { id: 7, fullName: 'T', email: 't@x', role, isActive: true, createdAt: '' } as User })
const ok = (data: unknown) => Promise.resolve({ data: { success: true, data } })

describe('permissionsApi for a non-Admin session', () => {
  beforeEach(() => { get.mockReset(); loginAs('Sales') })

  it("applies the Admin-saved flags for the caller's own role only", async () => {
    get.mockImplementation((url: string) => url === '/api/users/me/permissions'
      ? ok({ roleKey: 'sales_executive', permissions: { canManageTasks: true, canNavPayout: false }, menuVisibility: {} })
      : Promise.reject(new Error('unexpected ' + url)))
    const map = await permissionsApi.getRolePermissions()
    expect(map.sales_executive.canManageTasks).toBe(true)      // default is false
    expect(map.sales_executive.canNavPayout).toBe(false)       // default is true
    expect(map.manager).toEqual(DEFAULT_ROLES.manager)          // other roles untouched
    expect(get).not.toHaveBeenCalledWith('/api/settings/efin_role_permissions')
  })

  it('applies saved menu visibility for its own role and keeps other roles', async () => {
    get.mockImplementation(() => ok({ roleKey: 'sales_executive', permissions: null, menuVisibility: { tickets: false, reports: true } }))
    const vis = await permissionsApi.getMenuVisibility()
    expect(vis.tickets).not.toContain('sales_executive')
    expect(vis.tickets).toContain('manager')
    expect(vis.reports).toContain('sales_executive')
  })

  it('falls back to the defaults when the endpoint fails', async () => {
    get.mockImplementation(() => Promise.reject(new Error('403')))
    expect(await permissionsApi.getRolePermissions()).toEqual(DEFAULT_ROLES)
  })
})

describe('permissionsApi for an Admin session', () => {
  it('keeps reading the full saved matrix through the settings endpoint', async () => {
    get.mockReset(); loginAs('Admin')
    get.mockImplementation((url: string) => url === '/api/settings/efin_role_permissions'
      ? ok({ key: 'efin_role_permissions', value: JSON.stringify({ manager: { canNavUsers: false } }) })
      : Promise.reject(new Error('unexpected ' + url)))
    const map = await permissionsApi.getRolePermissions()
    expect(map.manager.canNavUsers).toBe(false)
    expect(get).not.toHaveBeenCalledWith('/api/users/me/permissions')
  })
})
