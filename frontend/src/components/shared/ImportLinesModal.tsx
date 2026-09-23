import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload, Download, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { lenderConfigApi } from '@/api/lenderConfigApi'
import { downloadCsv, buildCsv } from '@/utils/loanExport'
import { parseCsvLine } from '@/utils/csv'

// ── Bulk import of bank eligibility lines ──────────────────────────────
// Ports legacy's "Import Lines" tab (laPreviewImport / laRunImport).
//
// There is NO bulk endpoint on LenderConfigController — it exposes only
// single-item POST /companies, POST /categories and POST /lines. Legacy did
// the same thing: it looped and posted each row individually. So this
// resolves each row's company/category by name (creating the missing ones
// when asked), then creates one line per row, reporting per-row outcomes.
//
// CSV format matches the downloadable template below. XLS/XLSX are NOT
// accepted — there is no spreadsheet-parsing library in this project, and
// silently mis-parsing a binary file would be worse than refusing it.
const TEMPLATE_HEADER = ['Company', 'Category', 'Salary', 'PIN Code', 'PF']

interface ParsedRow {
  company: string
  category: string
  salary: number
  pinCode: string
  pf: boolean
  error?: string
}

interface RowResult { row: number; company: string; status: 'created' | 'failed'; message?: string }

function parseCsv(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length === 0) return []
  // Skip the header row if it looks like one.
  const first = parseCsvLine(lines[0]).map(s => s.toLowerCase())
  const start = first[0]?.includes('company') ? 1 : 0

  return lines.slice(start).map(line => {
    const c = parseCsvLine(line)
    const company = c[0] ?? ''
    const category = c[1] ?? ''
    const salaryRaw = c[2] ?? ''
    const pinCode = c[3] ?? ''
    const pfRaw = (c[4] ?? '').toLowerCase()
    const salary = Number(salaryRaw.replace(/[^\d.]/g, ''))

    let error: string | undefined
    if (!company) error = 'Company name is required'
    else if (!category) error = 'Category name is required'
    else if (!salaryRaw || !Number.isFinite(salary) || salary <= 0) error = 'Salary must be a number greater than 0'
    else if (pinCode && !/^\d{6}$/.test(pinCode)) error = 'PIN code must be 6 digits'

    return {
      company, category, salary,
      pinCode,
      pf: ['yes', 'true', '1', 'y'].includes(pfRaw),
      error,
    }
  })
}

export default function ImportLinesModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [bankId, setBankId] = useState<number | ''>('')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [fileName, setFileName] = useState('')
  const [createMissing, setCreateMissing] = useState(true)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<RowResult[] | null>(null)

  const { data: banks } = useQuery({
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

  function onFile(file: File) {
    setError(''); setResults(null); setFileName(file.name)
    if (!/\.csv$/i.test(file.name)) {
      setError('Only .csv files are supported. Use the template below as a starting point.')
      setRows([])
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result ?? ''))
      if (parsed.length === 0) setError('That file has no data rows.')
      setRows(parsed)
    }
    reader.onerror = () => setError('Could not read that file.')
    reader.readAsText(file)
  }

  function downloadTemplate() {
    downloadCsv(
      buildCsv(TEMPLATE_HEADER, [
        ['Tata Consultancy Services', 'Cat A', '50000', '400001', 'Yes'],
        ['Infosys', 'Cat B', '35000', '', 'No'],
      ]),
      'eligibility-lines-template.csv',
    )
  }

  const validRows = rows.filter(r => !r.error)
  const badRows = rows.filter(r => r.error)

  async function runImport() {
    if (bankId === '') { setError('Select the bank these lines belong to.'); return }
    setError(''); setRunning(true); setProgress(0)
    const out: RowResult[] = []

    // Local name→id maps, seeded from what already exists and extended as
    // new companies/categories are created, so a name repeated across rows
    // is only created once.
    const companyMap = new Map((companies ?? []).map(c => [c.name.trim().toLowerCase(), c.id]))
    const categoryMap = new Map((categories ?? []).map(c => [c.name.trim().toLowerCase(), c.id]))

    for (let i = 0; i < validRows.length; i++) {
      const r = validRows[i]
      const rowNo = rows.indexOf(r) + 1
      try {
        const compKey = r.company.trim().toLowerCase()
        let companyId = companyMap.get(compKey)
        if (!companyId) {
          if (!createMissing) throw new Error(`Company "${r.company}" does not exist`)
          const res = await lenderConfigApi.createCompany({ name: r.company.trim() })
          companyId = res.data.data?.id
          if (!companyId) throw new Error('Could not create company')
          companyMap.set(compKey, companyId)
        }

        const catKey = r.category.trim().toLowerCase()
        let categoryId = categoryMap.get(catKey)
        if (!categoryId) {
          if (!createMissing) throw new Error(`Category "${r.category}" does not exist`)
          const res = await lenderConfigApi.createCategory({ name: r.category.trim(), salary: r.salary })
          categoryId = res.data.data?.id
          if (!categoryId) throw new Error('Could not create category')
          categoryMap.set(catKey, categoryId)
        }

        await lenderConfigApi.createLine({
          bankId: Number(bankId), companyId, categoryId,
          pinCode: r.pinCode || undefined, pf: r.pf,
        })
        out.push({ row: rowNo, company: r.company, status: 'created' })
      } catch (e) {
        const d = (e as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
        out.push({
          row: rowNo, company: r.company, status: 'failed',
          message: d?.message || d?.errors?.join(' ') || (e instanceof Error ? e.message : 'Failed'),
        })
      }
      setProgress(Math.round(((i + 1) / validRows.length) * 100))
    }

    setResults(out)
    setRunning(false)
    qc.invalidateQueries({ queryKey: ['banks'] })
    qc.invalidateQueries({ queryKey: ['lender-companies'] })
    qc.invalidateQueries({ queryKey: ['lender-categories'] })
    qc.invalidateQueries({ queryKey: ['banksConfig'] })
  }

  const created = results?.filter(r => r.status === 'created').length ?? 0
  const failed = results?.filter(r => r.status === 'failed').length ?? 0

  return (
    <Modal
      open
      onClose={onClose}
      title="Import Eligibility Lines"
      subtitle="Bulk-add company/category lines to a bank from a CSV"
      size="xl"
      className="sm:max-w-2xl"
      // A bulk write in progress shouldn't be dismissable by an accidental
      // Esc or outside click — the import itself has no cancel/abort path.
      dismissable={!running}
      footer={<>
        {!results && (
          <Button size="sm" loading={running}
            disabled={running || validRows.length === 0 || bankId === ''}
            onClick={runImport}>
            <Upload size={13} className="mr-1" /> Import {validRows.length > 0 ? `${validRows.length} row(s)` : ''}
          </Button>
        )}
        <Button size="sm" variant="secondary" disabled={running} onClick={onClose}>{results ? 'Close' : 'Cancel'}</Button>
      </>}
    >
      <div className="space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          {/* Target bank */}
          <div>
            <label className="text-xs font-semibold text-gray-600 uppercase block mb-1">Target Bank *</label>
            <select value={bankId} onChange={e => setBankId(e.target.value ? Number(e.target.value) : '')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">— Select bank —</option>
              {(banks ?? []).map(b => <option key={b.id} value={b.id}>{b.bankName}</option>)}
            </select>
          </div>

          {/* File + template */}
          <div className="flex flex-wrap items-end gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs font-semibold text-gray-600 uppercase block mb-1">CSV File</label>
              <input ref={fileRef} type="file" accept=".csv"
                onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }}
                className="block w-full text-xs text-gray-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-efin-blue file:text-white" />
            </div>
            <Button size="sm" variant="secondary" onClick={downloadTemplate}>
              <Download size={13} className="mr-1" /> Template
            </Button>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={createMissing} onChange={e => setCreateMissing(e.target.checked)} />
            Create companies / categories that don't exist yet
          </label>

          {/* Preview */}
          {rows.length > 0 && !results && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                  Preview — {fileName}
                </p>
                <p className="text-xs">
                  <span className="text-green-700 font-semibold">{validRows.length} valid</span>
                  {badRows.length > 0 && <span className="text-red-600 font-semibold ml-2">{badRows.length} invalid</span>}
                </p>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr className="text-gray-600">
                      {['#', ...TEMPLATE_HEADER, 'Status'].map(h => (
                        <th key={h} className="px-2 py-1.5 text-left font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className={`border-t border-gray-100 ${r.error ? 'bg-red-50' : ''}`}>
                        <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                        <td className="px-2 py-1.5">{r.company || '—'}</td>
                        <td className="px-2 py-1.5">{r.category || '—'}</td>
                        <td className="px-2 py-1.5">{r.salary || '—'}</td>
                        <td className="px-2 py-1.5">{r.pinCode || '—'}</td>
                        <td className="px-2 py-1.5">{r.pf ? 'Yes' : 'No'}</td>
                        <td className="px-2 py-1.5">
                          {r.error
                            ? <span className="text-red-600">{r.error}</span>
                            : <span className="text-green-600">Ready</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {badRows.length > 0 && (
                <p className="text-xs text-amber-700 mt-2 flex items-start gap-1.5">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  Invalid rows are skipped — the rest still import.
                </p>
              )}
            </div>
          )}

          {running && (
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Importing…</span><span>{progress}%</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-efin-blue rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {/* Results */}
          {results && (
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-sm font-semibold text-green-700 flex items-center gap-1">
                  <CheckCircle2 size={15} /> {created} imported
                </span>
                {failed > 0 && <span className="text-sm font-semibold text-red-600">{failed} failed</span>}
              </div>
              {failed > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                  {results.filter(r => r.status === 'failed').map(r => (
                    <div key={r.row} className="px-3 py-1.5 text-xs">
                      <span className="text-gray-500">Row {r.row}</span> · <span className="font-medium">{r.company}</span>
                      <span className="text-red-600"> — {r.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
      </div>
    </Modal>
  )
}
