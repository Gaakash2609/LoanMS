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
import { Plus, UserCheck, UserX, Download } from 'lucide-react'
import { buildCsv, downloadCsv } from '@/utils/loanExport'

interface DsaPartner {
  id: number; name: string; code: string; email?: string
  phone?: string; city?: string; isActive: boolean; createdAt: string
}

const PAGE_SIZE = 20

export default function DsaPage() {
  const [page, setPage] = useState(1)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', code: '', email: '', phone: '', city: '' })
  const qc = useQueryClient()

  // BUGFIX (confirmed real, pre-existing gap — Phase 9 audit, same
  // root-cause class as Phase 4 Part C / Phase 5 / Phase 7's fixes):
  // DsaController.GetAll (LoanMS.API/Controllers/DsaController.cs)
  // returns a plain ApiResponseDto<object> wrapping a raw array
  // (`return Ok(ApiResponseDto<object>.Ok(dsa))`, where dsa is a
  // List<> — no page/pageSize params are even accepted) — not a paged
  // shape — so data?.items/totalCount/totalPages were always undefined
  // and the table showed zero DSA/Partner records regardless of how many
  // actually existed. The Phase 6 fix only touched the status-toggle
  // mutation below and never touched this list-fetch, so this bug
  // survived Phase 6 untouched. Corrected to fetch the full array once
  // and paginate client-side, same pattern already proven in
  // UsersPage.tsx/TasksPage.tsx/TicketsPage.tsx/PayoutPage.tsx. No
  // search/filter existed on this page before this fix (confirmed by
  // inspection), so there is nothing to preserve there beyond not
  // introducing one.
  const { data: allDsa, isLoading } = useQuery({
    queryKey: ['dsa'],
    queryFn: () => api.get<ApiResponse<DsaPartner[]>>('/api/dsa').then(r => r.data.data ?? []),
  })
  const dsaList = allDsa ?? []
  const totalCount = dsaList.length
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const pageItems = dsaList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const create = useMutation({
    mutationFn: () => api.post('/api/dsa', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dsa'] }); setShowForm(false); setForm({ name: '', code: '', email: '', phone: '', city: '' }) },
  })

  function exportCsv() {
    if (dsaList.length === 0) return
    const csv = buildCsv(
      ['Name', 'Code', 'Email', 'Phone', 'City', 'Active', 'Created At'],
      dsaList.map(d => [d.name, d.code, d.email ?? '', d.phone ?? '', d.city ?? '', d.isActive ? 'Yes' : 'No', formatDate(d.createdAt)]),
    )
    downloadCsv(csv, `dsa-export-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  // BUGFIX (Phase 6, corrected — kept fully intact, untouched by this
  // Phase 9 fix): the first Phase 6 attempt called PATCH
  // /api/dsa/{id}/toggle-active (a route that never existed — every click
  // 404'd), then an unsafe follow-up tried reconstructing a full PUT
  // payload from the row's own fields — but DsaController.GetAll never
  // exposes MappedSalesUserId's raw id (only the resolved name), so that
  // full-PUT would have silently cleared any existing sales-mapping on
  // toggle. Corrected to use a dedicated, minimal endpoint
  // (DsaController.SetStatus) that touches only IsActive server-side —
  // no other field is read or sent, so nothing else can be cleared.
  const [toggleError, setToggleError] = useState('')
  const toggle = useMutation({
    mutationFn: (d: DsaPartner) => api.patch(`/api/dsa/${d.id}/status`, { isActive: !d.isActive }),
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
      <PageHeader title="DSA Management" subtitle={`${totalCount} partners`}
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={dsaList.length === 0} onClick={exportCsv}>
              <Download size={14} className="mr-1" />Export CSV
            </Button>
            <Button size="sm" onClick={() => setShowForm(true)}><Plus size={14} className="mr-1" />Add DSA</Button>
          </div>
        } />

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
        <DataTable columns={columns} data={pageItems} isLoading={isLoading}
          totalPages={totalPages} currentPage={page} onPageChange={setPage} totalCount={totalCount} />
      </Card>
    </div>
  )
}
