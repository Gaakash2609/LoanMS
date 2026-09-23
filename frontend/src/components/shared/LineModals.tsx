import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { lenderConfigApi } from '@/api/lenderConfigApi'

// ── Company-line add modals ──────────────────────────────────────────────────
// Legacy laAddCompanyLine/laSaveNewLine (single) + laAddMultipleLines/
// laAddMultiRow/laSaveMultipleLines (bulk), and lcAddLineToBank (add a line to
// a specific bank from the Assigned-Banks card). All persist via
// POST /api/LenderConfig/lines (lenderConfigApi.createLine) → re-fetch banks.

function useLineData() {
  const { data: companies } = useQuery({ queryKey: ['lender-companies'], queryFn: () => lenderConfigApi.getCompanies().then(r => r.data.data ?? []) })
  const { data: categories } = useQuery({ queryKey: ['lender-categories'], queryFn: () => lenderConfigApi.getCategories().then(r => r.data.data ?? []) })
  const { data: banks } = useQuery({ queryKey: ['banks'], queryFn: () => lenderConfigApi.getBanksWithLines().then(r => r.data.data ?? []) })
  return { companies: companies ?? [], categories: categories ?? [], banks: banks ?? [] }
}

// ── Single line, fixed bank (Assigned-Banks card "+ Line" = lcAddLineToBank) ──
export function AddLineModal({ bankId, bankName, onClose }: { bankId: number; bankName: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { companies, categories } = useLineData()
  const [companyId, setCompanyId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [pinCode, setPinCode] = useState('')
  const [pf, setPf] = useState(false)

  const add = useMutation({
    mutationFn: () => lenderConfigApi.createLine({ bankId, companyId: Number(companyId), categoryId: Number(categoryId), pinCode: pinCode.trim() || undefined, pf }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['banks'] }); qc.invalidateQueries({ queryKey: ['banksConfig'] }); onClose() },
  })

  return (
    <div className="fixed inset-0 z-[820] flex items-center justify-center p-4" style={{ background: 'rgba(12,23,51,.45)' }} onClick={onClose}>
      <div className="bg-white rounded-2xl w-[min(440px,94vw)] p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <p className="text-[15px] font-extrabold mb-1">＋ Add Company Line</p>
        <p className="text-xs text-gray-500 mb-4">{bankName} — eligibility rule (Company + Category)</p>
        <label className="block text-xs font-semibold text-gray-600 mb-1">Company *</label>
        <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 bg-white">
          <option value="">— Select Company —</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="block text-xs font-semibold text-gray-600 mb-1">Category * <span className="font-normal text-gray-400">(min salary threshold)</span></label>
        <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 bg-white">
          <option value="">— Select Category —</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name} · ₹{c.salary.toLocaleString('en-IN')} min</option>)}
        </select>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">PIN Code</label>
            <input value={pinCode} maxLength={6} onChange={e => setPinCode(e.target.value)} placeholder="e.g. 400001" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" />
          </div>
          <label className="flex items-end gap-2 text-sm pb-2"><input type="checkbox" checked={pf} onChange={e => setPf(e.target.checked)} />PF Required</label>
        </div>
        {add.isError && <p className="text-xs text-[color:var(--danger)] mb-2">Could not add the line. Try again.</p>}
        <div className="flex gap-2">
          <Button className="flex-1" disabled={!companyId || !categoryId || add.isPending} onClick={() => add.mutate()}>✓ Add Line</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}

// ── Multiple lines (laAddMultipleLines) — bank select + up to 10 rows ─────────
type Row = { companyId: string; categoryId: string; pinCode: string; pf: boolean }
const emptyRow = (): Row => ({ companyId: '', categoryId: '', pinCode: '', pf: false })

export function MultiLineModal({ onClose, bankId }: { onClose: () => void; bankId?: number }) {
  const qc = useQueryClient()
  const { companies, categories, banks } = useLineData()
  const [bank, setBank] = useState(bankId ? String(bankId) : '')
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow(), emptyRow()])
  const setRow = (i: number, patch: Partial<Row>) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r))

  const saveAll = useMutation({
    mutationFn: async () => {
      const bId = Number(bank)
      for (const r of rows) {
        if (!r.companyId || !r.categoryId) continue
        await lenderConfigApi.createLine({ bankId: bId, companyId: Number(r.companyId), categoryId: Number(r.categoryId), pinCode: r.pinCode.trim() || undefined, pf: r.pf })
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['banks'] }); qc.invalidateQueries({ queryKey: ['banksConfig'] }); onClose() },
  })
  const validRows = rows.filter(r => r.companyId && r.categoryId).length

  return (
    <div className="fixed inset-0 z-[820] flex items-center justify-center p-4" style={{ background: 'rgba(12,23,51,.45)' }} onClick={onClose}>
      <div className="bg-white rounded-2xl w-[min(620px,96vw)] max-h-[85vh] overflow-y-auto p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <p className="text-[15px] font-extrabold mb-1">＋ Add Multiple Lines</p>
        <p className="text-xs text-gray-500 mb-3">Add up to 10 lines at once</p>
        {!bankId && (
          <select value={bank} onChange={e => setBank(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 bg-white">
            <option value="">— Select Bank —</option>
            {banks.map(b => <option key={b.id} value={b.id}>{b.bankName}</option>)}
          </select>
        )}
        <div className="space-y-2 mb-3">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[2fr_1.6fr_80px_44px_20px] gap-1.5 items-center">
              <select value={r.companyId} onChange={e => setRow(i, { companyId: e.target.value })} className="border border-gray-200 rounded-md px-2 py-1.5 text-xs bg-white">
                <option value="">Company…</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={r.categoryId} onChange={e => setRow(i, { categoryId: e.target.value })} className="border border-gray-200 rounded-md px-2 py-1.5 text-xs bg-white">
                <option value="">Category…</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input value={r.pinCode} maxLength={6} onChange={e => setRow(i, { pinCode: e.target.value })} placeholder="PIN" className="border border-gray-200 rounded-md px-2 py-1.5 text-xs font-mono" />
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={r.pf} onChange={e => setRow(i, { pf: e.target.checked })} />PF</label>
              <button onClick={() => setRows(rs => rs.filter((_, idx) => idx !== i))} className="text-gray-400 hover:text-[color:var(--danger)]"><X size={14} /></button>
            </div>
          ))}
        </div>
        <Button size="sm" variant="secondary" disabled={rows.length >= 10} onClick={() => setRows(rs => [...rs, emptyRow()])} className="mb-4"><Plus size={13} className="mr-1" />Add Row</Button>
        {saveAll.isError && <p className="text-xs text-[color:var(--danger)] mb-2">Could not save the lines. Try again.</p>}
        <div className="flex gap-2">
          <Button className="flex-1" disabled={!bank || validRows === 0 || saveAll.isPending} onClick={() => saveAll.mutate()}>✓ Save All ({validRows})</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}
