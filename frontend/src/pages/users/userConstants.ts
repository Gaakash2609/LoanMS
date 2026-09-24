// Users page constants + pure helpers — extracted verbatim from UsersPage.tsx
// (code-quality refactor, no behaviour change).

import type { UserRole } from '@/types'


// Legacy display labels for the role enum (efin-app.js ROLES[].label) — e.g.
// the Sales enum shows as "Sales Person", Dsa as "DSA User", etc.
export const ROLE_LABELS: Record<string, string> = {
  Admin: 'Admin', Manager: 'Manager', Sales: 'Sales Person', Dsa: 'DSA User',
  Partner: 'Partner', LoginTeam: 'Login Team', TeamLeader: 'Team Leader',
  Accounts: 'Accounts', LocationHead: 'Location Head',
  OperationManager: 'Operation Manager', ProductTeam: 'Product Team',
}

// Role → colour. The generic <Badge> component only has 5 variants
// (default/success/warning/danger/info), so mapping all 11 roles onto it
// left 7 of them (Dsa, LoginTeam, TeamLeader, Accounts, LocationHead,
// OperationManager, ProductTeam) sharing the exact same neutral-gray
// "default" pill — every non-Admin/Manager/Sales/Partner user looked
// identical at a glance in the table. This gives every role its own colour
// (Admin/Manager/Sales keep the app's own brand tokens; the rest get a
// distinct hue each), same visual language as STATUS_COLORS/UserPill.
export const ROLE_COLORS: Record<string, string> = {
  Admin: 'var(--accent)', Manager: 'var(--success)', Sales: 'var(--warn)',
  Dsa: '#7c3aed', Partner: '#64748b', LoginTeam: '#0891b2',
  TeamLeader: '#e11d48', Accounts: '#65a30d', LocationHead: '#0d9488',
  OperationManager: '#4f46e5', ProductTeam: '#c026d3',
}

// Full 11-role set from LoanMS.Domain.Enums.UserRole (see usersApi.ts's
// CreateUserRequest/UpdateUserRequest doc-comment) — the same set Employee
// Code generation and the legacy Users form already support.
export const ALL_ROLES: UserRole[] = [
  'Admin', 'Manager', 'Sales', 'Dsa', 'Partner',
  'LoginTeam', 'TeamLeader', 'Accounts', 'LocationHead', 'OperationManager', 'ProductTeam',
]

// Form shape mirrors legacy's tw-user-modal fields (efin-app.js twSaveUser):
// name, email, password, mobile, role, status + primary Location / Sales-Team /
// Operation-Team single-selects. All backend-backed (Create/UpdateUserRequestDto).
export const EMPTY_FORM = {
  fullName: '', email: '', password: '', role: 'Sales' as UserRole, phoneNumber: '',
  locationName: '', salesTeam: '', opTeam: '', isActive: true,
}
export const PAGE_SIZE = 20

// Row avatar — legacy renders a coloured initials circle in the Name column of
// the Users table. Colour is deterministic from the name so a user keeps the
// same badge colour across renders.
export const AVATAR_COLORS = ['#1a4fa3', '#7c3aed', '#1a7340', '#e31e25', '#d97706', '#0284c7', '#be185d', '#0f766e']
export function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}
export function userInitials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'
}
