import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import DataTable, { type Column } from '@/components/shared/DataTable'
import PageHeader from '@/components/shared/PageHeader'
import { Plus } from 'lucide-react'

interface Location {
  id: number; name: string; city: string; state: string; pinCode?: string; isActive: boolean
}

export default function LocationsPage() {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', city: '', state: '', pinCode: '' })
  const qc = useQueryClient()

  const { data: locations, isLoading } = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<ApiResponse<Location[]>>('/api/locations').then(r => r.data.data ?? []),
    staleTime: 120_000,
  })

  const create = useMutation({
    mutationFn: () => api.post('/api/locations', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['locations'] }); setShowForm(false); setForm({ name: '', city: '', state: '', pinCode: '' }) },
  })

  const toggle = useMutation({
    mutationFn: (id: number) => api.patch(`/api/locations/${id}/toggle-active`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locations'] }),
  })

  const columns: Column<Location>[] = [
    { key: 'name',  label: 'Location Name', render: l => <span className="font-medium">{l.name}</span> },
    { key: 'city',  label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'pinCode', label: 'PIN', render: l => l.pinCode ?? '—' },
    { key: 'isActive', label: 'Status', render: l => (
      <Badge variant={l.isActive ? 'success' : 'danger'}>{l.isActive ? 'Active' : 'Inactive'}</Badge>
    )},
    { key: 'actions', label: '', render: l => (
      <button onClick={() => toggle.mutate(l.id)}
        className="text-xs text-blue-600 hover:underline">
        {l.isActive ? 'Deactivate' : 'Activate'}
      </button>
    )},
  ]

  return (
    <div>
      <PageHeader title="Locations Management" subtitle={`${locations?.length ?? 0} locations`}
        action={<Button size="sm" onClick={() => setShowForm(true)}><Plus size={14} className="mr-1" />Add Location</Button>} />

      {showForm && (
        <Card className="mb-5 p-5">
          <p className="text-sm font-semibold mb-4">New Location</p>
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
          <div className="flex gap-2">
            <Button size="sm" loading={create.isPending} onClick={() => create.mutate()}>Save</Button>
            <Button size="sm" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      <Card>
        <DataTable columns={columns} data={locations} isLoading={isLoading} />
      </Card>
    </div>
  )
}
