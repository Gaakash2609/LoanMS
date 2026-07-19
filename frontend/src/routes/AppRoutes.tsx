import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './ProtectedRoute'
import { PageLoader } from '@/components/ui/LoadingSpinner'

const AppLayout          = lazy(() => import('@/layouts/AppLayout'))
const LoginPage          = lazy(() => import('@/pages/LoginPage'))
const DashboardPage      = lazy(() => import('@/pages/DashboardPage'))
const LoansPage          = lazy(() => import('@/pages/LoansPage'))
const LoanDetailPage     = lazy(() => import('@/pages/LoanDetailPage'))
const NewApplicationPage = lazy(() => import('@/pages/NewApplicationPage'))
const CustomersPage      = lazy(() => import('@/pages/CustomersPage'))
const CustomerDetailPage = lazy(() => import('@/pages/CustomerDetailPage'))
const PayoutPage         = lazy(() => import('@/pages/PayoutPage'))
const ReportsPage        = lazy(() => import('@/pages/ReportsPage'))
const TasksPage          = lazy(() => import('@/pages/TasksPage'))
const TicketsPage        = lazy(() => import('@/pages/TicketsPage'))
const TeamsPage          = lazy(() => import('@/pages/TeamsPage'))
const UsersPage          = lazy(() => import('@/pages/UsersPage'))
const SettingsPage       = lazy(() => import('@/pages/SettingsPage'))
const CalculatorPage     = lazy(() => import('@/pages/CalculatorPage'))
const DsaPage            = lazy(() => import('@/pages/DsaPage'))
const ProfilePage        = lazy(() => import('@/pages/ProfilePage'))
const LocationsPage      = lazy(() => import('@/pages/LocationsPage'))
const AuditLogPage       = lazy(() => import('@/pages/AuditLogPage'))
const TrackingPage       = lazy(() => import('@/pages/TrackingPage'))
const BanksPage          = lazy(() => import('@/pages/BanksPage'))
const LenderConfigPage   = lazy(() => import('@/pages/LenderConfigPage'))
const SecurityRolesPage  = lazy(() => import('@/pages/SecurityRolesPage'))
const PolicyProductPage  = lazy(() => import('@/pages/PolicyProductPage'))
const CibilPage          = lazy(() => import('@/pages/CibilPage'))
const IncredPage         = lazy(() => import('@/pages/IncredPage'))

const Wrap = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<PageLoader />}>{children}</Suspense>
)

export default function AppRoutes() {
  return (
    <Wrap>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/"      element={<Navigate to="/dashboard" replace />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            {/* Core workflows */}
            <Route path="/dashboard"             element={<DashboardPage />} />
            <Route path="/loans"                 element={<LoansPage />} />
            <Route path="/loans/new"             element={<NewApplicationPage />} />
            <Route path="/loans/:id"             element={<LoanDetailPage />} />
            <Route path="/new-application"       element={<NewApplicationPage />} />
            <Route path="/customers"             element={<CustomersPage />} />
            <Route path="/customers/:id"         element={<CustomerDetailPage />} />
            <Route path="/calculator"            element={<CalculatorPage />} />
            <Route path="/cibil"                 element={<CibilPage />} />
            <Route path="/profile"               element={<ProfilePage />} />
            <Route path="/tasks"                 element={<TasksPage />} />
            <Route path="/tickets"               element={<TicketsPage />} />
            {/* Tracking embedded under loan */}
            <Route path="/loans/:loanId/tracking" element={<TrackingPage />} />

            {/* Admin/Manager */}
            <Route element={<ProtectedRoute allowedRoles={['Admin', 'Manager']} />}>
              <Route path="/payout"              element={<PayoutPage />} />
              <Route path="/reports"             element={<ReportsPage />} />
              <Route path="/teams"               element={<TeamsPage />} />
              <Route path="/dsa"                 element={<DsaPage />} />
              <Route path="/locations"           element={<LocationsPage />} />
              <Route path="/banks"               element={<BanksPage />} />
              <Route path="/lender-config"       element={<LenderConfigPage />} />
              <Route path="/incred"              element={<IncredPage />} />
            </Route>

            {/* Admin only */}
            <Route element={<ProtectedRoute allowedRoles={['Admin']} />}>
              <Route path="/users"               element={<UsersPage />} />
              <Route path="/settings"            element={<SettingsPage />} />
              <Route path="/audit"               element={<AuditLogPage />} />
              <Route path="/security-roles"      element={<SecurityRolesPage />} />
              <Route path="/policy-product"      element={<PolicyProductPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Route>
      </Routes>
    </Wrap>
  )
}
