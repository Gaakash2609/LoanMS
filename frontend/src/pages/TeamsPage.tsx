import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Users, MapPin, Ticket } from 'lucide-react'
import { teamsApi } from '@/api/teamsApi'
import { usersApi } from '@/api/usersApi'
import { ticketsApi } from '@/api/ticketsApi'
import { Card } from '@/components/ui/Card'
import PageHeader from '@/components/shared/PageHeader'
import { useAuthStore } from '@/store/authStore'
// Team table tab + presentational helpers extracted to pages/teams.
import { TeamListTab } from '@/pages/teams/TeamListTab'

// Legacy's three SEPARATE Team-Management pages — page-team-overview /
// page-sales-teams / page-login-teams (efin-app.js's tw* functions), each its
// own sidebar item + route. This one component renders whichever the route
// asks for via `view`, reusing TeamListTab for the two team tables. Backend
// (TeamsController) has full CRUD + member + archive/delete support — see
// api/teamsApi.ts's comments for the real bugs fixed alongside this
// (removeMember's memberId→userId mismatch, missing teamLeadUserId on GetAll).
type TeamsView = 'overview' | 'sales' | 'login'

export default function TeamsPage({ view = 'overview' }: { view?: TeamsView }) {
  const user = useAuthStore(s => s.user)
  // Matches vanilla's twCanManageUsers (efin-app.js:24863: role==='admin' ||
  // role==='product_team'), the gate on Edit/Duplicate/Archive/Delete Team
  // via twTeamMenu (efin-app.js:24587) and twDeleteTeam's own explicit
  // "Only Admin or Product Team can delete teams" toast. Previously
  // Admin-only here, which silently hid these actions from a ProductTeam
  // login even though TeamsController now authorizes them the same as
  // Admin. Manager remains view-only, same as vanilla.
  const canManage = ['Admin', 'ProductTeam'].includes(user?.role ?? '')

  const { data: salesTeams, isLoading: salesLoading } = useQuery({
    queryKey: ['teams', 'Sales'],
    queryFn: () => teamsApi.getAll({ type: 'Sales' }).then(r => r.data.data ?? []),
    enabled: view !== 'login',
  })
  const { data: loginTeams, isLoading: loginLoading } = useQuery({
    queryKey: ['teams', 'Login'],
    queryFn: () => teamsApi.getAll({ type: 'Login' }).then(r => r.data.data ?? []),
    enabled: view !== 'sales',
  })
  const { data: locations } = useQuery({
    queryKey: ['locationOptions'],
    queryFn: () => usersApi.getAllLocations().then(r => r.data.data ?? []),
  })
  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.getAll().then(r => r.data.data ?? []),
    enabled: view !== 'overview',
  })
  const { data: openTickets } = useQuery({
    queryKey: ['tickets', 'Open', 'count'],
    queryFn: () => ticketsApi.getAll({ status: 'Open' }).then(r => r.data.data ?? []),
    enabled: view === 'overview',
  })

  // ── Sales Teams — standalone page (legacy #page-sales-teams). ──
  if (view === 'sales') {
    return (
      <div className="space-y-4">
        <PageHeader title="Sales Teams" subtitle="Manage sales departments, leaders and team members" />
        <TeamListTab type="Sales" teams={salesTeams ?? []} isLoading={salesLoading} users={users ?? []} locations={locations ?? []} canManage={canManage} />
      </div>
    )
  }

  // ── Login / Operation Teams — standalone page (legacy #page-login-teams). ──
  if (view === 'login') {
    return (
      <div className="space-y-4">
        <PageHeader title="Login / Operation Teams" subtitle="Manage operation and login departments" />
        <TeamListTab type="Login" teams={loginTeams ?? []} isLoading={loginLoading} users={users ?? []} locations={locations ?? []} canManage={canManage} />
      </div>
    )
  }

  // ── Team Overview — standalone dashboard page (legacy #page-team-overview). ──
  const activeSales = (salesTeams ?? []).filter(t => t.isActive).length
  const activeLogin = (loginTeams ?? []).filter(t => t.isActive).length
  return (
    <div className="space-y-4">
      <PageHeader title="Team Overview" subtitle="Sales teams, login teams, leaders & locations" />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Link to="/sales-teams">
          <Card className="hover:shadow-card-hover transition-shadow">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-efin-blue/10 text-efin-blue flex items-center justify-center"><Users size={18} /></div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{activeSales}</p>
                <p className="text-xs text-gray-500">Sales Teams</p>
              </div>
            </div>
          </Card>
        </Link>
        <Link to="/login-teams">
          <Card className="hover:shadow-card-hover transition-shadow">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center"><Users size={18} /></div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{activeLogin}</p>
                <p className="text-xs text-gray-500">Login Teams</p>
              </div>
            </div>
          </Card>
        </Link>
        <Link to="/locations">
          <Card className="hover:shadow-card-hover transition-shadow">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-50 text-green-600 flex items-center justify-center"><MapPin size={18} /></div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{locations?.length ?? 0}</p>
                <p className="text-xs text-gray-500">Locations</p>
              </div>
            </div>
          </Card>
        </Link>
        <Link to="/tickets">
          <Card className="hover:shadow-card-hover transition-shadow">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center"><Ticket size={18} /></div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{openTickets?.length ?? 0}</p>
                <p className="text-xs text-gray-500">Open Tickets</p>
              </div>
            </div>
          </Card>
        </Link>
      </div>
    </div>
  )
}
