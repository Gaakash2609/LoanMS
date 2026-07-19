import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import DataTable, { type Column } from '@/components/shared/DataTable'
import PageHeader from '@/components/shared/PageHeader'
import { Plus, Trash2 } from 'lucide-react'

interface Bank {
  id: number; bankName: string; ifscPrefix?: string; empCode?: string
  location?: string; rmName?: string; rmMobile?: string; email?: string; remarks?: string
}

export default function BanksPage() {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<Partial<Bank>>({})
  const qc = useQueryClient()

  const { data: banks, isLoading } = useQuery({
    queryKey: ['banks'],
    queryFn: () => api.get<ApiResponse<Bank[]>>('/api/banks').then(r => r.data.data ?? []),
    staleTime: 120_000,
  })

  const create = useMutation({
    mutationFn: () => api.post('/api/banks', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['banks'] }); setShowForm(false); setForm({}) },
  })

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/banks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['banks'] }),
  })

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
      <button onClick={() => remove.mutate(b.id)} className="text-red-400 hover:text-red-600 p-1">
        <Trash2 size={14} />
      </button>
    )},
  ]

  return (
    <div>
      <PageHeader title="Banks" subtitle={`${banks?.length ?? 0} banks`}
        action={<Button size="sm" onClick={() => setShowForm(true)}><Plus size={14} className="mr-1" />Add Bank</Button>} />

      {showForm && (
        <Card className="mb-5 p-5">
          <p className="text-sm font-semibold mb-4">New Bank</p>
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
            <Button size="sm" loading={create.isPending} onClick={() => create.mutate()}>Save</Button>
            <Button size="sm" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </Card>
      )}
      <Card><DataTable columns={columns} data={banks} isLoading={isLoading} /></Card>
    </div>
  )
}
