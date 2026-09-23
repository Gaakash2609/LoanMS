import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Upload, Download, CheckCircle2, AlertTriangle } from 'lucide-react'
import api from '@/api/axios'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { downloadCsv, buildCsv } from '@/utils/loanExport'
import { parseCsvRows, csvBool } from '@/utils/csv'

// ── Bulk upload of bank-master records ─────────────────────────────────────
// Ports legacy's "Bulk Upload" button on the Analytic Banks tab
// (efin-app.js laOpenBulkUploadModal). There is no bulk endpoint on
// BanksController — it exposes only single-item POST /api/banks — so, exactly
// like the eligibility-lines importer, this parses a CSV and creates one bank
// per row, reporting per-row outcomes. Reuses the existing POST endpoint (no
// new/duplicate backend), the shared CSV parser (utils/csv), and the same
// preview/progress/results UX as ImportLinesModal.
const TEMPLATE_HEADER = ['Bank Name', 'IFSC Prefix', 'Emp Code', 'Location', 'RM Name', 'RM Mobile', 'Email', 'InCred', 'Elite']

interface ParsedBank {
  bankName: string; ifscPrefix: string; empCode: string; location: string
  rmName: string; rmMobile: string; email: string; isIncred: boolean; isElite: boolean
  error?: string
}
interface RowResult { row: number; bankName: string; status: 'created' | 'failed'; message?: string }

function parseBanks(text: string): ParsedBank[] {
  return parseCsvRows(text, 'bank').map(c => {
    const bankName = c[0] ?? ''
    const email = c[6] ?? ''
    let error: string | undefined
    if (!bankName) error = 'Bank name is required'
    else if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) error = 'Email looks invalid'
    return {
      bankName, ifscPrefix: c[1] ?? '', empCode: c[2] ?? '', location: c[3] ?? '',
      rmName: c[4] ?? '', rmMobile: c[5] ?? '', email,
      isIncred: csvBool(c[7]), isElite: csvBool(c[8]), error,
    }
  })
}

export default function BulkUploadBanksModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<ParsedBank[]>([])
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<RowResult[] | null>(null)

  function onFile(file: File) {
    setError(''); setResults(null); setFileName(file.name)
    if (!/\.csv$/i.test(file.name)) {
      setError('Only .csv files are supported. Use the template below as a starting point.')
      setRows([]); return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const parsed = parseBanks(String(reader.result ?? ''))
      if (parsed.length === 0) setError('That file has no data rows.')
      setRows(parsed)
    }
    reader.onerror = () => setError('Could not read that file.')
    reader.readAsText(file)
  }

  function downloadTemplate() {
    downloadCsv(
      buildCsv(TEMPLATE_HEADER, [
        ['HDFC Bank', 'HDFC', 'EMP01', 'Mumbai', 'Ravi Kumar', '9876543210', 'ravi@hdfc.com', 'No', 'No'],
        ['InCred Finance', 'INCR', '', 'Bangalore', '', '', '', 'Yes', 'No'],
      ]),
      'banks-template.csv',
    )
  }

  const validRows = rows.filter(r => !r.error)
  const badRows = rows.filter(r => r.error)

  async function runImport() {
    setError(''); setRunning(true); setProgress(0)
    const out: RowResult[] = []
    for (let i = 0; i < validRows.length; i++) {
      const r = validRows[i]
      const rowNo = rows.indexOf(r) + 1
      try {
        await api.post('/api/banks', {
          bankName: r.bankName, ifscPrefix: r.ifscPrefix || undefined, empCode: r.empCode || undefined,
          location: r.location || undefined, rmName: r.rmName || undefined, rmMobile: r.rmMobile || undefined,
          email: r.email || undefined, isIncred: r.isIncred, isElite: r.isElite,
        })
        out.push({ row: rowNo, bankName: r.bankName, status: 'created' })
      } catch (e) {
        const d = (e as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
        out.push({ row: rowNo, bankName: r.bankName, status: 'failed', message: d?.message || d?.errors?.join(' ') || (e instanceof Error ? e.message : 'Failed') })
      }
      setProgress(Math.round(((i + 1) / validRows.length) * 100))
    }
    setResults(out); setRunning(false)
    qc.invalidateQueries({ queryKey: ['banks'] })
    qc.invalidateQueries({ queryKey: ['banksConfig'] })
  }

  const created = results?.filter(r => r.status === 'created').length ?? 0
  const failed = results?.filter(r => r.status === 'failed').length ?? 0

  return (
    <Modal
      open onClose={onClose}
      title="Bulk Upload Banks"
      subtitle="Create multiple banks at once from a CSV"
      size="xl" className="sm:max-w-2xl"
      dismissable={!running}
      footer={<>
        {!results && (
          <Button size="sm" loading={running} disabled={running || validRows.length === 0} onClick={runImport}>
            <Upload size={13} className="mr-1" /> Upload {validRows.length > 0 ? `${validRows.length} bank(s)` : ''}
          </Button>
        )}
        <Button size="sm" variant="secondary" disabled={running} onClick={onClose}>{results ? 'Close' : 'Cancel'}</Button>
      </>}
    >
      <div className="space-y-4">
        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

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

        {rows.length > 0 && !results && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Preview — {fileName}</p>
              <p className="text-xs">
                <span className="text-green-700 font-semibold">{validRows.length} valid</span>
                {badRows.length > 0 && <span className="text-red-600 font-semibold ml-2">{badRows.length} invalid</span>}
              </p>
            </div>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="text-gray-600">
                    {['#', 'Bank', 'IFSC', 'RM', 'InCred', 'Elite', 'Status'].map(h => (
                      <th key={h} className="px-2 py-1.5 text-left font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={`border-t border-gray-100 ${r.error ? 'bg-red-50' : ''}`}>
                      <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                      <td className="px-2 py-1.5">{r.bankName || '—'}</td>
                      <td className="px-2 py-1.5">{r.ifscPrefix || '—'}</td>
                      <td className="px-2 py-1.5">{r.rmName || '—'}</td>
                      <td className="px-2 py-1.5">{r.isIncred ? 'Yes' : 'No'}</td>
                      <td className="px-2 py-1.5">{r.isElite ? 'Yes' : 'No'}</td>
                      <td className="px-2 py-1.5">
                        {r.error ? <span className="text-red-600">{r.error}</span> : <span className="text-green-600">Ready</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {badRows.length > 0 && (
              <p className="text-xs text-amber-700 mt-2 flex items-start gap-1.5">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                Invalid rows are skipped — the rest still upload.
              </p>
            )}
          </div>
        )}

        {running && (
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1"><span>Uploading…</span><span>{progress}%</span></div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-efin-blue rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {results && (
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-sm font-semibold text-green-700 flex items-center gap-1"><CheckCircle2 size={15} /> {created} created</span>
              {failed > 0 && <span className="text-sm font-semibold text-red-600">{failed} failed</span>}
            </div>
            {failed > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                {results.filter(r => r.status === 'failed').map(r => (
                  <div key={r.row} className="px-3 py-1.5 text-xs">
                    <span className="text-gray-500">Row {r.row}</span> · <span className="font-medium">{r.bankName}</span>
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
