import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import DataTable, { type Column } from '@/components/shared/DataTable'
import PageHeader from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/Badge'
import BulkUploadBanksModal from '@/components/shared/BulkUploadBanksModal'
import { Plus, Trash2, Pencil, Download, Upload } from 'lucide-react'
import { buildCsv, downloadCsv } from '@/utils/loanExport'
import { useAuthStore } from '@/store/authStore'

interface Bank {
  id: number; bankName: string; ifscPrefix?: string; empCode?: string
  location?: string; rmName?: string; rmMobile?: string; email?: string; remarks?: string
  // Lender flags — legacy's bank-detail InCred + Mudrahub (Elite) checkboxes
  // (efin-app.js laSaveBankDetails). Backend BankDto/BanksController already
  // persist these; the form just never exposed them.
  isIncred?: boolean; isElite?: boolean
}

export default function BanksPage() {
  const [showForm, setShowForm] = useState(false)
  // PHASE 6 FIX: backend already exposed PUT /api/banks/{id} but the frontend
  // never called it — Create/Delete only. editingId tracks whether the open
  // form is creating a new bank (null) or editing an existing one (its id).
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<Partial<Bank>>({})
  const [showBulk, setShowBulk] = useState(false)
  const qc = useQueryClient()

  // PHASE 5 FIX: this page offered Add / Edit / Delete / Bulk Upload to every
  // role, but BanksController gates all three mutations to Admin + ProductTeam
  // (and legacy saveBank/editBank/deleteBank refused non-admins outright), so a
  // Manager or Sales user could fill in the whole form and only discover the
  // block on submit, as a bare 403. Same gate LenderConfigPage already uses.
  const user = useAuthStore(s => s.user)
  const canManage = user?.role === 'Admin' || user?.role === 'ProductTeam'

  const { data: banks, isLoading, error, refetch } = useQuery({
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

  // Server-side rejections (duplicate name, 403) were swallowed entirely — the
  // form just sat there on failure with no indication anything went wrong.
  const mutErr = (create.error ?? update.error ?? remove.error) as
    { response?: { data?: { message?: string; errors?: string[] } } } | null | undefined
  const mutErrText = mutErr
    ? mutErr.response?.data?.message
      ?? mutErr.response?.data?.errors?.join(' ')
      ?? 'Could not save the bank. Please try again.'
    : ''

  function openCreate() {
    setEditingId(null)
    setForm({})
    setShowForm(true)
  }

  function exportCsv() {
    if (!banks || banks.length === 0) return
    const csv = buildCsv(
      ['Bank Name', 'IFSC Prefix', 'Emp Code', 'Location', 'RM Name', 'RM Mobile', 'Email', 'Remarks'],
      banks.map(b => [b.bankName, b.ifscPrefix ?? '', b.empCode ?? '', b.location ?? '', b.rmName ?? '', b.rmMobile ?? '', b.email ?? '', b.remarks ?? '']),
    )
    downloadCsv(csv, `banks-export-${new Date().toISOString().slice(0, 10)}.csv`)
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
    { key: 'bankName',  label: 'Bank Name', sortable: true, render: b => (
      <span className="font-medium inline-flex items-center gap-1.5">
        {b.bankName}
        {b.isIncred && <Badge variant="info">InCred</Badge>}
        {b.isElite && <Badge variant="warning">Mudrahub</Badge>}
      </span>
    )},
    { key: 'ifscPrefix',label: 'IFSC', sortable: true, render: b => <span className="font-mono text-xs">{b.ifscPrefix ?? '—'}</span> },
    { key: 'empCode',   label: 'Emp Code', sortable: true, render: b => b.empCode ?? '—' },
    { key: 'location',  label: 'Location', sortable: true, render: b => b.location ?? '—' },
    { key: 'rmName',    label: 'RM Name', sortable: true, render: b => (
      <div><p className="text-sm">{b.rmName ?? '—'}</p><p className="text-xs text-gray-500">{b.rmMobile ?? ''}</p></div>
    )},
    { key: 'email',     label: 'Email', sortable: true, render: b => b.email ?? '—' },
    // Remarks was the one legacy renderBanksTable column with no React
    // equivalent — it was captured in the form and exported to CSV, but never
    // shown back in the grid.
    { key: 'remarks',   label: 'Remarks', render: b => (
      <span className="text-xs text-gray-500" title={b.remarks ?? ''}>{b.remarks ?? '—'}</span>
    )},
    ...(canManage ? [{ key: 'actions', label: '', render: (b: Bank) => (
      <div className="flex gap-1">
        <button onClick={() => openEdit(b)} className="text-gray-400 hover:text-gray-700 p-1" title="Edit bank">
          <Pencil size={14} />
        </button>
        <button
          title="Delete bank"
          onClick={() => { if (confirm(`Remove bank "${b.bankName}"? This cannot be undone.`)) remove.mutate(b.id) }}
          className="text-red-400 hover:text-red-600 p-1">
          <Trash2 size={14} />
        </button>
      </div>
    )}] as Column<Bank>[] : []),
  ]

  return (
    <div>
      <PageHeader title="Banks & NBFCs" subtitle="Manage lending partners"
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={!banks?.length} onClick={exportCsv}>
              <Download size={14} className="mr-1" />Export CSV
            </Button>
            {canManage && (
              <Button size="sm" variant="secondary" onClick={() => setShowBulk(true)}>
                <Upload size={14} className="mr-1" />Bulk Upload
              </Button>
            )}
            {canManage && <Button size="sm" onClick={openCreate}><Plus size={14} className="mr-1" />Add Bank</Button>}
          </div>
        } />

      {showBulk && <BulkUploadBanksModal onClose={() => setShowBulk(false)} />}

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
          {/* Lender flags — legacy bank-detail InCred + Mudrahub toggles
              (efin-app.js laSaveBankDetails). Persist to BankDto.IsIncred/IsElite. */}
          <div className="flex flex-wrap items-center gap-6 mb-4">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={!!form.isIncred}
                onChange={e => setForm(p => ({ ...p, isIncred: e.target.checked }))} />
              InCred lender
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={!!form.isElite}
                onChange={e => setForm(p => ({ ...p, isElite: e.target.checked }))} />
              Mudrahub (Elite) lender
            </label>
          </div>
          {mutErrText && (
            <p className="text-xs mb-3" style={{ color: 'var(--danger)' }}>{mutErrText}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" loading={editingId ? update.isPending : create.isPending}
              onClick={() => editingId ? update.mutate() : create.mutate()}>
              {editingId ? 'Save Changes' : 'Save'}
            </Button>
            <Button size="sm" variant="secondary" onClick={closeForm}>Cancel</Button>
          </div>
        </Card>
      )}
      <Card><DataTable columns={columns} data={banks} isLoading={isLoading} error={error} onRetry={() => refetch()} /></Card>
    </div>
  )
}

