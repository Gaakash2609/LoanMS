import { useEffect, useMemo, useState } from 'react'
import { SubTabBar } from '@/components/ui/SubTabBar'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { CheckCircle2, XCircle, AlertTriangle, Info, RotateCcw, Save, ScanLine } from 'lucide-react'
import type { PerfiosUploadResult } from '@/hooks/usePerfiosUpload'
import { buildFullAnalysis } from '@/utils/perfios/orchestrate'
import { fmt, fmtDate } from '@/utils/perfios/analysis'
import type { ValidationCheck } from '@/utils/perfios/types'
import { perfiosApi, type PerfiosReportSaveRequest } from '@/api/perfiosApi'
import { serializePerfiosReport } from '@/utils/perfios/persist'
import { applyTargetDateFilter } from '@/utils/perfios/calculations'
import {
  TxnTable, TargetDateTable, AccountsPanel, ValidationPanel,
  EXTRA_CATEGORY, EXTRA_SALARY, EXTRA_ACH, EXTRA_ECS, EXTRA_NEFT,
  EXTRA_UPI, EXTRA_CHEQUE, EXTRA_BOUNCE,
} from '@/components/shared/PerfiosTxnPanels'

const CHECK_ICON: Record<ValidationCheck['status'], typeof CheckCircle2> = {
  pass: CheckCircle2, warn: AlertTriangle, fail: XCircle,
}

// Legacy's #pfr-tabs set, in legacy's order (index.html).
type Tab =
  | 'txn' | 'abb' | 'target' | 'salary' | 'ach' | 'ecs' | 'neft' | 'upi'
  | 'cheque' | 'bounce' | 'finone' | 'analysis' | 'breakup' | 'eod'
  | 'accounts' | 'validation'

// ── Perfios analysis results (read-only) ────────────────────────────────
// Consumes Phase 2's PerfiosUploadResult and orchestrates the four
// remaining Phase 1 dataset builders (FinOne/Analysis/Breakup/EOD) via
// buildFullAnalysis — no calculation lives in this component. Everything
// displayed is exactly what buildValidationChecks/buildFinOneData/
// buildAnalysisData/buildBreakupData/buildEODData/buildABBFromTargetRows
// already produced. Stays in React memory only — no localStorage/
// sessionStorage/backend save/postMessage/iframe. Save-to-backend is
// Phase 4, not here.
// `readOnly` renders the SAME full report from a persisted/reloaded run
// (Reports > Perfios Report after a refresh) without the Confirm & Save /
// Analyze-Another footer — that report is already saved. The live-run path
// (PerfiosWorkflow) leaves readOnly false so the save/reset actions show.
export default function PerfiosAnalysisResults({ result, onReset, loanId, readOnly = false }: { result: PerfiosUploadResult; onReset: () => void; loanId: number; readOnly?: boolean }) {
  const full = useMemo(() => buildFullAnalysis(result), [result])
  const [tab, setTab] = useState<Tab>('txn')
  const qc = useQueryClient()

  const { upload, finOne, analysis, breakup, eod } = full
  const monthOrder = upload.monthOrder
  const monthLabels = monthOrder.map(mk => upload.abbData[mk]?.label ?? mk)

  // Validation pass/warn/fail counts — the same breakdown Vanilla's
  // renderPerfiosReport shows as badges (#pfr-validation-badge). Vanilla has
  // NO derived "health score" ring or progress meter, so neither does this
  // (removed to match Vanilla exactly — no React-only metric with no legacy
  // equivalent).
  const passCount = upload.validChecks.filter(c => c.status === 'pass').length
  const warnCount = upload.validChecks.filter(c => c.status === 'warn').length
  const failCount = upload.validChecks.filter(c => c.status === 'fail').length

  // ABB and Target Dates both render the target-date grid. The rows are not
  // part of PerfiosUploadResult, so they are recomputed here with the very
  // same pure function usePerfiosUpload calls (applyTargetDateFilter) —
  // no second implementation of the rule.
  const targetRows = useMemo(() => applyTargetDateFilter(upload.allTxns), [upload.allTxns])

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
        // Full report payload — this is what makes the ENTIRE report (all
        // transactions + ABB/FinOne/Analysis/Breakup/EOD source + validation
        // + account header) reload from the backend later, not just the
        // summary above.
        reportDataJson: serializePerfiosReport(upload),
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
    <div className="space-y-6 lms-reveal">
      {/* A. Summary — validation-count badges (Vanilla's #pfr-validation-badge)
          + summary stat tiles (Vanilla's #pfr-summary-cards). No health-score
          ring / progress meter: Vanilla has no equivalent. */}
      <div className="perfios-shell">
        <div className="perfios-shell-head">
          <div className="perfios-shell-icon"><ScanLine size={24} strokeWidth={2.25} /></div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-black leading-tight" style={{ fontFamily: 'var(--font-head)', color: 'var(--text)', letterSpacing: '-.3px' }}>Perfios Summary</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>{upload.perFileData.map(f => f.fileName).join(', ') || '—'}</p>
          </div>
          <span className="text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1.5 shrink-0"
            style={{ color: upload.valid ? 'var(--success)' : 'var(--warn)', background: upload.valid ? 'rgba(26,115,64,.1)' : 'rgba(230,126,0,.12)' }}>
            {upload.valid ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
            {upload.valid ? 'Valid' : 'Needs Review'}{upload.manualReviewRequired ? ' · Manual Review' : ''}
          </span>
        </div>

        <div className="p-5">
          <div className="mb-5">
            <p className="text-[11px] font-bold uppercase mb-2" style={{ letterSpacing: '1px', color: 'var(--text3)' }}>Validation Breakdown</p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="info-pill" style={{ ['--pill-fg' as string]: 'var(--success)', ['--pill-bg' as string]: 'rgba(26,115,64,.1)' }}><CheckCircle2 size={12} /> {passCount} passed</span>
              <span className="info-pill" style={{ ['--pill-fg' as string]: 'var(--warn)', ['--pill-bg' as string]: 'rgba(230,126,0,.12)' }}><AlertTriangle size={12} /> {warnCount} warnings</span>
              <span className="info-pill" style={{ ['--pill-fg' as string]: 'var(--danger)', ['--pill-bg' as string]: 'rgba(227,30,37,.1)' }}><XCircle size={12} /> {failCount} failed</span>
            </div>
            {!upload.valid && <p className="text-xs mt-2" style={{ color: 'var(--warn)' }}>Span or staleness rule did not pass — see Validation Checks below.</p>}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Txns (90d)', value: String(upload.totalTxns), accent: 'var(--accent)' },
              { label: 'Span', value: `${upload.span} days`, accent: '#7c3aed' },
              { label: 'Avg Bank Balance', value: `₹${fmt(upload.abb)}`, accent: 'var(--success)' },
              { label: 'Stale Days', value: String(upload.staledays), accent: 'var(--warn)' },
              { label: 'First Transaction', value: fmtDate(upload.firstDate), accent: 'var(--accent)' },
              { label: 'Last Transaction', value: fmtDate(upload.lastDate), accent: 'var(--accent)' },
              { label: 'Salary Detected', value: upload.hasSalary ? 'Yes' : 'No', accent: upload.hasSalary ? 'var(--success)' : 'var(--danger)' },
              { label: 'Manual Review', value: upload.manualReviewRequired ? 'Yes' : 'No', accent: upload.manualReviewRequired ? 'var(--warn)' : 'var(--success)' },
            ].map(s => (
              <div key={s.label} className="perfios-stat" style={{ ['--stat-accent' as string]: s.accent }}>
                <p className="text-[10.5px] font-semibold uppercase" style={{ letterSpacing: '.5px', color: 'var(--text3)' }}>{s.label}</p>
                <p className="text-[15px] font-bold mt-1 truncate" style={{ color: 'var(--text)' }}>{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* B. Validation Checks */}
      <Card>
        <CardHeader title="Validation Checks" subtitle={`${upload.validChecks.length} checks from the Perfios rule engine`} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {upload.validChecks.map(c => {
            const Icon = CHECK_ICON[c.status]
            const accent = c.status === 'pass' ? 'var(--success)' : c.status === 'warn' ? 'var(--warn)' : 'var(--danger)'
            return (
              <div key={c.id} className="check-card" style={{ ['--check-accent' as string]: accent }}>
                <Icon size={16} className="shrink-0 mt-0.5" style={{ color: accent }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{c.title}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>{c.detail}</p>
                </div>
                <span className="text-xs font-bold shrink-0 whitespace-nowrap" style={{ color: accent }}>{c.value}</span>
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
        <SubTabBar
          className="mb-4"
          tabs={[
            { key: 'txn', label: 'Transactions' },
            { key: 'abb', label: 'ABB / Perfios' },
            { key: 'target', label: 'Target Dates' },
            { key: 'salary', label: 'Salary' },
            { key: 'ach', label: 'ACH' },
            { key: 'ecs', label: 'ECS' },
            { key: 'neft', label: 'NEFT/RTGS' },
            { key: 'upi', label: 'UPI/IMPS' },
            { key: 'cheque', label: 'Cheque/CTS' },
            { key: 'bounce', label: 'Bounces' },
            { key: 'finone', label: 'FinOne' },
            { key: 'analysis', label: 'Analysis' },
            { key: 'breakup', label: 'Breakup' },
            { key: 'eod', label: 'EOD Balances' },
            { key: 'accounts', label: 'Accounts' },
            { key: 'validation', label: 'Validation' },
          ] as { key: Tab; label: string }[]}
          active={tab}
          onChange={setTab}
        />

        {tab === 'txn'        && <TxnTable rows={upload.allTxns}     extra={EXTRA_CATEGORY} emptyLabel="transactions" />}
        {tab === 'salary'     && <TxnTable rows={upload.salaryTxns}  extra={EXTRA_SALARY}   emptyLabel="salary credits" />}
        {tab === 'ach'        && <TxnTable rows={upload.achTxns}     extra={EXTRA_ACH}      emptyLabel="ACH transactions" />}
        {tab === 'ecs'        && <TxnTable rows={upload.ecsTxns}     extra={EXTRA_ECS}      emptyLabel="ECS transactions" />}
        {tab === 'neft'       && <TxnTable rows={upload.neftTxns}    extra={EXTRA_NEFT}     emptyLabel="NEFT/RTGS transactions" />}
        {tab === 'upi'        && <TxnTable rows={upload.upiTxns}     extra={EXTRA_UPI}      emptyLabel="UPI/IMPS transactions" />}
        {tab === 'cheque'     && <TxnTable rows={upload.chequeTxns}  extra={EXTRA_CHEQUE}   emptyLabel="cheque/CTS transactions" />}
        {tab === 'bounce'     && <TxnTable rows={upload.bounceTxns}  extra={EXTRA_BOUNCE}   emptyLabel="bounces" />}
        {(tab === 'abb' || tab === 'target') && <TargetDateTable rows={targetRows} />}
        {tab === 'accounts'   && <AccountsPanel info={upload.accountInfo} />}
        {tab === 'validation' && <ValidationPanel checks={upload.validChecks} />}

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

      {!readOnly && (
        <>
          <div className="flex items-center gap-3">
            <Button loading={save.isPending} disabled={save.isPending} onClick={() => { setSaveState('idle'); save.mutate() }}>
              <Save size={14} className="mr-1.5" />Confirm &amp; Save
            </Button>
            <Button variant="secondary" onClick={onReset}><RotateCcw size={14} className="mr-1.5" />Analyze Another Statement</Button>
          </div>
          {saveState === 'success' && (
            <p className="text-sm flex items-center gap-1.5" style={{ color: 'var(--success)' }}><CheckCircle2 size={15} />Saved — this is now the loan's latest Perfios report.</p>
          )}
          {saveState === 'error' && (
            <p className="text-sm flex items-center gap-1.5" style={{ color: 'var(--danger)' }}><XCircle size={15} />Could not save — your analysis results are unchanged, you can retry.</p>
          )}
        </>
      )}
    </div>
  )
}
