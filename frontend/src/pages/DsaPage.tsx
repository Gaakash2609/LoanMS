import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import DataTable, { type Column } from '@/components/shared/DataTable'
import PageHeader from '@/components/shared/PageHeader'
import { Plus, UserCheck, UserX, Pencil, Download, FileText, Link2, ClipboardList } from 'lucide-react'
import { filenameFromDisposition, dsaApi, type DsaPartner, type DsaSaveRequest } from '@/api/dsaApi'
import DsaDocumentsModal from '@/components/shared/DsaDocumentsModal'
import DsaMappingOverviewModal from '@/components/shared/DsaMappingOverviewModal'
import DsaAppsModal from '@/components/shared/DsaAppsModal'
import { useAuthStore } from '@/store/authStore'
import { useToast } from '@/store/toastStore'

const PAGE_SIZE = 20
const OFFICE_ADDR_TYPES = [
  { value: '', label: '— Select Type —' },
  { value: 'owned', label: 'Owned' },
  { value: 'rented', label: 'Rented' },
  { value: 'leased', label: 'Leased' },
  { value: 'coworking', label: 'Co-working Space' },
  { value: 'registered', label: 'Registered Office' },
  { value: 'branch', label: 'Branch Office' },
]

const EMPTY_FORM = {
  name: '', code: '', mobile: '', email: '', pan: '',
  status: 'active' as 'active' | 'inactive',
  officeAddr: '', officeCity: '', officeState: '', officePin: '', officeAddrType: '',
}

export default function DsaPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const user = useAuthStore(s => s.user)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')

  // Matches DsaController's Create/Update/SetStatus [Authorize(Roles=...)] —
  // same allow-list Vanilla's dsaCanCreate()/dsaCanEdit() enforce client-side
  // (efin-app.js:30550), gated here so the Add/Edit/Toggle controls aren't
  // shown to a role the backend would 403 anyway.
  const canManage = ['Admin', 'Sales', 'ProductTeam'].includes(user?.role ?? '')

  const { data: all, isLoading, error, refetch } = useQuery({
    queryKey: ['dsa'],
    queryFn: () => api.get<ApiResponse<DsaPartner[]>>('/api/dsa').then(r => r.data.data ?? []),
  })

  // GET /api/dsa serves BOTH DSA and Partner records — this page is scoped
  // to actual DSAs (PartnerPage.tsx covers Partner records), but the
  // Partner list is still needed here for the "N Partners mapped" stat, the
  // per-row mapped-partner count/button, and the mapping-overview modal.
  const dsaList = (all ?? []).filter(d => d.partnerType === 'Dsa')
  const partnerList = (all ?? []).filter(d => d.partnerType === 'Partner')

  const q = search.trim().toLowerCase()
  const filtered = dsaList.filter(d => {
    const matchesSearch = !q || d.name.toLowerCase().includes(q) || d.code.toLowerCase().includes(q)
      || (d.phone ?? '').includes(q)
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? d.isActive : !d.isActive)
    return matchesSearch && matchesStatus
  })

  const totalCount = filtered.length
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['dsa'] })

  function buildPayload(): DsaSaveRequest {
    return {
      name: form.name.trim(),
      code: form.code.trim(),
      email: form.email || null,
      phone: form.mobile || null,
      city: form.officeCity || null,
      partnerType: 'Dsa',
      isActive: form.status !== 'inactive',
      pan: form.pan ? form.pan.trim().toUpperCase() : null,
      officeAddress: form.officeAddr || null,
      officeState: form.officeState || null,
      officePin: form.officePin || null,
      officeAddressType: form.officeAddrType || null,
    }
  }

  // Validation matches dsaSave (efin-app.js:30760): DSA Name is required,
  // Mobile must be a valid 10-digit number.
  function validate(): string {
    if (!form.name.trim()) return 'DSA Name is required'
    if (!form.mobile.trim() || form.mobile.trim().length !== 10) return 'Valid 10-digit mobile required'
    return ''
  }

  const save = useMutation({
    mutationFn: async () => {
      if (editingId) { await dsaApi.update(editingId, buildPayload()); return }
      await dsaApi.create(buildPayload())
    },
    onSuccess: () => {
      setFormError(''); invalidate(); setShowForm(false); setEditingId(null); setForm(EMPTY_FORM)
      toast.success(editingId ? 'DSA updated successfully' : 'DSA added successfully')
    },
    onError: (err: unknown) => {
      const d = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      const msg = d?.message || d?.errors?.join(' ') || 'DSA saved locally, but database sync failed — will retry on next refresh'
      setFormError(msg); toast.error(msg)
    },
  })

  function onSaveClick() {
    const v = validate()
    if (v) { setFormError(v); toast.error(v); return }
    save.mutate()
  }

  function startAdd() {
    if (!canManage) { toast.error("Permission denied: your role cannot add DSAs"); return }
    setEditingId(null); setForm(EMPTY_FORM); setFormError(''); setShowForm(true)
  }

  function startEdit(d: DsaPartner) {
    if (!canManage) { toast.error('Permission denied'); return }
    setEditingId(d.id)
    setForm({
      name: d.name, code: d.code, mobile: d.phone ?? '', email: d.email ?? '', pan: d.pan ?? '',
      status: d.isActive ? 'active' : 'inactive',
      officeAddr: d.officeAddress ?? '', officeCity: d.city ?? '', officeState: d.officeState ?? '',
      officePin: d.officePin ?? '', officeAddrType: d.officeAddressType ?? '',
    })
    setFormError(''); setShowForm(true)
  }

  // ── Export ────────────────────────────────────────────────────────────
  const exportCsv = useMutation({
    mutationFn: async () => {
      const res = await dsaApi.exportCsv()
      const name = filenameFromDisposition(res.headers?.['content-disposition'], 'dsa_partners_export.csv')
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url; a.download = name
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    },
    onError: (err: unknown) => {
      const d = (err as { response?: { data?: { message?: string } } })?.response?.data
      toast.error(d?.message || 'Export failed. Please try again.')
    },
  })

  const [docsFor, setDocsFor] = useState<DsaPartner | null>(null)
  const [mappingFor, setMappingFor] = useState<number | null | undefined>(undefined) // undefined = closed
  const [appsFor, setAppsFor] = useState<{ dsa: DsaPartner; partner?: DsaPartner } | null>(null)

  const toggle = useMutation({
    mutationFn: (d: DsaPartner) => dsaApi.setStatus(d.id, !d.isActive),
    onSuccess: (_r, d) => {
      invalidate()
      toast.success((d.isActive ? '⏸ DSA deactivated' : '✅ DSA activated') + ' — ' + d.name)
    },
    onError: () => toast.error('Could not update DSA status. Please try again.'),
  })

  function onToggle(d: DsaPartner) {
    if (!canManage) { toast.error("Permission denied: your role cannot change DSA status"); return }
    toggle.mutate(d)
  }

  const mappedPartnersFor = (dsaId: number) => partnerList.filter(p => p.mappedDsaId === dsaId)

  const columns: Column<DsaPartner>[] = [
    { key: 'name', label: 'DSA Name', render: d => (
      <div><p className="font-medium">{d.name}</p><p className="text-xs text-gray-500 font-mono">{d.code}</p></div>
    )},
    { key: 'email', label: 'Contact', render: d => (
      <div><p className="text-sm">{d.email ?? '—'}</p><p className="text-xs text-gray-500">{d.phone ?? ''}</p></div>
    )},
    { key: 'partners', label: 'Mapping', render: d => {
      const n = mappedPartnersFor(d.id).length
      return (
        <button onClick={() => setMappingFor(d.id)} title="View mapped partners"
          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${
            n ? 'bg-purple-100 text-purple-700 hover:bg-purple-200' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
          }`}>
          <Link2 size={12} /> {n} Partner{n !== 1 ? 's' : ''}
        </button>
      )
    }},
    { key: 'apps', label: 'Apps', render: d => (
      <button onClick={() => setAppsFor({ dsa: d })} title="View applications for this DSA"
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold bg-efin-blue/10 text-efin-blue hover:bg-efin-blue/20">
        <ClipboardList size={12} /> Apps
      </button>
    )},
    { key: 'isActive', label: 'Status', render: d => (
      <Badge variant={d.isActive ? 'success' : 'danger'}>{d.isActive ? 'Active' : 'Inactive'}</Badge>
    )},
    { key: 'actions', label: '', render: d => (
      <div className="flex items-center gap-1">
        <button onClick={() => setDocsFor(d)} title="Documents"
          className="p-1.5 rounded-lg text-gray-400 hover:text-efin-blue hover:bg-gray-100"><FileText size={14} /></button>
        {canManage && (
          <>
            <button onClick={() => startEdit(d)} title="Edit DSA"
              className="p-1.5 rounded-lg text-gray-400 hover:text-efin-blue hover:bg-gray-100"><Pencil size={14} /></button>
            <button onClick={() => onToggle(d)} title={d.isActive ? 'Deactivate' : 'Activate'}
              className={`p-1.5 rounded-lg ${d.isActive ? 'text-red-500 hover:bg-red-50' : 'text-green-500 hover:bg-green-50'}`}>
              {d.isActive ? <UserX size={14} /> : <UserCheck size={14} />}
            </button>
          </>
        )}
      </div>
    )},
  ]

  // Stats strip — Total / Active / Inactive / Mapped, matching Vanilla's
  // dsaStatsRefresh (efin-app.js:30616): "Mapped" counts every Partner
  // record that has a mappedDsaId set, across all DSAs (not per-row).
  const activeCount = dsaList.filter(d => d.isActive).length
  const mappedCount = partnerList.filter(p => p.mappedDsaId).length

  return (
    <div>
      <PageHeader title="DSA Management" subtitle={`${dsaList.length} DSAs`}
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary"
              loading={exportCsv.isPending} disabled={exportCsv.isPending}
              onClick={() => exportCsv.mutate()}>
              <Download size={14} className="mr-1" />Export CSV
            </Button>
            {canManage && (
              <Button size="sm" onClick={startAdd}><Plus size={14} className="mr-1" />Add DSA</Button>
            )}
          </div>
        } />

      {/* Stats — legacy's Total / Active / Inactive / Mapped strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        {[
          { label: 'Total DSAs', value: dsaList.length, color: 'text-gray-900' },
          { label: 'Active', value: activeCount, color: 'text-green-600' },
          { label: 'Inactive', value: dsaList.length - activeCount, color: 'text-red-600' },
          { label: 'Mapped Partners', value: mappedCount, color: 'text-purple-600' },
        ].map(s => (
          <Card key={s.label} className="py-4">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </Card>
        ))}
      </div>

      {showForm && canManage && (
        <Card className="mb-5 p-5">
          <p className="text-sm font-semibold mb-4">{editingId ? `Edit DSA — ${form.name}` : 'New DSA Partner'}</p>
          {formError && (
            <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>
          )}

          <p className="text-[11px] font-bold text-efin-blue uppercase tracking-wide mb-2">Basic Details</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">DSA Name *</label>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="Full name of DSA" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">DSA Code</label>
              <input value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))}
                placeholder="Auto-generated if blank" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Mobile *</label>
              <input value={form.mobile} maxLength={10}
                onChange={e => setForm(p => ({ ...p, mobile: e.target.value.replace(/\D/g, '') }))}
                placeholder="10-digit mobile" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Email</label>
              <input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                placeholder="dsa@example.com" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">PAN Number</label>
              <input value={form.pan} maxLength={10}
                onChange={e => setForm(p => ({ ...p, pan: e.target.value.toUpperCase() }))}
                placeholder="ABCDE1234F" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm uppercase" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Status</label>
              <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value as 'active' | 'inactive' }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <p className="text-[11px] font-bold text-efin-blue uppercase tracking-wide mb-2">Office Address</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            <div className="md:col-span-3">
              <label className="text-xs font-medium text-gray-600 block mb-1">Office Address</label>
              <input value={form.officeAddr} onChange={e => setForm(p => ({ ...p, officeAddr: e.target.value }))}
                placeholder="Full office address" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">City</label>
              <input value={form.officeCity} onChange={e => setForm(p => ({ ...p, officeCity: e.target.value }))}
                placeholder="City" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">State</label>
              <input value={form.officeState} onChange={e => setForm(p => ({ ...p, officeState: e.target.value }))}
                placeholder="State" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">PIN Code</label>
              <input value={form.officePin} maxLength={6}
                onChange={e => setForm(p => ({ ...p, officePin: e.target.value.replace(/\D/g, '') }))}
                placeholder="6-digit PIN" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Office Address Type</label>
              <select value={form.officeAddrType} onChange={e => setForm(p => ({ ...p, officeAddrType: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                {OFFICE_ADDR_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button size="sm" loading={save.isPending} onClick={onSaveClick}>{editingId ? 'Update DSA' : 'Save DSA'}</Button>
            <Button size="sm" variant="secondary"
              onClick={() => { setShowForm(false); setEditingId(null); setFormError('') }}>Cancel</Button>
          </div>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search DSAs…"
            className="flex-1 max-w-xs border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue" />
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value as 'all'); setPage(1) }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <DataTable columns={columns} data={pageItems} isLoading={isLoading}
          error={error} onRetry={() => refetch()} emptyTitle="No DSAs found" emptyDescription="Try clearing the filters, or add a new DSA."
          totalPages={totalPages} currentPage={page} onPageChange={setPage} totalCount={totalCount} />
      </Card>

      {docsFor && (
        <DsaDocumentsModal
          partnerId={docsFor.id}
          partnerName={docsFor.name}
          canUpload={canManage}
          onClose={() => setDocsFor(null)}
        />
      )}

      {mappingFor !== undefined && (
        <DsaMappingOverviewModal
          dsaList={dsaList}
          partnerList={partnerList}
          initialDsaId={mappingFor}
          onClose={() => setMappingFor(undefined)}
          onViewApps={(dsa, partner) => { setMappingFor(undefined); setAppsFor({ dsa, partner }) }}
        />
      )}

      {appsFor && (
        <DsaAppsModal
          dsaId={appsFor.dsa.id}
          dsaName={appsFor.dsa.name}
          dsaCode={appsFor.dsa.code}
          mappedPartners={mappedPartnersFor(appsFor.dsa.id).map(p => ({ id: p.id, name: p.name }))}
          filterPartner={appsFor.partner ? { id: appsFor.partner.id, name: appsFor.partner.name } : null}
          onClose={() => setAppsFor(null)}
        />
      )}
    </div>
  )
}
