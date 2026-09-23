// Users page modals (admin password reset, view details, location/team
// mapping) — extracted verbatim from UsersPage.tsx (code-quality refactor,

import { useState, useEffect, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MapPin, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { usersApi } from '@/api/usersApi'
import type { User } from '@/types'
import { avatarColor, userInitials } from '@/pages/users/userConstants'
import { RolePill } from '@/pages/users/UserWidgets'

// no behaviour change).

// Admin reset-password modal — POST /api/users/{id}/reset-password.
// No current password is required (that's what makes it an admin reset);
// the backend enforces Admin-only via [Authorize(Roles = "Admin")].
export function ResetPasswordModal({ user, onClose }: { user: User; onClose: () => void }) {
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

// Read-only "View Details" panel — legacy's twViewUserDetail (efin-app.js:24944):
// avatar + status, User ID, Email/Login, Mobile, Role, primary Locations /
// Sales-Team(s) / Operation-Team(s), Created. (Legacy also shows "Last
// Updated", but UserDto exposes no UpdatedAt, so it is omitted rather than
// faked.) Values come straight off the row — no per-user fetch.
export function ViewUserDetailModal({ user, onClose }: { user: User; onClose: () => void }) {
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
export function MappingModal({ user, onClose }: { user: User; onClose: () => void }) {
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

