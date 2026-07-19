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

  const toggle = useMutation({
    mutationFn: (id: number) => api.patch(`/api/dsa/${id}/toggle-active`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dsa'] }),
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
      <button onClick={() => toggle.mutate(d.id)}
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
        <DataTable columns={columns} data={data?.items} isLoading={isLoading}
          totalPages={data?.totalPages} currentPage={page} onPageChange={setPage} totalCount={data?.totalCount} />
      </Card>
    </div>
  )
}
