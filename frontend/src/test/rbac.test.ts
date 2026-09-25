import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ROLES, BACKEND_TO_ROLE_KEY, NAV_PERM_KEY_BY_MENU_ID,
  type RoleKey,
} from '@/constants/permissions'
import { canAccessMenuItem, DOC_VERIFIER_ROLES } from '@/hooks/usePermissions'
import type { UserRole } from '@/types'

// The 11 backend roles, exactly as the app knows them. If a role is ever
// removed/renamed, the completeness test below fails loudly.
const ALL_BACKEND_ROLES: UserRole[] = [
  'Admin', 'Manager', 'Sales', 'Dsa', 'Partner', 'LoginTeam',
  'TeamLeader', 'Accounts', 'LocationHead', 'OperationManager', 'ProductTeam',
]

const rk = (r: UserRole): RoleKey => BACKEND_TO_ROLE_KEY[r]

// ─────────────────────────────────────────────────────────────────────────────
// Completeness — all 11 roles present, none removed, canVerifyDocs on every one
// ─────────────────────────────────────────────────────────────────────────────
describe('role model completeness (11 roles retained)', () => {
  it('maps every backend role to a default-roles record', () => {
    expect(ALL_BACKEND_ROLES).toHaveLength(11)
    for (const role of ALL_BACKEND_ROLES) {
      const key = rk(role)
      expect(key, `no role key for ${role}`).toBeTruthy()
      expect(DEFAULT_ROLES[key], `no default record for ${role}`).toBeDefined()
    }
  })

  it('defines a boolean canVerifyDocs on all 11 roles', () => {
    for (const role of ALL_BACKEND_ROLES) {
      expect(typeof DEFAULT_ROLES[rk(role)].canVerifyDocs, role).toBe('boolean')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// canAccessMenuItem — the pure nav-authorization function behaves correctly
// ─────────────────────────────────────────────────────────────────────────────
describe('canAccessMenuItem', () => {
  it('grants Admin every navigable menu', () => {
    for (const menuId of Object.keys(NAV_PERM_KEY_BY_MENU_ID)) {
      expect(canAccessMenuItem(menuId, 'Admin', DEFAULT_ROLES, undefined), menuId).toBe(true)
    }
  })

  it('faithfully returns each role’s nav flag for every navKey menu (all 11 roles)', () => {
    for (const role of ALL_BACKEND_ROLES) {
      if (role === 'Admin') continue // Admin is always-true by design
      const key = rk(role)
      for (const [menuId, navKey] of Object.entries(NAV_PERM_KEY_BY_MENU_ID)) {
        if (!navKey) continue
        const expected = DEFAULT_ROLES[key][navKey]
        expect(
          canAccessMenuItem(menuId, role, DEFAULT_ROLES, undefined),
          `${role} → ${menuId}`,
        ).toBe(expected)
      }
    }
  })

  it('falls back to Menu Access Control when a menu has no nav flag', () => {
    // 'lender-config' has no entry in NAV_PERM_KEY_BY_MENU_ID.
    const vis = { 'lender-config': ['manager'] as RoleKey[] }
    expect(canAccessMenuItem('lender-config', 'Manager', undefined, vis)).toBe(true)
    expect(canAccessMenuItem('lender-config', 'Sales', undefined, vis)).toBe(false)
  })

  it('returns undefined for an unknown/undefined role', () => {
    expect(canAccessMenuItem('payout', undefined, DEFAULT_ROLES, undefined)).toBeUndefined()
  })

  // Representative negative nav cases (data-backed, non-quirk cells).
  it('denies ProductTeam the Applications and Payout nav', () => {
    expect(canAccessMenuItem('applications', 'ProductTeam', DEFAULT_ROLES, undefined)).toBe(false)
    expect(canAccessMenuItem('payout', 'ProductTeam', DEFAULT_ROLES, undefined)).toBe(false)
  })

  it('denies Accounts the Applications nav but allows Payout nav', () => {
    expect(canAccessMenuItem('applications', 'Accounts', DEFAULT_ROLES, undefined)).toBe(false)
    expect(canAccessMenuItem('payout', 'Accounts', DEFAULT_ROLES, undefined)).toBe(true)
  })

  it('denies Users nav to non-admin operational roles', () => {
    for (const role of ['Sales', 'Manager', 'Accounts', 'LoginTeam'] as UserRole[]) {
      expect(canAccessMenuItem('users-mgmt', role, DEFAULT_ROLES, undefined), role).toBe(false)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Role permission matrix — positive + negative policy, all 11 roles
// ─────────────────────────────────────────────────────────────────────────────
describe('role permission matrix (positive + negative)', () => {
  type Flag = keyof typeof DEFAULT_ROLES['admin']
  const expectFlags = (role: UserRole, flags: Partial<Record<Flag, boolean>>) => {
    const rec = DEFAULT_ROLES[rk(role)]
    for (const [flag, val] of Object.entries(flags)) {
      expect(rec[flag as Flag], `${role}.${flag}`).toBe(val)
    }
  }

  it('Admin — full authority', () => {
    expectFlags('Admin', {
      canCreateApp: true, canChangeStatus: true, canDisburse: true,
      canDeviation: true, canVerifyDocs: true, canUploadDocs: true, canEditDetails: true,
    })
  })

  it('Sales — can originate, cannot process', () => {
    expectFlags('Sales', {
      canCreateApp: true,                        // positive
      canChangeStatus: false, canDisburse: false, canRejectApp: false,
      canDeviation: false, canVerifyDocs: false, // negatives
    })
  })

  it('DSA — originate + upload only', () => {
    expectFlags('Dsa', {
      canCreateApp: true, canUploadDocs: true, canPartnerView: true, // positive
      canChangeStatus: false, canVerifyDocs: false, canViewDocuments: false, // negative
    })
  })

  it('Partner — submit-only, masked, no processing', () => {
    expectFlags('Partner', {
      canCreateApp: true, canPartnerView: true, // positive
      canChangeStatus: false, canVerifyDocs: false, canUploadDocs: false,
      canEditDetails: false, // negative
    })
  })

  it('Accounts — finance only, no pipeline', () => {
    expectFlags('Accounts', {
      canNavPayout: true, // positive
      canNavApplications: false, canCreateApp: false, canVerifyDocs: false,
      canViewDocuments: false, canViewOverview: false, // negative
    })
  })

  it('ProductTeam — configuration plane, least privilege on loans', () => {
    expectFlags('ProductTeam', {
      canViewAccessRights: true, // positive
      canNavApplications: false, canNavPayout: false, canCreateApp: false,
      canViewOverview: false, canVerifyDocs: false, canViewDocuments: false, // negative
    })
  })

  // 2026-09-25 offer-workflow decision: Credit Evaluation Officer and Credit
  // Evaluation Manager are 2 of the 4 deviation / credit-approval / sanction /
  // disbursement authorities, so they may raise deviations too.
  it('LoginTeam — processing incl. verify, deviation + disbursement authority', () => {
    expectFlags('LoginTeam', {
      canCreateApp: true, canChangeStatus: true, canDisburse: true,
      canVerifyDocs: true, canUploadDocs: true, canDeviation: true, // positive
    })
  })

  it('TeamLeader — supervise + verify + raise deviation, cannot create/upload/disburse', () => {
    expectFlags('TeamLeader', {
      canChangeStatus: true, canDeviation: true, canVerifyDocs: true, // positive
      canCreateApp: false, canUploadDocs: false, canDisburse: false, // negative
    })
  })

  it('Manager — status + verify + raise deviation, cannot create/upload/disburse', () => {
    expectFlags('Manager', {
      canChangeStatus: true, canDeviation: true, canVerifyDocs: true, // positive
      canCreateApp: false, canUploadDocs: false, canDisburse: false, // negative
    })
  })

  it('LocationHead — full branch ownership incl. verify', () => {
    expectFlags('LocationHead', {
      canCreateApp: true, canChangeStatus: true, canDisburse: true,
      canVerifyDocs: true, canUploadDocs: true, // positive
    })
  })

  it('OperationManager — ops owner, verify, deviation + disbursement authority', () => {
    expectFlags('OperationManager', {
      canCreateApp: true, canChangeStatus: true, canDisburse: true,
      canVerifyDocs: true, canUploadDocs: true, canDeviation: true, // positive
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Document verifier gate — DOC_VERIFIER_ROLES + effective canVerifyDocs
// ─────────────────────────────────────────────────────────────────────────────
describe('DOC_VERIFIER_ROLES (mirror of backend role gate)', () => {
  const expectedVerifiers: UserRole[] = ['Admin', 'Manager', 'LoginTeam', 'TeamLeader', 'LocationHead', 'OperationManager']
  const expectedNonVerifiers: UserRole[] = ['Sales', 'Dsa', 'Partner', 'Accounts', 'ProductTeam']

  it('contains exactly the six processing/verifier roles', () => {
    expect([...DOC_VERIFIER_ROLES].sort()).toEqual([...expectedVerifiers].sort())
  })

  it('excludes every non-verifier role', () => {
    for (const role of expectedNonVerifiers) {
      expect(DOC_VERIFIER_ROLES.includes(role), role).toBe(false)
    }
  })
})

describe('effective canVerifyDocs gate for all 11 roles (role ∧ flag)', () => {
  // Mirrors useCanVerifyDocs(): inRole AND the canVerifyDocs flag.
  const effective = (role: UserRole) =>
    DOC_VERIFIER_ROLES.includes(role) && DEFAULT_ROLES[rk(role)].canVerifyDocs

  const expected: Record<UserRole, boolean> = {
    Admin: true, Manager: true, LoginTeam: true, TeamLeader: true,
    LocationHead: true, OperationManager: true,
    Sales: false, Dsa: false, Partner: false, Accounts: false, ProductTeam: false,
  }

  for (const role of ALL_BACKEND_ROLES) {
    it(`${role} → ${expected[role]}`, () => {
      expect(effective(role)).toBe(expected[role])
    })
  }
})
