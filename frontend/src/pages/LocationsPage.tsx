import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import DataTable, { type Column } from '@/components/shared/DataTable'
import PageHeader from '@/components/shared/PageHeader'
import { Plus, Trash2 } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
// Types + the pill-cell renderer extracted to pages/locations.
import { type Location, EMPTY_FORM, PillCell } from '@/pages/locations/locationHelpers'


export default function LocationsPage() {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  // null = the form is in "create" mode; a Location = "edit that row" mode.
  // One form serves both so the fields, layout and validation can never drift
  // apart between the two paths.
  const [editing, setEditing] = useState<Location | null>(null)
  const [formError, setFormError] = useState('')
  const [feedback, setFeedback] = useState('')
  const qc = useQueryClient()
  // Matches twCanManageUsers (efin-app.js:24863: role==='admin' ||
  // role==='product_team') — gates Rename/Delete in vanilla; Update/
  // SetStatus/Delete now share the same Admin,ProductTeam authorization
  // server-side (LocationsController.cs). Add is intentionally NOT gated
  // here — vanilla's twSaveLocation has no permission check beyond page
  // access, and this page is already only reachable by Admin/ProductTeam
  // by default (locations-mgmt menu permission).
  const user = useAuthStore(s => s.user)
  const canManage = ['Admin', 'ProductTeam'].includes(user?.role ?? '')

  function openCreate() {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setFeedback(''); setShowForm(true)
  }

  function openEdit(l: Location) {
    setEditing(l)
    setForm({ name: l.name ?? '', city: l.city ?? '', state: l.state ?? '', pinCode: l.pinCode ?? '' })
    setFormError(''); setFeedback(''); setShowForm(true)
  }

  function closeForm() {
    setShowForm(false); setEditing(null); setForm(EMPTY_FORM); setFormError('')
  }

  // The form has always labelled Name and City with a `*`, but nothing
  // enforced it — a blank Name could be saved and would render as an empty
  // row. LocationDto has no server-side validation attributes either
  // (LocationsController.cs:103), so the check belongs here.
  function validate(): string | null {
    if (!form.name.trim()) return 'Name is required'
    if (!form.city.trim()) return 'City is required'
    if (form.pinCode.trim() && !/^\d{6}$/.test(form.pinCode.trim())) return 'PIN Code must be 6 digits'
    return null
  }

  const { data: locations, isLoading, error, refetch } = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<ApiResponse<Location[]>>('/api/locations').then(r => r.data.data ?? []),
    staleTime: 120_000,
  })

  /** Shared by create and update — same trimmed shape legacy's rename sent. */
  function payload() {
    return {
      name: form.name.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      pinCode: form.pinCode.trim(),
    }
  }

  function reportError(err: unknown, fallback: string) {
    const res = (err as { response?: { status?: number; data?: { message?: string; errors?: string[] } } }).response
    if (!res) { setFormError(fallback); return }
    if (res.status === 403) { setFormError('Only an Admin or Product Team can change locations.'); return }
    setFormError(res.data?.errors?.join(' · ') || res.data?.message || `${fallback} (HTTP ${res.status ?? '?'})`)
  }

  const create = useMutation({
    mutationFn: () => api.post('/api/locations', payload()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations'] })
      setFeedback('Location created ✓')
      closeForm()
    },
    onError: (err) => reportError(err, 'Could not create the location.'),
  })

  // Reuses the PUT endpoint legacy's inline rename already called
  // (efin-app.js:24703 → PUT /locations/{id}) with the same
  // {name, city, state, pinCode} body. Code is deliberately not sent: the
  // endpoint only overwrites Code when a non-blank one is supplied
  // (LocationsController.cs:60), so omitting it preserves the existing value.
  const update = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error('No location selected.')
      return api.put(`/api/locations/${editing.id}`, payload())
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations'] })
      setFeedback('Location saved ✓')
      closeForm()
    },
    onError: (err) => reportError(err, 'Could not save the location.'),
  })

  function handleSave() {
    const err = validate()
    if (err) { setFormError(err); return }
    setFormError('')
    if (editing) update.mutate(); else create.mutate()
  }

  // BUGFIX (Phase 6, corrected): called PATCH /api/locations/{id}/toggle-active,
  // a route that never existed — every click 404'd. Corrected to use the
  // new, dedicated, minimal endpoint (LocationsController.SetStatus) —
  // Location.IsActive already existed on the entity/database (confirmed
  // by inspection — no migration was needed), it just had no endpoint
  // that could set it. Touches only IsActive server-side; Name/City/
  // State/PinCode/Code are untouched.
  const [toggleError, setToggleError] = useState('')
  const toggle = useMutation({
    mutationFn: (l: Location) => api.patch(`/api/locations/${l.id}/status`, { isActive: !l.isActive }),
    onSuccess: () => { setToggleError(''); qc.invalidateQueries({ queryKey: ['locations'] }) },
    onError: () => setToggleError('Could not update location status. Please try again.'),
  })

  // Restores legacy's twDeleteLocation (efin-app.js:24756). Legacy blocks
  // the delete client-side when the Location is still referenced by any
  // Sales/Login Team or assigned User, showing the exact count and asking
  // to reassign first — it never even reaches a confirm() dialog in that
  // case. This calls the real endpoint (soft-delete, IsDeleted = true,
  // LocationsController.cs), which invalidating then hides from the list.
  const [deleteError, setDeleteError] = useState('')
  const remove = useMutation({
    mutationFn: (l: Location) => api.delete(`/api/locations/${l.id}`),
    onSuccess: (_res, l) => {
      setDeleteError('')
      qc.invalidateQueries({ queryKey: ['locations'] })
      setFeedback(`"${l.name}" deleted ✓`)
    },
    onError: (err, l) => {
      const res = (err as { response?: { status?: number; data?: { message?: string } } }).response
      if (res?.status === 403) { setDeleteError('Only an Admin or Product Team can delete locations.'); return }
      if (res?.status === 404) {
        // Already gone (deleted in another session). Reconcile the list
        // rather than leaving a stale row the user can keep clicking.
        qc.invalidateQueries({ queryKey: ['locations'] })
        setDeleteError(`"${l.name}" no longer exists — the list has been refreshed.`)
        return
      }
      setDeleteError(res?.data?.message || `Could not delete "${l.name}".${res?.status ? ` (HTTP ${res.status})` : ''}`)
    },
  })

  function onDelete(l: Location) {
    if (!canManage) { setDeleteError('Only an Admin or Product Team can delete locations.'); return }
    const inUse = (l.salesTeams?.length ?? 0) + (l.loginTeams?.length ?? 0) + (l.users?.length ?? 0)
    if (inUse > 0) {
      setDeleteError(`Cannot delete "${l.name}" — it is used by ${inUse} team(s)/user(s). Reassign them first.`)
      return
    }
    if (!confirm(`Delete location "${l.name}"?`)) return
    setDeleteError('')
    remove.mutate(l)
  }

  const columns: Column<Location>[] = [
    { key: 'name',  label: 'Location Name', sortable: true, render: l => <span className="font-medium">{l.name}</span> },
    { key: 'city',  label: 'City', sortable: true },
    { key: 'state', label: 'State', sortable: true },
    { key: 'pinCode', label: 'PIN', sortable: true, render: l => l.pinCode ?? '—' },
    // Hierarchy — matches vanilla's Sales Teams / Login Teams / Users pill
    // columns (efin-app.js twRenderLocations, efin-app.js:24709-24711).
    { key: 'salesTeams', label: 'Sales Teams', render: l => <PillCell items={l.salesTeams ?? []} bg="rgba(10,88,154,.1)" color="#0a589a" /> },
    { key: 'loginTeams', label: 'Login Teams', render: l => <PillCell items={l.loginTeams ?? []} bg="rgba(16,185,129,.1)" color="#10b981" /> },
    { key: 'users', label: 'Users', render: l => <PillCell items={l.users ?? []} bg="rgba(255,179,71,.12)" color="#b45309" /> },
    { key: 'isActive', label: 'Status', sortable: true, sortValue: l => (l.isActive ? 1 : 0), render: l => (
      <Badge variant={l.isActive ? 'success' : 'danger'}>{l.isActive ? 'Active' : 'Inactive'}</Badge>
    )},
    { key: 'actions', label: '', render: l => canManage ? (
      <div className="flex items-center gap-3">
        <button onClick={() => openEdit(l)}
          className="text-xs text-efin-blue hover:underline">
          Edit
        </button>
        <button onClick={() => toggle.mutate(l)}
          className="text-xs text-efin-blue hover:underline">
          {l.isActive ? 'Deactivate' : 'Activate'}
        </button>
        <button
          onClick={() => onDelete(l)}
          className="text-xs text-red-600 hover:underline flex items-center gap-1">
          <Trash2 size={12} /> Delete
        </button>
      </div>
    ) : <span className="text-xs text-gray-400">View only</span> },
  ]

  return (
    <div>
      <PageHeader title="Locations Management" subtitle={`${locations?.length ?? 0} locations`}
        action={<Button size="sm" onClick={openCreate}><Plus size={14} className="mr-1" />Add Location</Button>} />

      {showForm && (
        <Card className="mb-5 p-5">
          <p className="text-sm font-semibold mb-4">
            {editing ? `Edit Location — ${editing.name}` : 'New Location'}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            {[
              { label: 'Name *', key: 'name', placeholder: 'Branch / Area name' },
              { label: 'City *', key: 'city', placeholder: 'City' },
              { label: 'State', key: 'state', placeholder: 'State' },
              { label: 'PIN Code', key: 'pinCode', placeholder: '6-digit PIN' },
            ].map(f => (
              <div key={f.key}>
                <label className="text-xs font-medium text-gray-600 block mb-1">{f.label}</label>
                <input value={form[f.key as keyof typeof form]}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            ))}
          </div>
          {formError && <p className="text-xs text-red-600 mb-3">{formError}</p>}

          <div className="flex justify-end gap-2">
            <Button size="sm" loading={create.isPending || update.isPending} onClick={handleSave}>
              {editing ? 'Save Changes' : 'Save'}
            </Button>
            <Button size="sm" variant="secondary" onClick={closeForm}>Cancel</Button>
          </div>
        </Card>
      )}

      <Card>
        {feedback && (
          <div className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            {feedback}
          </div>
        )}
        {toggleError && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {toggleError}
          </div>
        )}
        {deleteError && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {deleteError}
          </div>
        )}
        <DataTable columns={columns} data={locations} isLoading={isLoading} error={error} onRetry={() => refetch()} />
      </Card>
    </div>
  )
}
