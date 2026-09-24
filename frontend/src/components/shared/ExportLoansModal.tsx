import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { loansApi } from '@/api/loansApi'
import { EXPORT_SCOPES, PIPELINE_STATUSES, scopeToStatus, type ExportScope } from '@/constants/advFilter'
import { userSettingsApi } from '@/api/userSettingsApi'
import type { LoanFilter } from '@/types'
import { defaultExportColumns, buildLoansCsv, buildLoansExcelHtml, buildLoansPdfHtml, downloadCsv, type ExportColumn } from '@/utils/loanExport'
import { downloadBlob, openReportPdfPreview } from '@/utils/reportExport'

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
// All three of legacy's formats are offered — CSV, Excel and PDF — matching
// doExport's csv/xlsx/pdf branches (efin-app.js:36175-36187). Neither Excel nor
// PDF needs a library: Excel is legacy exportXLSX's Office-namespaced HTML
// table saved as .xls, and PDF is legacy exportPDF's print-styled window that
// calls window.print() itself. Both reuse helpers from utils/reportExport.ts
// (wrapExcelHtml/htmlTable, openReportPdfPreview) rather than duplicating them.
// (An earlier comment here claimed XLSX was impossible without a library; that
// was wrong — the Reports export had been using this same technique already.)
export default function ExportLoansModal({ filter, onClose }: { filter: LoanFilter; onClose: () => void }) {
  const qc = useQueryClient()
  const [columns, setColumns] = useState<ExportColumn[]>(defaultExportColumns())
  const [presetName, setPresetName] = useState('')
  const [error, setError] = useState('')
  // Legacy's afSetExportScope chip set in full: filtered / all / disbursed /
  // pending / rejected, plus the custom date range. "pending" is legacy's
  // Active Pipeline — several statuses at once, which the list endpoint's
  // single Status param cannot express, so that one scope fetches unfiltered
  // and narrows the rows before the CSV is built.
  const [scope, setScope] = useState<ExportScope | 'custom'>('filtered')
  // Legacy's export-fmt radio group. Legacy defaulted to xlsx; CSV is kept as
  // the default here because it is the format this modal has been shipping.
  const [format, setFormat] = useState<'csv' | 'excel' | 'pdf'>('csv')
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
      let effectiveFilter: LoanFilter
      if (scope === 'custom') {
        effectiveFilter = { ...filter, dateFrom, dateTo }
      } else if (scope === 'filtered') {
        effectiveFilter = filter
      } else {
        // all / disbursed / pending / rejected deliberately ignore the list's
        // own filters — legacy's chips mean "export this set", not "narrow
        // what is already on screen".
        effectiveFilter = { status: scopeToStatus(scope) }
      }
      // Every matching loan (was pageSize 5000, which the API clamps to 10).
      const items = await loansApi.getAllPages(effectiveFilter)
      return scope === 'pending'
        ? items.filter(l => (PIPELINE_STATUSES as readonly string[]).includes(l.status))
        : items
    },
    onSuccess: (items) => {
      if (items.length === 0) { setExportError('No loans match the current filter — nothing to export.'); return }
      const active = columns.filter(c => c.checked)
      if (active.length === 0) { setExportError('Select at least one column.'); return }
      const stamp = new Date().toISOString().slice(0, 10)
      if (format === 'pdf') {
        // Legacy's exportPDF technique: a print-styled document opened in its
        // own window that triggers window.print() itself. If the popup is
        // blocked, fall back to downloading the same HTML — identical to how
        // ReportsPage.handleExportPdf handles it, so behaviour is consistent
        // across both PDF exports.
        const html = buildLoansPdfHtml(items, columns)
        if (openReportPdfPreview(html) === 'blocked') {
          downloadBlob(html, `applications-export-${stamp}.html`, 'text/html;charset=utf-8')
        }
      } else if (format === 'excel') {
        // Office-HTML workbook (legacy exportXLSX's technique) — .xls so Excel
        // opens it natively; the CSV path below is untouched.
        downloadBlob(
          buildLoansExcelHtml(items, columns),
          `applications-export-${stamp}.xls`,
          'application/vnd.ms-excel;charset=utf-8',
        )
      } else {
        downloadCsv(buildLoansCsv(items, columns), `applications-export-${stamp}.csv`)
      }
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
    <Modal
      open
      onClose={onClose}
      title="Export Applications"
      size="md"
      className="sm:max-w-lg"
      footer={<>
        <Button loading={runExport.isPending} onClick={handleExportClick}>
          {format === 'pdf' ? 'Export PDF' : format === 'excel' ? 'Export Excel' : 'Export CSV'}
        </Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </>}
    >
      <div className="space-y-4">
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
              <button onClick={() => toggleAll(true)} className="text-xs text-efin-blue font-medium">All</button>
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
            <div className="flex flex-wrap gap-2 mb-2">
              {EXPORT_SCOPES.map(sc => (
                <label key={sc.scope}
                  className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-semibold cursor-pointer ${
                    scope === sc.scope ? 'bg-efin-blue/10 border-efin-blue/30' : 'bg-white border-gray-200'}`}>
                  <input type="radio" name="export-scope" checked={scope === sc.scope}
                    onChange={() => setScope(sc.scope)} />
                  {sc.label}
                </label>
              ))}
              <label className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-semibold cursor-pointer ${
                scope === 'custom' ? 'bg-efin-blue/10 border-efin-blue/30' : 'bg-white border-gray-200'}`}>
                <input type="radio" name="export-scope" checked={scope === 'custom'} onChange={() => setScope('custom')} />
                Custom Range
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

          <div>
            <p className="text-xs font-medium text-gray-500 mb-1.5">Format</p>
            <div className="flex gap-2">
              {([['csv', 'CSV'], ['excel', 'Excel (.xls)'], ['pdf', 'PDF']] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setFormat(value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    format === value
                      ? 'bg-efin-blue text-white border-efin-blue'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-gray-400">{
            scope === 'custom'   ? 'exports applications within the selected date range.'
            : scope === 'filtered' ? 'exports every application matching the current search/status filter.'
            : scope === 'all'      ? 'exports every application you can see, ignoring the list filters.'
            : scope === 'pending'  ? 'exports the active pipeline: draft, submitted, under review and approved.'
            : `exports ${scope} applications only, ignoring the list filters.`
          }</p>
          {exportError && <p className="text-xs text-red-600">{exportError}</p>}
      </div>
    </Modal>
  )
}
