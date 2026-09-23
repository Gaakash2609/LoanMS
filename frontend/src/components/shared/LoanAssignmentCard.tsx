import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserCog, Save } from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { loansApi } from '@/api/loansApi'
import { usersApi } from '@/api/usersApi'
import { teamsApi } from '@/api/teamsApi'
import { useHasAnyRole } from '@/hooks/usePermissions'
import { buildAssignmentPayload, hasAssignmentChange, type AssignmentSelection } from '@/utils/assignment'
import type { Loan, UserRole } from '@/types'
import { LOAN_KEYS } from '@/hooks/useLoans'

// ── Loan Assignment / Reassignment ──────────────────────────────────────
// Restores legacy's manual routing (updateLoginUser + the Team & Assignment
// panel, efin-app.js:7623): who owns the case (Assigned To), who logs it in
// with the lender (Login User), and the Sales Team / Operations Manager /
// Location fields from the same legacy panel. The backend already persisted
// all five fields (PATCH /api/loans/{id}/assignment) and returned them on
// the loan, and the assignment audit trail was already surfaced — only the
// controls to *set* them were missing. Auto-assignment still runs
// server-side on submit; this is the manual override on top of it.
//
// Role gate mirrors the endpoint's own [Authorize(Roles=...)] exactly (there is
// no finer permission flag on that route). The set/clear payload logic lives in
// utils/assignment (pure + unit-tested); this card only wires the picks.
const ASSIGN_ROLES: readonly UserRole[] = [
  'Admin', 'Manager', 'LoginTeam', 'TeamLeader', 'LocationHead', 'OperationManager', 'Accounts', 'ProductTeam',
]

// Sentinel for "no selection" in a <select> — kept out of the real id/name
// space (ids are numbers, team names are non-empty strings) so it can never
// collide with an actual value.
const NONE = ''

export default function LoanAssignmentCard({ loan }: { loan: Loan }) {
  const qc = useQueryClient()
  const canAssign = useHasAnyRole(ASSIGN_ROLES)

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.getAll().then(r => r.data.data ?? []),
  })
  const { data: salesTeams } = useQuery({
    queryKey: ['teams', 'Sales'],
    queryFn: () => teamsApi.getAll({ type: 'Sales' }).then(r => r.data.data ?? []),
  })
  const { data: locations } = useQuery({
    queryKey: ['locationOptions'],
    queryFn: () => usersApi.getAllLocations().then(r => r.data.data ?? []),
  })

  const currentAssignedId = loan.assignedTo?.id ?? null
  const currentLoginId = loan.loginUser?.id ?? null
  const currentOpsManagerId = loan.opsManager?.id ?? null
  const currentSalesTeam = loan.salesTeamName ?? null
  // LoanDto only exposes the location's name, not its id, so the current
  // location can only be resolved once the locations list has loaded — by
  // matching on name. The payload itself still sends locationId (the
  // backend contract), this lookup only affects which option starts selected.
  const currentLocationId = locations?.find(l => l.name === loan.locationName)?.id ?? null

  const [assignedSel, setAssignedSel] = useState<string>(currentAssignedId != null ? String(currentAssignedId) : NONE)
  const [loginSel, setLoginSel] = useState<string>(currentLoginId != null ? String(currentLoginId) : NONE)
  const [opsManagerSel, setOpsManagerSel] = useState<string>(currentOpsManagerId != null ? String(currentOpsManagerId) : NONE)
  const [salesTeamSel, setSalesTeamSel] = useState<string>(currentSalesTeam ?? NONE)
  const [locationSel, setLocationSel] = useState<string>(currentLocationId != null ? String(currentLocationId) : NONE)
  const [error, setError] = useState('')

  // Re-sync local editor state whenever the underlying loan data changes —
  // e.g. another user reassigns the case and this card's query refetches,
  // or the person navigates between loans that reuse this same component.
  // Without this, the selects would keep showing whatever was picked (or
  // the very first loan's values) instead of the current loan's assignment.
  useEffect(() => {
    setAssignedSel(currentAssignedId != null ? String(currentAssignedId) : NONE)
    setLoginSel(currentLoginId != null ? String(currentLoginId) : NONE)
    setOpsManagerSel(currentOpsManagerId != null ? String(currentOpsManagerId) : NONE)
    setSalesTeamSel(currentSalesTeam ?? NONE)
    setLocationSel(currentLocationId != null ? String(currentLocationId) : NONE)
  }, [loan.id, currentAssignedId, currentLoginId, currentOpsManagerId, currentSalesTeam, currentLocationId])

  // A select value maps to: number (set), null (clear a previously-set field),
  // or undefined (unchanged — same as current).
  const idSelToChange = (sel: string, currentId: number | null): number | null | undefined => {
    const val = sel === NONE ? null : Number(sel)
    return val === currentId ? undefined : val
  }
  const nameSelToChange = (sel: string, currentName: string | null): string | null | undefined => {
    const val = sel === NONE ? null : sel
    return val === currentName ? undefined : val
  }
  const selection: AssignmentSelection = {
    assignedToUserId: idSelToChange(assignedSel, currentAssignedId),
    loginUserId: idSelToChange(loginSel, currentLoginId),
    opsManagerId: idSelToChange(opsManagerSel, currentOpsManagerId),
    salesTeamName: nameSelToChange(salesTeamSel, currentSalesTeam),
    locationId: idSelToChange(locationSel, currentLocationId),
  }
  const dirty = hasAssignmentChange(selection)

  const save = useMutation({
    mutationFn: () => loansApi.updateAssignment(loan.id, buildAssignmentPayload(selection)),
    onSuccess: () => {
      setError('')
      qc.invalidateQueries({ queryKey: LOAN_KEYS.detail(loan.id) })
      qc.invalidateQueries({ queryKey: ['loans'] })
      qc.invalidateQueries({ queryKey: ['assignment-audit'] })
    },
    onError: (e: unknown) => {
      const d = (e as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      setError(d?.message || d?.errors?.join(' ') || 'Assignment could not be updated.')
    },
  })

  const options = (users ?? []).filter(u => u.isActive)
  const opsManagerOptions = options.filter(u => u.role === 'OperationManager')
  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50'

  const Row = ({ label, value }: { label: string; value?: string | null }) => (
    <div>
      <p className="text-gray-500 text-xs">{label}</p>
      <p className="font-medium text-gray-900 mt-0.5">{value || '— unassigned —'}</p>
    </div>
  )

  return (
    <Card>
      <CardHeader
        title={<><span className="section-icon-badge"><UserCog size={15} /></span> Assignment</>}
        subtitle="Who owns this case and who logs it in with the lender"
      />

      {/* Current assignment — always visible */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
        <Row label="Assigned To" value={loan.assignedTo?.fullName} />
        <Row label="Login User" value={loan.loginUser?.fullName} />
        <Row label="Sales Team" value={loan.salesTeamName} />
        <Row label="Ops Manager" value={loan.opsManager?.fullName} />
        <Row label="Location" value={loan.locationName} />
      </div>

      {/* Reassignment editor — role-gated to match the backend route */}
      {canAssign && (
        <div className="mt-5 pt-4 border-t border-gray-100">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Assign To</label>
              <select value={assignedSel} onChange={e => setAssignedSel(e.target.value)} className={inputCls}>
                <option value={NONE}>— Unassigned —</option>
                {options.map(u => <option key={u.id} value={u.id}>{u.fullName} · {u.role}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Login User</label>
              <select value={loginSel} onChange={e => setLoginSel(e.target.value)} className={inputCls}>
                <option value={NONE}>— Unassigned —</option>
                {options.map(u => <option key={u.id} value={u.id}>{u.fullName} · {u.role}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Sales Team</label>
              <select value={salesTeamSel} onChange={e => setSalesTeamSel(e.target.value)} className={inputCls}>
                <option value={NONE}>— Unassigned —</option>
                {(salesTeams ?? []).map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Operations Manager</label>
              <select value={opsManagerSel} onChange={e => setOpsManagerSel(e.target.value)} className={inputCls}>
                <option value={NONE}>— Unassigned —</option>
                {opsManagerOptions.map(u => <option key={u.id} value={u.id}>{u.fullName}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Location</label>
              <select value={locationSel} onChange={e => setLocationSel(e.target.value)} className={inputCls}>
                <option value={NONE}>— Unassigned —</option>
                {(locations ?? []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </div>

          {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

          <div className="mt-4">
            <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
              <Save size={14} className="mr-1" />{save.isPending ? 'Saving…' : 'Save Assignment'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
