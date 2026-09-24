import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './ProtectedRoute'
import RouteGuard from './RouteGuard'
import { PAGE_GUARDS } from './pageAccess'
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
            {/* Every page sits behind RouteGuard with its PAGE_GUARDS entry —
                the same role ceiling + canNav* / Menu Access Control check the
                sidebar uses (master prompt Part 7), so a hidden page can't be
                reached by URL. Pages with no sidebar item of their own (loan
                detail, tracking, profile) only need a signed-in user. Why each
                role list is what it is: routes/pageAccess.ts PAGE_ROLES. */}
            <Route path="/loans/:id"             element={<LoanDetailPage />} />
            <Route path="/loans/:loanId/tracking" element={<TrackingPage />} />
            <Route path="/profile"               element={<ProfilePage />} />

            <Route element={<RouteGuard guard={PAGE_GUARDS['/dashboard']} />}>
              <Route path="/dashboard"           element={<DashboardPage />} />
            </Route>
            <Route element={<RouteGuard guard={PAGE_GUARDS['/loans']} />}>
              <Route path="/loans"               element={<LoansPage />} />
            </Route>
            <Route element={<RouteGuard guard={PAGE_GUARDS['/new-application']} />}>
              <Route path="/new-application"     element={<NewApplicationPage />} />
              <Route path="/loans/new"           element={<NewApplicationPage />} />
            </Route>
            <Route element={<RouteGuard guard={PAGE_GUARDS['/calculator']} />}>
              <Route path="/calculator"          element={<CalculatorPage />} />
            </Route>
            <Route element={<RouteGuard guard={PAGE_GUARDS['/tasks']} />}>
              <Route path="/tasks"               element={<TasksPage />} />
            </Route>
            <Route element={<RouteGuard guard={PAGE_GUARDS['/tickets']} />}>
              <Route path="/tickets"             element={<TicketsPage />} />
            </Route>

            {/* Payout — PayoutPage also sends a Partner mapped to a DSA back
                to the dashboard (Vanilla hides Payout from it). */}
            <Route element={<RouteGuard guard={PAGE_GUARDS['/payout']} />}>
              <Route path="/payout"              element={<PayoutPage />} />
            </Route>

            {/* DSA / Partner Management — Sales never (Part 7); roles outside
                DSA_FULL_DETAIL_ROLES see the directory view only (Part 6). */}
            <Route element={<RouteGuard guard={PAGE_GUARDS['/dsa']} />}>
              <Route path="/dsa"                 element={<DsaPage />} />
            </Route>
            <Route element={<RouteGuard guard={PAGE_GUARDS['/partners']} />}>
              <Route path="/partners"            element={<PartnerPage />} />
            </Route>

            {/* Reports — Vanilla canNavReports (its hash-restore gap that let a
                hidden-menu role land here is deliberately not reproduced). */}
            <Route element={<RouteGuard guard={PAGE_GUARDS['/reports']} />}>
              <Route path="/reports"             element={<ReportsPage />} />
            </Route>

            {/* Team Management — Vanilla's three separate pages, one component
                parameterised by view; Admin/ProductTeam manage, the supervising
                roles read their own teams / Location (Part 5). */}
            <Route element={<RouteGuard guard={PAGE_GUARDS['/teams']} />}>
              <Route path="/teams"               element={<TeamsPage view="overview" />} />
            </Route>
            <Route element={<RouteGuard guard={PAGE_GUARDS['/sales-teams']} />}>
              <Route path="/sales-teams"         element={<TeamsPage view="sales" />} />
            </Route>
            <Route element={<RouteGuard guard={PAGE_GUARDS['/login-teams']} />}>
              <Route path="/login-teams"         element={<TeamsPage view="login" />} />
            </Route>
            <Route element={<RouteGuard guard={PAGE_GUARDS['/locations']} />}>
              <Route path="/locations"           element={<LocationsPage />} />
            </Route>
            <Route element={<RouteGuard guard={PAGE_GUARDS['/users']} />}>
              <Route path="/users"               element={<UsersPage />} />
            </Route>

            {/* Lenders — writes stay Admin/ProductTeam in each page's canManage. */}
            <Route element={<RouteGuard guard={PAGE_GUARDS['/incred']} />}>
              <Route path="/incred"              element={<IncredPage />} />
            </Route>
            <Route element={<RouteGuard guard={PAGE_GUARDS['/lender-config']} />}>
              <Route path="/lender-config"       element={<LenderConfigPage />} />
            </Route>
            <Route element={<RouteGuard guard={PAGE_GUARDS['/banks']} />}>
              <Route path="/banks"               element={<BanksPage />} />
            </Route>

            {/* Policy & Product — ProductTeam edits only what its backend
                endpoints allow (ProductOfferMatrixCard; Rejection Reasons and
                InCred templates stay Admin-only via their own isAdmin gates). */}
            <Route element={<RouteGuard guard={PAGE_GUARDS['/policy-product']} />}>
              <Route path="/policy-product"      element={<PolicyProductPage />} />
            </Route>

            {/* Admin only. */}
            <Route element={<RouteGuard guard={PAGE_GUARDS['/settings']} />}>
              <Route path="/settings"            element={<SettingsPage />} />
            </Route>
            <Route element={<RouteGuard guard={PAGE_GUARDS['/audit']} />}>
              <Route path="/audit"               element={<AuditLogPage />} />
            </Route>
            <Route element={<RouteGuard guard={PAGE_GUARDS['/security-roles']} />}>
              <Route path="/security-roles"      element={<SecurityRolesPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Route>
      </Routes>
    </Wrap>
  )
}
