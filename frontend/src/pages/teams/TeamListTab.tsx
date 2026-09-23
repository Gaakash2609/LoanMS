// Sales / Login team table tab — extracted verbatim from TeamsPage.tsx
// (code-quality refactor, no behaviour change).

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, ChevronDown, Eye, Archive, ArchiveRestore, Trash2, Pencil, Copy } from 'lucide-react'
import { teamsApi, type Team } from '@/api/teamsApi'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import DataTable, { type Column } from '@/components/shared/DataTable'
import TeamFormModal from '@/components/shared/TeamFormModal'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import type { LocationOption, User } from '@/types'
import { initials, avatarColor, MEMBER_PILL } from '@/pages/teams/teamHelpers'


export function TeamListTab({
  type, teams, isLoading, users, locations, canManage,
}: {
  type: 'Sales' | 'Login'
  teams: Team[]
  isLoading: boolean
  users: User[]
  locations: LocationOption[]
  canManage: boolean
}) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Team | null | 'new'>(null)
  const [viewing, setViewing] = useState<Team | null>(null)
  const [openMenu, setOpenMenu] = useState<number | null>(null)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['teams', type] })

  const archive = useMutation({
    mutationFn: (t: Team) => teamsApi.setStatus(t.id, !t.isActive),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: number) => teamsApi.delete(id),
    onSuccess: invalidate,
  })

  const [dupError, setDupError] = useState('')

  // Duplicate — creates a real new team (name + " (Copy)") carrying the
  // same type/location/leader, then re-adds every member.
  //
  // NOTE: legacy's twDuplicateTeam only cloned the team into its in-memory
  // array and called persistSave() — it never hit a create endpoint, so a
  // "duplicated" team vanished on the next sync. This uses the real
  // POST /api/teams + POST /api/teams/{id}/members routes so the copy
  // actually exists server-side.
  const duplicate = useMutation({
    mutationFn: async (t: Team) => {
      const res = await teamsApi.create({
        name: `${t.name} (Copy)`,
        type: (t.type === 'Login' ? 'Login' : 'Sales'),
        locationId: t.locationId ?? null,
        teamLeadUserId: t.teamLeadUserId ?? null,
      })
      const newId = res.data.data?.id
      if (!newId) return
      // Members are added one-by-one — there is no bulk member endpoint.
      // allSettled so one duplicate/invalid member can't abort the rest.
      await Promise.allSettled(t.members.map(m => teamsApi.addMember(newId, m.userId)))
    },
    onSuccess: () => { setDupError(''); invalidate() },
    onError: (err: unknown) => {
      const d = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      setDupError(d?.message || d?.errors?.join(' ') || 'Could not duplicate this team.')
    },
  })

  const q = search.trim().toLowerCase()
  const filtered = teams.filter(t =>
    !q || t.name.toLowerCase().includes(q) || (t.teamLead ?? '').toLowerCase().includes(q) || (t.locationName ?? '').toLowerCase().includes(q))

  const columns: Column<Team>[] = [
    {
      key: 'name', label: `${type} Team`, sortable: true, sortValue: t => t.name, render: t => (
        <div className="flex items-center gap-2.5">
          {/* Legacy avatar: square tile, per-name colour, white initials
              (efin-app.js twRenderSalesTeams) — not a fixed-blue round chip. */}
          <div
            className="w-[30px] h-[30px] rounded-lg flex items-center justify-center text-[10px] font-extrabold text-white shrink-0"
            style={{ background: avatarColor(t.name) }}
          >
            {initials(t.name)}
          </div>
          <span className="font-semibold text-gray-900 whitespace-nowrap">{t.name}</span>
        </div>
      ),
    },
    { key: 'teamLead', label: type === 'Sales' ? 'Team Leader' : 'Operation Leader', sortable: true, sortValue: t => t.teamLead ?? '', render: t => t.teamLead ?? <span className="text-gray-300">—</span> },
    // Legacy location cell: a neutral (badge-hold) pill with a 📍 pin, not a
    // blue "info" badge (efin-app.js:24449).
    { key: 'locationName', label: 'Location', sortable: true, sortValue: t => t.locationName ?? '', render: t => <Badge variant="default">📍 {t.locationName || '—'}</Badge> },
    {
      key: 'members', label: 'Members', sortable: true, sortValue: t => t.members.length, render: t => (
        <div className="flex flex-wrap gap-1 max-w-[150px]">
          {t.members.slice(0, 3).map(m => (
            <span key={m.userId} className="text-[10.5px] px-[7px] py-[2px] rounded-full whitespace-nowrap"
              style={{ background: MEMBER_PILL[type].bg, color: MEMBER_PILL[type].color }}>{m.fullName}</span>
          ))}
          {t.members.length > 3 && (
            <span title={t.members.slice(3).map(m => m.fullName).join(', ')}
              className="text-[10px] px-1.5 py-[2px] rounded-full border border-gray-200 bg-gray-50 text-gray-400">+{t.members.length - 3}</span>
          )}
          {t.members.length === 0 && <span className="text-xs text-gray-300">No members</span>}
        </div>
      ),
    },
    { key: 'isActive', label: 'Status', sortable: true, sortValue: t => (t.isActive ? 1 : 0), render: t => <Badge variant={t.isActive ? 'success' : 'default'}>{t.isActive ? 'Active' : 'Archived'}</Badge> },
    {
      key: 'actions', label: 'Actions', className: 'text-right', render: t => (
        <div className="relative inline-block text-left">
          {/* Legacy "Actions ▾" text button (row-menu-btn), not a 3-dot icon. */}
          <button onClick={() => setOpenMenu(openMenu === t.id ? null : t.id)}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50">
            Actions <ChevronDown size={12} />
          </button>
          {openMenu === t.id && (
            <div className="absolute right-0 mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1">
              {/* View Details — read-only, always available (legacy twViewTeamDetail). */}
              <button onClick={() => { setViewing(t); setOpenMenu(null) }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2">
                <Eye size={13} /> View Details
              </button>
              {canManage && (
                <>
                  <button onClick={() => { setEditing(t); setOpenMenu(null) }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2">
                    <Pencil size={13} /> Edit Team
                  </button>
                  <button onClick={() => { duplicate.mutate(t); setOpenMenu(null) }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2">
                    <Copy size={13} /> Duplicate Team
                  </button>
                  <button onClick={() => { archive.mutate(t); setOpenMenu(null) }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2">
                    {t.isActive ? <Archive size={13} /> : <ArchiveRestore size={13} />} {t.isActive ? 'Archive Team' : 'Restore Team'}
                  </button>
                  <button
                    onClick={() => { setOpenMenu(null); if (confirm(`Delete "${t.name}"? This cannot be undone.`)) remove.mutate(t.id) }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-red-50 text-red-600 flex items-center gap-2"
                  >
                    <Trash2 size={13} /> Delete Team
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      ),
    },
  ]

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by team name, leader, location…"
          className="flex-1 max-w-md border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue"
        />
        {canManage && (
          <Button size="sm" onClick={() => setEditing('new')}><Plus size={14} className="mr-1" /> New Team</Button>
        )}
      </div>

      {dupError && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{dupError}</div>
      )}

      {isLoading ? <LoadingSpinner /> : <DataTable columns={columns} data={filtered} keyField="id" emptyTitle="No teams found" />}

      {editing && (
        <TeamFormModal
          // Forces a fresh mount per target. Without it React reuses the
          // same instance when `editing` switches from one team to another
          // (or to 'new'), and TeamFormModal's useState initialisers —
          // which seed name/leader/location/members from the `team` prop —
          // don't re-run, so the form keeps showing the previous team's
          // values and stays stuck in edit mode.
          key={editing === 'new' ? 'new' : editing.id}
          team={editing === 'new' ? null : editing}
          type={type}
          locations={locations}
          users={users}
          canManage={canManage}
          onClose={() => { setEditing(null); invalidate() }}
        />
      )}

      {viewing && (
        <TeamFormModal
          key={`view-${viewing.id}`}
          team={viewing}
          type={type}
          locations={locations}
          users={users}
          canManage={canManage}
          viewOnly
          onClose={() => setViewing(null)}
        />
      )}
    </Card>
  )
}

