import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { X, ChevronUp, ChevronDown } from 'lucide-react'
import { loansApi } from '@/api/loansApi'
import { userSettingsApi } from '@/api/userSettingsApi'
import type { LoanFilter } from '@/types'
import { defaultExportColumns, buildLoansCsv, downloadCsv, type ExportColumn } from '@/utils/loanExport'

const PRESET_KEY = 'export_presets' // matches legacy's STG_EXPORT_PRESETS_KEY exactly

interface Preset { name: string; columns: string[] } // ordered list of checked column keys

// ── Applications Export (Loans list → Export) ───────────────────────────────
// Reproduces legacy's openExportModal/doExport column picker + preset
// save/load, backed by the real per-user settings store (UserSettingsController
// — same GET/POST /api/user-settings/export_presets contract legacy's
// stgSyncExportPresetsFromServer uses). Scope is always "filtered" (every
// loan matching the list's current search/status filter, fetched across all
// pages via the existing /api/loans endpoint with a large pageSize) — legacy's
// "custom date-range" scope isn't reproduced, see code comment. Reordering
// uses up/down buttons rather than legacy's drag-and-drop (no DnD library in
// this project) but produces the same reordered-column-list outcome.
// XLSX format is NOT implemented — no spreadsheet-generation library is
// installed in this project; only CSV (which needs none) is offered.
export default function ExportLoansModal({ filter, onClose }: { filter: LoanFilter; onClose: () => void }) {
  const qc = useQueryClient()
  const [columns, setColumns] = useState<ExportColumn[]>(defaultExportColumns())
  const [presetName, setPresetName] = useState('')
  const [error, setError] = useState('')
  // Matches legacy's afSetExportScope('filtered' | 'custom') — only the
  // date-range piece of legacy's custom scope is reproduced here (loan
  // type/bank/status/sales/amount-range custom filters are a separate,
  // not-yet-requested piece of that same legacy panel).
  const [scope, setScope] = useState<'filtered' | 'custom'>('filtered')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const { data: presetSetting } = useQuery({
    queryKey: ['exportPresets'],
    queryFn: () => userSettingsApi.get(PRESET_KEY).then(r => r.data.data).catch(() => null),
  })
  const presets: Preset[] = (() => {
    try { return presetSetting?.value ? JSON.parse(presetSetting.value) : [] } catch { return [] }
  })()

  const savePresets = useMutation({
    mutationFn: (next: Preset[]) => userSettingsApi.save(PRESET_KEY, JSON.stringify(next), 'export'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exportPresets'] }),
  })

  function toggle(key: string) {
    setColumns(cs => cs.map(c => c.key === key ? { ...c, checked: !c.checked } : c))
  }
  function move(idx: number, dir: -1 | 1) {
    setColumns(cs => {
      const ni = idx + dir
      if (ni < 0 || ni >= cs.length) return cs
      const next = [...cs]
      ;[next[idx], next[ni]] = [next[ni], next[idx]]
      return next
    })
  }
  function toggleAll(state: boolean) {
    setColumns(cs => cs.map(c => ({ ...c, checked: state })))
  }

  function applyPreset(p: Preset) {
    setColumns(cs => {
      const byKey = new Map(cs.map(c => [c.key, c]))
      const ordered = p.columns.map(k => byKey.get(k)).filter((c): c is ExportColumn => !!c)
      const rest = cs.filter(c => !p.columns.includes(c.key)).map(c => ({ ...c, checked: false }))
      return [...ordered.map(c => ({ ...c, checked: true })), ...rest]
    })
  }
  function saveCurrentAsPreset() {
    const name = presetName.trim()
    if (!name) { setError('Enter a preset name'); return }
    const checkedKeys = columns.filter(c => c.checked).map(c => c.key)
    const next = [...presets.filter(p => p.name !== name), { name, columns: checkedKeys }]
    savePresets.mutate(next)
    setPresetName(''); setError('')
  }
  function deletePreset(name: string) {
    savePresets.mutate(presets.filter(p => p.name !== name))
  }

  const [exportError, setExportError] = useState('')
  const runExport = useMutation({
    mutationFn: async () => {
      // "filtered" — every loan matching the list's current search/status
      // filter, matches legacy's default scope. "custom" — the same
      // filter, but with an independent date range replacing whatever
      // date filter the list itself had (matches legacy's afSetExportScope
      // 'custom', date-range portion only).
      const effectiveFilter: LoanFilter = scope === 'custom'
        ? { ...filter, dateFrom, dateTo }
        : filter
      const res = await loansApi.getAll({ ...effectiveFilter, page: 1, pageSize: 5000 })
      const page = res.data.data
      if (!page) throw new Error('Could not load loans to export')
      return page.items
    },
    onSuccess: (items) => {
      if (items.length === 0) { setExportError('No loans match the current filter — nothing to export.'); return }
      const active = columns.filter(c => c.checked)
      if (active.length === 0) { setExportError('Select at least one column.'); return }
      const csv = buildLoansCsv(items, columns)
      downloadCsv(csv, `applications-export-${new Date().toISOString().slice(0, 10)}.csv`)
      setExportError('')
      onClose()
    },
    onError: () => setExportError('Export failed — could not reach the server.'),
  })

  useEffect(() => { setExportError('') }, [columns])

  function handleExportClick() {
    if (runExport.isPending) return // guard against duplicate export clicks
    if (scope === 'custom') {
      if (!dateFrom || !dateTo) { setExportError('Both From and To dates are required for a custom range.'); return }
      if (dateFrom > dateTo) { setExportError('From date cannot be after To date.'); return }
    }
    setExportError('')
    runExport.mutate()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Export Applications</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {presets.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-600 mb-1.5">Presets</p>
              <div className="flex flex-wrap gap-2">
                {presets.map(p => (
                  <span key={p.name} className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-2.5 py-1 text-xs">
                    <button onClick={() => applyPreset(p)} className="font-medium text-gray-700">{p.name}</button>
                    <button onClick={() => deletePreset(p.name)} className="text-gray-400 hover:text-red-500">✕</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-600">Columns</p>
            <div className="flex gap-2">
              <button onClick={() => toggleAll(true)} className="text-xs text-blue-600 font-medium">All</button>
              <button onClick={() => toggleAll(false)} className="text-xs text-gray-400 font-medium">None</button>
            </div>
          </div>
          <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto">
            {columns.map((c, i) => (
              <div key={c.key} className="flex items-center gap-2 px-2.5 py-1.5 border-b border-gray-50 last:border-0 text-sm">
                <div className="flex flex-col">
                  <button onClick={() => move(i, -1)} disabled={i === 0} className="text-gray-300 hover:text-gray-600 disabled:opacity-30"><ChevronUp size={12} /></button>
                  <button onClick={() => move(i, 1)} disabled={i === columns.length - 1} className="text-gray-300 hover:text-gray-600 disabled:opacity-30"><ChevronDown size={12} /></button>
                </div>
                <label className="flex items-center gap-2 flex-1 cursor-pointer">
                  <input type="checkbox" checked={c.checked} onChange={() => toggle(c.key)} />
                  {c.label}
                </label>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <input value={presetName} onChange={e => setPresetName(e.target.value)} placeholder="Preset name"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
            <Button size="sm" variant="secondary" loading={savePresets.isPending} onClick={saveCurrentAsPreset}>Save Preset</Button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}

          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">Scope</p>
            <div className="flex gap-2 mb-2">
              <label className={`flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-semibold cursor-pointer ${scope === 'filtered' ? 'bg-blue-50 border-blue-300' : 'bg-white'}`}>
                <input type="radio" name="export-scope" checked={scope === 'filtered'} onChange={() => setScope('filtered')} />
                Current Filter
              </label>
              <label className={`flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-semibold cursor-pointer ${scope === 'custom' ? 'bg-blue-50 border-blue-300' : 'bg-white'}`}>
                <input type="radio" name="export-scope" checked={scope === 'custom'} onChange={() => setScope('custom')} />
                Custom Date Range
              </label>
            </div>
            {scope === 'custom' && (
              <div className="flex items-center gap-2">
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm flex-1" />
                <span className="text-gray-400 text-xs">to</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm flex-1" />
              </div>
            )}
          </div>

          <p className="text-xs text-gray-400">Format: CSV — {scope === 'custom' ? 'exports applications within the selected date range.' : 'exports every application matching the current search/status filter.'}</p>
          {exportError && <p className="text-xs text-red-600">{exportError}</p>}

          <div className="flex gap-2 pt-2 border-t border-gray-100">
            <Button loading={runExport.isPending} onClick={handleExportClick}>Export CSV</Button>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
