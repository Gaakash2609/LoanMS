import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './ProtectedRoute'
import { PageLoader } from '@/components/ui/LoadingSpinner'

const AppLayout          = lazy(() => import('@/layouts/AppLayout'))
const LoginPage          = lazy(() => import('@/pages/LoginPage'))
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPasswordPage'))
const ResetPasswordPage  = lazy(() => import('@/pages/ResetPasswordPage'))
const DashboardPage      = lazy(() => import('@/pages/DashboardPage'))
const LoansPage          = lazy(() => import('@/pages/LoansPage'))
const LoanDetailPage     = lazy(() => import('@/pages/LoanDetailPage'))
const NewApplicationPage = lazy(() => import('@/pages/NewApplicationPage'))
const PayoutPage         = lazy(() => import('@/pages/PayoutPage'))
const ReportsPage        = lazy(() => import('@/pages/ReportsPage'))
const TasksPage          = lazy(() => import('@/pages/TasksPage'))
const TicketsPage        = lazy(() => import('@/pages/TicketsPage'))
const TeamsPage          = lazy(() => import('@/pages/TeamsPage'))
const UsersPage          = lazy(() => import('@/pages/UsersPage'))
const SettingsPage       = lazy(() => import('@/pages/SettingsPage'))
const CalculatorPage     = lazy(() => import('@/pages/CalculatorPage'))
const DsaPage            = lazy(() => import('@/pages/DsaPage'))
const PartnerPage        = lazy(() => import('@/pages/PartnerPage'))
const ProfilePage        = lazy(() => import('@/pages/ProfilePage'))
const LocationsPage      = lazy(() => import('@/pages/LocationsPage'))
const AuditLogPage       = lazy(() => import('@/pages/AuditLogPage'))
const TrackingPage       = lazy(() => import('@/pages/TrackingPage'))
const BanksPage          = lazy(() => import('@/pages/BanksPage'))
const LenderConfigPage   = lazy(() => import('@/pages/LenderConfigPage'))
const SecurityRolesPage  = lazy(() => import('@/pages/SecurityRolesPage'))
const PolicyProductPage  = lazy(() => import('@/pages/PolicyProductPage'))
const IncredPage         = lazy(() => import('@/pages/IncredPage'))

const Wrap = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<PageLoader />}>{children}</Suspense>
)

export default function AppRoutes() {
  return (
    <Wrap>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/"      element={<Navigate to="/dashboard" replace />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            {/* Core workflows */}
            <Route path="/dashboard"             element={<DashboardPage />} />
            <Route path="/loans"                 element={<LoansPage />} />
            <Route path="/loans/new"             element={<NewApplicationPage />} />
            <Route path="/loans/:id"             element={<LoanDetailPage />} />
            <Route path="/new-application"       element={<NewApplicationPage />} />
            <Route path="/calculator"            element={<CalculatorPage />} />
            <Route path="/profile"               element={<ProfilePage />} />
            <Route path="/tasks"                 element={<TasksPage />} />
            <Route path="/tickets"               element={<TicketsPage />} />
            {/* Tracking embedded under loan */}
            <Route path="/loans/:loanId/tracking" element={<TrackingPage />} />

            {/* Admin/Manager/Accounts — Payout: backend PayoutController.
                UpdateStatus authorizes Admin,Accounts only. Manager can open
                the page but only with Sales-level rights (own claims, no
                override, no status change, no Payout Rules). Accounts was
                added via its own guard rather than widening the shared
                Admin,Manager block below (which would have also widened
                Reports/Teams/Locations/Banks/LenderConfig/Incred to
                Accounts — none of those were part of this fix). */}
            <Route element={<ProtectedRoute allowedRoles={['Admin', 'Manager', 'Accounts']} />}>
              <Route path="/payout"              element={<PayoutPage />} />
            </Route>

            {/* Admin/Manager/Sales/ProductTeam — DSA: backend DsaController's
                Create/Update/Upload/SetStatus already authorize
                Admin,Sales,ProductTeam; this route-guard previously only
                allowed Admin,Manager, blocking Sales and ProductTeam from a
                page the backend already lets them act on. Split into its
                own guard for the same reason as Payout above — Manager's
                existing access is preserved even though Manager isn't in
                DsaController's own role list, since removing it wasn't
                part of this fix. */}
            <Route element={<ProtectedRoute allowedRoles={['Admin', 'Manager', 'Sales', 'ProductTeam']} />}>
              <Route path="/dsa"                 element={<DsaPage />} />
              {/* Partner Management — same DsaController endpoints and same
                  role list as DSA above (Create/Update/SetStatus authorize
                  Admin,Sales,ProductTeam; Manager kept for parity with the
                  DSA route's existing guard). */}
              <Route path="/partners"            element={<PartnerPage />} />
            </Route>

            {/* Reports — page access mirrors legacy's canNavReports, which is the
                real gate in vanilla: applySession() reads ROLES[role].canNavReports
                (efin-app.js:1279) and the NAV_ITEMS `defaultRoles` list at :792 is
                dead code for this item, since canNavReports is defined for all 11
                roles and so the primary branch always wins. The six roles below are
                exactly the ones defaulting to true (:189 admin, :231 login_team,
                :275 team_leader, :450 location_head, :487 manager, :526
                operation_manager); Sales/Accounts/Partner/Dsa/ProductTeam default to
                false and stay blocked.

                Vanilla has no page-level guard for reports — showPage() only hard-
                guards payout* and settings (:1839-1852), so a hidden-menu role could
                still land here via the #reports hash restore (:78). That is a vanilla
                gap, not intended access, so it is deliberately NOT reproduced.

                Split out of the Admin/Manager block below rather than widening it —
                Teams/Locations/Banks/InCred keep their own narrower guard. */}
            <Route element={<ProtectedRoute allowedRoles={['Admin', 'Manager', 'TeamLeader', 'LoginTeam', 'LocationHead', 'OperationManager']} />}>
              <Route path="/reports"             element={<ReportsPage />} />
            </Route>

            {/* Admin/Manager/ProductTeam — Team Management: TeamsController's
                and LocationsController's mutation endpoints already authorize
                Admin,ProductTeam (Create/Update/SetStatus/AddMember/
                RemoveMember/Delete), and TeamsPage's own canManage check
                already expects ProductTeam too — this route-guard previously
                only allowed Admin,Manager, blocking ProductTeam from pages
                the backend already lets them manage (same bug class as the
                Lender Config route split below, already fixed there). */}
            <Route element={<ProtectedRoute allowedRoles={['Admin', 'Manager', 'ProductTeam']} />}>
              {/* Vanilla's three separate Team-Management pages
                  (#team-overview / #sales-teams / #login-teams) — one page
                  component parameterised by view, not a single tabbed page. */}
              <Route path="/teams"               element={<TeamsPage view="overview" />} />
              <Route path="/sales-teams"         element={<TeamsPage view="sales" />} />
              <Route path="/login-teams"         element={<TeamsPage view="login" />} />
              <Route path="/locations"           element={<LocationsPage />} />
            </Route>

            {/* Admin/Manager */}
            <Route element={<ProtectedRoute allowedRoles={['Admin', 'Manager']} />}>
              <Route path="/incred"              element={<IncredPage />} />
            </Route>

            {/* Admin/Manager/ProductTeam — Lender Config: backend
                LenderConfigController's Companies/Categories/Lines mutation
                endpoints already authorize Admin,ProductTeam; this
                route-guard previously only allowed Admin,Manager, blocking
                ProductTeam from a page the backend already lets them manage.
                Split into its own guard for the same reason as Phase 10's
                Payout/DSA fixes — Manager's existing access is preserved.

                Banks joins this guard for exactly the same reason: every
                BanksController mutation is [Authorize(Roles =
                "Admin,ProductTeam")] (BanksController.cs:93/158/218/259)
                and its GET is open to any authenticated user, so
                ProductTeam held full backend CRUD on banks while the
                route-guard refused them the page entirely. Manager keeps
                the read access it already had. */}
            <Route element={<ProtectedRoute allowedRoles={['Admin', 'Manager', 'ProductTeam']} />}>
              <Route path="/lender-config"       element={<LenderConfigPage />} />
              <Route path="/banks"               element={<BanksPage />} />
            </Route>

            {/* Admin/ProductTeam — Policy & Product. The page is already
                built for this role: ProductOfferMatrixCard.tsx:26 gates its
                editing on `Admin || ProductTeam`, matching
                ProductOfferMatrixController.cs:39. The Rejection Reasons and
                InCred-templates sections stay read-only for ProductTeam via
                their own existing `isAdmin` gates (PolicyProductPage.tsx:56,
                IncredCommentTemplatesCard.tsx:25), which mirror
                RejectionReasonsController's Admin-only writes — so no button
                is shown that the backend would refuse. Legacy likewise had
                defaultRoles ['admin','product_team'] (efin-app.js:794). */}
            <Route element={<ProtectedRoute allowedRoles={['Admin', 'ProductTeam']} />}>
              <Route path="/policy-product"      element={<PolicyProductPage />} />
            </Route>

            {/* Admin only. /users deliberately stays here: GET /api/users is
                [Authorize(Roles = "Admin")] (UsersController.cs:33-34), so a
                ProductTeam session would 403 on the list the page opens with.
                The four ProductTeam endpoints on that controller all act on a
                user id that only that list can supply. */}
            <Route element={<ProtectedRoute allowedRoles={['Admin']} />}>
              <Route path="/users"               element={<UsersPage />} />
              <Route path="/settings"            element={<SettingsPage />} />
              <Route path="/audit"               element={<AuditLogPage />} />
              <Route path="/security-roles"      element={<SecurityRolesPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Route>
      </Routes>
    </Wrap>
  )
}
