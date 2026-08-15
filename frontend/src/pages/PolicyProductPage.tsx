import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import PageHeader from '@/components/shared/PageHeader'
import { Check, Plus, Trash2, Pencil, ChevronUp, ChevronDown } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { rejectionReasonsApi, type RejectionReason } from '@/api/rejectionReasonsApi'
import ProductOfferMatrixCard from '@/components/shared/ProductOfferMatrixCard'
import IncredCommentTemplatesCard from '@/components/shared/IncredCommentTemplatesCard'

// Legacy page-policy-product: role-action permission matrix + DSA/Partner tables
// + Rejection Reasons card (rejection-reasons.js). DSA and Partner tables are
// covered by DsaPage. This page shows the permission matrix and rejection reasons.

const ACTIONS = [
  'Create new application', 'View applications (own)', 'View applications (all)',
  'Change loan status', 'Approve loan', 'Disburse loan',
  'Create customer', 'Edit customer', 'Delete record',
  'View payout claims', 'Approve payout', 'Generate reports',
  'Manage users', 'Manage settings', 'View audit log',
  'Add DSA', 'Add partner', 'Configure lender',
]

const ROLES = ['Admin', 'Login Team', 'Team Leader', 'Sales Exec', 'Partner', 'Accounts', 'Product Team']

const MATRIX: Record<string, Record<string, boolean>> = {
  'Create new application':     { Admin:true, 'Login Team':true, 'Team Leader':true, 'Sales Exec':true, Partner:true, Accounts:false, 'Product Team':false },
  'View applications (own)':    { Admin:true, 'Login Team':true, 'Team Leader':true, 'Sales Exec':true, Partner:true, Accounts:true,  'Product Team':true  },
  'View applications (all)':    { Admin:true, 'Login Team':true, 'Team Leader':true, 'Sales Exec':false, Partner:false, Accounts:true, 'Product Team':true  },
  'Change loan status':         { Admin:true, 'Login Team':true, 'Team Leader':true, 'Sales Exec':false, Partner:false, Accounts:false,'Product Team':false },
  'Approve loan':               { Admin:true, 'Login Team':false,'Team Leader':true, 'Sales Exec':false, Partner:false, Accounts:false,'Product Team':false },
  'Disburse loan':              { Admin:true, 'Login Team':false,'Team Leader':false,'Sales Exec':false, Partner:false, Accounts:true, 'Product Team':false },
  'Create customer':            { Admin:true, 'Login Team':true, 'Team Leader':true, 'Sales Exec':true,  Partner:true,  Accounts:false,'Product Team':false },
  'Edit customer':              { Admin:true, 'Login Team':true, 'Team Leader':true, 'Sales Exec':true,  Partner:false, Accounts:false,'Product Team':false },
  'Delete record':              { Admin:true, 'Login Team':false,'Team Leader':false,'Sales Exec':false, Partner:false, Accounts:false,'Product Team':false },
  'View payout claims':         { Admin:true, 'Login Team':false,'Team Leader':true, 'Sales Exec':true,  Partner:true,  Accounts:true, 'Product Team':false },
  'Approve payout':             { Admin:true, 'Login Team':false,'Team Leader':false,'Sales Exec':false, Partner:false, Accounts:true, 'Product Team':false },
  'Generate reports':           { Admin:true, 'Login Team':false,'Team Leader':true, 'Sales Exec':false, Partner:false, Accounts:true, 'Product Team':true  },
  'Manage users':               { Admin:true, 'Login Team':false,'Team Leader':false,'Sales Exec':false, Partner:false, Accounts:false,'Product Team':false },
  'Manage settings':            { Admin:true, 'Login Team':false,'Team Leader':false,'Sales Exec':false, Partner:false, Accounts:false,'Product Team':false },
  'View audit log':             { Admin:true, 'Login Team':false,'Team Leader':false,'Sales Exec':false, Partner:false, Accounts:false,'Product Team':false },
  'Add DSA':                    { Admin:true, 'Login Team':false,'Team Leader':false,'Sales Exec':false, Partner:false, Accounts:false,'Product Team':false },
  'Add partner':                { Admin:true, 'Login Team':false,'Team Leader':false,'Sales Exec':false, Partner:false, Accounts:false,'Product Team':false },
  'Configure lender':           { Admin:true, 'Login Team':false,'Team Leader':false,'Sales Exec':false, Partner:false, Accounts:false,'Product Team':true  },
}

// ── Rejection Reasons — RejectionReasonsController: GET open to any
// authenticated user (the Reject Application modal needs it for every role
// that can reject a loan); Create/Update/Reorder/Delete are Admin-only on
// the backend (rejection-reasons.js's client-side guard also allowed
// 'product_team', but the backend never did — following the backend
// contract here rather than that stale client check).
function RejectionReasonsCard() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'Admin'
  const qc = useQueryClient()

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['rejectionReasons'],
    queryFn: () => rejectionReasonsApi.getAll().then(r => r.data.data ?? []),
  })
  const reasons = data ?? []

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['rejectionReasons'] })
  }

  const create = useMutation({
    mutationFn: () => rejectionReasonsApi.create({ key: key.trim(), label: label.trim() }),
    onSuccess: (res) => {
      if (!res.data.success) { setError(res.data.message || 'Could not save reason.'); return }
      invalidate(); closeForm()
    },
    onError: () => setError('Could not save reason.'),
  })

  const update = useMutation({
    mutationFn: (id: number) => rejectionReasonsApi.update(id, { label: label.trim() }),
    onSuccess: (res) => {
      if (!res.data.success) { setError(res.data.message || 'Could not update reason.'); return }
      invalidate(); closeForm()
    },
    onError: () => setError('Could not update reason.'),
  })

  const remove = useMutation({
    mutationFn: (id: number) => rejectionReasonsApi.delete(id),
    onSuccess: () => invalidate(),
  })

  const reorder = useMutation({
    mutationFn: (orderedIds: number[]) => rejectionReasonsApi.reorder(orderedIds),
    onSuccess: () => invalidate(),
  })

  function openCreate() {
    setEditingId(null); setKey(''); setLabel(''); setError(''); setShowForm(true)
  }
  function openEdit(r: RejectionReason) {
    setEditingId(r.id); setKey(r.key); setLabel(r.label); setError(''); setShowForm(true)
  }
  function closeForm() {
    setShowForm(false); setEditingId(null); setKey(''); setLabel(''); setError('')
  }
  function save() {
    if (!label.trim()) { setError('Display label is required'); return }
    if (editingId) update.mutate(editingId)
    else {
      if (!/^[a-z0-9_]*$/.test(key.trim())) { setError('Key: lowercase letters, digits and underscores only'); return }
      create.mutate()
    }
  }
  function move(idx: number, dir: -1 | 1) {
    const ni = idx + dir
    if (ni < 0 || ni >= reasons.length) return
    const ids = reasons.map(r => r.id)
    const tmp = ids[idx]; ids[idx] = ids[ni]; ids[ni] = tmp
    reorder.mutate(ids)
  }

  return (
    <Card className="mt-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Rejection Reasons</h3>
          <p className="text-sm text-gray-500 mt-0.5">Shown in the Reject Application modal for all users</p>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={openCreate}><Plus size={14} className="mr-1" />Add Reason</Button>
        )}
      </div>

      {showForm && isAdmin && (
        <div className="mb-4 p-4 border border-gray-200 rounded-lg bg-gray-50">
          <p className="text-sm font-semibold mb-3">{editingId ? 'Edit Rejection Reason' : 'Add Rejection Reason'}</p>
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Key</label>
              <input value={key} onChange={e => setKey(e.target.value)} disabled={!!editingId}
                placeholder="e.g. address_not_found"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-100" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Display Label *</label>
              <input value={label} onChange={e => setLabel(e.target.value)}
                placeholder="e.g. Address Not Found"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" loading={editingId ? update.isPending : create.isPending} onClick={save}>
              {editingId ? 'Update Reason' : 'Save Reason'}
            </Button>
            <Button size="sm" variant="secondary" onClick={closeForm}>Cancel</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-400 py-4">Loading…</p>
      ) : reasons.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">No reasons configured.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {reasons.map((r, i) => (
            <div key={r.id} className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg">
              {isAdmin && (
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => move(i, -1)} disabled={i === 0}
                    className="text-gray-400 hover:text-gray-700 disabled:opacity-30"><ChevronUp size={14} /></button>
                  <button onClick={() => move(i, 1)} disabled={i === reasons.length - 1}
                    className="text-gray-400 hover:text-gray-700 disabled:opacity-30"><ChevronDown size={14} /></button>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{r.label}</p>
                <p className="text-xs text-gray-400 font-mono">{r.key}</p>
              </div>
              {isAdmin && (
                <div className="flex gap-1">
                  <button onClick={() => openEdit(r)} className="text-gray-400 hover:text-gray-700 p-1"><Pencil size={14} /></button>
                  <button onClick={() => { if (confirm(`Delete "${r.label}"? This cannot be undone.`)) remove.mutate(r.id) }}
                    className="text-red-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

export default function PolicyProductPage() {
  return (
    <div>
      <PageHeader title="Policy / Product Matrix" subtitle="Role-based access and feature permissions" />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="pb-3 pr-4 text-left text-gray-500 font-medium min-w-[180px]">Action / Feature</th>
                {ROLES.map(r => (
                  <th key={r} className="pb-3 px-3 text-center text-gray-500 font-medium whitespace-nowrap">{r}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {ACTIONS.map(action => (
                <tr key={action} className="hover:bg-gray-50">
                  <td className="py-2 pr-4 text-gray-700">{action}</td>
                  {ROLES.map(role => (
                    <td key={role} className="py-2 px-3 text-center">
                      {MATRIX[action]?.[role]
                        ? <Check size={16} className="text-green-500 mx-auto" strokeWidth={3} />
                        : <span className="text-gray-200 text-sm">—</span>
                      }
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <RejectionReasonsCard />
      <ProductOfferMatrixCard />
      <IncredCommentTemplatesCard />
    </div>
  )
}
