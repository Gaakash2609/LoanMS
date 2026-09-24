// Ported from LoanMS.API/wwwroot/js/efin-app.js — the legacy `ROLES` const
// (lines 160-629), `NON_ADMIN_ROLES` (line 5997), `ALL_MENU_ITEMS`
// (lines 771-795), `MASTER_PERM_GROUPS` (lines 5950-5995), the Permission
// Matrix's `allPerms` list (lines 5883-5947, inside renderAccessRights()),
// and `twSecGroups` (lines 24317-24326). Field names, values, and role
// order are transcribed verbatim so the React "Roles & Permissions" tab is
// a byte-accurate port, not a re-authored approximation.
import type { UserRole } from '@/types'

export type RoleKey =
  | 'admin' | 'login_team' | 'team_leader' | 'sales_executive' | 'accounts'
  | 'partner' | 'location_head' | 'manager' | 'operation_manager'
  | 'dsa_user' | 'product_team'

// efin-app.js:769 — includes admin.
export const ALL_ROLE_KEYS: RoleKey[] = [
  'admin', 'manager', 'team_leader', 'login_team', 'operation_manager',
  'location_head', 'sales_executive', 'dsa_user', 'partner', 'accounts', 'product_team',
]

// efin-app.js:5997 — excludes admin. Different element order than ALL_ROLE_KEYS
// (kept as-is, matches source — this is the iteration order Admin Master
// Control renders its per-role cards in).
export const NON_ADMIN_ROLE_KEYS: RoleKey[] = [
  'login_team', 'team_leader', 'sales_executive', 'accounts',
  'partner', 'location_head', 'manager', 'operation_manager', 'dsa_user', 'product_team',
]

// api-bridge.js:18-23 — backend PascalCase UserRole <-> frontend snake_case
// role key used throughout ROLES/menu-visibility.
export const BACKEND_TO_ROLE_KEY: Record<UserRole, RoleKey> = {
  Admin: 'admin', Manager: 'manager', Sales: 'sales_executive', Dsa: 'dsa_user',
  Partner: 'partner', LoginTeam: 'login_team', TeamLeader: 'team_leader',
  Accounts: 'accounts', LocationHead: 'location_head',
  OperationManager: 'operation_manager', ProductTeam: 'product_team',
}

// efin-app.js:812-824 — used by the Menu Access Control role-column header.
export const ROLE_DISPLAY: Record<RoleKey, { label: string; color: string; bg: string }> = {
  admin:             { label: 'Admin',         color: '#7c3aed', bg: 'rgba(124,58,237,.1)' },
  manager:           { label: 'Manager',       color: '#1a4fa3', bg: 'rgba(26,79,163,.1)' },
  team_leader:       { label: 'Team Lead',     color: '#0369a1', bg: 'rgba(3,105,161,.1)' },
  login_team:        { label: 'Login Team',    color: '#0f766e', bg: 'rgba(15,118,110,.1)' },
  operation_manager: { label: 'Ops Manager',   color: '#0f766e', bg: 'rgba(15,118,110,.1)' },
  location_head:     { label: 'Location Head', color: '#7c3aed', bg: 'rgba(124,58,237,.1)' },
  sales_executive:   { label: 'Sales',         color: '#b45309', bg: 'rgba(180,83,9,.1)' },
  dsa_user:          { label: 'DSA',           color: '#be185d', bg: 'rgba(190,24,93,.1)' },
  partner:           { label: 'Partner',       color: '#be185d', bg: 'rgba(190,24,93,.1)' },
  accounts:          { label: 'Accounts',      color: '#059669', bg: 'rgba(5,150,105,.1)' },
  product_team:      { label: 'Product Team',  color: '#db2777', bg: 'rgba(236,72,153,.1)' },
}

// The boolean permission flags every role carries. `canManagePayouts` and
// `canNavSecurity` are genuinely absent (undefined) on several roles in the
// legacy source — not every role sets every key. (`canNavWebhook` used to be
// listed here too but has been retired: nothing in this app's navigation
// consumes it — webhook logs are Admin-only inside Settings — so it was a
// dead configurable permission and is gone from the menu grid, the master
// control grid, the menu→perm map, and this interface.)
export interface RolePermissionFlags {
  canCreateApp: boolean; canChangeStatus: boolean; canRejectApp: boolean
  canHoldApp: boolean; canDisburse: boolean; canDeviation: boolean
  canViewOverview: boolean
  canViewPersonal: boolean; canMaskPersonal: boolean
  canViewAddress: boolean
  canViewEmployment: boolean
  canViewReferences: boolean
  canViewDocuments: boolean; canUploadDocs: boolean
  // Phase 3 (RBAC) — mirrors the Phase 2 backend `canVerifyDocs` permission key
  // consumed by PATCH /loans/{id}/documents/{docId}/verify|reject. Distinct
  // from canUploadDocs (upload/replace/delete) — this governs the review action
  // (Verify / Reject). The backend also role-gates verify/reject to the
  // processing roles, so the UI mirrors BOTH (role set + this flag).
  canVerifyDocs: boolean
  canViewBanks: boolean; canAddBank: boolean
  canViewIncred: boolean
  canViewTracking: boolean; canPostTracking: boolean; canEditTracking: boolean; canDeleteTracking: boolean
  canViewTasks: boolean; canManageTasks: boolean
  canViewObligations: boolean; canEditObligations: boolean
  canViewReports: boolean; canViewAccessRights: boolean
  canPartnerView: boolean
  canEditDetails: boolean
  // RETIRED (kept optional/inert only so the per-role default objects that
  // still list it type-check): no React component or backend endpoint reads
  // canManagePayouts — payout management is governed by fixed roles on both
  // sides (PayoutPage's role checks / PayoutController's
  // [Authorize(Roles="Admin,Accounts")]). It was a dead configurable
  // permission, so it's been removed from the Master Control and permission-
  // reference editors; toggling it did nothing.
  canManagePayouts?: boolean
  canTabOverview: boolean; canTabPersonal: boolean; canTabAddress: boolean; canTabEmployment: boolean; canTabReferences: boolean
  canTabDocuments: boolean; canTabLenderDetails: boolean; canTabTimeline: boolean; canTabTasks: boolean; canTabObligations: boolean; canTabReports: boolean
  canNavOverview: boolean; canNavApplications: boolean; canNavRegisterNew: boolean; canNavCalculator: boolean; canNavTasks: boolean; canNavPayout: boolean
  canNavBanks: boolean; canNavIncred: boolean; canNavDSA: boolean; canNavPartner: boolean
  canNavTeamOverview: boolean; canNavSalesTeams: boolean; canNavLoginTeams: boolean; canNavLocations: boolean; canNavUsers: boolean
  canNavReports: boolean; canNavTickets: boolean
  canNavSecurity?: boolean
}

export interface RoleRecord extends RolePermissionFlags {
  label: string; key: string; icon: string; color: string; textColor: string
  badgeClass: string; dept: string
  desc: string; scope: string; teamSize: string
  responsibilities: string[]; restrictions: string[]
}

// efin-app.js:160-629, transcribed verbatim (values, not paraphrased).
export const DEFAULT_ROLES: Record<RoleKey, RoleRecord> = {
  admin: {
    label: 'Admin', key: 'group_location_manager / group_location_user',
    icon: '🔑', color: 'rgba(26,79,163,.12)', textColor: 'var(--accent)',
    badgeClass: 'role-badge-admin', dept: 'Admin',
    canCreateApp: true, canChangeStatus: true,
    canRejectApp: true, canHoldApp: true, canDisburse: true, canDeviation: true,
    canViewOverview: true,
    canViewPersonal: true, canMaskPersonal: false,
    canViewAddress: true,
    canViewEmployment: true,
    canViewReferences: true,
    canViewDocuments: true, canUploadDocs: true,
    canVerifyDocs: true,
    canViewBanks: true, canAddBank: true,
    canViewIncred: true,
    canViewTracking: true, canPostTracking: true, canEditTracking: true, canDeleteTracking: true,
    canViewTasks: true, canManageTasks: true,
    canViewObligations: true, canEditObligations: true,
    canViewReports: true, canViewAccessRights: true,
    canPartnerView: true,
    canEditDetails: true,
    canTabOverview: true, canTabPersonal: true, canTabAddress: true, canTabEmployment: true, canTabReferences: true,
    canTabDocuments: true, canTabLenderDetails: true, canTabTimeline: true, canTabTasks: true, canTabObligations: true, canTabReports: true,
    canNavOverview: true, canNavApplications: true, canNavRegisterNew: true, canNavCalculator: true, canNavTasks: true, canNavPayout: true,
    canNavBanks: true, canNavIncred: true, canNavDSA: true, canNavPartner: true,
    canNavTeamOverview: true, canNavSalesTeams: true, canNavLoginTeams: true, canNavLocations: true, canNavUsers: true,
    canNavReports: true, canNavTickets: true,
    desc: 'Location Head / Admin — the super-administrator role with unrestricted system access. Can manage the entire loan lifecycle across all locations, teams, and product lines, override policy rules, reassign work, and configure master data.',
    scope: 'Location-wide or Enterprise-wide',
    teamSize: 'Senior leadership (typically 1–3 per location)',
    responsibilities: [
      'Full CRUD on all loan applications across every pipeline stage',
      'Approve, Reject, Hold, Disburse, and raise / clear Deviations',
      'Edit application details at any stage (changes logged silently)',
      'Configure Policies & Roles, First Offer Matrix, Loan Form Dropdowns',
      'Manage Users, Locations, Sales Teams, Login Teams, DSAs & Partners',
      'View system-wide reports and unmask sensitive PII (PAN / Aadhaar)',
    ],
    restrictions: [
      'Destructive actions on disbursed applications require deviation workflow',
      'Audit log captures every override — accountable to compliance team',
    ],
  },
  login_team: {
    label: 'Login Team', key: 'group_login_team_user',
    icon: '📋', color: 'rgba(227,30,37,.1)', textColor: 'var(--accent2)',
    badgeClass: 'role-badge-login', dept: 'Login Dep',
    canCreateApp: true, canChangeStatus: true,
    canRejectApp: true, canHoldApp: true, canDisburse: true, canDeviation: false,
    canViewOverview: true,
    canViewPersonal: true, canMaskPersonal: false,
    canViewAddress: true,
    canViewEmployment: true,
    canViewReferences: true,
    canViewDocuments: true, canUploadDocs: true,
    canVerifyDocs: true,
    canViewBanks: true, canAddBank: false,
    canViewIncred: true,
    canViewTracking: true, canPostTracking: true, canEditTracking: false, canDeleteTracking: false,
    canViewTasks: true, canManageTasks: true,
    canViewObligations: true, canEditObligations: true,
    canViewReports: true, canViewAccessRights: false,
    canPartnerView: false,
    canEditDetails: true,
    canTabOverview: true, canTabPersonal: true, canTabAddress: true, canTabEmployment: true, canTabReferences: true,
    canTabDocuments: true, canTabLenderDetails: true, canTabTimeline: true, canTabTasks: true, canTabObligations: true, canTabReports: true,
    canNavOverview: true, canNavApplications: true, canNavRegisterNew: true, canNavCalculator: true, canNavTasks: true, canNavPayout: true,
    canNavBanks: false, canNavIncred: true, canNavDSA: false, canNavPartner: false,
    canNavTeamOverview: false, canNavSalesTeams: false, canNavLoginTeams: false, canNavLocations: false, canNavUsers: false,
    canNavReports: true, canNavTickets: true,
    desc: 'Operations / Login Desk — front-line processing team responsible for receiving, logging and moving applications through verification, underwriting, and disbursement. Primary owner of daily case-flow.',
    scope: 'Assigned Location(s)',
    teamSize: 'Medium team (typically 5–15 per location)',
    responsibilities: [
      'Create new applications and capture applicant details',
      'Move applications through Login → Underwriting → Approved → Disbursed',
      'Post tracking entries (FI Report, NACH, Agreement, etc.)',
      'Upload documents, edit obligations, run Income / Bank / ECS checks',
      'Assign tasks to team members (Detail Verification, PD, CAD, etc.)',
      'Raise Hold / Reject with justification',
    ],
    restrictions: [
      'Cannot add new banks to the master eligibility list',
      'Cannot approve their own deviations — must route to Team Leader / Admin',
      'Cannot edit tracking records after they are posted',
      'No access to Policies & Roles or system-wide Reports',
    ],
  },
  team_leader: {
    label: 'Team Leader', key: 'group_team_leader_manager',
    icon: '👥', color: 'rgba(161,89,255,.12)', textColor: '#a159ff',
    badgeClass: 'role-badge-tl', dept: 'Team Dep',
    canCreateApp: false, canChangeStatus: true,
    canRejectApp: true, canHoldApp: true, canDisburse: true, canDeviation: true,
    canViewOverview: true,
    canViewPersonal: true, canMaskPersonal: false,
    canViewAddress: true,
    canViewEmployment: true,
    canViewReferences: true,
    canViewDocuments: true, canUploadDocs: false,
    canVerifyDocs: true,
    canViewBanks: true, canAddBank: false,
    canViewIncred: true,
    canViewTracking: true, canPostTracking: true, canEditTracking: false, canDeleteTracking: false,
    canViewTasks: true, canManageTasks: true,
    canViewObligations: true, canEditObligations: true,
    canViewReports: true, canViewAccessRights: false,
    canPartnerView: false,
    canEditDetails: true,
    canTabOverview: true, canTabPersonal: true, canTabAddress: true, canTabEmployment: true, canTabReferences: true,
    canTabDocuments: true, canTabLenderDetails: true, canTabTimeline: true, canTabTasks: true, canTabObligations: true, canTabReports: true,
    canNavOverview: true, canNavApplications: true, canNavRegisterNew: false, canNavCalculator: true, canNavTasks: true, canNavPayout: true,
    canNavBanks: true, canNavIncred: true, canNavDSA: false, canNavPartner: false,
    canNavTeamOverview: true, canNavSalesTeams: false, canNavLoginTeams: false, canNavLocations: false, canNavUsers: false,
    canNavReports: true, canNavTickets: true,
    desc: 'Operations Manager / Team Leader — supervises one or more Login Teams, approves deviations, ensures SLA compliance, and manages escalations. Bridges front-line operations with management.',
    scope: 'Multiple teams within a Location',
    teamSize: 'Middle management (typically 1–2 per location)',
    responsibilities: [
      'Supervise case flow and SLA adherence across reporting teams',
      'Approve / Skip Deviations raised by Login Team',
      'Change loan status, reject, hold, and approve disbursement',
      'Assign and reassign tasks across team members',
      'View all pipeline tabs including Bank Details and InCred (read-only)',
      'Generate and review operational reports',
    ],
    restrictions: [
      'Cannot create new applications — ops team owns that flow',
      'Bank Details and InCred integration are read-only (configured by Admin)',
      'Cannot upload new documents — only review and approve',
      'No access to Policies & Roles master configuration',
    ],
  },
  sales_executive: {
    label: 'Sales Person', key: 'group_sales_executive_manager',
    icon: '💼', color: 'rgba(255,107,53,.12)', textColor: 'var(--accent3)',
    badgeClass: 'role-badge-sales', dept: 'Sales Dep',
    canCreateApp: true, canChangeStatus: false,
    canRejectApp: false, canHoldApp: false, canDisburse: false, canDeviation: false,
    canViewOverview: true,
    canViewPersonal: true, canMaskPersonal: false,
    canViewAddress: true,
    canViewEmployment: true,
    canViewReferences: true,
    canViewDocuments: true, canUploadDocs: true,
    canVerifyDocs: false,
    canViewBanks: false, canAddBank: false,
    canViewIncred: false,
    canViewTracking: true, canPostTracking: true, canEditTracking: false, canDeleteTracking: false,
    canViewTasks: false, canManageTasks: false,
    canViewObligations: true, canEditObligations: false,
    canViewReports: false, canViewAccessRights: false,
    canPartnerView: false,
    canEditDetails: true,
    canTabOverview: true, canTabPersonal: true, canTabAddress: true, canTabEmployment: true, canTabReferences: true,
    canTabDocuments: true, canTabLenderDetails: false, canTabTimeline: true, canTabTasks: false, canTabObligations: true, canTabReports: false,
    canNavOverview: true, canNavApplications: true, canNavRegisterNew: true, canNavCalculator: true, canNavTasks: false, canNavPayout: true,
    canNavBanks: false, canNavIncred: false, canNavDSA: false, canNavPartner: false,
    canNavTeamOverview: false, canNavSalesTeams: false, canNavLoginTeams: false, canNavLocations: false, canNavUsers: false,
    canNavReports: false, canNavTickets: true,
    desc: 'Sales Person — field / branch sales team that originates applications, collects applicant KYC and income documents, and hands off to Operations. Focused on customer acquisition, not processing.',
    scope: 'Their own book of originated applications',
    teamSize: 'Large team (typically 20–100+ per region)',
    responsibilities: [
      'Source and onboard new customers — create fresh applications',
      'Capture applicant profile, employment, and reference details',
      'Upload required documents during origination',
      'Update Approval Details (CAM) — partner-editable section',
      'Post tracking entries (customer communication, follow-ups)',
      'Run Income Check, Bank Details Check, ECS Return on own applications',
    ],
    restrictions: [
      'Cannot move applications forward — Ops owns workflow transitions',
      'Cannot Approve, Reject, Hold, or Disburse',
      'Bank / InCred / Tasks tabs are hidden entirely',
      'Obligations tab is view-only',
      'No access to Reports or Policies & Roles',
    ],
  },
  accounts: {
    label: 'Accounts', key: 'group_accounts_user',
    icon: '🧾', color: 'rgba(16,185,129,.12)', textColor: '#059669',
    badgeClass: 'role-badge-accounts', dept: 'Accounts Dep',
    canCreateApp: false, canChangeStatus: false,
    canRejectApp: false, canHoldApp: false, canDisburse: false, canDeviation: false,
    canViewOverview: false,
    canViewPersonal: false, canMaskPersonal: true,
    canViewAddress: false,
    canViewEmployment: false,
    canViewReferences: false,
    canViewDocuments: false, canUploadDocs: false,
    canVerifyDocs: false,
    canViewBanks: false, canAddBank: false,
    canViewIncred: false,
    canViewTracking: false, canPostTracking: false, canEditTracking: false, canDeleteTracking: false,
    canViewTasks: false, canManageTasks: false,
    canViewObligations: true, canEditObligations: true,
    canViewReports: false, canViewAccessRights: false,
    canPartnerView: false,
    canManagePayouts: true,
    canEditDetails: false,
    canTabOverview: false, canTabPersonal: false, canTabAddress: false, canTabEmployment: false, canTabReferences: false,
    canTabDocuments: false, canTabLenderDetails: false, canTabTimeline: false, canTabTasks: false, canTabObligations: true, canTabReports: false,
    canNavOverview: false, canNavApplications: false, canNavRegisterNew: false, canNavCalculator: false, canNavTasks: false, canNavPayout: true,
    canNavBanks: false, canNavIncred: false, canNavDSA: false, canNavPartner: false,
    canNavTeamOverview: false, canNavSalesTeams: false, canNavLoginTeams: false, canNavLocations: false, canNavUsers: false,
    canNavReports: false, canNavTickets: true,
    desc: 'Accounts / Finance team — post-disbursement back-office role that reconciles payouts, processes partner commission claims, and maintains financial records. Does not see loan processing details.',
    scope: 'Finance function — cross-location payout visibility',
    teamSize: 'Small dedicated team (typically 3–8 across the organisation)',
    responsibilities: [
      'Review and approve / reject partner payout claims',
      'Update payout disbursement status (Pending → Paid / Hold / On-Hold)',
      'Maintain obligation records for all applications',
      'Reconcile disbursed amounts against lender reports',
      'Generate finance-specific reports for audit trail',
    ],
    restrictions: [
      'No visibility into applicant KYC, Employment, Address, References',
      'Cannot view the loan pipeline — Dashboard, Applications, Tasks hidden',
      'Cannot edit loan application details or change status',
      'PAN / Aadhaar fields always masked if accidentally surfaced',
      'Access confined to payout / obligation modules only',
    ],
  },
  partner: {
    label: 'Partner', key: 'group_sales_partner_user',
    icon: '🤝', color: 'rgba(138,150,180,.1)', textColor: '#8a96b4',
    badgeClass: 'role-badge-partner', dept: 'Partner Dep',
    canCreateApp: true, canChangeStatus: false,
    canRejectApp: false, canHoldApp: false, canDisburse: false, canDeviation: false,
    canViewOverview: true,
    canViewPersonal: true, canMaskPersonal: true,
    canViewAddress: true,
    canViewEmployment: false,
    canViewReferences: false,
    canViewDocuments: false, canUploadDocs: false,
    canVerifyDocs: false,
    canViewBanks: false, canAddBank: false,
    canViewIncred: false,
    canViewTracking: true, canPostTracking: false, canEditTracking: false, canDeleteTracking: false,
    canViewTasks: false, canManageTasks: false,
    canViewObligations: true, canEditObligations: false,
    canViewReports: false, canViewAccessRights: false,
    canPartnerView: true, canManagePayouts: false,
    canEditDetails: false,
    canTabOverview: true, canTabPersonal: true, canTabAddress: true, canTabEmployment: false, canTabReferences: false,
    canTabDocuments: false, canTabLenderDetails: false, canTabTimeline: true, canTabTasks: false, canTabObligations: true, canTabReports: false,
    canNavOverview: true, canNavApplications: true, canNavRegisterNew: true, canNavCalculator: true, canNavTasks: false, canNavPayout: true,
    canNavBanks: false, canNavIncred: false, canNavDSA: false, canNavPartner: false,
    canNavTeamOverview: false, canNavSalesTeams: false, canNavLoginTeams: false, canNavLocations: false, canNavUsers: false,
    canNavReports: false, canNavTickets: true,
    desc: 'DSA / Channel Partner — external agents or partner organisations who refer customers. View-only access limited to their own referred applications, with all sensitive data masked for compliance.',
    scope: 'Only their own referred / sourced applications',
    teamSize: 'External network (DSAs, referral partners, channel agents)',
    responsibilities: [
      'Submit new customer applications via partner channel',
      'View status and timeline of own referred cases',
      'Update Approval Details / CAM once shared by Operations',
      'Track their own disbursed volume and payout pipeline',
    ],
    restrictions: [
      'PAN and Aadhaar numbers are always masked — compliance requirement',
      'Employment, References, Documents, Banking, InCred, Tasks tabs hidden',
      'Cannot edit application details — submission only, no post-edit',
      'Cannot change loan status, reject, hold, or disburse',
      'Cannot post or edit tracking entries',
      'Obligations are view-only',
      'Sees only applications tagged with their partner ID',
    ],
  },
  location_head: {
    label: 'Location Head', key: 'group_location_head_user',
    icon: '🏢', color: 'rgba(16,185,129,.12)', textColor: '#059669',
    badgeClass: 'role-badge-admin', dept: 'Admin',
    canCreateApp: true, canChangeStatus: true,
    canRejectApp: true, canHoldApp: true, canDisburse: true, canDeviation: true,
    canViewOverview: true, canViewPersonal: true, canMaskPersonal: false,
    canViewAddress: true, canViewEmployment: true, canViewReferences: true,
    canViewDocuments: true, canUploadDocs: true,
    canVerifyDocs: true,
    canViewBanks: true, canAddBank: true,
    canViewIncred: true,
    canViewTracking: true, canPostTracking: true, canEditTracking: true, canDeleteTracking: true,
    canViewTasks: true, canManageTasks: true,
    canViewObligations: true, canEditObligations: true,
    canViewReports: true, canViewAccessRights: false,
    canPartnerView: true, canEditDetails: true, canManagePayouts: false,
    canTabOverview: true, canTabPersonal: true, canTabAddress: true, canTabEmployment: true, canTabReferences: true,
    canTabDocuments: true, canTabLenderDetails: true, canTabTimeline: true, canTabTasks: true, canTabObligations: true, canTabReports: true,
    canNavOverview: true, canNavApplications: true, canNavRegisterNew: true, canNavCalculator: true, canNavTasks: true, canNavPayout: true,
    canNavBanks: true, canNavIncred: true, canNavDSA: true, canNavPartner: true,
    canNavTeamOverview: true, canNavSalesTeams: true, canNavLoginTeams: true, canNavLocations: true, canNavUsers: true,
    canNavReports: true, canNavTickets: true,
    scope: 'Single Location — full ownership',
    teamSize: 'Senior management (1 per location)',
    responsibilities: [
      'Full loan lifecycle management within assigned location',
      'Approve, reject, hold, disburse — all workflow actions',
      'Manage teams, assign tasks, post and edit tracking entries',
      'View full applicant details including unmasked PAN / Aadhaar',
      'Configure location-level bank eligibility and team structure',
    ],
    restrictions: [
      'Cannot access or modify Policies & Roles configuration',
      'Scope limited to own location — cannot see other branches',
    ],
    desc: 'Location Head — owns the full loan operations for a single branch. All pipeline actions available. Cannot configure system-wide Policies & Roles.',
  },
  manager: {
    label: 'Manager', key: 'group_manager_user',
    icon: '👔', color: 'rgba(245,158,11,.12)', textColor: '#b45309',
    badgeClass: 'role-badge-tl', dept: 'Team Dep',
    canCreateApp: false, canChangeStatus: true,
    canRejectApp: true, canHoldApp: true, canDisburse: true, canDeviation: true,
    canViewOverview: true, canViewPersonal: true, canMaskPersonal: false,
    canViewAddress: true, canViewEmployment: true, canViewReferences: true,
    canViewDocuments: true, canUploadDocs: false,
    canVerifyDocs: true,
    canViewBanks: true, canAddBank: false,
    canViewIncred: true,
    canViewTracking: true, canPostTracking: true, canEditTracking: false, canDeleteTracking: false,
    canViewTasks: true, canManageTasks: true,
    canViewObligations: true, canEditObligations: true,
    canViewReports: true, canViewAccessRights: false,
    canPartnerView: false, canEditDetails: true, canManagePayouts: false,
    canTabOverview: true, canTabPersonal: true, canTabAddress: true, canTabEmployment: true, canTabReferences: true,
    canTabDocuments: true, canTabLenderDetails: true, canTabTimeline: true, canTabTasks: true, canTabObligations: true, canTabReports: true,
    canNavOverview: true, canNavApplications: true, canNavRegisterNew: false, canNavCalculator: true, canNavTasks: true, canNavPayout: true,
    canNavBanks: true, canNavIncred: true, canNavDSA: false, canNavPartner: false,
    canNavTeamOverview: true, canNavSalesTeams: false, canNavLoginTeams: false, canNavLocations: false, canNavUsers: false,
    canNavReports: true, canNavTickets: true,
    scope: 'Multi-team within a Location',
    teamSize: 'Mid-level (1–3 per location)',
    responsibilities: [
      'Oversee multiple processing and sales teams',
      'Approve deviations, change status, reject and hold',
      'Assign tasks across reporting teams',
      'Review and manage pipeline SLAs and bottlenecks',
      'Access all tabs read-write except document upload',
    ],
    restrictions: [
      'Cannot create new applications',
      'Cannot upload documents',
      'Cannot add banks to master list',
      'No access to Policies & Roles or system configuration',
    ],
    desc: 'Manager — oversees multiple teams, approves deviations and manages pipeline. Cannot create applications or upload documents.',
  },
  operation_manager: {
    label: 'Operation Manager', key: 'group_operation_manager_user',
    icon: '⚙️', color: 'rgba(79,70,229,.12)', textColor: '#4338ca',
    badgeClass: 'role-badge-tl', dept: 'Login Dep',
    canCreateApp: true, canChangeStatus: true,
    canRejectApp: true, canHoldApp: true, canDisburse: true, canDeviation: false,
    canViewOverview: true, canViewPersonal: true, canMaskPersonal: false,
    canViewAddress: true, canViewEmployment: true, canViewReferences: true,
    canViewDocuments: true, canUploadDocs: true,
    canVerifyDocs: true,
    canViewBanks: true, canAddBank: false,
    canViewIncred: true,
    canViewTracking: true, canPostTracking: true, canEditTracking: false, canDeleteTracking: false,
    canViewTasks: true, canManageTasks: true,
    canViewObligations: true, canEditObligations: true,
    canViewReports: true, canViewAccessRights: false,
    canPartnerView: false, canEditDetails: true, canManagePayouts: false,
    canTabOverview: true, canTabPersonal: true, canTabAddress: true, canTabEmployment: true, canTabReferences: true,
    canTabDocuments: true, canTabLenderDetails: true, canTabTimeline: true, canTabTasks: true, canTabObligations: true, canTabReports: true,
    canNavOverview: true, canNavApplications: true, canNavRegisterNew: true, canNavCalculator: true, canNavTasks: true, canNavPayout: true,
    canNavBanks: true, canNavIncred: true, canNavDSA: false, canNavPartner: false,
    canNavTeamOverview: true, canNavSalesTeams: false, canNavLoginTeams: false, canNavLocations: false, canNavUsers: false,
    canNavReports: true, canNavTickets: true,
    scope: 'Operations department — all processing teams',
    teamSize: 'Senior ops lead (1–2 per location)',
    responsibilities: [
      'Direct ownership of the Login Team operations',
      'Create, move and manage applications end-to-end',
      'Assign tasks, manage obligations, run bank and income checks',
      'Post tracking entries and review full audit trail',
      'View all loan pipeline tabs including Bank and InCred',
    ],
    restrictions: [
      'Cannot approve deviations — must route to Manager / Admin',
      'Cannot add banks to master eligibility list',
      'Cannot edit posted tracking entries',
    ],
    desc: 'Operation Manager — senior ops lead who owns the Login Team workflow. Full pipeline access except deviation approvals.',
  },
  dsa_user: {
    label: 'DSA User', key: 'group_dsa_user',
    icon: '🤝', color: 'rgba(245,158,11,.1)', textColor: '#d97706',
    badgeClass: 'role-badge-sales', dept: 'Sales Exe. Dep',
    canCreateApp: true, canChangeStatus: false,
    canRejectApp: false, canHoldApp: false, canDisburse: false, canDeviation: false,
    canViewOverview: true, canViewPersonal: true, canMaskPersonal: true,
    canViewAddress: true, canViewEmployment: false,
    canViewReferences: false,
    canViewDocuments: false, canUploadDocs: true,
    canVerifyDocs: false,
    canViewBanks: false, canAddBank: false,
    canViewIncred: false,
    canViewTracking: true, canPostTracking: false, canEditTracking: false, canDeleteTracking: false,
    canViewTasks: false, canManageTasks: false,
    canViewObligations: true, canEditObligations: false,
    canViewReports: false, canViewAccessRights: false,
    canPartnerView: true, canEditDetails: false, canManagePayouts: false,
    canTabOverview: true, canTabPersonal: true, canTabAddress: true, canTabEmployment: false, canTabReferences: false,
    canTabDocuments: true, canTabLenderDetails: false, canTabTimeline: true, canTabTasks: false, canTabObligations: true, canTabReports: false,
    canNavOverview: true, canNavApplications: true, canNavRegisterNew: true, canNavCalculator: true, canNavTasks: false, canNavPayout: true,
    canNavBanks: false, canNavIncred: false, canNavDSA: false, canNavPartner: false,
    canNavTeamOverview: false, canNavSalesTeams: false, canNavLoginTeams: false, canNavLocations: false, canNavUsers: false,
    canNavReports: false, canNavTickets: true,
    scope: 'Own referred applications only',
    teamSize: 'External DSA network',
    responsibilities: [
      'Submit new customer applications via DSA channel',
      'Upload KYC and required documents at origination',
      'Track status of own referred applications',
      'View Obligations (read-only) for disbursed cases',
    ],
    restrictions: [
      'PAN and Aadhaar always masked',
      'Cannot view Employment, References, Banking tabs',
      'Cannot change status, post tracking, or run checks',
      'Sees only own DSA-tagged applications',
    ],
    desc: 'DSA User — external DSA agent who submits and tracks their own referred customers. Masked sensitive data, view-only pipeline.',
  },
  product_team: {
    label: 'Product Team', key: 'group_product_team_user',
    icon: '🛠️', color: 'rgba(236,72,153,.12)', textColor: '#db2777',
    badgeClass: 'role-badge-product', dept: 'Product Team',
    canCreateApp: false, canChangeStatus: false,
    canRejectApp: false, canHoldApp: false, canDisburse: false, canDeviation: false,
    canViewOverview: false,
    canViewPersonal: false, canMaskPersonal: false,
    canViewAddress: false,
    canViewEmployment: false,
    canViewReferences: false,
    canViewDocuments: false, canUploadDocs: false,
    canVerifyDocs: false,
    canViewBanks: false, canAddBank: false,
    canViewIncred: false,
    canViewTracking: false, canPostTracking: false, canEditTracking: false, canDeleteTracking: false,
    canViewTasks: false, canManageTasks: false,
    canViewObligations: false, canEditObligations: false,
    canViewReports: false, canViewAccessRights: true,
    canPartnerView: true,
    canEditDetails: true,
    canTabOverview: false, canTabPersonal: false, canTabAddress: false, canTabEmployment: false, canTabReferences: false,
    canTabDocuments: false, canTabLenderDetails: false, canTabTimeline: false, canTabTasks: false, canTabObligations: false, canTabReports: false,
    canNavOverview: true, canNavApplications: false, canNavRegisterNew: false, canNavCalculator: false, canNavTasks: false, canNavPayout: false,
    canNavBanks: true, canNavIncred: true, canNavDSA: true, canNavPartner: true,
    canNavTeamOverview: true, canNavSalesTeams: true, canNavLoginTeams: true, canNavLocations: true, canNavUsers: true,
    canNavReports: false, canNavTickets: true,
    desc: 'Product / Platform Team — governs business rules, master data, and organisational structure but does not handle customer-facing loan processing. Configures the system so other roles can operate.',
    scope: 'Configuration plane — organisation-wide master data',
    teamSize: 'Small specialised team (typically 2–5)',
    responsibilities: [
      'Manage Partner Master (onboard, deactivate, map to DSAs)',
      'Manage DSA Master (onboard, assign linked partners)',
      'Configure Team Overview: Sales Teams, Login Teams, Leaders',
      'Manage Locations, Branches, and geographic hierarchy',
      'Onboard and manage Users — assign roles and access rights',
      'Maintain Loan Form dropdown lists (Company Types, Purposes, etc.)',
      'Edit the First Offer Matrix (salary bands, ROI, FOIR, tenure)',
      'Add / edit Analytic Bank Configuration and Category rules',
    ],
    restrictions: [
      'No access to live loan applications, tracking, or timeline',
      'Cannot create, edit, approve, reject, hold, or disburse loans',
      'No visibility into applicant KYC, Personal, Employment data',
      'Configuration changes apply immediately to all downstream users',
    ],
  },
}

// Tab-permission rows shown per Role Access Card — efin-app.js:5757-5776.
export const CARD_TAB_PERMS: [string, keyof RolePermissionFlags, (keyof RolePermissionFlags | null)][] = [
  ['📋 Overview', 'canViewOverview', null],
  ['👤 Personal Details', 'canViewPersonal', 'canMaskPersonal'],
  ['🏠 Address', 'canViewAddress', null],
  ['💼 Employment', 'canViewEmployment', null],
  ['🤝 References', 'canViewReferences', null],
  ['📁 Documents (View)', 'canViewDocuments', null],
  ['📁 Documents (Upload)', 'canUploadDocs', null],
  ['📁 Documents (Verify/Reject)', 'canVerifyDocs', null],
  ['🏦 Bank Details', 'canViewBanks', 'canAddBank'],
  ['⚡ InCred', 'canViewIncred', null],
  ['🔵 Timeline (View)', 'canViewTracking', null],
  ['🔵 Timeline (Post)', 'canPostTracking', null],
  ['🔵 Timeline (Edit)', 'canEditTracking', null],
  ['🔵 Timeline (Delete)', 'canDeleteTracking', null],
  ['📌 Tasks (View)', 'canViewTasks', null],
  ['📌 Tasks (Manage)', 'canManageTasks', null],
  ['💳 Obligations (View)', 'canViewObligations', null],
  ['💳 Obligations (Edit)', 'canEditObligations', null],
  ['📊 Reports Tab (CIBIL/Perfios)', 'canTabReports', null],
]

// Action-permission rows shown per Role Access Card — efin-app.js:5778-5788.
export const CARD_ACTION_PERMS: [string, keyof RolePermissionFlags][] = [
  ['Create Applications', 'canCreateApp'], ['Change Loan Status', 'canChangeStatus'],
  ['Reject Application', 'canRejectApp'], ['Hold Application', 'canHoldApp'],
  ['Disburse Loan', 'canDisburse'], ['Deviation Actions', 'canDeviation'],
  ['📝 Edit Application Details', 'canEditDetails'], ['View Reports', 'canViewReports'],
  ['View Access Rights', 'canViewAccessRights'],
]

export interface MenuItem {
  id: string; label: string; icon: string; section: string
  canHide: boolean; defaultRoles?: RoleKey[]
}

// efin-app.js:771-795. The 6 canHide:false items are "Core" (always
// visible, rendered as read-only chips); the rest are grouped by `section`
// in the Menu Access Control grid.
export const ALL_MENU_ITEMS: MenuItem[] = [
  { id: 'dashboard', label: 'Overview', icon: '⬡', section: 'Core', canHide: false },
  { id: 'applications', label: 'Applications', icon: '📋', section: 'Core', canHide: false },
  { id: 'calculator', label: 'EMI Calculator', icon: '🧮', section: 'Core', canHide: false },
  { id: 'tasks-page', label: 'Tasks', icon: '📌', section: 'Core', canHide: false },
  { id: 'payout', label: 'Payout', icon: '💰', section: 'Core', canHide: false },
  { id: 'new-application', label: 'Register New', icon: '＋', section: 'Core', canHide: false },
  { id: 'banks', label: 'Banks / NBFC', icon: '🏦', section: 'Management', canHide: true, defaultRoles: ['admin', 'team_leader'] },
  { id: 'incred', label: 'InCred Integration', icon: '⚡', section: 'Management', canHide: true, defaultRoles: ['admin', 'team_leader', 'login_team'] },
  // 'product_team' added to legacy's ['admin','team_leader'] default: every
  // LenderConfigController mutation is [Authorize(Roles = "Admin,ProductTeam")]
  // (LenderConfigController.cs:40/70/90/116/137/156/177/205), the route guard
  // already allows ProductTeam (AppRoutes.tsx) and LenderConfigPage.tsx:558
  // gates its own editing on `Admin || ProductTeam`. Without this the menu
  // entry stayed hidden for the one non-Admin role the backend actually
  // grants write access to, leaving the page reachable only by URL.
  { id: 'lender-config', label: 'Lender Configuration', icon: '🏦', section: 'Management', canHide: true, defaultRoles: ['admin', 'team_leader', 'product_team'] },
  { id: 'dsa-mgmt', label: 'DSA Management', icon: '💼', section: 'Management', canHide: true, defaultRoles: ['admin', 'team_leader', 'product_team'] },
  { id: 'partner-mgmt', label: 'Partner Management', icon: '🤝', section: 'Management', canHide: true, defaultRoles: ['admin', 'team_leader', 'product_team'] },
  { id: 'team-overview', label: 'Team Overview', icon: '📊', section: 'Team Management', canHide: true, defaultRoles: ['admin', 'team_leader', 'product_team'] },
  { id: 'sales-teams', label: 'Sales Teams', icon: '👥', section: 'Team Management', canHide: true, defaultRoles: ['admin', 'team_leader', 'product_team'] },
  { id: 'login-teams', label: 'Login Teams', icon: '🔑', section: 'Team Management', canHide: true, defaultRoles: ['admin', 'team_leader', 'product_team'] },
  { id: 'locations-mgmt', label: 'Locations', icon: '📍', section: 'Team Management', canHide: true, defaultRoles: ['admin', 'product_team'] },
  // Admin-only to match the backend: UsersController.GetAll/Create/Update/
  // Delete are all [Authorize(Roles="Admin")], and the sidebar route guard is
  // ['Admin']. The old 'product_team' default was misleading — ProductTeam
  // could never actually reach Users, so exposing it as a togglable default
  // suggested access the backend forbids.
  { id: 'users-mgmt', label: 'Users', icon: '🙋', section: 'Team Management', canHide: true, defaultRoles: ['admin'] },
  // 'webhook-logs' intentionally NOT listed: unlike every other item here it
  // has no sidebar nav entry or route in this app — webhook logs live inside
  // the Admin-only Settings page (and the GET /api/settings/webhook-logs
  // endpoint is hard [Authorize(Roles="Admin")]), so a configurable menu
  // toggle for it controlled nothing. Retired as a dead permission (its
  // canNavWebhook flag and the NAV_PERM_KEY_BY_MENU_ID mapping were removed
  // too) rather than left as a switch with no effect.
  { id: 'security-roles', label: 'Roles & Rules', icon: '🔒', section: 'Team Management', canHide: true, defaultRoles: ['admin', 'product_team'] },
  { id: 'reports', label: 'Reports', icon: '📈', section: 'Analytics', canHide: true, defaultRoles: ['admin', 'team_leader'] },
  { id: 'tickets', label: 'Helpdesk Tickets', icon: '🎟', section: 'Analytics', canHide: true, defaultRoles: ALL_ROLE_KEYS },
  { id: 'policy-product', label: 'Policy & Product', icon: '📋', section: 'Policy & Product', canHide: true, defaultRoles: ['admin', 'product_team'] },
]

// efin-app.js:5950-5995 — 59 boolean keys grouped for Admin Master Control.
export const MASTER_PERM_GROUPS: { group: string; perms: [keyof RolePermissionFlags, string][] }[] = [
  {
    group: 'Application Actions', perms: [
      ['canCreateApp', 'Create Applications'], ['canChangeStatus', 'Change Loan Status'],
      ['canRejectApp', 'Reject Application'], ['canHoldApp', 'Hold Application'],
      ['canDisburse', 'Disburse Loan'], ['canDeviation', 'Deviation Actions'],
    ],
  },
  {
    group: 'App Detail Tabs', perms: [
      ['canTabOverview', 'Tab: Overview'], ['canTabPersonal', 'Tab: Personal Details'],
      ['canTabAddress', 'Tab: Address'], ['canTabEmployment', 'Tab: Employment'],
      ['canTabReferences', 'Tab: References'], ['canTabDocuments', 'Tab: Documents'],
      ['canTabLenderDetails', 'Tab: Lender Details'], ['canTabTimeline', 'Tab: Timeline'],
      ['canTabTasks', 'Tab: Tasks'], ['canTabObligations', 'Tab: Obligations'],
      ['canTabReports', 'Tab: Reports (CIBIL / Perfios / Bank Eligibility)'],
    ],
  },
  {
    group: 'Tab Data Access', perms: [
      ['canViewOverview', 'View Overview'], ['canViewPersonal', 'View Personal'],
      ['canViewAddress', 'View Address'], ['canViewEmployment', 'View Employment'],
      ['canViewReferences', 'View References'], ['canViewDocuments', 'View Documents'],
      ['canUploadDocs', 'Upload Documents'], ['canVerifyDocs', 'Verify / Reject Documents'], ['canViewBanks', 'View Banks'],
      ['canAddBank', 'Add Bank'], ['canViewIncred', 'View InCred'],
    ],
  },
  {
    group: 'Timeline & Tasks', perms: [
      ['canViewTracking', 'View Timeline'], ['canPostTracking', 'Post Timeline'],
      ['canEditTracking', 'Edit Timeline'], ['canDeleteTracking', 'Delete Timeline'],
      ['canViewTasks', 'View Tasks'], ['canManageTasks', 'Manage Tasks'],
    ],
  },
  {
    group: 'Sidebar Navigation', perms: [
      ['canNavOverview', 'Nav: Overview'], ['canNavApplications', 'Nav: Applications'],
      ['canNavRegisterNew', 'Nav: Register New'], ['canNavCalculator', 'Nav: EMI Calculator'],
      ['canNavTasks', 'Nav: Tasks'], ['canNavPayout', 'Nav: Payout'],
      ['canNavBanks', 'Nav: Banks / NBFC'], ['canNavIncred', 'Nav: InCred'],
      ['canNavDSA', 'Nav: DSA Management'], ['canNavPartner', 'Nav: Partner Management'],
      ['canNavTeamOverview', 'Nav: Team Overview'], ['canNavSalesTeams', 'Nav: Sales Teams'],
      ['canNavLoginTeams', 'Nav: Login Teams'], ['canNavLocations', 'Nav: Locations'],
      ['canNavUsers', 'Nav: Users'],
      ['canNavSecurity', 'Nav: Roles & Rules'],
      ['canNavReports', 'Nav: Reports'], ['canNavTickets', 'Nav: Helpdesk Tickets'],
    ],
  },
  {
    group: 'Other', perms: [
      ['canViewObligations', 'View Obligations'], ['canEditObligations', 'Edit Obligations'],
      ['canPartnerView', 'Partner View'],
      ['canViewReports', 'View Reports'], ['canViewAccessRights', 'View Access Rights'],
      ['canEditDetails', 'Edit Details'],
    ],
  },
]

// Permission Matrix — efin-app.js:5883-5947 `allPerms`. `null` permKey rows
// are section-header pseudo-rows. Legacy's roleOrder is 11 roles (incl.
// admin) but its static <thead> only labels 7 columns — a real markup
// mismatch in the source. We render all 11 columns properly labeled
// instead of reproducing that mismatch, since it's an accidental legacy
// bug, not a deliberate scope choice.
export const PERMISSION_MATRIX_ROLE_ORDER: RoleKey[] = [
  'admin', 'manager', 'login_team', 'operation_manager', 'team_leader',
  'location_head', 'sales_executive', 'dsa_user', 'partner', 'accounts', 'product_team',
]

export const PERMISSION_MATRIX_ROWS: [string, (keyof RolePermissionFlags | null)][] = [
  ['── APPLICATION DETAIL TABS ──', null],
  ['📋 Overview', 'canViewOverview'],
  ['👤 Personal Details — View', 'canViewPersonal'],
  ['👤 Personal Details — PAN/Aadhar Masked', 'canMaskPersonal'],
  ['🏠 Address', 'canViewAddress'],
  ['💼 Employment', 'canViewEmployment'],
  ['🤝 References', 'canViewReferences'],
  ['📁 Documents — View', 'canViewDocuments'],
  ['📁 Documents — Upload', 'canUploadDocs'],
  ['📁 Documents — Verify / Reject', 'canVerifyDocs'],
  ['🏦 Bank Details — View', 'canViewBanks'],
  ['🏦 Bank Details — Add', 'canAddBank'],
  ['⚡ InCred — View', 'canViewIncred'],
  ['🔵 Timeline — View', 'canViewTracking'],
  ['🔵 Timeline — Post Entry', 'canPostTracking'],
  ['🔵 Timeline — Edit Record', 'canEditTracking'],
  ['🔵 Timeline — Delete Record', 'canDeleteTracking'],
  ['📌 Tasks — View', 'canViewTasks'],
  ['📌 Tasks — Assign/Manage', 'canManageTasks'],
  ['💳 Obligations — View', 'canViewObligations'],
  ['💳 Obligations — Edit/Add', 'canEditObligations'],
  ['📊 Reports Tab — CIBIL / Perfios / Bank Eligibility', 'canTabReports'],
  ['── APPLICATION ACTIONS ──', null],
  ['Create new application', 'canCreateApp'],
  ['Change loan status', 'canChangeStatus'],
  ['Reject application', 'canRejectApp'],
  ['Hold application', 'canHoldApp'],
  ['Disburse loan', 'canDisburse'],
  ['Deviation actions', 'canDeviation'],
  ['📝 Edit application details', 'canEditDetails'],
  ['View partner-specific data', 'canPartnerView'],
  ['View reports & analytics', 'canViewReports'],
  ['View Access Rights page', 'canViewAccessRights'],
]

export interface SecurityGroup {
  id: string; name: string; cat: string; color: string; implied: string[]; desc: string
}

// efin-app.js:24317-24326 `twSecGroups`, transcribed verbatim including the
// source's own `group_opeation_manager` id typo (kept as-is — it's a
// display-only reference id, not something re-keyed by anything else).
export const SECURITY_GROUPS: SecurityGroup[] = [
  { id: 'group_location_user', name: 'Location Head', cat: 'Location Team', color: '#1a4fa3', implied: ['base.group_user'], desc: 'Sees apps in own locations: location_id in user.location_id.ids' },
  { id: 'group_location_manager', name: 'Admin', cat: 'Location Team', color: '#1a4fa3', implied: ['group_location_user'], desc: 'Sees ALL records: (1=1). Highest in Location Team.' },
  { id: 'group_sales_partner_user', name: 'Partner', cat: 'Manager Team', color: '#a159ff', implied: ['base.group_user'], desc: 'Sees own: partner_id = user.partner_id.id' },
  { id: 'group_sales_executive_manager', name: 'Sales Person', cat: 'Manager Team', color: '#e31e25', implied: ['group_sales_partner_user'], desc: 'Sees own assigned: assigned_user_id = user.id' },
  { id: 'group_team_leader_manager', name: 'Team Leader', cat: 'Manager Team', color: '#ffb347', implied: ['group_sales_executive_manager'], desc: "Sees team's: salles_id in user.team_sales_ids.ids" },
  { id: 'group_sales_manager_manager', name: 'Manager', cat: 'Manager Team', color: '#ffb347', implied: ['group_team_leader_manager'], desc: 'Same rule as Team Leader. Highest in Manager Team.' },
  { id: 'group_login_team_user', name: 'Login Team', cat: 'Operation Team', color: '#10b981', implied: ['base.group_user'], desc: 'Sees assigned: login_user_id = user.id' },
  { id: 'group_opeation_manager', name: 'Operation Manager', cat: 'Operation Team', color: '#10b981', implied: ['group_login_team_user'], desc: 'Sees op team: login_id in user.operation_team_ids.ids' },
]

// efin-app.js's stgRenderSecGroups() local catColors — deliberately a
// second, independent color source from SECURITY_GROUPS[].color (legacy
// has two inconsistent color sources for the same categories; preserved).
export const SECURITY_GROUP_CATEGORY_COLORS: Record<string, string> = {
  'Location Team': '#1a4fa3', 'Manager Team': '#f59e0b', 'Operation Team': '#10b981',
}

// efin-app.js's NAV_PERM_MAP (applySession, ~1263-1277) — only some menu
// items have a dedicated canNav* override key; items not listed here rely
// solely on Menu Access Control's roleMenuVisibility (e.g. lender-config,
// policy-product have no canNav* key in ROLES at all). Where a canNav* key
// exists, it takes precedence over roleMenuVisibility when defined.
export const NAV_PERM_KEY_BY_MENU_ID: Partial<Record<string, keyof RolePermissionFlags>> = {
  dashboard: 'canNavOverview',
  applications: 'canNavApplications',
  'new-application': 'canNavRegisterNew',
  calculator: 'canNavCalculator',
  'tasks-page': 'canNavTasks',
  payout: 'canNavPayout',
  banks: 'canNavBanks',
  incred: 'canNavIncred',
  'dsa-mgmt': 'canNavDSA',
  'partner-mgmt': 'canNavPartner',
  'team-overview': 'canNavTeamOverview',
  'sales-teams': 'canNavSalesTeams',
  'login-teams': 'canNavLoginTeams',
  'locations-mgmt': 'canNavLocations',
  'users-mgmt': 'canNavUsers',
  // 'webhook-logs' retired — no nav item/route consumes it (see ALL_MENU_ITEMS).
  'security-roles': 'canNavSecurity',
  reports: 'canNavReports',
  tickets: 'canNavTickets',
}
