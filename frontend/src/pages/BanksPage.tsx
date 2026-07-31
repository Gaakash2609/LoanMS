import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import DataTable, { type Column } from '@/components/shared/DataTable'
import PageHeader from '@/components/shared/PageHeader'
import { Plus, Trash2, Pencil } from 'lucide-react'

interface Bank {
  id: number; bankName: string; ifscPrefix?: string; empCode?: string
  location?: string; rmName?: string; rmMobile?: string; email?: string; remarks?: string
}

export default function BanksPage() {
  const [showForm, setShowForm] = useState(false)
  // PHASE 6 FIX: backend already exposed PUT /api/banks/{id} but the frontend
  // never called it — Create/Delete only. editingId tracks whether the open
  // form is creating a new bank (null) or editing an existing one (its id).
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<Partial<Bank>>({})
  const qc = useQueryClient()

  const { data: banks, isLoading } = useQuery({
    queryKey: ['banks'],
    queryFn: () => api.get<ApiResponse<Bank[]>>('/api/banks').then(r => r.data.data ?? []),
    staleTime: 120_000,
  })

  const create = useMutation({
    mutationFn: () => api.post('/api/banks', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['banks'] }); closeForm() },
  })

  const update = useMutation({
    mutationFn: () => api.put(`/api/banks/${editingId}`, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['banks'] }); closeForm() },
  })

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/banks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['banks'] }),
  })

  function openCreate() {
    setEditingId(null)
    setForm({})
    setShowForm(true)
  }

  function openEdit(bank: Bank) {
    setEditingId(bank.id)
    setForm(bank)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm({})
  }

  const fields: Array<{ label: string; key: keyof Bank; placeholder: string }> = [
    { label: 'Bank Name *', key: 'bankName',   placeholder: 'e.g. HDFC Bank' },
    { label: 'IFSC Prefix', key: 'ifscPrefix',  placeholder: 'e.g. HDFC' },
    { label: 'Emp Code',    key: 'empCode',     placeholder: 'Employee code' },
    { label: 'Location',    key: 'location',    placeholder: 'Branch location' },
    { label: 'RM Name',     key: 'rmName',      placeholder: 'Relationship Manager' },
    { label: 'RM Mobile',   key: 'rmMobile',    placeholder: '10-digit mobile' },
    { label: 'Email',       key: 'email',       placeholder: 'rm@bank.com' },
    { label: 'Remarks',     key: 'remarks',     placeholder: 'Optional notes' },
  ]

  const columns: Column<Bank>[] = [
    { key: 'bankName',  label: 'Bank Name', render: b => <span className="font-medium">{b.bankName}</span> },
    { key: 'ifscPrefix',label: 'IFSC', render: b => <span className="font-mono text-xs">{b.ifscPrefix ?? '—'}</span> },
    { key: 'empCode',   label: 'Emp Code', render: b => b.empCode ?? '—' },
    { key: 'location',  label: 'Location', render: b => b.location ?? '—' },
    { key: 'rmName',    label: 'RM Name',  render: b => (
      <div><p className="text-sm">{b.rmName ?? '—'}</p><p className="text-xs text-gray-500">{b.rmMobile ?? ''}</p></div>
    )},
    { key: 'email',     label: 'Email',    render: b => b.email ?? '—' },
    { key: 'actions',   label: '', render: b => (
      <div className="flex gap-1">
        <button onClick={() => openEdit(b)} className="text-gray-400 hover:text-gray-700 p-1">
          <Pencil size={14} />
        </button>
        <button onClick={() => remove.mutate(b.id)} className="text-red-400 hover:text-red-600 p-1">
          <Trash2 size={14} />
        </button>
      </div>
    )},
  ]

  return (
    <div>
      <PageHeader title="Banks" subtitle={`${banks?.length ?? 0} banks`}
        action={<Button size="sm" onClick={openCreate}><Plus size={14} className="mr-1" />Add Bank</Button>} />

      {showForm && (
        <Card className="mb-5 p-5">
          <p className="text-sm font-semibold mb-4">{editingId ? 'Edit Bank' : 'New Bank'}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            {fields.map(f => (
              <div key={f.key}>
                <label className="text-xs font-medium text-gray-600 block mb-1">{f.label}</label>
                <input value={(form[f.key] as string) ?? ''}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" loading={editingId ? update.isPending : create.isPending}
              onClick={() => editingId ? update.mutate() : create.mutate()}>
              {editingId ? 'Save Changes' : 'Save'}
            </Button>
            <Button size="sm" variant="secondary" onClick={closeForm}>Cancel</Button>
          </div>
        </Card>
      )}
      <Card><DataTable columns={columns} data={banks} isLoading={isLoading} /></Card>
    </div>
  )
}

