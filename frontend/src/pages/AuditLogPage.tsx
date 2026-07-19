import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { Card } from '@/components/ui/Card'
import DataTable, { type Column } from '@/components/shared/DataTable'
import PageHeader from '@/components/shared/PageHeader'
import { formatDateTime } from '@/utils/format'

interface AuditLog {
  id: number; entityName: string; action: string; entityId?: string
  userName?: string; createdAt: string; oldValues?: string; newValues?: string
}

export default function AuditLogPage() {
  const [page, setPage] = useState(1)
  const [entity, setEntity] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['audit', page, entity],
    queryFn: () => api.get<ApiResponse<{ items: AuditLog[]; totalCount: number; totalPages: number }>>(
      '/api/audit', { params: { page, pageSize: 30, entity: entity || undefined } }).then(r => r.data.data),
    staleTime: 30_000,
  })

  const columns: Column<AuditLog>[] = [
    { key: 'createdAt',  label: 'Time',    render: l => formatDateTime(l.createdAt) },
    { key: 'entityName', label: 'Entity',  render: l => <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{l.entityName}</span> },
    { key: 'action',     label: 'Action',  render: l => (
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
        l.action === 'Create' ? 'bg-green-100 text-green-700' :
        l.action === 'Update' ? 'bg-blue-100 text-blue-700' :
        l.action === 'Delete' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
      }`}>{l.action}</span>
    )},
    { key: 'entityId',  label: 'Entity ID', render: l => l.entityId ?? '—' },
    { key: 'userName',  label: 'User',      render: l => l.userName ?? '—' },
  ]

  return (
    <div>
      <PageHeader title="Audit Log" subtitle="System activity history"
        action={
          <select value={entity} onChange={e => { setEntity(e.target.value); setPage(1) }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
            <option value="">All Entities</option>
            {['Loan', 'Customer', 'User', 'PayoutClaim', 'Auth'].map(e => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        } />
      <Card>
        <DataTable columns={columns} data={data?.items} isLoading={isLoading}
          totalPages={data?.totalPages} currentPage={page} onPageChange={setPage} totalCount={data?.totalCount} />
      </Card>
    </div>
  )
}
