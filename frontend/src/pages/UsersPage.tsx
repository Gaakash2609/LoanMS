import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi, type CreateUserRequest, type UpdateUserRequest } from '@/api/usersApi'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import DataTable, { type Column, sortRows } from '@/components/shared/DataTable'
import { useTableSort } from '@/hooks/useTableSort'
import PageHeader from '@/components/shared/PageHeader'
import type { User, UserRole } from '@/types'
import { UserCheck, UserX, Plus, Pencil, X, Copy, Search, Users as UsersIcon, ShieldCheck } from 'lucide-react'
import { useToast } from '@/store/toastStore'
import { useAuthStore } from '@/store/authStore'
// Constants, widgets and modals extracted to their own modules under pages/users.
import { ROLE_LABELS, ALL_ROLES, EMPTY_FORM, PAGE_SIZE, avatarColor, userInitials } from '@/pages/users/userConstants'
import { RolePill, UserActionsMenu, UserPill } from '@/pages/users/UserWidgets'
import { ResetPasswordModal, ViewUserDetailModal, MappingModal } from '@/pages/users/UserModals'

export default function UsersPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  // Inline message kept (it is anchored next to the control that failed), and
  // now also surfaced as a toast so the failure is noticed when the user's
  // attention is elsewhere on a long list. A toast store exists as of the
  // legacy-parity work — see store/toastStore.ts.
  const [toggleError, setToggleError] = useState('')
  const toast = useToast()
  const qc = useQueryClient()

  // ── Create/Edit form state ──────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')

  // ── Part D: which user's mapping-modal (if any) is open ─────────────────
  const [mappingUser, setMappingUser] = useState<User | null>(null)
  const [resetUser, setResetUser] = useState<User | null>(null)
  const [viewUser, setViewUser] = useState<User | null>(null)
  const [actionError, setActionError] = useState('')
  const signedInUser = useAuthStore(s => s.user)

  // BUGFIX (confirmed real, pre-existing gap — Phase 4 Part C audit): see
  // usersApi.ts's getAll() doc-comment. UsersController.GetAll() takes no
  // page/pageSize/search parameters and returns a plain array, not a
  // paged shape. Corrected to fetch the full array once and
  // paginate/search client-side.
  const { data: allUsers, isLoading, error, refetch } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.getAll().then(r => r.data.data),
  })

  const { sortKey, sortDir, toggle: onSort } = useTableSort()

  // Option lists for the "All Locations" filter and the create/edit form's
  // primary Location / Sales-Team / Operation-Team selects (legacy's
  // tw-user-modal populates these from twLocations / twSalesTeams /
  // twLoginTeams — the same GET /api/locations and GET /api/teams lists).
  const { data: allLocations } = useQuery({
    queryKey: ['locations-lookup'],
    queryFn: () => usersApi.getAllLocations().then(r => r.data.data ?? []),
    staleTime: 300_000,
  })
  const { data: salesTeamOptions } = useQuery({
    queryKey: ['team-options', 'Sales'],
    queryFn: () => usersApi.getAllTeams('Sales').then(r => r.data.data ?? []),
    staleTime: 300_000,
  })
  const { data: opTeamOptions } = useQuery({
    queryKey: ['team-options', 'Login'],
    queryFn: () => usersApi.getAllTeams('Login').then(r => r.data.data ?? []),
    staleTime: 300_000,
  })

  // Location filter — legacy's twApplyUserFilters matches on the user's
  // PRIMARY location (`u.locs`, api-bridge-mapped to `[locationName]`), which
  // GET /api/users already returns as UserDto.LocationName. So filter on that
  // single field directly — no per-user fetch (the earlier N+1 is gone).
  const filtered = (allUsers ?? []).filter(u => {
    if (roleFilter && u.role !== roleFilter) return false
    if (locationFilter && (u.locationName ?? '') !== locationFilter) return false
    if (!query) return true
    const q = query.toLowerCase()
    return u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
  })
  const totalCount = filtered.length
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  const toggle = useMutation({
    // BUGFIX (Phase 4 Part A): toggleActive now needs the TARGET isActive
    // value explicitly — passes the flipped current state from here.
    mutationFn: (u: User) => usersApi.toggleActive(u.id, !u.isActive),
    onSuccess: () => { setToggleError(''); toast.success('User status updated'); qc.invalidateQueries({ queryKey: ['users'] }) },
    onError: () => { setToggleError('Could not update user status. Please try again.'); toast.error('Could not update user status') },
  })

  // DELETE /api/users/{id} — Admin only, and the backend also refuses
  // self-deletion. The button is hidden for the signed-in user as well.
  const remove = useMutation({
    mutationFn: (id: number) => usersApi.delete(id),
    onSuccess: () => { setActionError(''); qc.invalidateQueries({ queryKey: ['users'] }) },
    onError: (err: unknown) => {
      const d = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      setActionError(d?.message || d?.errors?.join(' ') || 'Could not delete this user.')
    },
  })

  function closeForm() {
    setShowForm(false); setEditingUser(null); setForm(EMPTY_FORM); setFormError('')
  }

  function openCreateForm() {
    setEditingUser(null); setForm(EMPTY_FORM); setFormError(''); setShowForm(true)
  }

  function openEditForm(u: User) {
    // Email and password are deliberately NOT pre-filled — UpdateUserRequestDto
    // has no Email field, and password/reset flows are out of scope here.
    // Mobile / primary Location / Sales-Team / Operation-Team / Status ARE
    // pre-filled from the user (legacy twEditUser seeds the same fields).
    setEditingUser(u)
    setForm({
      fullName: u.fullName, email: u.email, password: '', role: u.role,
      phoneNumber: u.phoneNumber ?? '', locationName: u.locationName ?? '',
      salesTeam: u.salesTeam ?? '', opTeam: u.opTeam ?? '', isActive: u.isActive,
    })
    setFormError('')
    setShowForm(true)
  }

  function validate(): string | null {
    if (!form.fullName.trim()) return 'Full name is required.'
    if (!editingUser) {
      if (!form.email.trim()) return 'Email is required.'
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return 'Enter a valid email address.'
      if (!form.password || form.password.length < 6) return 'Password must be at least 6 characters.'
    }
    return null
  }

  const create = useMutation({
    mutationFn: (payload: CreateUserRequest) => usersApi.create(payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); closeForm() },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      setFormError(msg?.message || msg?.errors?.join(' ') || 'Could not create user. Please check the details and try again.')
    },
  })

  const update = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdateUserRequest }) => usersApi.update(id, payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); closeForm() },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      setFormError(msg?.message || msg?.errors?.join(' ') || 'Could not save changes. Please try again.')
    },
  })

  function handleSave() {
    const validationError = validate()
    if (validationError) { setFormError(validationError); return }
    setFormError('')
    if (editingUser) {
      update.mutate({
        id: editingUser.id,
        payload: {
          fullName: form.fullName.trim(), isActive: form.isActive, role: form.role,
          phoneNumber: form.phoneNumber || undefined,
          locationName: form.locationName || undefined,
          salesTeam: form.salesTeam || undefined,
          opTeam: form.opTeam || undefined,
        },
      })
    } else {
      create.mutate({
        fullName: form.fullName.trim(), email: form.email.trim(), password: form.password,
        role: form.role, phoneNumber: form.phoneNumber || undefined,
        locationName: form.locationName || undefined,
        salesTeam: form.salesTeam || undefined,
        opTeam: form.opTeam || undefined,
      })
    }
  }

  const saving = create.isPending || update.isPending

  const columns: Column<User>[] = [
    // Name — legacy shows a coloured initials avatar beside the name, with the
    // user's mobile number in a small line underneath (efin-app.js:24910).
    { key: 'fullName', label: 'Name', sortable: true, sortValue: u => u.fullName, render: (u: User) => (
      <div className="flex items-center gap-2.5">
        <span className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
          style={{ background: avatarColor(u.fullName) }}>{userInitials(u.fullName)}</span>
        <div className="min-w-0">
          <span className="block font-medium truncate">{u.fullName}</span>
          {u.phoneNumber && <span className="block text-[10px]" style={{ color: 'var(--text3)' }}>{u.phoneNumber}</span>}
        </div>
      </div>
    )},
    // User ID — legacy's copyable code chip.
    { key: 'employeeCode', label: 'User ID', sortable: true, sortValue: u => u.employeeCode ?? '', render: (u: User) => (
      u.employeeCode
        ? <button type="button" onClick={() => navigator.clipboard?.writeText(u.employeeCode!)}
            title="Copy User ID"
            className="inline-flex items-center gap-1.5 font-mono text-[11px] px-2 py-1 rounded-md border whitespace-nowrap"
            style={{ background: 'var(--surface2)', borderColor: 'var(--border)', color: 'var(--text2)' }}>
            {u.employeeCode}<Copy size={11} className="opacity-60" />
          </button>
        : <span className="text-xs text-gray-400 italic">—</span>
    )},
    { key: 'email', label: 'Email / Login', sortable: true, sortValue: u => u.email, render: (u: User) => (
      <span className="text-sm" style={{ color: 'var(--text2)' }}>{u.email}</span>
    )},
    { key: 'role', label: 'Role', sortable: true, sortValue: u => u.role, render: (u: User) => (
      <RolePill role={u.role} />
    )},
    // Status — legacy's "● Active" pill (efin-app.js:24898), not a plain badge.
    { key: 'isActive', label: 'Status', sortable: true, sortValue: u => (u.isActive ? 1 : 0), render: (u: User) => (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap"
        style={u.isActive
          ? { color: 'var(--success)', background: 'rgba(16,185,129,.12)' }
          : { color: '#dc2626', background: 'rgba(220,38,38,.1)' }}>
        ● {u.isActive ? 'Active' : 'Inactive'}
      </span>
    )},
    // Locations / Sales Team(s) / Operation Team(s) — THREE separate columns
    // like legacy (efin-app.js:24915-24917), each showing the user's PRIMARY
    // value as a coloured pill (blue / amber / green). These are the
    // denormalised UserDto.LocationName/SalesTeam/OpTeam GET /api/users already
    // returns; the full multi-assignment is managed via "Manage Locations &
    // Teams" (same split as legacy: table shows primary, editor shows the set).
    { key: 'locationName', label: 'Locations', sortable: true, sortValue: u => u.locationName ?? '', render: (u: User) => (
      <UserPill value={u.locationName} color="var(--accent)" bg="rgba(8,88,151,.1)" prefix="📍 " />
    )},
    { key: 'salesTeam', label: 'Sales Team(s)', sortable: true, sortValue: u => u.salesTeam ?? '', render: (u: User) => (
      <UserPill value={u.salesTeam} color="#f59e0b" bg="rgba(255,179,71,.12)" />
    )},
    { key: 'opTeam', label: 'Operation Team(s)', sortable: true, sortValue: u => u.opTeam ?? '', render: (u: User) => (
      <UserPill value={u.opTeam} color="#10b981" bg="rgba(16,185,129,.1)" />
    )},
    { key: 'actions', label: 'Actions', render: (u: User) => (
      <div className="flex justify-end">
        <UserActionsMenu
          isActive={u.isActive}
          onView={() => setViewUser(u)}
          onEdit={() => openEditForm(u)}
          onMap={() => setMappingUser(u)}
          onToggle={() => toggle.mutate(u)}
          onReset={() => setResetUser(u)}
          // Hidden for the signed-in user — the backend rejects deleting your
          // own account, so offering it would only ever error.
          onDelete={u.id !== signedInUser?.id
            ? () => { if (confirm(`Delete "${u.fullName}"? This cannot be undone.`)) remove.mutate(u.id) }
            : undefined}
        />
      </div>
    )},
  ]

  // Sort the FULL filtered list, then slice — so a sort spans every page,
  // not just the visible slice (columns are needed for sortValue, hence
  // computed here rather than up with the other derived values).
  const pageItems = sortRows(filtered, columns, sortKey, sortDir)
    .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div>
      <PageHeader title="Users" subtitle="User accounts, roles, locations and team assignments"
        action={<Button size="sm" onClick={openCreateForm}><Plus size={14} className="mr-1" />Add User</Button>} />

      {/* At-a-glance summary strip — same .kpi-card language as the Reports
          page, computed client-side from the already-fetched user list (no
          extra request). Gives an instant read on headcount/active split
          and how many distinct roles exist, instead of only a raw table. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Users', value: allUsers?.length ?? 0, sub: 'All roles combined', icon: UsersIcon, accent: 'var(--accent)', tint: 'var(--accent-subtle)' },
          { label: 'Active', value: (allUsers ?? []).filter(u => u.isActive).length, sub: 'Currently signed-in eligible', icon: UserCheck, accent: 'var(--success)', tint: 'rgba(26,115,64,.1)' },
          { label: 'Inactive', value: (allUsers ?? []).filter(u => !u.isActive).length, sub: 'Deactivated accounts', icon: UserX, accent: 'var(--danger)', tint: 'rgba(192,57,43,.1)' },
          { label: 'Admins', value: (allUsers ?? []).filter(u => u.role === 'Admin').length, sub: 'Full-access accounts', icon: ShieldCheck, accent: '#7c3aed', tint: 'rgba(124,58,237,.1)' },
        ].map(({ label, value, sub, icon: Icon, accent, tint }) => (
          <div key={label} className="kpi-card" style={{ ['--kpi-accent' as string]: accent, ['--kpi-tint' as string]: tint }}>
            <div className="kpi-icon" style={{ color: accent }}>
              <Icon size={19} strokeWidth={2.25} />
            </div>
            <p className="text-[11px] font-semibold uppercase mt-1" style={{ letterSpacing: '1px', color: 'var(--text3)' }}>{label}</p>
            <p className="text-[24px] font-black leading-tight mt-1" style={{ fontFamily: 'var(--font-head)', letterSpacing: '-.5px', color: 'var(--text)' }}>{value}</p>
            <p className="text-xs mt-1.5" style={{ color: 'var(--text3)' }}>{sub}</p>
          </div>
        ))}
      </div>

      {showForm && (
        <Card className="mb-5 p-5">
          <p className="text-sm font-bold mb-4 flex items-center gap-2" style={{ color: 'var(--text)' }}>
            <span className="section-icon-badge" style={{ color: 'var(--accent)' }}>{editingUser ? <Pencil size={15} /> : <Plus size={16} />}</span>
            {editingUser ? `Edit User — ${editingUser.fullName}` : 'New User'}
          </p>
          {formError && (
            <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {formError}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Full Name *</label>
              <input value={form.fullName} onChange={e => setForm(p => ({ ...p, fullName: e.target.value }))}
                placeholder="Full name" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Email {editingUser ? '' : '*'}</label>
              <input value={form.email} disabled={!!editingUser}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                placeholder="email@example.com"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400" />
              {editingUser && <p className="text-xs text-gray-400 mt-1">Email cannot be changed here.</p>}
            </div>
            {!editingUser && (
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Password *</label>
                <input type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                  placeholder="Minimum 6 characters" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Role *</label>
              <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value as UserRole }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                {ALL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Phone</label>
              <input value={form.phoneNumber} onChange={e => setForm(p => ({ ...p, phoneNumber: e.target.value }))}
                placeholder="10-digit mobile" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            {/* Primary Location / Sales-Team / Operation-Team + Status — legacy's
                tw-user-modal single-selects (efin-app.js twSaveUser). Status is
                editable only on edit — CreateUserRequestDto has no IsActive, so
                new users are always created Active (legacy's api-bridge create
                hard-codes isActive:true too). */}
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Location</label>
              <select value={form.locationName} onChange={e => setForm(p => ({ ...p, locationName: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">— Select Location —</option>
                {(allLocations ?? []).map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Sales Team</label>
              <select value={form.salesTeam} onChange={e => setForm(p => ({ ...p, salesTeam: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">— Select Sales Team —</option>
                {(salesTeamOptions ?? []).map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Operation Team</label>
              <select value={form.opTeam} onChange={e => setForm(p => ({ ...p, opTeam: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">— Select Operation Team —</option>
                {(opTeamOptions ?? []).map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
            </div>
            {editingUser && (
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Status</label>
                <select value={form.isActive ? 'active' : 'inactive'} onChange={e => setForm(p => ({ ...p, isActive: e.target.value === 'active' }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" loading={saving} onClick={handleSave}>{editingUser ? 'Save Changes' : 'Create User'}</Button>
            <Button size="sm" variant="secondary" onClick={closeForm}>Cancel</Button>
          </div>
        </Card>
      )}

      <Card>
        {(toggleError || actionError) && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {toggleError || actionError}
          </div>
        )}
        {/* Search + role + location filters — legacy's Users toolbar
            (index.html:5991) stacked these three full-width, one per row,
            which reads as a plain HTML form and wastes most of a wide
            desktop screen. Kept stacked on mobile (each control still needs
            full width there) but laid out as one row from `sm` up, with a
            search icon + inline clear button instead of a bare text input. */}
        <div className="flex flex-col sm:flex-row gap-2.5 mb-5">
          <form onSubmit={e => { e.preventDefault(); setQuery(search); setPage(1) }} className="relative flex-1 min-w-[200px]">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text3)' }} />
            <input
              type="text" placeholder="Search by name or email…"
              value={search} onChange={e => { setSearch(e.target.value); setQuery(e.target.value); setPage(1) }}
              className="w-full rounded-lg pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue transition-colors"
              style={{ border: '1.5px solid var(--border)', color: 'var(--text)' }}
            />
            {search && (
              <button type="button" aria-label="Clear search"
                onClick={() => { setSearch(''); setQuery(''); setPage(1) }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 hover:opacity-70"
                style={{ color: 'var(--text3)' }}>
                <X size={14} />
              </button>
            )}
          </form>
          <select value={roleFilter} onChange={e => { setRoleFilter(e.target.value); setPage(1) }}
            className="rounded-lg px-3.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-efin-blue sm:w-52 transition-colors"
            style={{ border: '1.5px solid var(--border)', color: 'var(--text2)' }}>
            <option value="">All Roles</option>
            {ALL_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>)}
          </select>
          <select value={locationFilter} onChange={e => { setLocationFilter(e.target.value); setPage(1) }}
            className="rounded-lg px-3.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-efin-blue sm:w-52 transition-colors"
            style={{ border: '1.5px solid var(--border)', color: 'var(--text2)' }}>
            <option value="">All Locations</option>
            {(allLocations ?? []).map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
          </select>
        </div>
        <DataTable
          columns={columns} data={pageItems}
          isLoading={isLoading} error={error} onRetry={() => refetch()}
          emptyTitle="No users found"
          emptyDescription="Try a different search or role filter."
          sortKey={sortKey} sortDir={sortDir} onSort={k => { onSort(k); setPage(1) }}
          totalPages={totalPages}
          currentPage={page} onPageChange={setPage} totalCount={totalCount}
        />
      </Card>

      {viewUser && (
        <ViewUserDetailModal user={viewUser} onClose={() => setViewUser(null)} />
      )}
      {mappingUser && (
        <MappingModal user={mappingUser} onClose={() => setMappingUser(null)} />
      )}
      {resetUser && (
        <ResetPasswordModal user={resetUser} onClose={() => setResetUser(null)} />
      )}
    </div>
  )
}
