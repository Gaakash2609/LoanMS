import { describe, it, expect } from 'vitest'
import { BACKEND_TO_ROLE_KEY, DEFAULT_ROLES, ROLE_DISPLAY } from '@/constants/permissions'
import { ROLE_LABELS, roleTitle } from '@/pages/users/userConstants'

// Business-owner title rename (2026-09-24). Only display titles change —
// backend enum names and frontend RoleKey strings must stay exactly as they are.
const TITLES: Record<string, string> = {
  Admin: 'Chief Administrator',
  LocationHead: 'Zonal Manager',
  Manager: 'Business Development Manager',
  OperationManager: 'Credit Evaluation Manager',
  TeamLeader: 'Deputy Sales Manager',
  LoginTeam: 'Credit Evaluation Officer',
  Sales: 'Business Development Executive',
  Dsa: 'Mass Channel Partner',
  Partner: 'Channel Partner',
  Accounts: 'Payout & Reconciliation Officer',
  ProductTeam: 'Product & Risk Officer',
}

describe('role display titles', () => {
  it('keeps every backend enum name and RoleKey string unchanged', () => {
    expect(BACKEND_TO_ROLE_KEY).toEqual({
      Admin: 'admin', Manager: 'manager', Sales: 'sales_executive', Dsa: 'dsa_user', Partner: 'partner',
      LoginTeam: 'login_team', TeamLeader: 'team_leader', Accounts: 'accounts', LocationHead: 'location_head',
      OperationManager: 'operation_manager', ProductTeam: 'product_team',
    })
  })

  it('uses the new title in every role label map', () => {
    for (const [role, title] of Object.entries(TITLES)) {
      const key = BACKEND_TO_ROLE_KEY[role as keyof typeof BACKEND_TO_ROLE_KEY]
      expect(ROLE_LABELS[role]).toBe(title)
      expect(ROLE_DISPLAY[key].label).toBe(title)
      expect(DEFAULT_ROLES[key].label).toBe(title)
      expect(roleTitle(role)).toBe(title)
    }
  })

  it('falls back to the raw value for an unknown role', () => {
    expect(roleTitle('Mystery')).toBe('Mystery')
    expect(roleTitle(undefined)).toBe('')
  })
})
