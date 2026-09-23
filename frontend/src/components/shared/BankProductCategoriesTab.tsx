import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { banksApi, offersProduct, type BankConfig, type ProductKey } from '@/api/banksApi'
import { lenderConfigApi, type ProductCategory } from '@/api/lenderConfigApi'
import { NumberInput } from '@/components/ui/NumberInput'

// ── Per-product Income/Turnover Categories ───────────────────────────────────
// Legacy non-personal multi-config "Categories" tab (efin-app.js
// lcBlRenderCategories / lcBlOpenAddCategoryModal / lcBlConfirmSaveCategory /
// lcBlEditCategory / lcBlDeleteCategory — LA_DB.productCategories[pk]). Now
// backed by BankProductCategory (PostgreSQL) via lenderConfigApi, so it
// persists like every other config value. Shown for non-personal products.

const TIERS = ['standard', 'silver', 'gold', 'platinum', 'premium'] as const
const TIER_COLORS: Record<string, string> = {
  gold: '#d97706', silver: '#6b7280', platinum: '#7c3aed',
  standard: 'var(--accent)', premium: 'var(--success)',
}

type Draft = { id?: number; name: string; bankId: string; minTurnover: string; color: string; notes: string }
const EMPTY: Draft = { name: '', bankId: '', minTurnover: '', color: 'standard', notes: '' }

export function ProductCategoriesGrid({ canEdit, productKey }: { canEdit: boolean; productKey: ProductKey }) {
  const qc = useQueryClient()
  const [bankFilter, setBankFilter] = useState('')
  const [modal, setModal] = useState<Draft | null>(null)

  const { data: cats, isLoading } = useQuery({
    queryKey: ['productCategories', productKey],
    queryFn: () => lenderConfigApi.getProductCategories(productKey).then(r => r.data.data ?? []),
  })
  const { data: banks } = useQuery({
    queryKey: ['banksConfig'],
    queryFn: () => banksApi.getAll().then(r => r.data.data ?? []),
  })
  // Only banks assigned to this product can own a category (legacy _prBanks).
  const assignedBanks = useMemo(
    () => (banks ?? []).filter((b: BankConfig) => offersProduct(b, productKey)),
    [banks, productKey],
  )
  const bankName = (id: number) => (banks ?? []).find(b => b.id === id)?.bankName ?? '—'

  const invalidate = () => qc.invalidateQueries({ queryKey: ['productCategories', productKey] })
  const saveMut = useMutation({
    mutationFn: async (d: Draft) => {
      const payload = {
        bankId: Number(d.bankId), productKey, name: d.name.trim(),
        minTurnover: Number(d.minTurnover) || 0, color: d.color, notes: d.notes.trim() || undefined,
      }
      if (d.id) await lenderConfigApi.updateProductCategory(d.id, payload)
      else await lenderConfigApi.createProductCategory(payload)
    },
    onSuccess: () => { invalidate(); setModal(null) },
  })
  const delMut = useMutation({
    mutationFn: (id: number) => lenderConfigApi.deleteProductCategory(id),
    onSuccess: invalidate,
  })

  const rows = (cats ?? []).filter(c => !bankFilter || String(c.bankId) === bankFilter)

  const openAdd = () => setModal({ ...EMPTY })
  const openEdit = (c: ProductCategory) => setModal({
    id: c.id, name: c.name, bankId: String(c.bankId), minTurnover: String(c.minTurnover), color: c.color || 'standard', notes: c.notes ?? '',
  })

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <p className="text-xs text-gray-500 flex-1 min-w-[180px]">Per-product income / turnover tiers per bank. Persisted to the database.</p>
        <select value={bankFilter} onChange={e => setBankFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">All Banks</option>
          {assignedBanks.map(b => <option key={b.id} value={b.id}>{b.bankName}</option>)}
        </select>
        {canEdit && <Button size="sm" onClick={openAdd}><Plus size={14} className="mr-1" />Add Category</Button>}
      </div>

      {isLoading ? <LoadingSpinner /> : rows.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">
          {(cats?.length ?? 0) === 0 ? 'No categories yet — click ＋ Add Category to create one.' : 'No categories for the selected bank.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-600"><tr>{['Category', 'Bank', 'Min Turnover', 'Tier', 'Notes', ''].map(h => <th key={h} className="px-2.5 py-2 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map(c => {
                const tc = TIER_COLORS[c.color] || 'var(--text3)'
                return (
                  <tr key={c.id} className="border-t border-gray-100">
                    <td className="px-2.5 py-2"><strong style={{ color: tc }}>{c.name}</strong></td>
                    <td className="px-2.5 py-2 text-gray-600">{bankName(c.bankId)}</td>
                    <td className="px-2.5 py-2 font-mono">₹{(c.minTurnover || 0).toLocaleString('en-IN')}</td>
                    <td className="px-2.5 py-2"><span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full" style={{ background: `${tc}20`, color: tc }}>{c.color || 'standard'}</span></td>
                    <td className="px-2.5 py-2 text-gray-500 max-w-[180px] truncate">{c.notes || '—'}</td>
                    <td className="px-2.5 py-2 whitespace-nowrap">
                      {canEdit && <>
                        <button className="text-efin-blue hover:underline mr-2" onClick={() => openEdit(c)} title="Edit"><Pencil size={13} /></button>
                        <button className="text-[color:var(--danger)] hover:underline" onClick={() => { if (confirm(`Delete category "${c.name}"?`)) delMut.mutate(c.id) }} title="Delete"><Trash2 size={13} /></button>
                      </>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-[800] flex items-center justify-center p-4" style={{ background: 'rgba(12,23,51,.45)' }} onClick={() => setModal(null)}>
          <div className="bg-white rounded-2xl w-[min(440px,94vw)] p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-[15px] font-extrabold">{modal.id ? '✏ Edit' : '＋ Add'} Category</p>
              <button onClick={() => setModal(null)} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Category Name *</label>
                <input value={modal.name} onChange={e => setModal({ ...modal, name: e.target.value })} placeholder="e.g. Premium · Gold · Standard"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Bank *</label>
                <select value={modal.bankId} onChange={e => setModal({ ...modal, bankId: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">— Select Bank —</option>
                  {assignedBanks.map(b => <option key={b.id} value={b.id}>{b.bankName}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Min Monthly Turnover (₹) *</label>
                <NumberInput value={modal.minTurnover} onChange={e => setModal({ ...modal, minTurnover: e.target.value })} placeholder="e.g. 200000"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-efin-blue" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Color Tier</label>
                  <select value={modal.color} onChange={e => setModal({ ...modal, color: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white capitalize">
                    {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label>
                  <input value={modal.notes} onChange={e => setModal({ ...modal, notes: e.target.value })} placeholder="Optional note"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue" />
                </div>
              </div>
              {saveMut.isError && <p className="text-xs text-[color:var(--danger)]">Could not save — check the fields and try again.</p>}
              <div className="flex gap-2 pt-1">
                <Button className="flex-1" disabled={!modal.name.trim() || !modal.bankId || saveMut.isPending}
                  onClick={() => saveMut.mutate(modal)}>✓ {modal.id ? 'Update' : 'Add'} Category</Button>
                <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
