import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  lenderConfigApi,
  type Company, type Category, type MatchRequest, type MatchResponse,
} from '@/api/lenderConfigApi'
import { useAuthStore } from '@/store/authStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import PageHeader from '@/components/shared/PageHeader'
import { Plus, Trash2, Pencil, Search, Download } from 'lucide-react'
import { buildCsv, downloadCsv } from '@/utils/loanExport'

type Tab = 'companies' | 'categories' | 'lines' | 'match'

function errorMessage(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
  return msg?.message || msg?.errors?.join(' ') || fallback
}

// ── Tab 1: Companies ─────────────────────────────────────────────────────
function CompaniesTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', empTypes: '', compType: '' })
  const [error, setError] = useState('')

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
      <div className="mb-4 flex items-center gap-2">
        {canManage && (
          <Button size="sm" onClick={() => { closeForm(); setShowForm(true) }}><Plus size={14} className="mr-1" />Add Company</Button>
        )}
        <Button size="sm" variant="secondary" disabled={!companies?.length} onClick={exportCsv}>
          <Download size={14} className="mr-1" />Export CSV
        </Button>
      </div>

      {showForm && (
        <Card className="mb-4 p-5">
          <p className="text-sm font-semibold mb-4">{editingId ? 'Edit Company' : 'New Company'}</p>
          {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
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
          <div className="flex gap-2">
            <Button size="sm" loading={save.isPending} disabled={!form.name.trim()} onClick={() => save.mutate()}>
              {editingId ? 'Save Changes' : 'Create'}
            </Button>
            <Button size="sm" variant="secondary" onClick={closeForm}>Cancel</Button>
          </div>
        </Card>
      )}

      {!showForm && error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {isLoading ? <LoadingSpinner /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {(companies ?? []).map(c => (
            <Card key={c.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-gray-900">{c.name}</p>
                  {c.compType && <p className="text-xs text-gray-500 mt-0.5">{c.compType}</p>}
                </div>
                {canManage && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><Pencil size={13} /></button>
                    <button onClick={() => handleDelete(c.id, c.name)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
            </Card>
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
      <div className="mb-4 flex items-center gap-2">
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
          {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Category Name *</label>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. High Salary Band" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Salary Threshold *</label>
              <input type="number" value={form.salary} onChange={e => setForm(p => ({ ...p, salary: e.target.value }))}
                placeholder="e.g. 50000" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" loading={save.isPending} disabled={!form.name.trim()} onClick={() => save.mutate()}>
              {editingId ? 'Save Changes' : 'Create'}
            </Button>
            <Button size="sm" variant="secondary" onClick={closeForm}>Cancel</Button>
          </div>
        </Card>
      )}

      {!showForm && error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {isLoading ? <LoadingSpinner /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {(categories ?? []).map(c => (
            <Card key={c.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-gray-900">{c.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Salary ≥ ₹{c.salary.toLocaleString('en-IN')}</p>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><Pencil size={13} /></button>
                    <button onClick={() => handleDelete(c.id, c.name)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
            </Card>
          ))}
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
  const [form, setForm] = useState({ bankId: '', companyId: '', categoryId: '', pinCode: '', pf: false })
  const [error, setError] = useState('')

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
      <div className="mb-4 flex items-center gap-2">
        {canManage && (
          <Button size="sm" onClick={() => setShowForm(s => !s)}><Plus size={14} className="mr-1" />Add Line</Button>
        )}
        <Button size="sm" variant="secondary" disabled={banksWithLines.length === 0} onClick={exportCsv}>
          <Download size={14} className="mr-1" />Export CSV
        </Button>
      </div>

      {showForm && (
        <Card className="mb-4 p-5">
          <p className="text-sm font-semibold mb-4">New Eligibility Line</p>
          {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
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
          <div className="flex gap-2">
            <Button size="sm" loading={create.isPending}
              disabled={!form.bankId || !form.companyId || !form.categoryId}
              onClick={() => create.mutate()}>Add Line</Button>
            <Button size="sm" variant="secondary" onClick={closeForm}>Cancel</Button>
          </div>
        </Card>
      )}

      {!showForm && error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {isLoading ? <LoadingSpinner /> : banksWithLines.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">No eligibility lines configured yet.</div>
      ) : (
        <div className="space-y-4">
          {banksWithLines.map(bank => (
            <Card key={bank.id} className="p-4">
              <p className="font-medium text-gray-900 mb-2">{bank.bankName}</p>
              <div className="space-y-1.5">
                {bank.lines.map(line => (
                  <div key={line.id} className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                    <span>
                      {companyName(line.companyId)} · {categoryName(line.categoryId)}
                      {line.pinCode && <span className="text-gray-500"> · PIN {line.pinCode}</span>}
                      {line.pf && <span className="ml-2"><Badge variant="info">PF</Badge></span>}
                    </span>
                    {canManage && (
                      <button onClick={() => handleDelete(line.id)} className="p-1 rounded text-red-500 hover:bg-red-50"><Trash2 size={13} /></button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Tab 4: Match ──────────────────────────────────────────────────────────
function MatchTab() {
  const [form, setForm] = useState<MatchRequest>({ salary: 0, loanType: 'personal_loan' })
  const [result, setResult] = useState<MatchResponse | null>(null)
  const [error, setError] = useState('')

  const run = useMutation({
    mutationFn: () => lenderConfigApi.match(form),
    onSuccess: (res) => { setResult(res.data.data ?? null); setError('') },
    onError: (err: unknown) => { setError(errorMessage(err, 'Could not run matching. Please try again.')); setResult(null) },
  })

  return (
    <div>
      <Card className="p-5 mb-5">
        <p className="text-sm font-semibold mb-4">Run Eligibility Match</p>
        {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Monthly Salary *</label>
            <input type="number" value={form.salary || ''} onChange={e => setForm(p => ({ ...p, salary: Number(e.target.value) || 0 }))}
              placeholder="e.g. 60000" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Loan Type</label>
            <input value={form.loanType ?? ''} onChange={e => setForm(p => ({ ...p, loanType: e.target.value }))}
              placeholder="personal_loan" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">CIBIL Score</label>
            <input type="number" value={form.cibil ?? ''} onChange={e => setForm(p => ({ ...p, cibil: Number(e.target.value) || undefined }))}
              placeholder="e.g. 750" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Loan Amount</label>
            <input type="number" value={form.loanAmount ?? ''} onChange={e => setForm(p => ({ ...p, loanAmount: Number(e.target.value) || undefined }))}
              placeholder="e.g. 500000" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Tenure (months)</label>
            <input type="number" value={form.tenure ?? ''} onChange={e => setForm(p => ({ ...p, tenure: Number(e.target.value) || undefined }))}
              placeholder="e.g. 36" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">PIN Code</label>
            <input value={form.pinCode ?? ''} onChange={e => setForm(p => ({ ...p, pinCode: e.target.value }))}
              placeholder="Optional" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
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
              <p className="text-sm text-gray-600 mb-4">
                <strong className="text-gray-900">{result.eligibleCount}</strong> of {result.totalBanksConfigured} configured banks are eligible.
              </p>
              <div className="space-y-2">
                {result.results.map(r => (
                  <div key={r.bankId} className="flex items-center justify-between px-3 py-2.5 bg-gray-50 rounded-lg text-sm">
                    <span className="font-medium">{r.bankName}</span>
                    <div className="flex items-center gap-3">
                      {r.reason && !r.eligible && <span className="text-xs text-gray-400">{r.reason}</span>}
                      {r.eligible && <span className="text-xs text-gray-500">Score {r.score}</span>}
                      <Badge variant={r.eligible ? 'success' : 'danger'}>{r.eligible ? 'Eligible' : 'Not Eligible'}</Badge>
                    </div>
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
  const [tab, setTab] = useState<Tab>('companies')
  const user = useAuthStore(s => s.user)
  // Backend mutation-authorization for Companies/Categories/Lines is
  // Admin,ProductTeam (confirmed in LenderConfigController — every POST/
  // PUT/DELETE carries [Authorize(Roles = "Admin,ProductTeam")], further
  // gated by a dynamic "policy-product" menu-permission check). Read
  // endpoints are open to any authenticated role by design (the wizard's
  // eligibility matching needs them), which is why Match itself has no
  // role gate here.
  const canManage = user?.role === 'Admin' || user?.role === 'ProductTeam'

  const tabs: { key: Tab; label: string }[] = [
    { key: 'companies', label: 'Companies' },
    { key: 'categories', label: 'Categories' },
    { key: 'lines', label: 'Eligibility Lines' },
    { key: 'match', label: 'Match' },
  ]

  return (
    <div>
      <PageHeader title="Lender Configuration" subtitle="Companies, categories, and bank eligibility rules" />

      <div className="flex items-center gap-1 border-b border-gray-200 mb-5">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key ? 'text-blue-600 border-blue-600' : 'text-gray-500 border-transparent hover:text-gray-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'companies' && <CompaniesTab canManage={canManage} />}
      {tab === 'categories' && <CategoriesTab canManage={canManage} />}
      {tab === 'lines' && <LinesTab canManage={canManage} />}
      {tab === 'match' && <MatchTab />}
    </div>
  )
}
