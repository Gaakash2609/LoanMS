import { useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { UserPlus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { teamsApi, type Team, type TeamSaveRequest } from '@/api/teamsApi'
import type { LocationOption, User } from '@/types'

// Per-name avatar colour + initials — same port of legacy twAvi/twInitials the
// Teams list uses, for the read-only "View Details" panel (twViewTeamDetail).
const TW_AVATARS = ['#1a4fa3', '#e31e25', '#ffb347', '#a159ff', '#f472b6', '#10b981', '#ff4560', '#0ea5e9']
function avatarColor(name: string) {
  const n = name || ''
  return TW_AVATARS[Math.abs((n.charCodeAt(0) || 0) + (n.charCodeAt(n.length - 1) || 0)) % TW_AVATARS.length]
}
function initials(name: string) {
  const parts = (name || '').trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

// Sales/Login Team create+edit — mirrors legacy's inline "Team Details"
// panel (efin-app.js's twSaveSalesTeamDetail/twSaveLoginTeamDetail +
// twAddMember/twRemoveMember), collapsed into a modal since this codebase
// has no full-page-replacement panel pattern elsewhere. On successful
// create, stays open and switches into edit mode for the new team so
// members can be added immediately — legacy's own flow also only allows
// adding members once the team exists.
export default function TeamFormModal({
  team, type, locations, users, canManage, viewOnly, onClose,
}: {
  team: Team | null
  type: 'Sales' | 'Login'
  locations: LocationOption[]
  users: User[]
  canManage: boolean
  // Read-only "View Details" mode — legacy twViewTeamDetail (efin-app.js:24541).
  // Renders the team's avatar/status/leader/location/members as a static info
  // panel instead of the editable form; no Save, only Close.
  viewOnly?: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [current, setCurrent] = useState<Team | null>(team)
  const [name, setName] = useState(team?.name ?? '')
  const [teamLeadUserId, setTeamLeadUserId] = useState<number | ''>(team?.teamLeadUserId ?? '')
  const [locationId, setLocationId] = useState<number | ''>(team?.locationId ?? '')
  const [isActive, setIsActive] = useState(team?.isActive ?? true)
  const [error, setError] = useState('')
  const [memberSearch, setMemberSearch] = useState('')
  const [showMemberPicker, setShowMemberPicker] = useState(false)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['teams'] })

  const save = useMutation({
    mutationFn: async () => {
      const payload: TeamSaveRequest = {
        name: name.trim(), type,
        locationId: locationId === '' ? null : locationId,
        teamLeadUserId: teamLeadUserId === '' ? null : teamLeadUserId,
      }
      if (current) {
        await teamsApi.update(current.id, payload)
        if (isActive !== current.isActive) await teamsApi.setStatus(current.id, isActive)
        return current.id
      }
      const res = await teamsApi.create(payload)
      return res.data.data!.id
    },
    onSuccess: (id) => {
      invalidate()
      setError('')
      if (!current) {
        // Just created — switch into edit mode (with the fields we already
        // know, since GetAll() would need a refetch to know) so the member
        // section becomes available without closing the modal.
        setCurrent({
          id, name: name.trim(), type, locationId: locationId === '' ? null : locationId,
          teamLeadUserId: teamLeadUserId === '' ? null : teamLeadUserId,
          teamLead: users.find(u => u.id === teamLeadUserId)?.fullName ?? null,
          locationName: locations.find(l => l.id === locationId)?.name ?? null,
          isActive: true, members: [],
        })
      }
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setError(msg || 'Could not save this team. Please try again.')
    },
  })

  const addMember = useMutation({
    mutationFn: (userId: number) => teamsApi.addMember(current!.id, userId),
    onSuccess: (_res, userId) => {
      invalidate()
      const u = users.find(x => x.id === userId)
      if (u && current) setCurrent({ ...current, members: [...current.members, { userId: u.id, fullName: u.fullName, email: u.email }] })
      setShowMemberPicker(false)
      setMemberSearch('')
    },
  })

  const removeMember = useMutation({
    mutationFn: (userId: number) => teamsApi.removeMember(current!.id, userId),
    onSuccess: (_res, userId) => {
      invalidate()
      if (current) setCurrent({ ...current, members: current.members.filter(m => m.userId !== userId) })
    },
  })

  const memberIds = new Set((current?.members ?? []).map(m => m.userId))
  // Legacy twAddMember (efin-app.js:24681): when the team has a Location
  // selected, the member picker only offers users assigned to THAT location
  // (`twUsers.filter(u => u.locs.includes(locVal))`); with no location it
  // offers everyone. api-bridge maps each user's `locs` from the single
  // primary `locationName`, so this compares against that same field — an
  // exact match of the real (API-backed) legacy behaviour. Uses the CURRENT
  // location selection (may differ from the saved one), like legacy.
  const selectedLocationName = locationId === '' ? '' : (locations.find(l => l.id === locationId)?.name ?? '')
  const availableUsers = users.filter(u =>
    !memberIds.has(u.id) &&
    (!selectedLocationName || (u.locationName ?? '') === selectedLocationName) &&
    (!memberSearch.trim() || u.fullName.toLowerCase().includes(memberSearch.toLowerCase())))

  // ── Read-only View Details (legacy twViewTeamDetail) ──────────────────────
  if (viewOnly && team) {
    const pillColor = type === 'Sales' ? 'var(--accent)' : '#10b981'
    const Row = ({ label, value }: { label: string; value: ReactNode }) => (
      <div className="flex gap-3 py-[7px] border-b border-gray-100">
        <div className="min-w-[120px] text-xs font-semibold text-gray-500">{label}</div>
        <div className="text-[13px] text-gray-800">{value || '—'}</div>
      </div>
    )
    return (
      <Modal open onClose={onClose} title={`${type === 'Sales' ? 'Sales' : 'Login'} Team — ${team.name}`} size="md" className="sm:max-w-lg"
        footer={<Button size="sm" variant="secondary" onClick={onClose}>Close</Button>}>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-[42px] h-[42px] rounded-[10px] flex items-center justify-center text-sm font-extrabold text-white shrink-0" style={{ background: avatarColor(team.name) }}>
            {initials(team.name)}
          </div>
          <div>
            <div className="text-[15px] font-bold text-gray-900">{team.name}</div>
            <div className="text-xs font-bold" style={{ color: team.isActive ? '#059669' : '#6b7280' }}>● {team.isActive ? 'Active' : 'Archived'}</div>
          </div>
        </div>
        <Row label="Type" value={type === 'Sales' ? 'Sales Team' : 'Login / Operation Team'} />
        <Row label={type === 'Sales' ? 'Leader' : 'Operation Leader'} value={team.teamLead} />
        <Row label="Location" value={team.locationName ? `📍 ${team.locationName}` : '—'} />
        <Row label={`Members (${team.members.length})`} value={
          team.members.length
            ? <div className="flex flex-wrap gap-1.5">{team.members.map(m => (
                <span key={m.userId} className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `${pillColor}22`, color: pillColor }}>{m.fullName}</span>
              ))}</div>
            : '—'
        } />
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={current ? `Edit ${type} Team` : `New ${type} Team`}
      size="md"
      className="sm:max-w-lg"
      footer={<>
        {canManage && (
          <Button size="sm" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>
            {current ? 'Save Changes' : 'Create Team'}
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={onClose}>{canManage ? 'Cancel' : 'Close'}</Button>
      </>}
    >
      <div className="space-y-3">
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          <Input label={`${type} Team Name *`} value={name} onChange={e => setName(e.target.value)} disabled={!canManage} />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{type === 'Sales' ? 'Team Leader' : 'Operation Leader'}</label>
            <select value={teamLeadUserId} onChange={e => setTeamLeadUserId(e.target.value ? Number(e.target.value) : '')} disabled={!canManage}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue">
              <option value="">— None —</option>
              {/* Legacy leader select shows "Name (Role)" (efin-app.js twPopulateUserSelect). */}
              {users.map(u => <option key={u.id} value={u.id}>{u.fullName} ({u.role})</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
            <select value={locationId} onChange={e => setLocationId(e.target.value ? Number(e.target.value) : '')} disabled={!canManage}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue">
              <option value="">— None —</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>

          {/* Company — legacy's New Team modal shows a read-only Company field
              (index.html tw-team-modal); it is decorative and never persisted
              (twSaveTeamModal reads only name/leader/location), so it appears
              only on create, disabled, matching legacy 1:1. */}
          {!current && (
            <Input label="Company" value="EFIN Finance Pvt. Ltd." disabled readOnly />
          )}

          {current && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select value={isActive ? 'active' : 'archived'} onChange={e => setIsActive(e.target.value === 'active')} disabled={!canManage}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue">
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          )}

          {current && (
            <div className="pt-2 border-t border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">Members ({current.members.length})</label>
                {canManage && (
                  <button onClick={() => setShowMemberPicker(v => !v)} className="text-xs font-semibold text-efin-blue flex items-center gap-1">
                    <UserPlus size={13} /> Add Member
                  </button>
                )}
              </div>

              {showMemberPicker && (
                <div className="mb-2 border border-gray-200 rounded-lg p-2">
                  <input value={memberSearch} onChange={e => setMemberSearch(e.target.value)} placeholder="Search users…"
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs mb-1.5" />
                  <div className="max-h-32 overflow-y-auto flex flex-col gap-0.5">
                    {availableUsers.length === 0 && <p className="text-xs text-gray-400 px-1 py-1">No matching users</p>}
                    {availableUsers.slice(0, 30).map(u => (
                      <button key={u.id} onClick={() => addMember.mutate(u.id)}
                        className="text-left text-xs px-2 py-1.5 rounded hover:bg-gray-50 flex items-center justify-between">
                        <span>{u.fullName} <span className="text-gray-400">· {u.email}</span></span>
                        <span className="text-efin-blue font-semibold">+ Add</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-1">
                {current.members.map(m => (
                  <div key={m.userId} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-2.5 py-1.5">
                    <span className="font-medium text-gray-700">{m.fullName} <span className="text-gray-400 font-normal">· {m.email}</span></span>
                    {canManage && (
                      <button onClick={() => removeMember.mutate(m.userId)} className="text-red-400 hover:text-red-600">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
                {current.members.length === 0 && <p className="text-xs text-gray-400">No members yet.</p>}
              </div>
            </div>
          )}
      </div>
    </Modal>
  )
}
