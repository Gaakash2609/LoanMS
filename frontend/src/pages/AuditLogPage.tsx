import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { Card } from '@/components/ui/Card'
import { Tabs } from '@/components/ui/Tabs'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Button } from '@/components/ui/Button'
import AssignmentAuditTab from '@/components/shared/AssignmentAuditTab'
import PageHeader from '@/components/shared/PageHeader'
import { formatDateTime } from '@/utils/format'
import { History, PlusCircle, PencilLine, Trash2, LogIn, Activity, Clock, User } from 'lucide-react'

interface AuditLog {
  id: number; entityName: string; action: string; entityId?: string
  userName?: string; createdAt: string; oldValues?: string; newValues?: string
}

export default function AuditLogPage() {
  const [page, setPage] = useState(1)
  const [entity, setEntity] = useState('')
  // The assignment trail lives in its own table with its own endpoint, so it
  // sits beside the general activity log rather than being merged into it.
  const [tab, setTab] = useState<'activity' | 'assignment'>('activity')

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['audit', page, entity],
    // BUGFIX (confirmed real, pre-existing gap — Phase 8 audit):
    // AuditController.GetLogs (LoanMS.API/Controllers/AuditController.cs)
    // returns { items, total, page, pageSize, totalPages } — the property
    // is `total`, not `totalCount`. items/totalPages already matched, so
    // the table and pagination-buttons worked correctly; only the count
    // read below (data?.totalCount) was always undefined.
    queryFn: () => api.get<ApiResponse<{ items: AuditLog[]; total: number; totalPages: number }>>(
      '/api/audit', { params: { page, pageSize: 30, entity: entity || undefined } }).then(r => r.data.data),
    staleTime: 30_000,
  })

  // Action → badge colors + icon + timeline node color. Same rgba-tinted
  // --success/--danger/--accent pairs the table used before.
  const actionMeta = (action: string) => {
    switch (action) {
      case 'Create': return { fg: 'var(--success)', bg: 'rgba(26,115,64,.12)', node: 'var(--success)', Icon: PlusCircle }
      case 'Update': return { fg: 'var(--accent)', bg: 'rgba(10,88,154,.12)', node: 'var(--accent)', Icon: PencilLine }
      case 'Delete': return { fg: 'var(--danger)', bg: 'rgba(255,69,96,.15)', node: 'var(--danger)', Icon: Trash2 }
      case 'Login': case 'Auth': return { fg: 'var(--warn)', bg: 'rgba(230,126,0,.12)', node: 'var(--warn)', Icon: LogIn }
      default: return { fg: 'var(--text2)', bg: 'var(--surface3)', node: 'var(--text3)', Icon: Activity }
    }
  }

  const items = data?.items ?? []
  const totalPages = data?.totalPages ?? 1

  return (
    <div>
      <PageHeader
        title="Audit Log"
        subtitle={`System activity history${typeof data?.total === 'number' ? ` · ${data.total} entries` : ''}`}
        action={tab === 'activity' && (
          <select value={entity} onChange={e => { setEntity(e.target.value); setPage(1) }}
            className="efin-input !h-auto !py-1.5 !px-3 text-sm" style={{ width: 'auto' }}>
            <option value="">All Entities</option>
            {['Loan', 'Customer', 'User', 'PayoutClaim', 'Auth'].map(e => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        )}
      />

      {/* P12 global audit: this was a hand-rolled 2-tab underline bar —
          identical onChange/active-key shape to the shared `Tabs` component,
          just missing its role="tab"/aria-selected/arrow-key semantics.
          Swapped in directly; no behavior change. */}
      <Tabs
        className="mb-5"
        tabs={[
          { key: 'activity', label: 'System Activity' },
          { key: 'assignment', label: 'Assignment Trail' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'assignment' && <AssignmentAuditTab />}

      {tab === 'activity' && (
        isLoading ? (
          <LoadingSpinner />
        ) : error ? (
          <Card><div className="text-center py-10"><p className="text-sm text-red-600 mb-3">Could not load audit entries.</p><Button size="sm" variant="secondary" onClick={() => refetch()}>Retry</Button></div></Card>
        ) : items.length === 0 ? (
          <Card>
            <div className="text-center py-12">
              <div className="empty-illustration mx-auto mb-4"><History size={30} className="empty-illustration-icon" /></div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>No audit entries</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>Nothing has been recorded for these filters yet.</p>
            </div>
          </Card>
        ) : (
          <>
            <div className="audit-timeline space-y-3">
              {items.map(l => {
                const m = actionMeta(l.action)
                return (
                  <div key={l.id} className="audit-node" style={{ ['--node-color' as string]: m.node }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="audit-badge" style={{ ['--ab-fg' as string]: m.fg, ['--ab-bg' as string]: m.bg }}>
                            <m.Icon size={11} /> {l.action}
                          </span>
                          <span className="efin-mono-id">{l.entityName}</span>
                          {l.entityId && <span className="text-xs font-semibold" style={{ color: 'var(--text3)' }}>#{l.entityId}</span>}
                        </div>
                        <p className="text-[11px] flex items-center gap-3 flex-wrap" style={{ color: 'var(--text3)' }}>
                          <span className="flex items-center gap-1"><User size={11} /> {l.userName ?? 'System'}</span>
                          <span className="flex items-center gap-1"><Clock size={11} /> {formatDateTime(l.createdAt)}</span>
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-4">
                <span className="text-xs" style={{ color: 'var(--text3)' }}>Page {page} of {totalPages}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</Button>
                  <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</Button>
                </div>
              </div>
            )}
          </>
        )
      )}
    </div>
  )
}
