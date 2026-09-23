import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, UserCheck, UserX, Pencil, Download, Link2, FileText, Trash2 } from 'lucide-react'
import { dsaApi, type DsaPartner, type DsaSaveRequest } from '@/api/dsaApi'
import DsaDocumentsModal from '@/components/shared/DsaDocumentsModal'
import DsaMappingOverviewModal from '@/components/shared/DsaMappingOverviewModal'
import DsaAppsModal from '@/components/shared/DsaAppsModal'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import DataTable, { type Column } from '@/components/shared/DataTable'
import PageHeader from '@/components/shared/PageHeader'
import { formatDate } from '@/utils/format'
import { buildCsv, downloadCsv } from '@/utils/loanExport'
import { useAuthStore } from '@/store/authStore'

// Partner Management — legacy page-partner-mgmt (efin-app.js's pm*
// functions). Had NO React equivalent at all before this: DsaPage queried
// /api/dsa unfiltered, so Partner records appeared merged into the DSA
// table with no Type column, no partner-specific fields, and no DSA
// mapping UI. Same backend endpoint, filtered to PartnerType == 'Partner'.
const PAGE_SIZE = 20
const PARTNER_CATEGORIES = ['Individual', 'Firm', 'Agent']

const EMPTY_FORM = {
  name: '', code: '', email: '', phone: '', city: '',
  category: PARTNER_CATEGORIES[0], status: 'active' as 'active' | 'inactive',
  mappedDsaId: '' as number | '',
}

export default function PartnerPage() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState('')

  // Matches DsaController's Create/Update/SetStatus [Authorize(Roles=...)].
  const canManage = ['Admin', 'Sales', 'ProductTeam'].includes(user?.role ?? '')
  // Delete is narrower on the backend — [Authorize(Roles = "Admin,ProductTeam")].
  const canDelete = ['Admin', 'ProductTeam'].includes(user?.role ?? '')
  const [docsFor, setDocsFor] = useState<DsaPartner | null>(null)
  // Mapped-DSA badge → mapping overview (Vanilla pmRender's dsaCell button,
  // efin-app.js:30846: onclick="dsaOpenMappingOverview('${mappedDsa.id}')").
  const [mappingFor, setMappingFor] = useState<number | null | undefined>(undefined)
  const [appsFor, setAppsFor] = useState<{ dsa: DsaPartner; partner?: DsaPartner } | null>(null)
  const mappedPartnersFor = (dsaId: number) => partners.filter(p => p.mappedDsaId === dsaId)

  const { data: all, isLoading, error: loadError, refetch } = useQuery({
    queryKey: ['dsa'],
    queryFn: () => dsaApi.getAll().then(r => r.data.data ?? []),
  })

  const partners = (all ?? []).filter(d => d.partnerType === 'Partner')
  const dsaOptions = (all ?? []).filter(d => d.partnerType === 'Dsa')
  // Vanilla's pmPopulateDsaDropdown (efin-app.js:30807) only lists DSAs with
  // status==='active' in the "Map to DSA" select — an inactive DSA can still
  // be shown elsewhere (badges, table), just not offered as a new mapping
  // target.
  const activeDsaOptions = dsaOptions.filter(d => d.isActive)

  const q = search.trim().toLowerCase()
  const filtered = partners.filter(p => {
    const matchesSearch = !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)
      || (p.email ?? '').toLowerCase().includes(q) || (p.phone ?? '').includes(q)
    const matchesStatus = statusFilter === 'all'
      || (statusFilter === 'active' ? p.isActive : !p.isActive)
    return matchesSearch && matchesStatus
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['dsa'] })

  function buildPayload(): DsaSaveRequest {
    return {
      name: form.name.trim(),
      code: form.code.trim(),
      email: form.email || null,
      phone: form.phone || null,
      city: form.city || null,
      partnerType: 'Partner',
      isActive: form.status !== 'inactive',
      category: form.category || null,
      mappedDsaId: form.mappedDsaId === '' ? null : Number(form.mappedDsaId),
    }
  }

  // Matches pmSave (efin-app.js:30930): Partner Name is required, Mobile
  // must be a valid 10-digit number. Code is optional — vanilla auto-
  // generates 'PAR'+timestamp when left blank (see pmSave), so it must
  // never block Save the way it previously did here.
  function validate(): string {
    if (!form.name.trim()) return 'Partner Name is required'
    if (!form.phone.trim() || form.phone.trim().length !== 10) return 'Valid 10-digit mobile required'
    return ''
  }

  const save = useMutation({
    mutationFn: async () => {
      if (editingId) { await dsaApi.update(editingId, buildPayload()); return }
      await dsaApi.create(buildPayload())
    },
    onSuccess: () => {
      setError(''); invalidate(); setShowForm(false); setEditingId(null); setForm(EMPTY_FORM)
    },
    onError: (err: unknown) => {
      const d = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      setError(d?.message || d?.errors?.join(' ') || 'Could not save this partner.')
    },
  })

  const toggle = useMutation({
    mutationFn: (p: DsaPartner) => dsaApi.setStatus(p.id, !p.isActive),
    onSuccess: () => { setError(''); invalidate() },
    onError: () => setError('Could not update partner status.'),
  })

  // DELETE /api/dsa/{id} — soft-delete, existed on the backend with no
  // caller from either the DSA or Partner page.
  const remove = useMutation({
    mutationFn: (id: number) => dsaApi.delete(id),
    onSuccess: () => { setError(''); invalidate() },
    onError: () => setError('Could not delete this partner.'),
  })

  function startEdit(p: DsaPartner) {
    setEditingId(p.id)
    setForm({
      name: p.name, code: p.code, email: p.email ?? '', phone: p.phone ?? '',
      city: p.city ?? '', category: p.category ?? PARTNER_CATEGORIES[0],
      status: p.isActive ? 'active' : 'inactive',
      mappedDsaId: p.mappedDsaId ?? '',
    })
    setShowForm(true)
  }

  function onSaveClick() {
    const v = validate()
    if (v) { setError(v); return }
    setError('')
    save.mutate()
  }

  function exportCsv() {
    if (filtered.length === 0) return
    const csv = buildCsv(
      ['Name', 'Code', 'Type', 'Email', 'Phone', 'City', 'Mapped DSA', 'Active', 'Created'],
      filtered.map(p => [p.name, p.code, p.category ?? '', p.email ?? '', p.phone ?? '',
        p.city ?? '', p.mappedDsaName ?? '', p.isActive ? 'Yes' : 'No', formatDate(p.createdAt)]),
    )
    downloadCsv(csv, `partners-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  const mappedDsaPreview = form.mappedDsaId === '' ? null : dsaOptions.find(d => d.id === Number(form.mappedDsaId))
  // Matches pmDsaMappingPreview (efin-app.js:30820): count excludes the
  // partner currently being edited, so editing an already-mapped partner
  // doesn't count itself as "1 partner mapped" alongside itself.
  const mappedDsaPartnerCount = mappedDsaPreview
    ? partners.filter(p => p.mappedDsaId === mappedDsaPreview.id && p.id !== editingId).length
    : 0

  const columns: Column<DsaPartner>[] = [
    { key: 'name', label: 'Partner', render: p => (
      <div><p className="font-medium text-gray-900">{p.name}</p><p className="text-xs text-gray-500 font-mono">{p.code}</p></div>
    )},
    { key: 'category', label: 'Type', render: p => p.category ? <Badge variant="info">{p.category}</Badge> : <span className="text-gray-300">—</span> },
    { key: 'email', label: 'Contact', render: p => (
      <div><p className="text-sm">{p.email ?? '—'}</p><p className="text-xs text-gray-500">{p.phone ?? ''}</p></div>
    )},
    { key: 'city', label: 'City', render: p => p.city ?? '—' },
    { key: 'mappedDsaName', label: 'Mapped DSA', render: p => p.mappedDsaName && p.mappedDsaId
      ? <button onClick={() => setMappingFor(p.mappedDsaId as number)} title={`View DSA mapping for ${p.mappedDsaName}`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-purple-700 bg-purple-100 hover:bg-purple-200 rounded-lg px-2 py-1">
          <Link2 size={12} />{p.mappedDsaName}
        </button>
      : <span className="text-gray-300">—</span> },
    { key: 'isActive', label: 'Status', render: p => (
      <Badge variant={p.isActive ? 'success' : 'danger'}>{p.isActive ? 'Active' : 'Inactive'}</Badge>
    )},
    { key: 'actions', label: '', render: p => (
      <div className="flex items-center gap-1">
        <button onClick={() => setDocsFor(p)} title="Documents"
          className="p-1.5 rounded-lg text-gray-400 hover:text-efin-blue hover:bg-gray-100"><FileText size={14} /></button>
        {canManage && (
          <>
            <button onClick={() => startEdit(p)} title="Edit"
              className="p-1.5 rounded-lg text-gray-400 hover:text-efin-blue hover:bg-gray-100"><Pencil size={14} /></button>
            <button onClick={() => toggle.mutate(p)} title={p.isActive ? 'Deactivate' : 'Activate'}
              className={`p-1.5 rounded-lg ${p.isActive ? 'text-red-500 hover:bg-red-50' : 'text-green-500 hover:bg-green-50'}`}>
              {p.isActive ? <UserX size={14} /> : <UserCheck size={14} />}
            </button>
          </>
        )}
        {canDelete && (
          <button
            onClick={() => { if (confirm(`Delete "${p.name}"? This cannot be undone.`)) remove.mutate(p.id) }}
            title="Delete"
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
        )}
      </div>
    ) },
  ]

  const activeCount = partners.filter(p => p.isActive).length

  return (
    <div>
      <PageHeader title="Partner Management" subtitle={`${partners.length} partners`}
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={filtered.length === 0} onClick={exportCsv}>
              <Download size={14} className="mr-1" />Export CSV
            </Button>
            {canManage && (
              <Button size="sm" onClick={() => { setEditingId(null); setForm(EMPTY_FORM); setShowForm(true) }}>
                <Plus size={14} className="mr-1" />Add Partner
              </Button>
            )}
          </div>
        } />

      {/* Stats — legacy's Total / Active / Inactive strip */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        {[
          { label: 'Total Partners', value: partners.length, color: 'text-gray-900' },
          { label: 'Active', value: activeCount, color: 'text-green-600' },
          { label: 'Inactive', value: partners.length - activeCount, color: 'text-red-600' },
        ].map(s => (
          <Card key={s.label} className="py-4">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </Card>
        ))}
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {showForm && canManage && (
        <Card className="mb-5">
          <p className="text-sm font-semibold mb-4">{editingId ? 'Edit Partner' : 'New Partner'}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {[
              { label: 'Partner Name *', key: 'name', placeholder: 'Full name' },
              { label: 'Code', key: 'code', placeholder: 'Auto-generated if blank' },
              { label: 'Email', key: 'email', placeholder: 'partner@example.com' },
              { label: 'City', key: 'city', placeholder: 'City' },
            ].map(f => (
              <div key={f.key}>
                <label className="text-xs font-medium text-gray-600 block mb-1">{f.label}</label>
                <input value={form[f.key as 'name'] as string}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            ))}
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Mobile *</label>
              <input value={form.phone} maxLength={10}
                onChange={e => setForm(p => ({ ...p, phone: e.target.value.replace(/\D/g, '') }))}
                placeholder="10-digit mobile"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Type</label>
              <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                {PARTNER_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
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

          {/* DSA mapping — legacy's pm-f-dsa-id + live preview card */}
          <div className="mb-4">
            <label className="text-xs font-medium text-gray-600 block mb-1">Map to DSA</label>
            <select
              value={form.mappedDsaId}
              onChange={e => setForm(p => ({ ...p, mappedDsaId: e.target.value ? Number(e.target.value) : '' }))}
              className="w-full md:w-1/3 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">— No DSA Mapping —</option>
              {activeDsaOptions.map(d => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
            </select>
            {mappedDsaPreview && (
              <div className="mt-2 inline-flex items-center gap-3 text-xs bg-surface2 border border-token rounded-lg px-3 py-2">
                <Link2 size={13} className="text-efin-blue" />
                <span className="font-semibold">{mappedDsaPreview.name}</span>
                <span className="text-gray-500 font-mono">{mappedDsaPreview.code}</span>
                <Badge variant={mappedDsaPreview.isActive ? 'success' : 'danger'}>
                  {mappedDsaPreview.isActive ? 'Active' : 'Inactive'}
                </Badge>
                <span className="text-gray-500">
                  {mappedDsaPartnerCount} partner(s) mapped
                </span>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button size="sm" loading={save.isPending} onClick={onSaveClick}>
              {editingId ? 'Save Changes' : 'Create Partner'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => { setShowForm(false); setEditingId(null); setError('') }}>Cancel</Button>
          </div>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search partners…"
            className="flex-1 max-w-xs border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue" />
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value as 'all'); setPage(1) }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <DataTable columns={columns} data={pageItems} isLoading={isLoading}
          error={loadError} onRetry={() => refetch()} emptyTitle="No partners found" emptyDescription="Try clearing the filters, or add a new partner."
          totalPages={totalPages} currentPage={page} onPageChange={setPage} totalCount={filtered.length} />
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
          dsaList={dsaOptions}
          partnerList={partners}
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
