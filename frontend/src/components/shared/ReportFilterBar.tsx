import { useQuery } from '@tanstack/react-query'
import api from '@/api/axios'
import { teamsApi } from '@/api/teamsApi'
import type { ApiResponse, LoanStatus } from '@/types'
import { useAuthStore } from '@/store/authStore'
import type { ReportFilters } from '@/api/reportsApi'
import { Button } from '@/components/ui/Button'

// ── Reports filter bar ──────────────────────────────────────────────────
// Ports the legacy Reports header controls (index.html #page-reports, and
// their gating in renderReports, efin-app.js:12974-13032).
//
// Legacy's role gating is reproduced exactly, quirks included:
//   • "My Data"  — everyone
//   • "My Team"  — TeamLeader and Admin only (:12978). Manager does NOT get
//                  it; that is legacy's rule, not an oversight here.
//   • "All"      — Admin only (:12979)
//   • User filter — Admin or TeamLeader (:13003)
//   • Team filter — Admin only (:13017)
//   • The whole scope row is hidden for Partner (:12964)
//
// Month is a plain YYYY-MM picker that legacy converts to a date range, and
// a custom range overrides it (:12933-12946) — same behaviour here, computed
// in monthToRange below so the server never needs a month parameter.

// Legacy's chips are its own local vocabulary (underwriting / login / hold),
// which has no counterpart in the persisted enum. Per the agreed decision the
// filter uses Loan.Status as stored, in the same order LoansPage lists it.
const STATUSES: LoanStatus[] = [
  'Draft', 'Submitted', 'UnderReview', 'Offer', 'Approved', 'Disbursed', 'Rejected', 'Closed',
]

export type ScopeValue = 'all' | 'mine' | 'team'

export interface ReportFilterState {
  scope: ScopeValue
  userId: string
  teamId: string
  status: string
  month: string
  from: string
  to: string
}

export const EMPTY_REPORT_FILTERS: ReportFilterState = {
  scope: 'all', userId: '', teamId: '', status: '', month: '', from: '', to: '',
}

/** Legacy: a YYYY-MM pick means "that whole month", unless a custom range is set. */
export function monthToRange(month: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) return null
  const year = Number(m[1]); const mon = Number(m[2])
  if (mon < 1 || mon > 12) return null
  const last = new Date(year, mon, 0).getDate()
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}` }
}

/** Turns the UI state into the query the API layer sends. */
export function toReportFilters(s: ReportFilterState): ReportFilters {
  // A custom range wins over the month picker, exactly as legacy does.
  const range = (s.from || s.to) ? { from: s.from, to: s.to } : monthToRange(s.month)
  return {
    from: range?.from || undefined,
    to: range?.to || undefined,
    scope: s.scope,
    userId: s.userId ? Number(s.userId) : undefined,
    teamId: s.teamId ? Number(s.teamId) : undefined,
    status: s.status || undefined,
  }
}

export default function ReportFilterBar({
  value, onChange, onApply,
}: {
  value: ReportFilterState
  onChange: (next: ReportFilterState) => void
  onApply: () => void
}) {
  const user = useAuthStore(s => s.user)
  const role = user?.role ?? ''
  const isAdmin = role === 'Admin'
  const isTL = role === 'TeamLeader'
  const isPartner = role === 'Partner'

  const showTeamScope = isTL || isAdmin
  const showAllScope = isAdmin
  const showUserFilter = isAdmin || isTL
  const showTeamFilter = isAdmin

  const { data: users } = useQuery({
    queryKey: ['users-lookup'],
    queryFn: () => api.get<ApiResponse<{ id: number; fullName: string }[]>>('/api/users/lookup').then(r => r.data.data ?? []),
    enabled: showUserFilter,
    staleTime: 300_000,
  })

  const { data: teams } = useQuery({
    queryKey: ['teams-lookup'],
    // Legacy reads twSalesTeams here — Sales teams only, not Login teams.
    queryFn: () => teamsApi.getAll({ type: 'Sales' }).then(r => r.data.data ?? []),
    enabled: showTeamFilter,
    staleTime: 300_000,
  })

  const set = <K extends keyof ReportFilterState>(k: K, v: ReportFilterState[K]) =>
    onChange({ ...value, [k]: v })

  // Legacy setRptScope clears both dropdowns when the scope changes (:12484-86).
  const setScope = (scope: ScopeValue) => onChange({ ...value, scope, userId: '', teamId: '' })

  // Legacy setRptUserFilter/setRptTeamFilter (:12490-12504): the two dropdowns
  // are mutually exclusive, and picking either one resets the scope to 'all'
  // so the pick isn't also narrowed by "My Data"/"My Team". Clearing the
  // dropdown leaves the scope on 'all' — that is legacy's behaviour too.
  //
  // 'all' here only means "no extra narrowing"; the server still runs
  // ApplyVisibilityScope first, so a TeamLeader picking a user outside their
  // team gets nothing back. Legacy, filtering a client-side array, would have
  // shown it. That is a deliberate tightening, not a parity gap.
  const setPeopleFilter = (patch: Partial<ReportFilterState>) =>
    onChange({
      ...value, userId: '', teamId: '', ...patch,
      scope: (patch.userId || patch.teamId) ? 'all' : value.scope,
    })

  const selectCls = 'rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-efin-blue transition-colors'
  const selectStyle = { border: '1.5px solid var(--border)', color: 'var(--text2)' }
  const scopeBtn = (active: boolean) =>
    `px-3.5 py-1 text-xs font-semibold rounded-lg transition-all ${active ? 'text-white shadow-sm' : 'hover:bg-white'}`
  const scopeBtnStyle = (active: boolean) => active
    ? { background: 'linear-gradient(135deg, var(--accent-light), var(--accent))' }
    : { color: 'var(--text2)' }

  // Legacy dims the scope buttons while a user/team filter is active (:12986).
  const scopeActive = (s: ScopeValue) => value.scope === s && !value.userId && !value.teamId

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!isPartner && (
        <div className="flex gap-1.5 rounded-[10px] p-1" style={{ background: 'var(--surface2)', border: '1.5px solid var(--border)' }}>
          <button className={scopeBtn(scopeActive('mine'))} style={scopeBtnStyle(scopeActive('mine'))} onClick={() => setScope('mine')}>My Data</button>
          {showTeamScope && (
            <button className={scopeBtn(scopeActive('team'))} style={scopeBtnStyle(scopeActive('team'))} onClick={() => setScope('team')}>My Team</button>
          )}
          {showAllScope && (
            <button className={scopeBtn(scopeActive('all'))} style={scopeBtnStyle(scopeActive('all'))} onClick={() => setScope('all')}>All</button>
          )}
        </div>
      )}

      {showUserFilter && (
        <select className={selectCls} style={selectStyle} value={value.userId}
          onChange={e => setPeopleFilter({ userId: e.target.value })}>
          <option value="">👤 All Users</option>
          {(users ?? []).map(u => <option key={u.id} value={u.id}>{u.fullName}</option>)}
        </select>
      )}

      {showTeamFilter && (
        <select className={selectCls} style={selectStyle} value={value.teamId}
          onChange={e => setPeopleFilter({ teamId: e.target.value })}>
          <option value="">🏢 All Teams</option>
          {(teams ?? []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}

      <select className={selectCls} style={selectStyle} value={value.status} onChange={e => set('status', e.target.value)}>
        <option value="">All Statuses</option>
        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>

      <input type="month" className={selectCls} style={selectStyle} value={value.month}
        disabled={!!(value.from || value.to)}
        title={value.from || value.to ? 'Clear the date range to use the month picker' : undefined}
        onChange={e => set('month', e.target.value)} />

      <input type="date" className={selectCls} style={selectStyle} value={value.from}
        onChange={e => set('from', e.target.value)} />
      <span className="text-sm" style={{ color: 'var(--text3)' }}>to</span>
      <input type="date" className={selectCls} style={selectStyle} value={value.to}
        onChange={e => set('to', e.target.value)} />

      {(value.from || value.to) && (
        <button onClick={() => onChange({ ...value, from: '', to: '' })}
          className="text-xs font-semibold text-efin-blue hover:underline">
          Clear dates
        </button>
      )}

      {/* Was a raw <button> with its own ad hoc border/hover instead of
          the app's shared Button (.efin-btn — legacy's actual button
          geometry/weight, ported in Button.tsx), unlike every other
          "Apply"/"Save" action elsewhere in the app. */}
      <Button size="sm" variant="secondary" onClick={onApply}>Apply</Button>
    </div>
  )
}
