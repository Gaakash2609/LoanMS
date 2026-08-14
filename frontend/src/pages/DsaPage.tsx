import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import DataTable, { type Column } from '@/components/shared/DataTable'
import PageHeader from '@/components/shared/PageHeader'
import { formatDate } from '@/utils/format'
import { Plus, UserCheck, UserX } from 'lucide-react'

interface DsaPartner {
  id: number; name: string; code: string; email?: string
  phone?: string; city?: string; isActive: boolean; createdAt: string
  // BUGFIX (Phase 6): these were already present in the actual GET
  // /api/dsa response (DsaController.GetAll's Select) but never captured
  // in this type — needed now because DsaController.Update (PUT, the
  // only endpoint that can change IsActive — there is no dedicated
  // status-only endpoint for this module) unconditionally overwrites
  // every one of these fields from the request body, with no per-field
  // null-check. Sending only { isActive } would have silently wiped
  // Name/Code/PartnerType/etc back to empty/default. mappedSalesUserId is
  // deliberately NOT added here — confirmed it genuinely is not part of
  // the GetAll response at all (only the resolved name, MappedSalesUser,
  // is) — see toggle's own comment below for how that one field is
  // handled.
  partnerType?: string
  linkedUserId?: number | null
  pan?: string; officeAddress?: string; officeState?: string; officePin?: string
  officeAddressType?: string; category?: string; mappedDsaId?: number | null
}

export default function DsaPage() {
  const [page, setPage] = useState(1)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', code: '', email: '', phone: '', city: '' })
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['dsa', page],
    queryFn: () => api.get<ApiResponse<{ items: DsaPartner[]; totalCount: number; totalPages: number }>>(
      '/api/dsa', { params: { page, pageSize: 20 } }).then(r => r.data.data),
  })

  const create = useMutation({
    mutationFn: () => api.post('/api/dsa', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dsa'] }); setShowForm(false); setForm({ name: '', code: '', email: '', phone: '', city: '' }) },
  })

  // BUGFIX (confirmed real, pre-existing bug — Phase 6 audit): called
  // PATCH /api/dsa/{id}/toggle-active, a route that never existed in
  // DsaController.cs — every click genuinely 404'd. There is no
  // dedicated status-only endpoint for this module (unlike Users' PATCH
  // /{id}/status) — the only endpoint that can change IsActive is the
  // full PUT /{id} (DsaController.Update), which unconditionally
  // overwrites every field from the request body. Sends back the row's
  // own current values for every field the list-response actually
  // provides, with only isActive flipped — preserves the record instead
  // of wiping it.
  //
  // mappedSalesUserId is the one field genuinely NOT recoverable here —
  // confirmed the list-response only exposes the resolved name
  // (MappedSalesUser), never the raw id — omitting it from this payload
  // means the backend's unconditional `dsa.MappedSalesUserId =
  // dto.MappedSalesUserId` will reset it to null if a mapping was
  // previously set. This is a genuine, narrow, pre-existing API-shape
  // limitation (no GET /dsa/{id} endpoint exists either) that can't be
  // fixed from this file alone without a backend change, which is out of
  // this phase's scope — flagged, not silently fixed.
  const [toggleError, setToggleError] = useState('')
  const toggle = useMutation({
    mutationFn: (d: DsaPartner) => api.put(`/api/dsa/${d.id}`, {
      name: d.name, code: d.code, email: d.email, phone: d.phone, city: d.city,
      partnerType: d.partnerType, linkedUserId: d.linkedUserId,
      isActive: !d.isActive,
      pan: d.pan, officeAddress: d.officeAddress, officeState: d.officeState,
      officePin: d.officePin, officeAddressType: d.officeAddressType,
      category: d.category, mappedDsaId: d.mappedDsaId,
    }),
    onSuccess: () => { setToggleError(''); qc.invalidateQueries({ queryKey: ['dsa'] }) },
    onError: () => setToggleError('Could not update DSA status. Please try again.'),
  })

  const columns: Column<DsaPartner>[] = [
    { key: 'name', label: 'DSA Name', render: d => (
      <div><p className="font-medium">{d.name}</p><p className="text-xs text-gray-500 font-mono">{d.code}</p></div>
    )},
    { key: 'email', label: 'Contact', render: d => (
      <div><p className="text-sm">{d.email ?? '—'}</p><p className="text-xs text-gray-500">{d.phone ?? ''}</p></div>
    )},
    { key: 'city', label: 'City', render: d => d.city ?? '—' },
    { key: 'isActive', label: 'Status', render: d => (
      <Badge variant={d.isActive ? 'success' : 'danger'}>{d.isActive ? 'Active' : 'Inactive'}</Badge>
    )},
    { key: 'createdAt', label: 'Joined', render: d => formatDate(d.createdAt) },
    { key: 'actions', label: '', render: d => (
      <button onClick={() => toggle.mutate(d)}
        className={`p-1.5 rounded-lg ${d.isActive ? 'text-red-500 hover:bg-red-50' : 'text-green-500 hover:bg-green-50'}`}>
        {d.isActive ? <UserX size={14} /> : <UserCheck size={14} />}
      </button>
    )},
  ]

  return (
    <div>
      <PageHeader title="DSA Management" subtitle={`${data?.totalCount ?? 0} partners`}
        action={<Button size="sm" onClick={() => setShowForm(true)}><Plus size={14} className="mr-1" />Add DSA</Button>} />

      {showForm && (
        <Card className="mb-5 p-5">
          <p className="text-sm font-semibold mb-4">New DSA Partner</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {[
              { label: 'DSA Name *', key: 'name', placeholder: 'Full DSA name' },
              { label: 'Code *', key: 'code', placeholder: 'Unique code' },
              { label: 'Email', key: 'email', placeholder: 'email@example.com' },
              { label: 'Phone', key: 'phone', placeholder: '10-digit mobile' },
              { label: 'City', key: 'city', placeholder: 'City' },
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
          <div className="flex gap-2">
            <Button size="sm" loading={create.isPending} onClick={() => create.mutate()}>Save</Button>
            <Button size="sm" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      <Card>
        {toggleError && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {toggleError}
          </div>
        )}
        <DataTable columns={columns} data={data?.items} isLoading={isLoading}
          totalPages={data?.totalPages} currentPage={page} onPageChange={setPage} totalCount={data?.totalCount} />
      </Card>
    </div>
  )
}
