import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { CheckCircle2, XCircle, AlertTriangle, Info, RotateCcw, Save } from 'lucide-react'
import type { PerfiosUploadResult } from '@/hooks/usePerfiosUpload'
import { buildFullAnalysis } from '@/utils/perfios/orchestrate'
import { fmt, fmtDate } from '@/utils/perfios/analysis'
import type { ValidationCheck } from '@/utils/perfios/types'
import { perfiosApi, type PerfiosReportSaveRequest } from '@/api/perfiosApi'

const CHECK_ICON: Record<ValidationCheck['status'], typeof CheckCircle2> = {
  pass: CheckCircle2, warn: AlertTriangle, fail: XCircle,
}
const CHECK_COLOR: Record<ValidationCheck['status'], string> = {
  pass: 'text-green-600', warn: 'text-yellow-600', fail: 'text-red-600',
}

type Tab = 'analysis' | 'breakup' | 'eod' | 'finone'

// ── Perfios analysis results (read-only) ────────────────────────────────
// Consumes Phase 2's PerfiosUploadResult and orchestrates the four
// remaining Phase 1 dataset builders (FinOne/Analysis/Breakup/EOD) via
// buildFullAnalysis — no calculation lives in this component. Everything
// displayed is exactly what buildValidationChecks/buildFinOneData/
// buildAnalysisData/buildBreakupData/buildEODData/buildABBFromTargetRows
// already produced. Stays in React memory only — no localStorage/
// sessionStorage/backend save/postMessage/iframe. Save-to-backend is
// Phase 4, not here.
export default function PerfiosAnalysisResults({ result, onReset, loanId }: { result: PerfiosUploadResult; onReset: () => void; loanId: number }) {
  const full = useMemo(() => buildFullAnalysis(result), [result])
  const [tab, setTab] = useState<Tab>('analysis')
  const qc = useQueryClient()

  const { upload, finOne, analysis, breakup, eod } = full
  const monthOrder = upload.monthOrder
  const monthLabels = monthOrder.map(mk => upload.abbData[mk]?.label ?? mk)

  // ── Confirm & Save — reproduces legacy's pfv9ConfirmAttachment save call
  // exactly: same 10 fields, same source values (this run's already-
  // computed upload summary, nothing recalculated), same "first uploaded
  // file's name" convention for multi-file runs (legacy: perFileData[0].
  // fileName, not a combined name), same string-not-number ABB/span
  // (String(data.abb)/String(data.span)) and same already-formatted
  // DD/MM/YYYY date strings (fmtDate) rather than ISO — matching
  // SavePerfiosReportRequestDto's actual string?/int?/bool field types.
  // No raw PDF, ArrayBuffer, base64, password, or transaction list is ever
  // included — only this final summary.
  const [saveState, setSaveState] = useState<'idle' | 'success' | 'error'>('idle')
  const save = useMutation({
    mutationFn: () => {
      const payload: PerfiosReportSaveRequest = {
        fileName: upload.perFileData[0]?.fileName ?? null,
        averageBankBalance: upload.abb != null ? String(upload.abb) : null,
        span: upload.span != null ? String(upload.span) : null,
        totalTransactions: upload.totalTxns || null,
        hasSalary: !!upload.hasSalary,
        isValid: !!upload.valid,
        firstTransactionDate: upload.firstDate ? fmtDate(upload.firstDate) : null,
        lastTransactionDate: upload.lastDate ? fmtDate(upload.lastDate) : null,
        manualReviewRequired: !!upload.manualReviewRequired,
        staleDays: upload.staledays || null,
      }
      return perfiosApi.save(loanId, payload)
    },
    onSuccess: (res) => {
      if (!res.data.success) { setSaveState('error'); return }
      setSaveState('success')
      qc.invalidateQueries({ queryKey: ['perfiosReport', loanId] })
    },
    onError: () => setSaveState('error'),
  })

  useEffect(() => { setSaveState('idle') }, [result])

  return (
    <div className="space-y-6">
      {/* A. Summary */}
      <Card>
        <CardHeader title="Perfios Summary" />
        <div className={`flex items-start gap-2 p-3 rounded-lg border mb-4 ${upload.valid ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
          {upload.valid ? <CheckCircle2 size={16} className="text-green-600 shrink-0 mt-0.5" /> : <AlertTriangle size={16} className="text-yellow-600 shrink-0 mt-0.5" />}
          <div>
            <p className={`text-sm font-semibold ${upload.valid ? 'text-green-700' : 'text-yellow-700'}`}>
              {upload.valid ? 'Valid' : 'Needs Review'}{upload.manualReviewRequired ? ' · Manual Review Required' : ''}
            </p>
            {!upload.valid && <p className="text-xs text-yellow-700 mt-0.5">Span or staleness rule did not pass — see Validation Checks below.</p>}
          </div>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
          <div><dt className="text-gray-400 text-xs">File(s)</dt><dd className="text-gray-800">{upload.perFileData.map(f => f.fileName).join(', ') || '—'}</dd></div>
          <div><dt className="text-gray-400 text-xs">Total Transactions (90d)</dt><dd className="text-gray-800">{upload.totalTxns}</dd></div>
          <div><dt className="text-gray-400 text-xs">First Transaction</dt><dd className="text-gray-800">{fmtDate(upload.firstDate)}</dd></div>
          <div><dt className="text-gray-400 text-xs">Last Transaction</dt><dd className="text-gray-800">{fmtDate(upload.lastDate)}</dd></div>
          <div><dt className="text-gray-400 text-xs">Span</dt><dd className="text-gray-800">{upload.span} days</dd></div>
          <div><dt className="text-gray-400 text-xs">Average Bank Balance</dt><dd className="text-gray-800">₹{fmt(upload.abb)}</dd></div>
          <div><dt className="text-gray-400 text-xs">Salary Detected</dt><dd className="text-gray-800">{upload.hasSalary ? 'Yes' : 'No'}</dd></div>
          <div><dt className="text-gray-400 text-xs">Stale Days</dt><dd className="text-gray-800">{upload.staledays}</dd></div>
          <div><dt className="text-gray-400 text-xs">Manual Review Required</dt><dd className="text-gray-800">{upload.manualReviewRequired ? 'Yes' : 'No'}</dd></div>
        </dl>
      </Card>

      {/* B. Validation Checks */}
      <Card>
        <CardHeader title="Validation Checks" subtitle={`${upload.validChecks.length} checks from the Perfios rule engine`} />
        <div className="space-y-2">
          {upload.validChecks.map(c => {
            const Icon = CHECK_ICON[c.status]
            return (
              <div key={c.id} className="flex items-start gap-2.5 p-2.5 border border-gray-100 rounded-lg">
                <Icon size={15} className={`shrink-0 mt-0.5 ${CHECK_COLOR[c.status]}`} />
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${CHECK_COLOR[c.status]}`}>{c.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{c.detail}</p>
                </div>
                <span className="ml-auto text-xs text-gray-400 shrink-0 whitespace-nowrap">{c.value}</span>
              </div>
            )
          })}
        </div>
      </Card>

      {/* C. Salary / Income Information */}
      <Card>
        <CardHeader title="Salary / Income" subtitle={upload.hasSalary ? `${upload.salaryTxns.length} salary transaction(s) detected` : 'No salary transactions detected'} />
        {upload.salaryTxns.length === 0 ? (
          <p className="text-sm text-gray-400 py-2 flex items-center gap-1.5"><Info size={14} />No transactions matched salary keywords.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                <th className="py-1.5 pr-4">Date</th><th className="py-1.5 pr-4">Description</th><th className="py-1.5 text-right">Amount</th>
              </tr></thead>
              <tbody>
                {upload.salaryTxns.map((t, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-1.5 pr-4">{fmtDate(t.date)}</td>
                    <td className="py-1.5 pr-4 text-gray-700">{t.desc}</td>
                    <td className="py-1.5 text-right font-medium">₹{fmt(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* D-G. Detailed report tables */}
      <Card>
        <div className="flex gap-6 border-b border-gray-200 mb-4">
          {([
            ['analysis', 'Transaction Analysis'],
            ['breakup', 'Breakup'],
            ['eod', 'EOD / Balance'],
            ['finone', 'FinOne'],
          ] as [Tab, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`pb-3 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'analysis' && (
          <div className="overflow-auto max-h-[520px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left border-b border-gray-200">
                  <th className="py-1.5 pr-3">Metric</th>
                  {monthLabels.map(l => <th key={l} className="py-1.5 px-2 text-right whitespace-nowrap">{l}</th>)}
                  <th className="py-1.5 pl-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {analysis.map((row, i) => (
                  <tr key={i} className={row.label.startsWith('──') ? 'bg-gray-50' : 'border-b border-gray-50'}>
                    <td className={`py-1.5 pr-3 whitespace-nowrap ${row.label.startsWith('──') ? 'font-semibold text-gray-500' : 'text-gray-700'}`}>{row.label}</td>
                    {row.values.map((v, j) => (
                      <td key={j} className="py-1.5 px-2 text-right text-gray-600">
                        {row.fmt === '₹' ? `₹${fmt(v)}` : row.fmt === '%' ? `${(v * 100).toFixed(1)}%` : fmt(v).replace(/\.00$/, '')}
                      </td>
                    ))}
                    <td className="py-1.5 pl-2 text-right font-semibold text-gray-800">
                      {row.fmt === '₹' ? `₹${fmt(row.total)}` : row.fmt === '%' ? '' : fmt(row.total).replace(/\.00$/, '')}
                    </td>
                  </tr>
                ))}
                {analysis.length === 0 && <tr><td className="py-4 text-gray-400">No data.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'breakup' && (
          <div className="space-y-6">
            {(['income', 'expense'] as const).map(kind => (
              <div key={kind}>
                <p className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">{kind === 'income' ? 'Income Categories' : 'Expense Categories'}</p>
                <div className="overflow-auto max-h-[320px]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-white">
                      <tr className="text-left border-b border-gray-200">
                        <th className="py-1.5 pr-3">Category</th>
                        {monthLabels.map(l => <th key={l} className="py-1.5 px-2 text-right whitespace-nowrap">{l}</th>)}
                        <th className="py-1.5 pl-2 text-right font-semibold">Total</th>
                        <th className="py-1.5 pl-2 text-right font-semibold">Avg</th>
                      </tr>
                    </thead>
                    <tbody>
                      {breakup[kind].map((row, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          <td className="py-1.5 pr-3 whitespace-nowrap text-gray-700">{row.label}</td>
                          {row.values.map((v, j) => <td key={j} className="py-1.5 px-2 text-right text-gray-600">₹{fmt(v)}</td>)}
                          <td className="py-1.5 pl-2 text-right font-semibold text-gray-800">₹{fmt(row.total)}</td>
                          <td className="py-1.5 pl-2 text-right text-gray-600">₹{fmt(row.avg)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'eod' && (
          <div className="overflow-auto max-h-[520px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left border-b border-gray-200">
                  <th className="py-1.5 pr-3">Day</th>
                  {monthOrder.map(mk => <th key={mk} className="py-1.5 px-2 text-right whitespace-nowrap">{upload.abbData[mk]?.label ?? mk}</th>)}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 31 }, (_, i) => i + 1).map(day => {
                  const row = eod[day]
                  const hasAny = monthOrder.some(mk => row?.[mk] !== undefined)
                  if (!hasAny) return null
                  return (
                    <tr key={day} className="border-b border-gray-50">
                      <td className="py-1 pr-3 text-gray-500">{day}</td>
                      {monthOrder.map(mk => (
                        <td key={mk} className="py-1 px-2 text-right text-gray-600">
                          {row[mk] !== undefined ? `₹${fmt(row[mk])}` : '—'}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'finone' && (
          <div className="overflow-auto max-h-[520px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left border-b border-gray-200">
                  <th className="py-1.5 pr-3">Month</th>
                  <th className="py-1.5 px-2 text-right">Credits (No.)</th>
                  <th className="py-1.5 px-2 text-right">Credits (₹)</th>
                  <th className="py-1.5 px-2 text-right">Bal@2</th>
                  <th className="py-1.5 px-2 text-right">Bal@4</th>
                  <th className="py-1.5 px-2 text-right">Bal@10</th>
                  <th className="py-1.5 px-2 text-right">Bal@17</th>
                  <th className="py-1.5 px-2 text-right">Bal@25</th>
                  <th className="py-1.5 px-2 text-right">EOD (Last)</th>
                  <th className="py-1.5 px-2 text-right font-semibold">Avg (K)</th>
                  <th className="py-1.5 px-2 text-right">Withdrawal (₹)</th>
                  <th className="py-1.5 px-2 text-right">Min Bal</th>
                  <th className="py-1.5 px-2 text-right">Salary Credit</th>
                  <th className="py-1.5 px-2 text-right">Salary Date</th>
                  <th className="py-1.5 px-2 text-right">Chq Bounces</th>
                </tr>
              </thead>
              <tbody>
                {finOne.map((r, i) => (
                  <tr key={i} className={r.month === 'TOTAL' ? 'font-semibold bg-gray-50' : 'border-b border-gray-50'}>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{r.month}</td>
                    <td className="py-1.5 px-2 text-right">{r.creditsNos}</td>
                    <td className="py-1.5 px-2 text-right">₹{fmt(r.creditsValue)}</td>
                    <td className="py-1.5 px-2 text-right">₹{fmt(r.bal2)}</td>
                    <td className="py-1.5 px-2 text-right">₹{fmt(r.bal4)}</td>
                    <td className="py-1.5 px-2 text-right">₹{fmt(r.bal10)}</td>
                    <td className="py-1.5 px-2 text-right">₹{fmt(r.bal17)}</td>
                    <td className="py-1.5 px-2 text-right">₹{fmt(r.bal25)}</td>
                    <td className="py-1.5 px-2 text-right">₹{fmt(r.eodLast)}</td>
                    <td className="py-1.5 px-2 text-right font-semibold">₹{fmt(r.kAvg)}</td>
                    <td className="py-1.5 px-2 text-right">₹{fmt(r.withdrawalAmt)}</td>
                    <td className="py-1.5 px-2 text-right">₹{fmt(r.minBal)}</td>
                    <td className="py-1.5 px-2 text-right">₹{fmt(r.salaryCredit)}</td>
                    <td className="py-1.5 px-2 text-right whitespace-nowrap">{r.salaryDate}</td>
                    <td className="py-1.5 px-2 text-right">{r.totalChqBounces}</td>
                  </tr>
                ))}
                {finOne.length === 0 && <tr><td className="py-4 text-gray-400">No data.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="flex items-center gap-3">
        <Button loading={save.isPending} disabled={save.isPending} onClick={() => { setSaveState('idle'); save.mutate() }}>
          <Save size={14} className="mr-1.5" />Confirm &amp; Save
        </Button>
        <Button variant="secondary" onClick={onReset}><RotateCcw size={14} className="mr-1.5" />Analyze Another Statement</Button>
      </div>
      {saveState === 'success' && (
        <p className="text-sm text-green-600 flex items-center gap-1.5"><CheckCircle2 size={15} />Saved — this is now the loan's latest Perfios report.</p>
      )}
      {saveState === 'error' && (
        <p className="text-sm text-red-600 flex items-center gap-1.5"><XCircle size={15} />Could not save — your analysis results are unchanged, you can retry.</p>
      )}
    </div>
  )
}
