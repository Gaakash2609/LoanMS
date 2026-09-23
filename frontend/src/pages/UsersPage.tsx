import { useState, useEffect, useRef, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi, type CreateUserRequest, type UpdateUserRequest } from '@/api/usersApi'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import DataTable, { type Column, sortRows } from '@/components/shared/DataTable'
import { useTableSort } from '@/hooks/useTableSort'
import PageHeader from '@/components/shared/PageHeader'
import type { User, UserRole } from '@/types'
import { UserCheck, UserX, Plus, Pencil, MapPin, X, KeyRound, Trash2, Copy, ChevronDown, Eye, Search, Users as UsersIcon, ShieldCheck } from 'lucide-react'
import { useToast } from '@/store/toastStore'
import { useAuthStore } from '@/store/authStore'

// Admin reset-password modal — POST /api/users/{id}/reset-password.
// No current password is required (that's what makes it an admin reset);
// the backend enforces Admin-only via [Authorize(Roles = "Admin")].
function ResetPasswordModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const reset = useMutation({
    mutationFn: () => usersApi.adminResetPassword(user.id, pw),
    onSuccess: () => { setError(''); setDone(true) },
    onError: (err: unknown) => {
      const d = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      setError(d?.message || d?.errors?.join(' ') || 'Could not reset this password.')
    },
  })

  function submit() {
    if (pw.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (pw !== confirm) { setError('Passwords do not match.'); return }
    setError('')
    reset.mutate()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[var(--z-modal)] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Reset Password</h3>
            <p className="text-xs text-gray-500">{user.fullName} · {user.email}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          {done ? (
            <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              Password reset. Share the new password with {user.fullName} securely — they should change it after signing in.
            </div>
          ) : (
            <>
              <div>
                <label className="text-xs font-semibold text-gray-600 uppercase block mb-1">New Password</label>
                <input type="password" value={pw} onChange={e => setPw(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 uppercase block mb-1">Confirm Password</label>
                <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <p className="text-xs text-gray-400">Minimum 6 characters. The user is not asked for their current password.</p>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-200">
          {!done && <Button size="sm" loading={reset.isPending} onClick={submit}>Reset Password</Button>}
          <Button size="sm" variant="secondary" onClick={onClose}>{done ? 'Close' : 'Cancel'}</Button>
        </div>
      </div>
    </div>
  )
}

// Legacy display labels for the role enum (efin-app.js ROLES[].label) — e.g.
// the Sales enum shows as "Sales Person", Dsa as "DSA User", etc.
const ROLE_LABELS: Record<string, string> = {
  Admin: 'Admin', Manager: 'Manager', Sales: 'Sales Person', Dsa: 'DSA User',
  Partner: 'Partner', LoginTeam: 'Login Team', TeamLeader: 'Team Leader',
  Accounts: 'Accounts', LocationHead: 'Location Head',
  OperationManager: 'Operation Manager', ProductTeam: 'Product Team',
}

// Role → colour. The generic <Badge> component only has 5 variants
// (default/success/warning/danger/info), so mapping all 11 roles onto it
// left 7 of them (Dsa, LoginTeam, TeamLeader, Accounts, LocationHead,
// OperationManager, ProductTeam) sharing the exact same neutral-gray
// "default" pill — every non-Admin/Manager/Sales/Partner user looked
// identical at a glance in the table. This gives every role its own colour
// (Admin/Manager/Sales keep the app's own brand tokens; the rest get a
// distinct hue each), same visual language as STATUS_COLORS/UserPill.
const ROLE_COLORS: Record<string, string> = {
  Admin: 'var(--accent)', Manager: 'var(--success)', Sales: 'var(--warn)',
  Dsa: '#7c3aed', Partner: '#64748b', LoginTeam: '#0891b2',
  TeamLeader: '#e11d48', Accounts: '#65a30d', LocationHead: '#0d9488',
  OperationManager: '#4f46e5', ProductTeam: '#c026d3',
}
function RolePill({ role }: { role: string }) {
  const color = ROLE_COLORS[role] ?? '#8a96b4'
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-[3px] rounded-full text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset ring-black/5"
      style={{ letterSpacing: '.3px', background: `${color}1f`, color }}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
      {ROLE_LABELS[role] ?? role}
    </span>
  )
}

// Full 11-role set from LoanMS.Domain.Enums.UserRole (see usersApi.ts's
// CreateUserRequest/UpdateUserRequest doc-comment) — the same set Employee
// Code generation and the legacy Users form already support.
const ALL_ROLES: UserRole[] = [
  'Admin', 'Manager', 'Sales', 'Dsa', 'Partner',
  'LoginTeam', 'TeamLeader', 'Accounts', 'LocationHead', 'OperationManager', 'ProductTeam',
]

// Form shape mirrors legacy's tw-user-modal fields (efin-app.js twSaveUser):
// name, email, password, mobile, role, status + primary Location / Sales-Team /
// Operation-Team single-selects. All backend-backed (Create/UpdateUserRequestDto).
const EMPTY_FORM = {
  fullName: '', email: '', password: '', role: 'Sales' as UserRole, phoneNumber: '',
  locationName: '', salesTeam: '', opTeam: '', isActive: true,
}
const PAGE_SIZE = 20

// Row avatar — legacy renders a coloured initials circle in the Name column of
// the Users table. Colour is deterministic from the name so a user keeps the
// same badge colour across renders.
const AVATAR_COLORS = ['#1a4fa3', '#7c3aed', '#1a7340', '#c0392b', '#d97706', '#0284c7', '#be185d', '#0f766e']
function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}
function userInitials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'
}

// Row "Actions ▾" dropdown — legacy renders each user row's actions as a single
// menu button (efin-app.js:24931), not a strip of icon buttons. Only actions
// this app's backend actually supports are shown: legacy's "Suspend" is a third
// user state that LoanMS's UserDto (active/inactive only) does not have, so it
// is intentionally omitted rather than shown as a no-op.
function UserActionsMenu({ isActive, onView, onEdit, onMap, onToggle, onReset, onDelete }: {
  isActive: boolean
  onView: () => void; onEdit: () => void; onMap: () => void
  onToggle: () => void; onReset: () => void; onDelete?: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  const item = 'w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left hover:bg-gray-50 transition-colors'
  return (
    <div ref={ref} className="relative inline-block text-left">
      <Button variant="secondary" size="sm" onClick={() => setOpen(o => !o)}>
        Actions <ChevronDown size={13} className="ml-1" />
      </Button>
      {open && (
        <div className="absolute right-0 top-9 z-[var(--z-dropdown)] w-56 bg-white border border-gray-200 rounded-xl py-1.5"
          style={{ boxShadow: '0 12px 40px rgba(8,88,151,.14)' }}>
          <button className={item} onClick={() => { setOpen(false); onView() }}><Eye size={14} className="text-gray-500" /> View Details</button>
          <button className={item} onClick={() => { setOpen(false); onEdit() }}><Pencil size={14} className="text-orange-500" /> Edit User</button>
          <button className={item} onClick={() => { setOpen(false); onMap() }}><MapPin size={14} className="text-pink-500" /> Manage Locations &amp; Teams</button>
          <button className={item} style={{ color: 'var(--warn)' }} onClick={() => { setOpen(false); onToggle() }}>
            {isActive ? <UserX size={14} /> : <UserCheck size={14} />} {isActive ? 'Deactivate' : 'Activate'}
          </button>
          <button className={item} onClick={() => { setOpen(false); onReset() }}><KeyRound size={14} className="text-amber-500" /> Reset Password</button>
          {onDelete && (
            <button className={item} style={{ color: 'var(--danger)' }} onClick={() => { setOpen(false); onDelete() }}>
              <Trash2 size={14} /> Delete User
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Read-only "View Details" panel — legacy's twViewUserDetail (efin-app.js:24944):
// avatar + status, User ID, Email/Login, Mobile, Role, primary Locations /
// Sales-Team(s) / Operation-Team(s), Created. (Legacy also shows "Last
// Updated", but UserDto exposes no UpdatedAt, so it is omitted rather than
// faked.) Values come straight off the row — no per-user fetch.
function ViewUserDetailModal({ user, onClose }: { user: User; onClose: () => void }) {
  const onePill = (value: string | null | undefined, color: string, prefix = '') =>
    value
      ? <span className="inline-block px-2.5 py-0.5 rounded-full text-[11.5px] font-semibold" style={{ background: `${color}22`, color }}>{prefix}{value}</span>
      : <span className="text-gray-400">—</span>
  const Row = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="flex gap-2.5 py-[7px] border-b border-gray-100">
      <div className="min-w-[130px] text-xs font-semibold" style={{ color: 'var(--text3)' }}>{label}</div>
      <div className="text-[13px]" style={{ color: 'var(--text)' }}>{children}</div>
    </div>
  )
  const created = user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[var(--z-modal)] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="w-12 h-12 rounded-full flex items-center justify-center text-base font-extrabold text-white shrink-0"
              style={{ background: avatarColor(user.fullName) }}>{userInitials(user.fullName)}</span>
            <div>
              <div className="text-base font-bold" style={{ color: 'var(--text)' }}>{user.fullName}</div>
              <div className="text-xs font-bold" style={{ color: user.isActive ? 'var(--success)' : '#dc2626' }}>● {user.isActive ? 'Active' : 'Inactive'}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <Row label="User ID"><code className="px-1.5 py-0.5 rounded" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>{user.employeeCode || '—'}</code></Row>
        <Row label="Email / Login">{user.email}</Row>
        <Row label="Mobile">{user.phoneNumber || '—'}</Row>
        <Row label="Role"><RolePill role={user.role} /></Row>
        <Row label="Locations">{onePill(user.locationName, '#085897', '📍 ')}</Row>
        <Row label="Sales Team(s)">{onePill(user.salesTeam, '#f59e0b')}</Row>
        <Row label="Operation Team(s)">{onePill(user.opTeam, '#10b981')}</Row>
        <Row label="Created">{created}</Row>
      </div>
    </div>
  )
}

// A single coloured pill for the Users table's Locations / Sales-Team /
// Operation-Team columns — legacy twPillCell rendering a user's primary value
// (efin-app.js:24915-24917). Renders an em-dash when unset.
function UserPill({ value, color, bg, prefix = '' }: { value?: string | null; color: string; bg: string; prefix?: string }) {
  if (!value) return <span className="text-gray-300">—</span>
  return (
    <span className="inline-block px-[7px] py-[2px] rounded-full text-[10.5px] font-medium whitespace-nowrap" style={{ background: bg, color }}>
      {prefix}{value}
    </span>
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[var(--z-modal)] p-4">
      <Card className="w-full max-w-lg max-h-[85vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold flex items-center gap-2"><MapPin size={16} />Locations &amp; Teams — {user.fullName}</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {error && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
        )}

        {loadingOptions ? (
          <LoadingSpinner size="sm" />
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

        <div className="flex justify-end gap-2 mt-5">
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
