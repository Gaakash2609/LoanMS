import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi, type CreateUserRequest, type UpdateUserRequest } from '@/api/usersApi'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import DataTable, { type Column } from '@/components/shared/DataTable'
import PageHeader from '@/components/shared/PageHeader'
import { formatDate } from '@/utils/format'
import type { User, UserRole } from '@/types'
import { UserCheck, UserX, Plus, Pencil, MapPin, X } from 'lucide-react'

const ROLE_VARIANTS: Record<string, 'info'|'success'|'warning'|'default'> = {
  Admin: 'info', Manager: 'success', Sales: 'warning', Partner: 'default',
}

// Full 11-role set from LoanMS.Domain.Enums.UserRole (see usersApi.ts's
// CreateUserRequest/UpdateUserRequest doc-comment) — the same set Employee
// Code generation and the legacy Users form already support.
const ALL_ROLES: UserRole[] = [
  'Admin', 'Manager', 'Sales', 'Dsa', 'Partner',
  'LoginTeam', 'TeamLeader', 'Accounts', 'LocationHead', 'OperationManager', 'ProductTeam',
]

const EMPTY_FORM = { fullName: '', email: '', password: '', role: 'Sales' as UserRole, phoneNumber: '' }
const PAGE_SIZE = 20

// ── Part C: read-only Locations/Teams badges ────────────────────────────────
// Small, self-contained sub-component with its own useQuery per visible
// row — reuses the existing GET /users/{id}/locations-and-teams endpoint
// exactly as-is. Acceptable N+1 pattern for an internal admin tool's
// typically small user-count; each row's own query is independently
// cached by React Query.
function LocationsTeamsCell({ userId }: { userId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['user-locations-teams', userId],
    queryFn: () => usersApi.getLocationsAndTeams(userId).then(r => r.data.data),
    staleTime: 60_000,
  })

  if (isLoading) return <span className="text-xs text-gray-400">Loading…</span>

  const locations = data?.locations ?? []
  const teams = [...(data?.salesTeams ?? []), ...(data?.opTeams ?? [])]

  return (
    <div className="flex flex-col gap-1 max-w-[220px]">
      <div className="flex flex-wrap gap-1">
        {locations.length === 0
          ? <span className="text-xs text-gray-400 italic">No Location Assigned</span>
          : locations.map(l => (
              <span key={l.locationId} className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-100">
                {l.name}
              </span>
            ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {teams.length === 0
          ? <span className="text-xs text-gray-400 italic">No Team Assigned</span>
          : teams.map(t => (
              <span key={t.teamId} className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-100">
                {t.name}
              </span>
            ))}
      </div>
    </div>
  )
}

// ── Part D: Location/Team multi-select mapping modal ────────────────────────
// Reuses four existing endpoints as-is:
//   GET  /api/users/{id}/locations-and-teams  — this user's current mapping
//   GET  /api/locations, GET /api/teams?type= — the full option-lists
//   PUT  /api/users/{id}/locations            — whole-replace save
//   PUT  /api/users/{id}/teams                — whole-replace save
// No new backend endpoint, no duplicate mapping logic. Checkbox-state is
// initialized from the current mapping once it loads, then edited purely
// locally until Save is pressed — Cancel/closing discards changes, matching
// the Create/Edit form's own save-or-cancel convention.
function MappingModal({ user, onClose }: { user: User; onClose: () => void }) {
  const qc = useQueryClient()
  const [error, setError] = useState('')
  const [selectedLocations, setSelectedLocations] = useState<Set<number>>(new Set())
  const [selectedSales, setSelectedSales] = useState<Set<number>>(new Set())
  const [selectedOps, setSelectedOps] = useState<Set<number>>(new Set())
  const [initialized, setInitialized] = useState(false)

  const current = useQuery({
    queryKey: ['user-locations-teams', user.id],
    queryFn: () => usersApi.getLocationsAndTeams(user.id).then(r => r.data.data),
  })
  const locations = useQuery({
    queryKey: ['locations-options'],
    queryFn: () => usersApi.getAllLocations().then(r => r.data.data ?? []),
  })
  const salesTeams = useQuery({
    queryKey: ['team-options', 'Sales'],
    queryFn: () => usersApi.getAllTeams('Sales').then(r => r.data.data ?? []),
  })
  const opTeams = useQuery({
    queryKey: ['team-options', 'Login'],
    queryFn: () => usersApi.getAllTeams('Login').then(r => r.data.data ?? []),
  })

  // Seed the editable checkbox-state from the current mapping exactly
  // once, when it first arrives — not on every re-render/refetch, so a
  // half-edited selection isn't clobbered by a background refetch.
  useEffect(() => {
    if (!initialized && current.data) {
      setSelectedLocations(new Set(current.data.locations.map(l => l.locationId)))
      setSelectedSales(new Set(current.data.salesTeams.map(t => t.teamId)))
      setSelectedOps(new Set(current.data.opTeams.map(t => t.teamId)))
      setInitialized(true)
    }
  }, [initialized, current.data])

  function toggle(set: Set<number>, setFn: (s: Set<number>) => void, id: number) {
    const next = new Set(set)
    if (next.has(id)) next.delete(id); else next.add(id)
    setFn(next)
  }

  const save = useMutation({
    mutationFn: async () => {
      // Two separate calls, matching the two separate existing endpoints
      // — not combined into one, since that's the real backend contract
      // (SetLocations and SetTeams are independent whole-replace
      // operations on independent tables).
      await usersApi.setLocations(user.id, Array.from(selectedLocations))
      await usersApi.setTeams(user.id, Array.from(selectedSales), Array.from(selectedOps))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-locations-teams', user.id] })
      onClose()
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      setError(msg?.message || msg?.errors?.join(' ') || 'Could not save the mapping. Please try again.')
    },
  })

  const loadingOptions = locations.isLoading || salesTeams.isLoading || opTeams.isLoading || current.isLoading

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-lg max-h-[85vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold flex items-center gap-2"><MapPin size={16} />Locations &amp; Teams — {user.fullName}</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {error && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
        )}

        {loadingOptions ? (
          <p className="text-sm text-gray-400 py-6 text-center">Loading options…</p>
        ) : (
          <div className="space-y-5">
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">Locations</p>
              {(locations.data ?? []).length === 0
                ? <p className="text-xs text-gray-400 italic">No locations configured.</p>
                : (
                  <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto border border-gray-100 rounded-lg p-2">
                    {(locations.data ?? []).map(l => (
                      <label key={l.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={selectedLocations.has(l.id)}
                          onChange={() => toggle(selectedLocations, setSelectedLocations, l.id)} />
                        {l.name}
                      </label>
                    ))}
                  </div>
                )}
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">Sales Teams</p>
              {(salesTeams.data ?? []).length === 0
                ? <p className="text-xs text-gray-400 italic">No sales teams configured.</p>
                : (
                  <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto border border-gray-100 rounded-lg p-2">
                    {(salesTeams.data ?? []).map(t => (
                      <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={selectedSales.has(t.id)}
                          onChange={() => toggle(selectedSales, setSelectedSales, t.id)} />
                        {t.name}
                      </label>
                    ))}
                  </div>
                )}
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">Operation / Login Teams</p>
              {(opTeams.data ?? []).length === 0
                ? <p className="text-xs text-gray-400 italic">No operation teams configured.</p>
                : (
                  <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto border border-gray-100 rounded-lg p-2">
                    {(opTeams.data ?? []).map(t => (
                      <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={selectedOps.has(t.id)}
                          onChange={() => toggle(selectedOps, setSelectedOps, t.id)} />
                        {t.name}
                      </label>
                    ))}
                  </div>
                )}
            </div>
          </div>
        )}

        <div className="flex gap-2 mt-5">
          <Button size="sm" loading={save.isPending} disabled={loadingOptions} onClick={() => save.mutate()}>Save Mapping</Button>
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </Card>
    </div>
  )
}

export default function UsersPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  // Established error-display pattern already used elsewhere in this app
  // (see ProfilePage.tsx's setPwError) — no toast-store exists in this
  // codebase, so this follows the same local-state + inline-message
  // convention instead of inventing a new one.
  const [toggleError, setToggleError] = useState('')
  const qc = useQueryClient()

  // ── Create/Edit form state ──────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')

  // ── Part D: which user's mapping-modal (if any) is open ─────────────────
  const [mappingUser, setMappingUser] = useState<User | null>(null)

  // BUGFIX (confirmed real, pre-existing gap — Phase 4 Part C audit): see
  // usersApi.ts's getAll() doc-comment. UsersController.GetAll() takes no
  // page/pageSize/search parameters and returns a plain array, not a
  // paged shape. Corrected to fetch the full array once and
  // paginate/search client-side.
  const { data: allUsers, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.getAll().then(r => r.data.data),
  })

  const filtered = (allUsers ?? []).filter(u => {
    if (!query) return true
    const q = query.toLowerCase()
    return u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
  })
  const totalCount = filtered.length
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const toggle = useMutation({
    // BUGFIX (Phase 4 Part A): toggleActive now needs the TARGET isActive
    // value explicitly — passes the flipped current state from here.
    mutationFn: (u: User) => usersApi.toggleActive(u.id, !u.isActive),
    onSuccess: () => { setToggleError(''); qc.invalidateQueries({ queryKey: ['users'] }) },
    onError: () => setToggleError('Could not update user status. Please try again.'),
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
    setEditingUser(u)
    setForm({ fullName: u.fullName, email: u.email, password: '', role: u.role, phoneNumber: '' })
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
        payload: { fullName: form.fullName.trim(), isActive: editingUser.isActive, role: form.role, phoneNumber: form.phoneNumber || undefined },
      })
    } else {
      create.mutate({
        fullName: form.fullName.trim(), email: form.email.trim(), password: form.password,
        role: form.role, phoneNumber: form.phoneNumber || undefined,
      })
    }
  }

  const saving = create.isPending || update.isPending

  const columns: Column<User>[] = [
    { key: 'fullName', label: 'Name',  render: (u: User) => (
      <div><p className="font-medium">{u.fullName}</p><p className="text-xs text-gray-500">{u.email}</p></div>
    )},
    { key: 'employeeCode', label: 'Employee Code', render: (u: User) => (
      u.employeeCode
        ? <span className="font-mono text-xs text-gray-600">{u.employeeCode}</span>
        : <span className="text-xs text-gray-400 italic">—</span>
    )},
    { key: 'role', label: 'Role', render: (u: User) => (
      <Badge variant={ROLE_VARIANTS[u.role] ?? 'default'}>{u.role}</Badge>
    )},
    { key: 'locationsTeams', label: 'Locations & Teams', render: (u: User) => (
      <LocationsTeamsCell userId={u.id} />
    )},
    { key: 'isActive', label: 'Status', render: (u: User) => (
      <Badge variant={u.isActive ? 'success' : 'danger'}>{u.isActive ? 'Active' : 'Inactive'}</Badge>
    )},
    { key: 'createdAt', label: 'Joined', render: (u: User) => formatDate(u.createdAt) },
    { key: 'actions', label: '', render: (u: User) => (
      <div className="flex items-center gap-1">
        <button
          onClick={() => setMappingUser(u)}
          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
          title="Manage Locations & Teams"
        >
          <MapPin size={14} />
        </button>
        <button
          onClick={() => openEditForm(u)}
          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
          title="Edit user"
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={() => toggle.mutate(u)}
          className={`p-1.5 rounded-lg transition-colors ${u.isActive ? 'text-red-500 hover:bg-red-50' : 'text-green-500 hover:bg-green-50'}`}
          title={u.isActive ? 'Deactivate' : 'Activate'}
        >
          {u.isActive ? <UserX size={14} /> : <UserCheck size={14} />}
        </button>
      </div>
    )},
  ]

  return (
    <div>
      <PageHeader title="User Management" subtitle={`${totalCount} users`}
        action={<Button size="sm" onClick={openCreateForm}><Plus size={14} className="mr-1" />Add User</Button>} />

      {showForm && (
        <Card className="mb-5 p-5">
          <p className="text-sm font-semibold mb-4">{editingUser ? `Edit User — ${editingUser.fullName}` : 'New User'}</p>
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
          </div>
          <div className="flex gap-2">
            <Button size="sm" loading={saving} onClick={handleSave}>{editingUser ? 'Save Changes' : 'Create User'}</Button>
            <Button size="sm" variant="secondary" onClick={closeForm}>Cancel</Button>
          </div>
        </Card>
      )}

      <Card>
        {toggleError && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {toggleError}
          </div>
        )}
        <form onSubmit={e => { e.preventDefault(); setQuery(search); setPage(1) }}
          className="flex gap-2 mb-5">
          <input
            type="text" placeholder="Search users..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
          />
          <Button type="submit" variant="secondary" size="sm">Search</Button>
        </form>
        <DataTable
          columns={columns} data={pageItems}
          isLoading={isLoading} totalPages={totalPages}
          currentPage={page} onPageChange={setPage} totalCount={totalCount}
        />
      </Card>

      {mappingUser && (
        <MappingModal user={mappingUser} onClose={() => setMappingUser(null)} />
      )}
    </div>
  )
}
