import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/store/authStore'
import { ChevronDown, ChevronUp, Pencil, Trash2 } from 'lucide-react'
import {
  productOfferMatrixApi, PP_PRODUCTS, PP_DEFAULTS, type OfferBand,
} from '@/api/productOfferMatrixApi'

function fmtK(v: number) {
  const k = v / 1000
  return `${Number.isInteger(k) ? k : k.toFixed(1)}K`
}

const EMPTY_ROW = { label: '', salMin: '', salMax: '', rateMin: '', rateMax: '', tenMin: '', tenMax: '', foir: '' }

// ── Product Offer Matrices — ProductOfferMatrixController: GET open to any
// authenticated user, PUT (upsert per product) is Admin/ProductTeam only.
// Row-level add/edit/delete happen against a local working copy, exactly as
// in legacy product-offer-matrix.js — nothing is sent to the server until
// "Save Matrix" is clicked (matches _persist(key) only firing from
// ppPmatSaveMatrix/ppPmatResetMatrix, not from row edits).
export default function ProductOfferMatrixCard() {
  const { user } = useAuthStore()
  const canEdit = user?.role === 'Admin' || user?.role === 'ProductTeam'
  const qc = useQueryClient()

  const [openKey, setOpenKey] = useState<string | null>(null)
  const [local, setLocal] = useState<Record<string, OfferBand[]>>({})
  const [editingIdx, setEditingIdx] = useState<Record<string, number>>({})
  const [editRow, setEditRow] = useState(EMPTY_ROW)
  const [addRow, setAddRow] = useState(EMPTY_ROW)
  const [savedFlash, setSavedFlash] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['productOfferMatrix'],
    queryFn: () => productOfferMatrixApi.getAll().then(r => r.data.data ?? []),
  })

  function matrixFor(key: string): OfferBand[] {
    if (local[key]) return local[key]
    const saved = data?.find(d => d.productKey === key)
    if (saved) {
      try {
        const parsed = JSON.parse(saved.matrixJson)
        if (Array.isArray(parsed) && parsed.length) return parsed
      } catch { /* fall through to default */ }
    }
    return (PP_DEFAULTS[key] || []).map(r => ({ ...r }))
  }

  const save = useMutation({
    mutationFn: (key: string) => productOfferMatrixApi.upsert(key, JSON.stringify(local[key] ?? matrixFor(key))),
    onSuccess: (_res, key) => {
      qc.invalidateQueries({ queryKey: ['productOfferMatrix'] })
      setSavedFlash(key)
      setTimeout(() => setSavedFlash(null), 2500)
    },
  })

  function toggle(key: string) {
    if (openKey === key) { setOpenKey(null); return }
    setOpenKey(key)
    if (!local[key]) setLocal(p => ({ ...p, [key]: matrixFor(key) }))
    setEditingIdx(p => ({ ...p, [key]: -1 }))
  }

  function startEdit(key: string, i: number) {
    const r = matrixFor(key)[i]
    setEditRow({
      label: r.label, salMin: String(r.salaryMin), salMax: String(r.salaryMax),
      rateMin: String(r.rateMin), rateMax: String(r.rateMax),
      tenMin: String(r.tenureMin), tenMax: String(r.tenureMax), foir: String(Math.round(r.foir * 100)),
    })
    setEditingIdx(p => ({ ...p, [key]: i }))
  }
  function cancelEdit(key: string) {
    setEditingIdx(p => ({ ...p, [key]: -1 }))
  }
  function saveRow(key: string, i: number) {
    const mx = [...matrixFor(key)]
    const sMin = parseFloat(editRow.salMin) || 0
    const sMax = parseFloat(editRow.salMax) || 0
    mx[i] = {
      label: editRow.label || `${fmtK(sMin)} to ${fmtK(sMax)}`,
      salaryMin: sMin, salaryMax: sMax,
      rateMin: parseFloat(editRow.rateMin) || 0, rateMax: parseFloat(editRow.rateMax) || 0,
      tenureMin: parseInt(editRow.tenMin, 10) || 0, tenureMax: parseInt(editRow.tenMax, 10) || 0,
      foir: (parseFloat(editRow.foir) || 0) / 100,
    }
    setLocal(p => ({ ...p, [key]: mx }))
    setEditingIdx(p => ({ ...p, [key]: -1 }))
  }
  function deleteRow(key: string, i: number) {
    const mx = matrixFor(key)
    if (mx.length <= 1) { alert('At least one band required'); return }
    if (!confirm('Delete this income band?')) return
    const next = mx.filter((_, idx) => idx !== i)
    setLocal(p => ({ ...p, [key]: next }))
    const cur = editingIdx[key] ?? -1
    if (cur === i) setEditingIdx(p => ({ ...p, [key]: -1 }))
    else if (cur > i) setEditingIdx(p => ({ ...p, [key]: cur - 1 }))
  }
  function addNewRow(key: string) {
    const sMin = parseFloat(addRow.salMin) || 0, sMax = parseFloat(addRow.salMax) || 0
    const rMin = parseFloat(addRow.rateMin) || 0, rMax = parseFloat(addRow.rateMax) || 0
    const tMin = parseInt(addRow.tenMin, 10) || 0, tMax = parseInt(addRow.tenMax, 10) || 0
    const foir = parseFloat(addRow.foir) || 0
    if (!sMin || !sMax || !rMin || !rMax || !tMin || !tMax || !foir) { alert('Fill all fields'); return }
    const label = addRow.label.trim() || `${fmtK(sMin)} to ${fmtK(sMax)}`
    const mx = [...matrixFor(key), { label, salaryMin: sMin, salaryMax: sMax, rateMin: rMin, rateMax: rMax, tenureMin: tMin, tenureMax: tMax, foir: foir / 100 }]
    setLocal(p => ({ ...p, [key]: mx }))
    setAddRow(EMPTY_ROW)
  }
  function resetToDefaults(key: string) {
    const pInfo = PP_PRODUCTS.find(p => p.key === key)
    if (!confirm(`Reset "${pInfo?.name || key}" to defaults?`)) return
    const defaults = (PP_DEFAULTS[key] || []).map(r => ({ ...r }))
    setLocal(p => ({ ...p, [key]: defaults }))
    setEditingIdx(p => ({ ...p, [key]: -1 }))
    save.mutate(key)
  }

  if (!canEdit) return null // read is used by the offer calculator elsewhere; this admin editor is Admin/ProductTeam-only, matching the legacy "ADMIN ONLY" badge

  return (
    <Card className="mt-6">
      <h3 className="text-base font-semibold text-gray-900 mb-1">Product Offer Matrices</h3>
      <p className="text-sm text-gray-500 mb-4">Per-product First Offer income bands, rates, tenure &amp; FOIR caps</p>

      {isLoading ? (
        <p className="text-sm text-gray-400 py-4">Loading…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {PP_PRODUCTS.map(p => {
            const isOpen = openKey === p.key
            const mx = matrixFor(p.key)
            const editIdx = editingIdx[p.key] ?? -1
            const incLbl = p.key === 'insurance' ? 'Annual Inc.' : 'Income Band'
            return (
              <div key={p.key} className="border border-gray-200 rounded-xl overflow-hidden">
                <button onClick={() => toggle(p.key)}
                  className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50">
                  <span className="text-xl">{p.icon}</span>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-gray-900">{p.name} — First Offer Matrix</p>
                    <p className="text-xs text-gray-500">{p.desc} · Edit income bands, rates, tenure &amp; FOIR caps</p>
                  </div>
                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-red-50 text-red-600">ADMIN ONLY</span>
                  {isOpen ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                </button>

                {isOpen && (
                  <div className="px-5 py-4 border-t border-gray-200">
                    <div className="overflow-x-auto rounded-lg border border-gray-200">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-efin-blue text-white">
                            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">{incLbl}</th>
                            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Min (₹)</th>
                            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Max (₹)</th>
                            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Rate Min %</th>
                            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Rate Max %</th>
                            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Ten. Min</th>
                            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Ten. Max</th>
                            <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">FOIR %</th>
                            <th className="px-3 py-2 text-center font-semibold">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {mx.map((r, i) => editIdx === i ? (
                            <tr key={i} className="bg-blue-50 border-b border-gray-100">
                              <td className="p-1.5"><input value={editRow.label} onChange={e => setEditRow(v => ({ ...v, label: e.target.value }))} className="w-24 border border-efin-blue rounded px-1.5 py-1 text-xs" /></td>
                              <td className="p-1.5"><input type="number" value={editRow.salMin} onChange={e => setEditRow(v => ({ ...v, salMin: e.target.value }))} className="w-20 border border-efin-blue rounded px-1.5 py-1 text-xs" /></td>
                              <td className="p-1.5"><input type="number" value={editRow.salMax} onChange={e => setEditRow(v => ({ ...v, salMax: e.target.value }))} className="w-20 border border-efin-blue rounded px-1.5 py-1 text-xs" /></td>
                              <td className="p-1.5"><input type="number" value={editRow.rateMin} onChange={e => setEditRow(v => ({ ...v, rateMin: e.target.value }))} className="w-14 border border-efin-blue rounded px-1.5 py-1 text-xs" /></td>
                              <td className="p-1.5"><input type="number" value={editRow.rateMax} onChange={e => setEditRow(v => ({ ...v, rateMax: e.target.value }))} className="w-14 border border-efin-blue rounded px-1.5 py-1 text-xs" /></td>
                              <td className="p-1.5"><input type="number" value={editRow.tenMin} onChange={e => setEditRow(v => ({ ...v, tenMin: e.target.value }))} className="w-14 border border-efin-blue rounded px-1.5 py-1 text-xs" /></td>
                              <td className="p-1.5"><input type="number" value={editRow.tenMax} onChange={e => setEditRow(v => ({ ...v, tenMax: e.target.value }))} className="w-14 border border-efin-blue rounded px-1.5 py-1 text-xs" /></td>
                              <td className="p-1.5 text-right"><input type="number" value={editRow.foir} onChange={e => setEditRow(v => ({ ...v, foir: e.target.value }))} className="w-12 border border-efin-blue rounded px-1.5 py-1 text-xs" /></td>
                              <td className="p-1.5 text-center whitespace-nowrap">
                                <button onClick={() => saveRow(p.key, i)} className="text-xs font-semibold text-green-600 mr-2">✓ Save</button>
                                <button onClick={() => cancelEdit(p.key)} className="text-xs text-gray-400">✕</button>
                              </td>
                            </tr>
                          ) : (
                            <tr key={i} className={i % 2 === 0 ? 'bg-gray-50 border-b border-gray-100' : 'bg-white border-b border-gray-100'}>
                              <td className="px-3 py-2 font-semibold text-gray-700">{r.label}</td>
                              <td className="px-3 py-2 text-gray-600">₹{fmtK(r.salaryMin)}</td>
                              <td className="px-3 py-2 text-gray-600">₹{fmtK(r.salaryMax)}</td>
                              <td className="px-3 py-2">{r.rateMin}%</td>
                              <td className="px-3 py-2">{r.rateMax}%</td>
                              <td className="px-3 py-2">{r.tenureMin}m</td>
                              <td className="px-3 py-2">{r.tenureMax}m</td>
                              <td className="px-3 py-2 text-right font-bold text-efin-blue">{Math.round(r.foir * 100)}%</td>
                              <td className="px-3 py-2 text-center whitespace-nowrap">
                                <button onClick={() => startEdit(p.key, i)} className="text-gray-400 hover:text-gray-700 p-1"><Pencil size={13} /></button>
                                <button onClick={() => deleteRow(p.key, i)} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={13} /></button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-3 p-3.5 bg-gray-50 border border-gray-200 rounded-lg">
                      <p className="text-[11px] font-bold text-efin-blue uppercase tracking-wide mb-2">+ Add New Income Band</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2 items-end">
                        <div><label className="text-[10px] font-bold text-gray-400 block mb-1">Band Label</label><input value={addRow.label} onChange={e => setAddRow(v => ({ ...v, label: e.target.value }))} placeholder="30K to 50K" className="w-full border border-gray-200 rounded px-1.5 py-1.5 text-xs" /></div>
                        <div><label className="text-[10px] font-bold text-gray-400 block mb-1">Min Income (₹)</label><input type="number" value={addRow.salMin} onChange={e => setAddRow(v => ({ ...v, salMin: e.target.value }))} placeholder="30000" className="w-full border border-gray-200 rounded px-1.5 py-1.5 text-xs" /></div>
                        <div><label className="text-[10px] font-bold text-gray-400 block mb-1">Max Income (₹)</label><input type="number" value={addRow.salMax} onChange={e => setAddRow(v => ({ ...v, salMax: e.target.value }))} placeholder="50000" className="w-full border border-gray-200 rounded px-1.5 py-1.5 text-xs" /></div>
                        <div><label className="text-[10px] font-bold text-gray-400 block mb-1">Rate Min %</label><input type="number" value={addRow.rateMin} onChange={e => setAddRow(v => ({ ...v, rateMin: e.target.value }))} placeholder="11" className="w-full border border-gray-200 rounded px-1.5 py-1.5 text-xs" /></div>
                        <div><label className="text-[10px] font-bold text-gray-400 block mb-1">Rate Max %</label><input type="number" value={addRow.rateMax} onChange={e => setAddRow(v => ({ ...v, rateMax: e.target.value }))} placeholder="15" className="w-full border border-gray-200 rounded px-1.5 py-1.5 text-xs" /></div>
                        <div><label className="text-[10px] font-bold text-gray-400 block mb-1">Ten. Min (M)</label><input type="number" value={addRow.tenMin} onChange={e => setAddRow(v => ({ ...v, tenMin: e.target.value }))} placeholder="12" className="w-full border border-gray-200 rounded px-1.5 py-1.5 text-xs" /></div>
                        <div><label className="text-[10px] font-bold text-gray-400 block mb-1">Ten. Max (M)</label><input type="number" value={addRow.tenMax} onChange={e => setAddRow(v => ({ ...v, tenMax: e.target.value }))} placeholder="60" className="w-full border border-gray-200 rounded px-1.5 py-1.5 text-xs" /></div>
                        <div><label className="text-[10px] font-bold text-gray-400 block mb-1">FOIR %</label><input type="number" value={addRow.foir} onChange={e => setAddRow(v => ({ ...v, foir: e.target.value }))} placeholder="50" className="w-full border border-gray-200 rounded px-1.5 py-1.5 text-xs" /></div>
                      </div>
                      <Button size="sm" className="mt-2.5" onClick={() => addNewRow(p.key)}>+ Add Band</Button>
                    </div>

                    <div className="mt-3 flex items-center gap-3 flex-wrap">
                      <Button size="sm" loading={save.isPending && save.variables === p.key} onClick={() => save.mutate(p.key)}>✓ Save Matrix</Button>
                      <Button size="sm" variant="ghost" onClick={() => resetToDefaults(p.key)}>↺ Reset to Defaults</Button>
                      {savedFlash === p.key && <span className="text-xs font-semibold text-green-600">✓ Saved</span>}
                    </div>
                    <p className="mt-2 text-xs text-gray-400">💡 Saved to the database — Income bands for <strong>{p.name}</strong> First Offer calculator apply for every user.</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
