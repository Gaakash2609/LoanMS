import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X, Trash2, Pencil } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import {
  incredRmApi, RM_FIELD_LIMITS,
  type IncredRm, type IncredRmUpsertRequest,
} from '@/api/incredRmApi'
import { useAuthStore } from '@/store/authStore'
import { apiErrorMessage as errorMessage } from '@/utils/apiError'

// ── InCred RM Emails tab ────────────────────────────────────────────────
// Ports legacy's RM panel (incred-rm.js injects the tab + shell;
// renderRmEmails / openRmModal / saveRm / deleteRm live in efin-app.js:
// 23980-24055).
//
// Kept from legacy: the same heading and sub-line, the record-count badge,
// "Add RM", the five-column table (RM Name / Location / Email ID / Contact No
// / Actions) with a mailto: link on the email, Edit + delete per row, the
// same delete confirmation, and the same required-field rule (name + email).
//
// Writes are Admin-only server-side, so the buttons are hidden for everyone
// else rather than shown and left to 403.


function RmFormModal({
  rm, onClose, onSaved,
}: {
  /** null = create. */
  rm: IncredRm | null
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = rm != null
  const [name, setName] = useState(rm?.name ?? '')
  const [location, setLocation] = useState(rm?.location ?? '')
  const [email, setEmail] = useState(rm?.email ?? '')
  const [contactNo, setContactNo] = useState(rm?.contactNo ?? '')
  const [error, setError] = useState('')

  const save = useMutation({
    // Returns void so both branches share one type — create resolves to
    // { id }, update to boolean, and neither result is used here.
    mutationFn: async (payload: IncredRmUpsertRequest) => {
      if (rm) await incredRmApi.update(rm.id, payload)
      else await incredRmApi.create(payload)
    },
    onSuccess: () => onSaved(),
    onError: (err: unknown) => setError(errorMessage(err, 'Could not save this RM.')),
  })

  function handleSubmit() {
    // Legacy's rule exactly: name and email required, nothing else.
    if (!name.trim())  { setError('Name is required.'); return }
    if (!email.trim()) { setError('Email is required.'); return }
    setError('')
    if (save.isPending) return
    save.mutate({
      name: name.trim(),
      location: location.trim() || null,
      email: email.trim(),
      contactNo: contactNo.trim() || null,
    })
  }

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue'
  const labelCls = 'text-xs font-medium text-gray-600 block mb-1'

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[var(--z-modal)] p-4" onClick={onClose}>
      <div className="w-full max-w-md" onClick={e => e.stopPropagation()}>
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold">{isEdit ? 'Edit RM' : 'Add RM'}</p>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>

          {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          <div className="space-y-4">
            <div>
              <label className={labelCls}>RM Name *</label>
              <input value={name} onChange={e => setName(e.target.value)} maxLength={RM_FIELD_LIMITS.name}
                placeholder="e.g. Rajesh Menon" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Location</label>
              <input value={location ?? ''} onChange={e => setLocation(e.target.value)} maxLength={RM_FIELD_LIMITS.location}
                placeholder="e.g. Mumbai" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Email ID *</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={RM_FIELD_LIMITS.email}
                placeholder="rm@incred.com" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Contact No</label>
              <input value={contactNo ?? ''} onChange={e => setContactNo(e.target.value)} maxLength={RM_FIELD_LIMITS.contactNo}
                placeholder="10-digit mobile" inputMode="tel" className={inputCls} />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <Button size="sm" loading={save.isPending} disabled={save.isPending} onClick={handleSubmit}>
              {isEdit ? 'Save Changes' : 'Add RM'}
            </Button>
            <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

export default function IncredRmTab() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  // POST/PUT/DELETE are all [Authorize(Roles = "Admin")].
  const canManage = user?.role === 'Admin'

  const [editing, setEditing] = useState<IncredRm | 'new' | null>(null)
  const [actionError, setActionError] = useState('')

  const { data: rms, isLoading, error } = useQuery({
    queryKey: ['incred-rms'],
    queryFn: () => incredRmApi.getAll().then(r => r.data.data ?? []),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['incred-rms'] })

  const remove = useMutation({
    mutationFn: (id: number) => incredRmApi.delete(id),
    onSuccess: () => { setActionError(''); invalidate() },
    onError: (err: unknown) => setActionError(errorMessage(err, 'Could not delete this RM.')),
  })

  const list = rms ?? []

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <div>
          <p className="text-xl font-extrabold" style={{ fontFamily: 'var(--font-head)', color: 'var(--text)' }}>
            InCred Relationship Managers
          </p>
          <p className="text-[13px]" style={{ color: 'var(--text3)' }}>
            Manage RM email records used for InCred API applications
          </p>
        </div>
        <span className="ml-auto"><Badge variant="info">{list.length}</Badge></span>
        {canManage && (
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus size={14} className="mr-1" />Add RM
          </Button>
        )}
      </div>

      {!canManage && (
        <div className="mb-4 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
          You can view these records. Only an Admin can add, edit or remove them.
        </div>
      )}

      {actionError && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{actionError}</div>
      )}
      {error != null && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {errorMessage(error, 'Could not load RM records.')}
        </div>
      )}

      <Card>
        {isLoading ? <LoadingSpinner /> : list.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-sm font-medium text-gray-700">No RM records yet</p>
            <p className="text-xs text-gray-500 mt-1">
              InCred applications use these addresses to reach the right relationship manager.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 620 }}>
              <thead>
                <tr className="text-left text-[11px] font-bold uppercase tracking-wide border-b border-gray-200" style={{ color: 'var(--text3)' }}>
                  <th className="py-2 pr-4">RM Name</th>
                  <th className="py-2 pr-4">Location</th>
                  <th className="py-2 pr-4">Email ID</th>
                  <th className="py-2 pr-4">Contact No</th>
                  {canManage && <th className="py-2 w-24">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {list.map(rm => (
                  <tr key={rm.id} className="border-b border-gray-100 last:border-0">
                    <td className="py-2.5 pr-4 font-semibold text-gray-900">{rm.name}</td>
                    <td className="py-2.5 pr-4">{rm.location || '—'}</td>
                    <td className="py-2.5 pr-4">
                      <a href={`mailto:${rm.email}`} className="text-efin-blue hover:underline">{rm.email}</a>
                    </td>
                    <td className="py-2.5 pr-4">{rm.contactNo || '—'}</td>
                    {canManage && (
                      <td className="py-2.5">
                        <div className="flex items-center gap-1">
                          <button onClick={() => setEditing(rm)} title="Edit RM"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-efin-blue hover:bg-gray-50">
                            <Pencil size={14} />
                          </button>
                          <button
                            disabled={remove.isPending}
                            title="Delete RM"
                            onClick={() => { if (window.confirm('Delete this RM record?')) remove.mutate(rm.id) }}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-gray-50 disabled:opacity-50">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <RmFormModal
          key={editing === 'new' ? 'new' : editing.id}
          rm={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setActionError(''); invalidate() }}
        />
      )}
    </div>
  )
}
