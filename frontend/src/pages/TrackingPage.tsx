import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { formatDateTime } from '@/utils/format'
import { ArrowLeft, Plus, CheckCircle, Clock, AlertCircle } from 'lucide-react'

interface TrackingEntry {
  id: number; name: string; stage: string; assignedUser: string
  status: string; comment?: string; subNote?: string; createdAt: string
}

const STAGES = ['KYC','Login','Underwriting','Approval','Disbursement','PostDisbursement','Other']
const STATUSES = ['Pending','In Progress','Complete','COMPLETE','On Hold','Cancelled']

const statusIcon = (s: string) => {
  const u = s.toUpperCase()
  if (u === 'COMPLETE') return <CheckCircle size={14} className="text-green-500" />
  if (u === 'IN PROGRESS') return <Clock size={14} className="text-blue-500" />
  return <AlertCircle size={14} className="text-gray-400" />
}

export default function TrackingPage() {
  const { loanId } = useParams<{ loanId: string }>()
  const id = Number(loanId)
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', stage: 'KYC', assignedUser: '', status: 'Pending', comment: '', subNote: '' })

  const { data: entries, isLoading } = useQuery({
    queryKey: ['tracking', id],
    queryFn: () => api.get<ApiResponse<TrackingEntry[]>>(`/api/loans/${id}/tracking`).then(r => r.data.data ?? []),
    enabled: id > 0,
  })

  const add = useMutation({
    mutationFn: () => api.post(`/api/loans/${id}/tracking`, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tracking', id] }); setShowForm(false); setForm({ name: '', stage: 'KYC', assignedUser: '', status: 'Pending', comment: '', subNote: '' }) },
  })

  const update = useMutation({
    mutationFn: ({ entryId, status }: { entryId: number; status: string }) =>
      api.put(`/api/tracking/${entryId}`, { ...entries?.find(e => e.id === entryId), status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tracking', id] }),
  })

  if (!id) return <div className="p-8 text-center text-gray-500">Invalid loan ID</div>

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <Link to={`/loans/${id}`} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"><ArrowLeft size={18} /></Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Tracking — Loan #{id}</h1>
          <p className="text-sm text-gray-500">Workflow stage tracking</p>
        </div>
      </div>

      {showForm && (
        <Card className="mb-5 p-5">
          <p className="text-sm font-semibold mb-4">Add Tracking Entry</p>
          <div className="grid grid-cols-2 gap-4 mb-4">
            {[
              { label: 'Task Name *', key: 'name', type: 'text', placeholder: 'e.g. EFIN-KYC Verification' },
              { label: 'Assigned User', key: 'assignedUser', type: 'text', placeholder: 'Team member name' },
              { label: 'Comment', key: 'comment', type: 'text', placeholder: 'Optional note' },
              { label: 'Sub Note', key: 'subNote', type: 'text', placeholder: 'Additional detail' },
            ].map(f => (
              <div key={f.key}>
                <label className="text-xs font-medium text-gray-600 block mb-1">{f.label}</label>
                <input value={form[f.key as keyof typeof form]}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            ))}
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Stage</label>
              <select value={form.stage} onChange={e => setForm(p => ({ ...p, stage: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                {STAGES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Status</label>
              <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" loading={add.isPending} onClick={() => add.mutate()}>Save</Button>
            <Button size="sm" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title={`Tracking Entries (${entries?.length ?? 0})`}
          action={<Button size="sm" onClick={() => setShowForm(true)}><Plus size={14} className="mr-1" />Add Entry</Button>} />
        {isLoading ? <LoadingSpinner /> : (
          <div className="space-y-3">
            {(entries ?? []).map(e => (
              <div key={e.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <div className="mt-0.5">{statusIcon(e.status)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900">{e.name}</p>
                    <select value={e.status}
                      onChange={ev => update.mutate({ entryId: e.id, status: ev.target.value })}
                      className="text-xs border border-gray-200 rounded px-2 py-0.5 bg-white ml-2">
                      {STATUSES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Stage: <span className="font-medium">{e.stage}</span>
                    {e.assignedUser && <> · {e.assignedUser}</>}
                    {e.comment && <> · {e.comment}</>}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{formatDateTime(e.createdAt)}</p>
                </div>
              </div>
            ))}
            {!entries?.length && <p className="text-sm text-gray-400 py-4 text-center">No tracking entries yet.</p>}
          </div>
        )}
      </Card>
    </div>
  )
}
