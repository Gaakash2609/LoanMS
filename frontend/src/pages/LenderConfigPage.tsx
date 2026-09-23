import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  lenderConfigApi,
  type Company, type Category, type MatchRequest, type MatchResponse,
} from '@/api/lenderConfigApi'
import { LOAN_PRODUCTS, EMP_TYPES, COMPANY_TYPES } from '@/api/banksApi'
import { useAuthStore } from '@/store/authStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Tabs, type TabItem } from '@/components/ui/Tabs'
import { Plus, Trash2, Pencil, Search, Download, Upload, Landmark, Building2, Layers, SlidersHorizontal, CheckCircle2, XCircle } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import { buildCsv, downloadCsv } from '@/utils/loanExport'
import { parseCsvRows } from '@/utils/csv'
import BankProductConfigCard from '@/components/shared/BankProductConfigCard'
import LenderQuickSetup from '@/components/shared/LenderQuickSetup'
import ImportLinesModal from '@/components/shared/ImportLinesModal'
import { MultiLineModal } from '@/components/shared/LineModals'
import { NumberInput } from '@/components/ui/NumberInput'

// Legacy nests Companies / Categories / Import-Lines under the Personal
// product workspace (index.html #lc-general-config-section), not as top-level
// tabs — so the page's own tabs are just the product workspace + Match.
type Tab = 'quicksetup' | 'bankconfig' | 'match'

function errorMessage(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
  return msg?.message || msg?.errors?.join(' ') || fallback
}

// Reproduces ErrorBanner's (components/ui/States.tsx) exact computed colors
// -- rgba(192,57,43,.1) bg / 1px rgba(192,57,43,.25) border / var(--danger)
// text -- for the plain-string error state these tabs already track locally,
// replacing the raw text-red-600/bg-red-50/border-red-200 stock Tailwind
// trio used at every one of these call sites.
function ErrorNotice({ message, className }: { message: string; className?: string }) {
  return (
    <div
      role="alert"
      className={`text-sm rounded-lg px-3 py-2 ${className ?? 'mb-4'}`}
      style={{ color: 'var(--danger)', background: 'rgba(192, 57, 43, .1)', border: '1px solid rgba(192, 57, 43, .25)' }}
    >
      {message}
    </div>
  )
}

// ── Tab 1: Companies ─────────────────────────────────────────────────────
// Legacy laCatTier / LA_CAT_TIERS (efin-app.js:19681) — salary → tier badge.
const CAT_TIERS = [
  { label: 'Platinum', color: '#7c3aed', bg: 'rgba(124,58,237,.12)', min: 40000 },
  { label: 'Gold', color: '#d97706', bg: 'rgba(245,158,11,.12)', min: 25000 },
  { label: 'Silver', color: '#64748b', bg: 'rgba(100,116,139,.12)', min: 15000 },
  { label: 'Bronze', color: '#92400e', bg: 'rgba(180,83,9,.12)', min: 0 },
]
function catTier(salary: number) { return CAT_TIERS.find(t => salary >= t.min) ?? CAT_TIERS[CAT_TIERS.length - 1] }

// Legacy laCompSort/laCatSort/laLineSort — client-side list ordering.
type SortDir = 'asc' | 'desc'
function cmp<T>(a: T, b: T, dir: SortDir) { const r = a < b ? -1 : a > b ? 1 : 0; return dir === 'asc' ? r : -r }

function CompaniesTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', empTypes: '', compType: '' })
  const [error, setError] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'compType'>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const importInputRef = useRef<HTMLInputElement>(null)

  const { data: companies, isLoading } = useQuery({
    queryKey: ['lender-companies'],
    queryFn: () => lenderConfigApi.getCompanies().then(r => r.data.data ?? []),
  })

  function closeForm() { setShowForm(false); setEditingId(null); setForm({ name: '', empTypes: '', compType: '' }); setError('') }
  function openEdit(c: Company) {
    let empTypes: string[] = []
    try { empTypes = JSON.parse(c.empTypesJson || '[]') } catch { /* leave empty on parse failure */ }
    setEditingId(c.id)
    setForm({ name: c.name, empTypes: empTypes.join(', '), compType: c.compType ?? '' })
    setError('')
    setShowForm(true)
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        empTypes: form.empTypes.trim() ? form.empTypes.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        compType: form.compType.trim() || undefined,
      }
      if (editingId) await lenderConfigApi.updateCompany(editingId, payload)
      else await lenderConfigApi.createCompany(payload)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lender-companies'] }); closeForm() },
    onError: (err: unknown) => setError(errorMessage(err, 'Could not save company. Please try again.')),
  })

  const remove = useMutation({
    mutationFn: (id: number) => lenderConfigApi.deleteCompany(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lender-companies'] }),
    onError: (err: unknown) => setError(errorMessage(err, 'Could not delete company. Please try again.')),
  })

  function handleDelete(id: number, name: string) {
    if (!window.confirm(`Delete company "${name}"? This cannot be undone.`)) return
    remove.mutate(id)
  }

  // Bulk import (legacy laImportCompaniesCSV / laConfirmBulkCompanies) —
  // CSV columns: Name, Employment Types (';'-separated), Company Type.
  const importCsv = useMutation({
    mutationFn: async (text: string) => {
      const rows = parseCsvRows(text, 'name')
      for (const cols of rows) {
        const name = (cols[0] ?? '').trim()
        if (!name) continue
        const empTypes = (cols[1] ?? '').split(/[;|]/).map(s => s.trim()).filter(Boolean)
        await lenderConfigApi.createCompany({ name, empTypes: empTypes.length ? empTypes : undefined, compType: (cols[2] ?? '').trim() || undefined })
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lender-companies'] }),
    onError: (err: unknown) => setError(errorMessage(err, 'Could not import companies. Check the CSV format.')),
  })
  function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) { setError('Only .csv files are supported.'); return }
    const reader = new FileReader()
    reader.onload = () => importCsv.mutate(String(reader.result ?? ''))
    reader.readAsText(file)
  }

  // Delete all (legacy laDeleteAllCompanies)
  const deleteAll = useMutation({
    mutationFn: async () => { for (const c of companies ?? []) await lenderConfigApi.deleteCompany(c.id) },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lender-companies'] }),
    onError: (err: unknown) => setError(errorMessage(err, 'Could not delete all companies.')),
  })
  function handleDeleteAll() {
    if (!companies?.length) return
    if (!window.confirm(`Delete ALL ${companies.length} companies? This cannot be undone.`)) return
    deleteAll.mutate()
  }

  function exportCsv() {
    if (!companies || companies.length === 0) return
    const csv = buildCsv(
      ['Name', 'Employment Types', 'Company Type'],
      companies.map(c => {
        let empTypes = ''
        try { empTypes = (JSON.parse(c.empTypesJson || '[]') as string[]).join('; ') } catch { /* leave blank on parse failure */ }
        return [c.name, empTypes, c.compType ?? '']
      }),
    )
    downloadCsv(csv, `lender-companies-export-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className="section-icon-badge" style={{ color: 'var(--accent)' }}><Building2 size={16} /></span>
        <div className="mr-auto">
          <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>Companies</p>
          <p className="text-xs" style={{ color: 'var(--text3)' }}>{companies?.length ?? 0} configured</p>
        </div>
        <select value={`${sortBy}:${sortDir}`} onChange={e => { const [b, d] = e.target.value.split(':'); setSortBy(b as 'name' | 'compType'); setSortDir(d as SortDir) }}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white" title="Sort">
          <option value="name:asc">Name ↑</option>
          <option value="name:desc">Name ↓</option>
          <option value="compType:asc">Type ↑</option>
          <option value="compType:desc">Type ↓</option>
        </select>
        {canManage && (
          <Button size="sm" onClick={() => { closeForm(); setShowForm(true) }}><Plus size={14} className="mr-1" />Add Company</Button>
        )}
        {canManage && (
          <>
            <input ref={importInputRef} type="file" accept=".csv" className="hidden" onChange={onImportFile} />
            <Button size="sm" variant="secondary" loading={importCsv.isPending} onClick={() => importInputRef.current?.click()}><Upload size={14} className="mr-1" />Import CSV</Button>
          </>
        )}
        <Button size="sm" variant="secondary" disabled={!companies?.length} onClick={exportCsv}>
          <Download size={14} className="mr-1" />Export CSV
        </Button>
        {canManage && (
          <Button size="sm" variant="secondary" disabled={!companies?.length} loading={deleteAll.isPending} onClick={handleDeleteAll}>
            <Trash2 size={14} className="mr-1" />Delete All
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="mb-4 p-5">
          <p className="text-sm font-semibold mb-4">{editingId ? 'Edit Company' : 'New Company'}</p>
          {error && <ErrorNotice message={error} />}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Company Name *</label>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Infosys Ltd" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Employment Types (comma-separated)</label>
              <input value={form.empTypes} onChange={e => setForm(p => ({ ...p, empTypes: e.target.value }))}
                placeholder="e.g. SALARIED, SELFEMP" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Company Type</label>
              <input value={form.compType} onChange={e => setForm(p => ({ ...p, compType: e.target.value }))}
                placeholder="e.g. mnc, plcc" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" loading={save.isPending} disabled={!form.name.trim()} onClick={() => save.mutate()}>
              {editingId ? 'Save Changes' : 'Create'}
            </Button>
            <Button size="sm" variant="secondary" onClick={closeForm}>Cancel</Button>
          </div>
        </Card>
      )}

      {!showForm && error && <ErrorNotice message={error} />}

      {isLoading ? <LoadingSpinner /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {[...(companies ?? [])].sort((a, b) => cmp((a[sortBy] ?? '').toString().toLowerCase(), (b[sortBy] ?? '').toString().toLowerCase(), sortDir)).map(c => (
            <div key={c.id} className="entity-card">
              <div className="flex items-start gap-3">
                <div className="entity-card-icon"><Building2 size={19} /></div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold truncate" style={{ color: 'var(--text)' }}>{c.name}</p>
                  {c.compType && <p className="text-xs mt-0.5 uppercase font-semibold" style={{ letterSpacing: '.5px', color: 'var(--text3)' }}>{c.compType}</p>}
                </div>
                {canManage && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><Pencil size={13} /></button>
                    <button onClick={() => handleDelete(c.id, c.name)} className="p-1.5 rounded-lg text-[color:var(--danger)] hover:bg-red-50"><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {companies?.length === 0 && <div className="col-span-3 text-center py-10 text-gray-400 text-sm">No companies configured yet.</div>}
        </div>
      )}
    </div>
  )
}

// ── Tab 2: Categories ─────────────────────────────────────────────────────
function CategoriesTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', salary: '' })
  const [error, setError] = useState('')

  const { data: categories, isLoading } = useQuery({
    queryKey: ['lender-categories'],
    queryFn: () => lenderConfigApi.getCategories().then(r => r.data.data ?? []),
  })

  const [sortBy, setSortBy] = useState<'name' | 'salary'>('salary')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  function closeForm() { setShowForm(false); setEditingId(null); setForm({ name: '', salary: '' }); setError('') }
  function openEdit(c: Category) {
    setEditingId(c.id); setForm({ name: c.name, salary: String(c.salary) }); setError(''); setShowForm(true)
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = { name: form.name.trim(), salary: Number(form.salary) || 0 }
      if (editingId) await lenderConfigApi.updateCategory(editingId, payload)
      else await lenderConfigApi.createCategory(payload)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lender-categories'] }); closeForm() },
    onError: (err: unknown) => setError(errorMessage(err, 'Could not save category. Please try again.')),
  })

  const remove = useMutation({
    mutationFn: (id: number) => lenderConfigApi.deleteCategory(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lender-categories'] }),
    onError: (err: unknown) => setError(errorMessage(err, 'Could not delete category. Please try again.')),
  })

  function handleDelete(id: number, name: string) {
    if (!window.confirm(`Delete category "${name}"? This cannot be undone.`)) return
    remove.mutate(id)
  }

  function exportCsv() {
    if (!categories || categories.length === 0) return
    const csv = buildCsv(['Name', 'Salary Threshold'], categories.map(c => [c.name, c.salary]))
    downloadCsv(csv, `lender-categories-export-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className="section-icon-badge" style={{ color: '#7c3aed' }}><Layers size={16} /></span>
        <div className="mr-auto">
          <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>Categories</p>
          <p className="text-xs" style={{ color: 'var(--text3)' }}>{categories?.length ?? 0} salary bands</p>
        </div>
        <select value={`${sortBy}:${sortDir}`} onChange={e => { const [b, d] = e.target.value.split(':'); setSortBy(b as 'name' | 'salary'); setSortDir(d as SortDir) }}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white" title="Sort">
          <option value="salary:desc">Salary ↓</option>
          <option value="salary:asc">Salary ↑</option>
          <option value="name:asc">Name ↑</option>
          <option value="name:desc">Name ↓</option>
        </select>
        {canManage && (
          <Button size="sm" onClick={() => { closeForm(); setShowForm(true) }}><Plus size={14} className="mr-1" />Add Category</Button>
        )}
        <Button size="sm" variant="secondary" disabled={!categories?.length} onClick={exportCsv}>
          <Download size={14} className="mr-1" />Export CSV
        </Button>
      </div>

      {showForm && (
        <Card className="mb-4 p-5">
          <p className="text-sm font-semibold mb-4">{editingId ? 'Edit Category' : 'New Category'}</p>
          {error && <ErrorNotice message={error} />}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Category Name *</label>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. High Salary Band" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Salary Threshold *</label>
              <NumberInput value={form.salary} onChange={e => setForm(p => ({ ...p, salary: e.target.value }))}
                placeholder="e.g. 50000" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" loading={save.isPending} disabled={!form.name.trim()} onClick={() => save.mutate()}>
              {editingId ? 'Save Changes' : 'Create'}
            </Button>
            <Button size="sm" variant="secondary" onClick={closeForm}>Cancel</Button>
          </div>
        </Card>
      )}

      {!showForm && error && <ErrorNotice message={error} />}

      {isLoading ? <LoadingSpinner /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {[...(categories ?? [])].sort((a, b) => sortBy === 'salary' ? cmp(a.salary, b.salary, sortDir) : cmp(a.name.toLowerCase(), b.name.toLowerCase(), sortDir)).map(c => {
            const tier = catTier(c.salary)
            return (
            <div key={c.id} className="entity-card">
              <div className="flex items-start gap-3">
                <div className="entity-card-icon" style={{ ['--ent-fg' as string]: '#7c3aed', ['--ent-bg' as string]: 'rgba(124,58,237,.1)' }}><Layers size={19} /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-bold truncate" style={{ color: 'var(--text)' }}>{c.name}</p>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: tier.bg, color: tier.color }}>{tier.label}</span>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>Salary ≥ ₹{c.salary.toLocaleString('en-IN')}</p>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><Pencil size={13} /></button>
                    <button onClick={() => handleDelete(c.id, c.name)} className="p-1.5 rounded-lg text-[color:var(--danger)] hover:bg-red-50"><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
            </div>
            )
          })}
          {categories?.length === 0 && <div className="col-span-3 text-center py-10 text-gray-400 text-sm">No categories configured yet.</div>}
        </div>
      )}
    </div>
  )
}

// ── Tab 3: Eligibility Lines ─────────────────────────────────────────────
// Confirmed real read-contract: GET /api/banks already embeds each bank's
// Lines — no separate lines-list endpoint exists, so this is NOT invented
// local/fake data. Create/Delete go through LenderConfigController's
// dedicated /lines endpoints, then re-fetch banks (the real source of
// truth) rather than locally splicing the new row into state.
function LinesTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showMulti, setShowMulti] = useState(false)
  const [form, setForm] = useState({ bankId: '', companyId: '', categoryId: '', pinCode: '', pf: false })
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'company' | 'category' | 'salary'>('company')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const { data: banks, isLoading: loadingBanks } = useQuery({
    queryKey: ['banks'],
    queryFn: () => lenderConfigApi.getBanksWithLines().then(r => r.data.data ?? []),
  })
  const { data: companies } = useQuery({
    queryKey: ['lender-companies'],
    queryFn: () => lenderConfigApi.getCompanies().then(r => r.data.data ?? []),
  })
  const { data: categories } = useQuery({
    queryKey: ['lender-categories'],
    queryFn: () => lenderConfigApi.getCategories().then(r => r.data.data ?? []),
  })

  const companyName = (id: number) => companies?.find(c => c.id === id)?.name ?? `#${id}`
  const categoryName = (id: number) => categories?.find(c => c.id === id)?.name ?? `#${id}`
  const categorySalary = (id: number) => categories?.find(c => c.id === id)?.salary ?? 0

  // Legacy laLineSort + la-lines-search — client-side filter + sort within a bank.
  type LineT = { id: number; companyId: number; categoryId: number; pinCode?: string; pf: boolean }
  function sortFilterLines(lines: LineT[]): LineT[] {
    const q = search.trim().toLowerCase()
    let ls = [...lines]
    if (q) ls = ls.filter(l => companyName(l.companyId).toLowerCase().includes(q) || categoryName(l.categoryId).toLowerCase().includes(q) || (l.pinCode ?? '').includes(q))
    ls.sort((a, b) => {
      if (sortBy === 'salary') return cmp(categorySalary(a.categoryId), categorySalary(b.categoryId), sortDir)
      const key = sortBy === 'company' ? companyName : categoryName
      const av = key(sortBy === 'company' ? a.companyId : a.categoryId).toLowerCase()
      const bv = key(sortBy === 'company' ? b.companyId : b.categoryId).toLowerCase()
      return cmp(av, bv, sortDir)
    })
    return ls
  }

  // Legacy laExportBankLines — one bank's lines only (Category, Company, PIN, Min Salary, PF).
  function exportBankLines(bank: { bankName: string; lines: LineT[] }) {
    if (!bank.lines.length) return
    const rows = bank.lines.map(l => [categoryName(l.categoryId), companyName(l.companyId), l.pinCode ?? '', String(categorySalary(l.categoryId)), l.pf ? 'True' : 'False'])
    downloadCsv(buildCsv(['Category', 'Company', 'PIN Code', 'Min Salary', 'PF'], rows), `${bank.bankName.replace(/\s+/g, '_')}_lines.csv`)
  }

  function closeForm() { setShowForm(false); setForm({ bankId: '', companyId: '', categoryId: '', pinCode: '', pf: false }); setError('') }

  const create = useMutation({
    mutationFn: () => lenderConfigApi.createLine({
      bankId: Number(form.bankId), companyId: Number(form.companyId), categoryId: Number(form.categoryId),
      pinCode: form.pinCode.trim() || undefined, pf: form.pf,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['banks'] }); closeForm() },
    onError: (err: unknown) => setError(errorMessage(err, 'Could not add line. Please try again.')),
  })

  const remove = useMutation({
    mutationFn: (id: number) => lenderConfigApi.deleteLine(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['banks'] }),
    onError: (err: unknown) => setError(errorMessage(err, 'Could not delete line. Please try again.')),
  })

  function handleDelete(id: number) {
    if (!window.confirm('Delete this eligibility line? This cannot be undone.')) return
    remove.mutate(id)
  }

  const isLoading = loadingBanks
  const banksWithLines = (banks ?? []).filter(b => b.lines.length > 0)

  // Legacy laExportBanks — the bank master list, not the lines.
  function exportBanksCsv() {
    const rows = (banks ?? []).map(b => [b.bankName, String(b.lines.length)])
    if (!rows.length) return
    downloadCsv(
      buildCsv(['Bank', 'Eligibility Lines'], rows),
      `lender-banks-export-${new Date().toISOString().slice(0, 10)}.csv`,
    )
  }

  // Legacy laDeleteAllLines clears the bank's lines. Legacy only mutated its
  // own in-memory copy and never called the API, so the rows came back on the
  // next sync — here each line is actually deleted through the endpoint that
  // already backs the per-row delete, which is what the button claims to do.
  const [bulkDeleting, setBulkDeleting] = useState<number | null>(null)
  async function deleteAllLines(bankId: number, bankName: string, lineIds: number[]) {
    if (!window.confirm(`Delete all ${lineIds.length} eligibility line(s) for ${bankName}?`)) return
    setBulkDeleting(bankId)
    try {
      for (const id of lineIds) await lenderConfigApi.deleteLine(id)
      qc.invalidateQueries({ queryKey: ['lenderBanks'] })
    } finally {
      setBulkDeleting(null)
    }
  }

  function exportCsv() {
    if (banksWithLines.length === 0) return
    const rows: (string | number)[][] = []
    banksWithLines.forEach(b => b.lines.forEach(l => {
      rows.push([b.bankName, companyName(l.companyId), categoryName(l.categoryId), l.pinCode ?? '', l.pf ? 'Yes' : 'No'])
    }))
    const csv = buildCsv(['Bank', 'Company', 'Category', 'Pin Code', 'PF'], rows)
    downloadCsv(csv, `lender-lines-export-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className="section-icon-badge" style={{ color: 'var(--accent)' }}><Landmark size={16} /></span>
        <div className="mr-auto">
          <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>Eligibility Lines</p>
          <p className="text-xs" style={{ color: 'var(--text3)' }}>{banksWithLines.length} bank{banksWithLines.length === 1 ? '' : 's'} with rules</p>
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search lines…" className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-40" />
        <select value={`${sortBy}:${sortDir}`} onChange={e => { const [b, d] = e.target.value.split(':'); setSortBy(b as 'company' | 'category' | 'salary'); setSortDir(d as SortDir) }}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white" title="Sort">
          <option value="company:asc">Company ↑</option>
          <option value="company:desc">Company ↓</option>
          <option value="category:asc">Category ↑</option>
          <option value="category:desc">Category ↓</option>
          <option value="salary:asc">Salary ↑</option>
          <option value="salary:desc">Salary ↓</option>
        </select>
        {canManage && (
          <Button size="sm" onClick={() => setShowForm(s => !s)}><Plus size={14} className="mr-1" />Add Line</Button>
        )}
        {canManage && (
          <Button size="sm" variant="secondary" onClick={() => setShowMulti(true)}><Plus size={14} className="mr-1" />Add Multiple</Button>
        )}
        {canManage && (
          <Button size="sm" variant="secondary" onClick={() => setShowImport(true)}>
            <Upload size={14} className="mr-1" />Import CSV
          </Button>
        )}
        <Button size="sm" variant="secondary" disabled={banksWithLines.length === 0} onClick={exportCsv}>
          <Download size={14} className="mr-1" />Export CSV
        </Button>
        {/* Legacy also exports the bank list itself (laExportBanks), separate
            from the line export next to it. */}
        <Button size="sm" variant="secondary" disabled={(banks ?? []).length === 0} onClick={exportBanksCsv}>
          <Download size={14} className="mr-1" />Export Banks
        </Button>
      </div>

      {showImport && <ImportLinesModal onClose={() => setShowImport(false)} />}
      {showMulti && <MultiLineModal onClose={() => setShowMulti(false)} />}

      {showForm && (
        <Card className="mb-4 p-5">
          <p className="text-sm font-semibold mb-4">New Eligibility Line</p>
          {error && <ErrorNotice message={error} />}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Bank *</label>
              <select value={form.bankId} onChange={e => setForm(p => ({ ...p, bankId: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">Select bank…</option>
                {(banks ?? []).map(b => <option key={b.id} value={b.id}>{b.bankName}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Company *</label>
              <select value={form.companyId} onChange={e => setForm(p => ({ ...p, companyId: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">Select company…</option>
                {(companies ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Category *</label>
              <select value={form.categoryId} onChange={e => setForm(p => ({ ...p, categoryId: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">Select category…</option>
                {(categories ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">PIN Code</label>
              <input value={form.pinCode} onChange={e => setForm(p => ({ ...p, pinCode: e.target.value }))}
                placeholder="Optional" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={form.pf} onChange={e => setForm(p => ({ ...p, pf: e.target.checked }))} />
              PF Required
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" loading={create.isPending}
              disabled={!form.bankId || !form.companyId || !form.categoryId}
              onClick={() => create.mutate()}>Add Line</Button>
            <Button size="sm" variant="secondary" onClick={closeForm}>Cancel</Button>
          </div>
        </Card>
      )}

      {!showForm && error && <ErrorNotice message={error} />}

      {isLoading ? <LoadingSpinner /> : banksWithLines.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">No eligibility lines configured yet.</div>
      ) : (
        <div className="space-y-4">
          {banksWithLines.map(bank => (
            <div key={bank.id} className="lender-card">
              <div className="lender-card-head">
                <div className="lender-card-badge">{bank.bankName.slice(0, 2).toUpperCase()}</div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold truncate" style={{ color: 'var(--text)' }}>{bank.bankName}</p>
                  <p className="text-xs" style={{ color: 'var(--text3)' }}>{bank.lines.length} eligibility line{bank.lines.length === 1 ? '' : 's'}</p>
                </div>
                <button onClick={() => exportBankLines(bank)}
                  className="text-[11px] font-semibold text-efin-blue hover:underline shrink-0">Export</button>
                {canManage && bank.lines.length > 0 && (
                  <button
                    disabled={bulkDeleting === bank.id}
                    onClick={() => deleteAllLines(bank.id, bank.bankName, bank.lines.map(l => l.id))}
                    className="text-[11px] font-semibold text-[color:var(--danger)] hover:underline disabled:opacity-50 shrink-0">
                    {bulkDeleting === bank.id ? 'Deleting…' : 'Delete all lines'}
                  </button>
                )}
              </div>
              <div className="p-4 space-y-2">
                {sortFilterLines(bank.lines).map(line => (
                  <div key={line.id} className="elig-line">
                    <span className="text-sm min-w-0 truncate" style={{ color: 'var(--text2)' }}>
                      <span className="font-semibold" style={{ color: 'var(--text)' }}>{companyName(line.companyId)}</span> · {categoryName(line.categoryId)}
                      {line.pinCode && <span style={{ color: 'var(--text3)' }}> · PIN {line.pinCode}</span>}
                      {line.pf && <span className="ml-2"><Badge variant="info">PF</Badge></span>}
                    </span>
                    {canManage && (
                      <button onClick={() => handleDelete(line.id)} className="p-1 rounded text-[color:var(--danger)] hover:bg-red-50 shrink-0"><Trash2 size={13} /></button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Tab 4: Match ──────────────────────────────────────────────────────────
function MatchTab() {
  const [form, setForm] = useState<MatchRequest>({ salary: 0, loanType: 'personal', empType: 'SALARIED' })
  const [result, setResult] = useState<MatchResponse | null>(null)
  const [error, setError] = useState('')

  // Employer list — banks with eligibility lines require an approved company
  // (LenderConfigController.Match: "No employer selected — bank requires an
  // approved company"), so this dropdown is essential, mirroring legacy's
  // la-elig-company select (index.html:2714 / laLoadEligibility).
  const { data: companies } = useQuery({
    queryKey: ['lender-companies'],
    queryFn: () => lenderConfigApi.getCompanies().then(r => r.data.data ?? []),
  })

  const run = useMutation({
    mutationFn: () => lenderConfigApi.match(form),
    onSuccess: (res) => { setResult(res.data.data ?? null); setError('') },
    onError: (err: unknown) => { setError(errorMessage(err, 'Could not run matching. Please try again.')); setResult(null) },
  })

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm'

  return (
    <div>
      <Card className="p-5 mb-5">
        <p className="text-sm font-semibold mb-4 flex items-center gap-2"><span className="section-icon-badge" style={{ color: 'var(--accent)' }}><SlidersHorizontal size={15} /></span>Run Eligibility Match</p>
        {error && <ErrorNotice message={error} />}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Monthly Salary *</label>
            <NumberInput value={form.salary || ''} onChange={e => setForm(p => ({ ...p, salary: Number(e.target.value) || 0 }))}
              placeholder="e.g. 60000" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Loan Type</label>
            <select value={form.loanType ?? 'personal'} onChange={e => setForm(p => ({ ...p, loanType: e.target.value }))}
              className={`${inputCls} bg-white`}>
              {LOAN_PRODUCTS.map(pr => <option key={pr.key} value={pr.key}>{pr.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Employer / Company</label>
            <select value={form.companyId ?? ''} onChange={e => setForm(p => ({ ...p, companyId: e.target.value ? Number(e.target.value) : undefined }))}
              className={`${inputCls} bg-white`}>
              <option value="">— Any / not listed —</option>
              {(companies ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Employment Type</label>
            <select value={form.empType ?? 'SALARIED'} onChange={e => setForm(p => ({ ...p, empType: e.target.value }))}
              className={`${inputCls} bg-white`}>
              {EMP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Company Type</label>
            <select value={form.compType ?? ''} onChange={e => setForm(p => ({ ...p, compType: e.target.value || undefined }))}
              className={`${inputCls} bg-white`}>
              <option value="">— Any —</option>
              {COMPANY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Monthly Obligations</label>
            <NumberInput value={form.obligations ?? ''} onChange={e => setForm(p => ({ ...p, obligations: Number(e.target.value) || undefined }))}
              placeholder="e.g. 12000 (for FOIR)" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">CIBIL Score</label>
            <NumberInput value={form.cibil ?? ''} onChange={e => setForm(p => ({ ...p, cibil: Number(e.target.value) || undefined }))}
              placeholder="e.g. 750" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Loan Amount</label>
            <NumberInput value={form.loanAmount ?? ''} onChange={e => setForm(p => ({ ...p, loanAmount: Number(e.target.value) || undefined }))}
              placeholder="e.g. 500000" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Tenure (months)</label>
            <NumberInput value={form.tenure ?? ''} onChange={e => setForm(p => ({ ...p, tenure: Number(e.target.value) || undefined }))}
              placeholder="e.g. 36" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Age</label>
            <NumberInput value={form.age ?? ''} onChange={e => setForm(p => ({ ...p, age: Number(e.target.value) || undefined }))}
              placeholder="e.g. 32" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">PIN Code</label>
            <input value={form.pinCode ?? ''} onChange={e => setForm(p => ({ ...p, pinCode: e.target.value }))}
              placeholder="Optional" className={inputCls} />
          </div>
        </div>
        <Button size="sm" loading={run.isPending} disabled={!form.salary} onClick={() => run.mutate()}>
          <Search size={14} className="mr-1" />Run Match
        </Button>
      </Card>

      {result && (
        <Card className="p-5">
          {result.awaitingDetails ? (
            <p className="text-sm text-gray-500">Enter a salary to run matching.</p>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-4">
                <div className="score-ring-wrap" style={{ width: 84, height: 84 }}>
                  <svg width="84" height="84" viewBox="0 0 84 84">
                    <circle className="score-ring-track" cx="42" cy="42" r="36" fill="none" strokeWidth="8" />
                    <circle className="score-ring-value" cx="42" cy="42" r="36" fill="none" strokeWidth="8" strokeLinecap="round"
                      style={{ ['--ring-color' as string]: 'var(--success)' }}
                      strokeDasharray={2 * Math.PI * 36}
                      strokeDashoffset={2 * Math.PI * 36 * (1 - (result.totalBanksConfigured ? result.eligibleCount / result.totalBanksConfigured : 0))} />
                  </svg>
                  <div className="score-ring-center">
                    <span className="text-lg font-black leading-none" style={{ fontFamily: 'var(--font-head)', color: 'var(--success)' }}>{result.eligibleCount}</span>
                    <span className="text-[9px] font-bold uppercase" style={{ color: 'var(--text3)' }}>eligible</span>
                  </div>
                </div>
                <p className="text-sm" style={{ color: 'var(--text2)' }}>
                  <strong style={{ color: 'var(--text)' }}>{result.eligibleCount}</strong> of {result.totalBanksConfigured} configured banks match this profile.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {result.results.map(r => (
                  <div key={r.bankId} className="match-card" style={{ ['--match-accent' as string]: r.eligible ? 'var(--success)' : 'var(--danger)' }}>
                    {r.eligible
                      ? <CheckCircle2 size={20} className="shrink-0" style={{ color: 'var(--success)' }} />
                      : <XCircle size={20} className="shrink-0" style={{ color: 'var(--danger)' }} />}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold truncate" style={{ color: 'var(--text)' }}>{r.bankName}</p>
                      {r.eligible
                        ? <p className="text-xs" style={{ color: 'var(--text3)' }}>Match score {r.score}</p>
                        : r.reason && <p className="text-xs truncate" style={{ color: 'var(--text3)' }}>{r.reason}</p>}
                    </div>
                    <Badge variant={r.eligible ? 'success' : 'danger'}>{r.eligible ? 'Eligible' : 'Not Eligible'}</Badge>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  )
}

export default function LenderConfigPage() {
  // Open on Quick Setup — the guided, linear "set up a bank" flow, so first-run
  // configuration is the default path. The full advanced editor (product picker
  // + per-bank tabs, the previous default) is one click away on "Bank Config".
  const [tab, setTab] = useState<Tab>('quicksetup')
  const user = useAuthStore(s => s.user)
  // Backend mutation-authorization for Companies/Categories/Lines is
  // Admin,ProductTeam (confirmed in LenderConfigController — every POST/
  // PUT/DELETE carries [Authorize(Roles = "Admin,ProductTeam")], further
  // gated by a dynamic "policy-product" menu-permission check). Read
  // endpoints are open to any authenticated role by design (the wizard's
  // eligibility matching needs them), which is why Match itself has no
  // role gate here.
  const canManage = user?.role === 'Admin' || user?.role === 'ProductTeam'

  const tabs: TabItem<Tab>[] = [
    { key: 'quicksetup', label: '⚡ Quick Setup' },
    { key: 'bankconfig', label: 'Bank Config' },
    { key: 'match', label: 'Match' },
  ]

  return (
    <div>
      {/* Vanilla header — "🏦 Lender Configuration" (index.html:2856), plain
          title + subtitle, no gradient hero / icon tile. */}
      <PageHeader
        title="🏦 Lender Configuration"
        subtitle="Companies, categories, and bank eligibility rules"
      />

      {/* Was a hand-written underline-tab bar (its own px-4/py-2.5/border-b-2
          markup) -- the same one-off pattern the shared Tabs component
          (components/ui/Tabs.tsx) already exists to replace on Settings/
          Payout/Loan Detail/Reports/CIBIL. Colors already resolved correctly
          here (efin-blue/gray are both token-safe), so this is a primitive-
          consistency fix, not a color fix: same keyboard/ARIA tab semantics
          and scroll-not-wrap behaviour the other pages already got. */}
      <Tabs tabs={tabs} active={tab} onChange={setTab} className="mb-5" />

      {tab === 'quicksetup' && <LenderQuickSetup onOpenAdvanced={() => setTab('bankconfig')} />}
      {tab === 'bankconfig' && (
        <BankProductConfigCard
          companiesTab={<CompaniesTab canManage={canManage} />}
          categoriesTab={<CategoriesTab canManage={canManage} />}
          linesTab={<LinesTab canManage={canManage} />}
        />
      )}
      {tab === 'match' && <MatchTab />}
    </div>
  )
}
