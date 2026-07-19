import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import DataTable, { type Column } from '@/components/shared/DataTable'
import PageHeader from '@/components/shared/PageHeader'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { AlertCircle } from 'lucide-react'

interface IncredStatus {
  configured: boolean; baseUrl?: string; partnerId?: string
}

interface IncredApp {
  id: number; loanId: number; applicantName: string
  incredAppId?: string; loanAmount: number; offerStatus: string; updatedAt: string
}

const STATUS_VARIANT: Record<string, 'success'|'warning'|'info'|'danger'|'default'> = {
  approved: 'success', pending: 'warning', offer_received: 'info',
  rejected: 'danger', initiated: 'default',
}

export default function IncredPage() {
  const [tab, setTab] = useState<'apps'|'config'>('apps')

  const { data: status } = useQuery({
    queryKey: ['incred-status'],
    queryFn: () => api.get<ApiResponse<IncredStatus>>('/api/incred/status').then(r => r.data.data),
    staleTime: 60_000,
  })

  const { data: apps, isLoading } = useQuery({
    queryKey: ['incred-apps'],
    queryFn: () => api.get<ApiResponse<IncredApp[]>>('/api/incred/applications').then(r => r.data.data ?? []),
    enabled: tab === 'apps',
    staleTime: 30_000,
  })

  const columns: Column<IncredApp>[] = [
    { key: 'id',            label: 'App ID',      render: a => <span className="font-mono text-xs">#{a.loanId}</span> },
    { key: 'applicantName', label: 'Applicant',   render: a => <span className="font-medium">{a.applicantName}</span> },
    { key: 'incredAppId',   label: 'InCred App ID',render: a => <span className="font-mono text-xs">{a.incredAppId ?? '—'}</span> },
    { key: 'loanAmount',    label: 'Loan Amount', render: a => `₹${a.loanAmount.toLocaleString('en-IN')}` },
    { key: 'offerStatus',   label: 'Offer Status',render: a => (
      <Badge variant={STATUS_VARIANT[a.offerStatus?.toLowerCase()] ?? 'default'}>{a.offerStatus ?? 'Pending'}</Badge>
    )},
  ]

  return (
    <div>
      <PageHeader title="InCred Integration" subtitle="Bank API workflow management" />

      {!status?.configured && (
        <div className="mb-4 p-4 bg-amber-50 rounded-xl border border-amber-100 text-sm text-amber-700 flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold mb-1">InCred API Not Configured</p>
            <p className="text-xs">
              Configure InCred credentials in <code className="bg-amber-100 px-1 rounded">appsettings.json → InCred:BaseUrl, InCred:PartnerId, InCred:ClientSecret</code>.
              Once configured, this module enables automatic offer requests, status tracking, and application submission to InCred's lending platform.
            </p>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-5">
        {(['apps','config'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {t === 'apps' ? 'InCred Applications' : 'API Configuration'}
          </button>
        ))}
      </div>

      {tab === 'apps' && (
        <Card>
          {isLoading ? <LoadingSpinner /> : (
            <DataTable columns={columns} data={apps ?? []} />
          )}
        </Card>
      )}

      {tab === 'config' && (
        <Card className="p-5 max-w-lg">
          <p className="text-sm font-semibold mb-4">InCred API Credentials</p>
          <div className="space-y-3">
            {[
              { label: 'Base URL', placeholder: 'https://api.incred.com/v3', key: 'InCred:BaseUrl' },
              { label: 'Partner ID', placeholder: 'e.g. 5251599593571026P', key: 'InCred:PartnerId' },
              { label: 'Client Secret', placeholder: 'OAuth2 client_secret', key: 'InCred:ClientSecret' },
            ].map(f => (
              <div key={f.key}>
                <label className="text-xs font-medium text-gray-600 block mb-1">{f.label}</label>
                <input type={f.label.includes('Secret') ? 'password' : 'text'}
                  placeholder={f.placeholder}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
                  disabled
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-4">
            Credentials are set via environment variables or <code>appsettings.json</code>.
            They cannot be edited from the UI for security reasons.
            Contact your system administrator to update InCred API credentials.
          </p>
        </Card>
      )}
    </div>
  )
}
