import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { reportsApi, type ActiveTimeRow, type ReportFilters } from '@/api/reportsApi'
import { useAuthStore } from '@/store/authStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner, PageLoader } from '@/components/ui/LoadingSpinner'
import { formatCurrency, STATUS_COLORS } from '@/utils/format'
import { TrendingUp, TrendingDown, BarChart3, Users, Award, Clock, Zap, Target, Check, AlertTriangle, Download } from 'lucide-react'
import { buildReportCsv, buildReportExcelHtml, buildReportPdfHtml, downloadBlob, openReportPdfPreview } from '@/utils/reportExport'
import ReportFilterBar, { EMPTY_REPORT_FILTERS, toReportFilters, type ReportFilterState } from '@/components/shared/ReportFilterBar'
import PageHeader from '@/components/shared/PageHeader'
import { loansApi } from '@/api/loansApi'
import type { LoanListItem } from '@/types'
import ReportAnalyticsTabs from '@/components/shared/ReportAnalyticsTabs'
import OfferPipelineReport from '@/components/shared/OfferPipelineReport'

export default function ReportsPage() {
  // Draft vs applied — legacy only re-renders on an explicit Apply (or on a
  // scope button, which applies immediately). Keeping the two separate stops
  // every keystroke in a date box from firing a request.
  const [draft, setDraft] = useState<ReportFilterState>(EMPTY_REPORT_FILTERS)
  const [applied, setApplied] = useState<ReportFilterState>(EMPTY_REPORT_FILTERS)
  const filters = toReportFilters(applied)
  const [showExportMenu, setShowExportMenu] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['reports', filters],
    queryFn: () => reportsApi.getSummary(filters)
      .then(r => r.data.data),
    staleTime: 120_000,
  })

  const scopeLabel = [
    applied.scope === 'mine' ? 'My Data' : applied.scope === 'team' ? 'My Team' : 'All',
    filters.from || filters.to ? `${filters.from || '…'} to ${filters.to || '…'}` : 'All Time',
    applied.status || null,
  ].filter(Boolean).join(' · ')

  // Row-level application data for export only — fetched on demand (not on
  // every render) via the existing GET /api/loans endpoint, scoped to the
  // same date range currently applied to the aggregate report above.
  // useMutation (rather than a plain async click handler) guards against a
  // duplicate fetch firing while one is already in flight.
  const fetchExportRows = useMutation({
    // Every loan in the range (was pageSize 5000, which the API clamps to 10).
    mutationFn: () => loansApi.getAllPages({
      dateFrom: filters.from || undefined,
      dateTo: filters.to || undefined,
    }),
  })

  // ── Export — matches legacy's toggleRptExportMenu/exportReportCSV/Excel/
  // PDF/Print exactly in technique (plain CSV, HTML-table-as-.xls, print-
  // styled HTML + window.print() for "PDF", scoped browser print for
  // "Print") — built from the same aggregate summary already loaded above,
  // since that's the only report data this page has (see reportExport.ts
  // doc comment for why legacy's per-application row columns aren't here).
  async function withExportRows(fn: (rows: LoanListItem[]) => void) {
    if (fetchExportRows.isPending) return // guard against duplicate export clicks
    const rows = await fetchExportRows.mutateAsync()
    fn(rows)
  }
  function handleExportCsv() {
    if (!data) return
    withExportRows(rows => {
      downloadBlob(buildReportCsv(data, scopeLabel, rows), `LoanMS_Report_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8;')
      setShowExportMenu(false)
    })
  }
  function handleExportExcel() {
    if (!data) return
    withExportRows(rows => {
      downloadBlob('\uFEFF' + buildReportExcelHtml(data, scopeLabel, rows), `LoanMS_Report_${new Date().toISOString().slice(0, 10)}.xls`, 'application/vnd.ms-excel;charset=utf-8')
      setShowExportMenu(false)
    })
  }
  function handleExportPdf() {
    if (!data) return
    withExportRows(rows => {
      const html = buildReportPdfHtml(data, scopeLabel, rows)
      const result = openReportPdfPreview(html)
      if (result === 'blocked') downloadBlob(html, `LoanMS_Report_${new Date().toISOString().slice(0, 10)}.html`, 'text/html;charset=utf-8')
      setShowExportMenu(false)
    })
  }
  function handlePrint() {
    setShowExportMenu(false)
    const style = document.createElement('style')
    style.id = 'reports-print-style'
    style.textContent = `@media print {
      body > *:not(#root) { display: none !important; }
      #root > *:not(#reports-print-area-portal) { display: none !important; }
      body * { visibility: hidden; }
      #reports-print-area, #reports-print-area * { visibility: visible; }
      #reports-print-area { position: absolute; left: 0; top: 0; width: 100%; }
    }`
    document.head.appendChild(style)
    const cleanup = () => { style.remove(); window.removeEventListener('afterprint', cleanup) }
    window.addEventListener('afterprint', cleanup)
    window.print()
  }

  const totalByStatus = data?.loansByStatus ?? []
  const totalByType   = data?.loansByType ?? []

  // Vanilla's Reports KPI row (efin-app.js renderReports) shows Total Disbursed
  // / Avg Loan Size / Conversion Rate / Rejection Rate. Two React parity fixes:
  //  1. "Total Portfolio" was a mislabel — the backend field `totalPortfolio`
  //     is actually stats.TotalDisb (disbursed amount, ReportsController:448),
  //     so the value was right but the label/sub said "portfolio / across all
  //     applications". Relabelled to "Total Disbursed" to match Vanilla + the
  //     real data.
  //  2. "Loan Types" (a React-only extra) replaced by Vanilla's Rejection Rate,
  //     computed here from loansByStatus (no backend change).
  const statusTotal    = totalByStatus.reduce((s, r) => s + (r.count || 0), 0)
  const rejectedCount  = totalByStatus.find(r => r.status === 'Rejected')?.count ?? 0
  const disbursedCount = totalByStatus.find(r => r.status === 'Disbursed')?.count ?? 0
  const rejectionRate  = statusTotal > 0 ? Math.round((rejectedCount / statusTotal) * 1000) / 10 : 0

  // TAT metrics from API (Real data)
  const tatLoginToDisbDays = data?.avgTatDays ?? 0
  const tatLoginToDisbTarget = data?.tatTarget ?? 7
  const tatLoginToDisbTrend = tatLoginToDisbDays > 0 ? Math.round((tatLoginToDisbTarget - tatLoginToDisbDays) * 100) / 100 : 0
  
  // DDR metrics from API (Real data)
  const loginToDdrRatio = (data?.ddrRatio ?? 0) / 100
  const loginToDdrTarget = (data?.ddrTarget ?? 95) / 100
  const loginToDdrTrend = (data?.ddrRatio ?? 0) - (data?.ddrTarget ?? 95)

  // TAT Status indicator — tokens (accent/tint), not raw Tailwind green/
  // orange/red. Those hues are the one part of the palette the app's
  // gray-remap (tailwind.config) deliberately leaves alone ("every non-
  // neutral hue"), so bg-green-50/text-green-700 etc. render as stock
  // Tailwind colors instead of legacy's --success/--warn/--danger — the
  // same class of gap DashboardPage's VARIANTS map (StatCard) already
  // fixed for its own green/orange/red KPI cards. Mirrored here so the
  // TAT/DDR cards use the identical accent+tint pairing instead of a
  // second, slightly-off palette.
  // `border` is a full literal Tailwind arbitrary-value class (not built
  // from string interpolation) so the JIT scanner picks it up — Card.tsx
  // takes className, not a style prop, and extending it isn't this task's
  // file scope.
  const getTatStatus = (actual: number, target: number) => {
    if (actual <= target) return { status: 'On Track', icon: <Check size={12} />, accent: 'var(--success)', tint: 'rgba(26, 115, 64, .1)', border: 'border-[rgba(26,115,64,.3)]' }
    if (actual <= target * 1.15) return { status: 'Slightly Delayed', icon: <Zap size={12} />, accent: 'var(--warn)', tint: 'rgba(230, 126, 0, .12)', border: 'border-[rgba(230,126,0,.3)]' }
    return { status: 'Delayed', icon: <AlertTriangle size={12} />, accent: 'var(--danger)', tint: 'rgba(227, 30, 37, .1)', border: 'border-[rgba(227,30,37,.3)]' }
  }

  const tatStatus = getTatStatus(tatLoginToDisbDays, tatLoginToDisbTarget)
  const ddrStatus = getTatStatus(1 - loginToDdrRatio, 1 - loginToDdrTarget)

  return (
    <div className="space-y-8">
      {/* Vanilla header — plain title + scope subtitle + Export menu
          (index.html:4391). No gradient hero / icon tile / chip. */}
      <PageHeader
        title="Reports & Analytics"
        subtitle={scopeLabel}
        action={(
          <div className="relative shrink-0">
            <Button size="sm" variant="secondary" disabled={!data || fetchExportRows.isPending} onClick={() => setShowExportMenu(v => !v)}>
              <Download size={14} className="mr-1.5" />{fetchExportRows.isPending ? 'Exporting…' : 'Export'}
            </Button>
            {showExportMenu && (
              <div className="absolute right-0 top-9 w-40 rounded-lg z-20 py-1" style={{ background: 'var(--surface)', border: '1.5px solid var(--border)', boxShadow: 'var(--shadow-md)' }}>
                {[
                  { label: 'CSV', onClick: handleExportCsv },
                  { label: 'Excel', onClick: handleExportExcel },
                  { label: 'PDF', onClick: handleExportPdf },
                  { label: 'Print', onClick: handlePrint },
                ].map(({ label, onClick }) => (
                  <button key={label} onClick={onClick} className="w-full text-left px-3 py-1.5 text-sm transition-colors"
                    style={{ color: 'var(--text2)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      />

      {/* Vanilla renders the report filters inline (no premium surface box)
          — plain wrapper. */}
      <div>
        <ReportFilterBar
          value={draft}
          onChange={next => {
            setDraft(next)
            // Scope buttons and the dropdowns act immediately, like legacy;
            // only the date/month boxes wait for Apply.
            if (next.scope !== draft.scope || next.userId !== draft.userId
                || next.teamId !== draft.teamId || next.status !== draft.status) {
              setApplied(next)
            }
          }}
          onApply={() => setApplied(draft)}
        />
      </div>

      <div id="reports-print-area">

      {isLoading ? <PageLoader /> : (
        <>
          {/* Summary KPI cards — minimal: thin border, small flat icon tile,
              no gradient blob / animated top bar. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5 lms-stagger">
            {[
              { label: 'Total Disbursed', value: formatCurrency(data?.totalPortfolio), sub: `${disbursedCount} disbursed of ${statusTotal} applications`, icon: TrendingUp, accent: 'var(--accent)', tint: 'var(--accent-subtle)' },
              { label: 'Avg Loan Size', value: formatCurrency(data?.averageLoanAmount), sub: 'Mean ticket size', icon: BarChart3, accent: '#7c3aed', tint: 'rgba(124,58,237,.1)' },
              { label: 'Conversion Rate', value: `${data?.conversionRate ?? 0}%`, sub: 'Applications disbursed', icon: Award, accent: 'var(--success)', tint: 'rgba(26,115,64,.1)' },
              { label: 'Rejection Rate', value: `${rejectionRate}%`, sub: `${rejectedCount} rejected of ${statusTotal}`, icon: TrendingDown, accent: 'var(--accent2)', tint: 'rgba(227,30,37,.1)' },
            ].map(({ label, value, sub, icon: Icon, accent, tint }) => (
              <div key={label} className="rp-kpi-card" style={{ ['--rp-accent' as string]: accent, ['--rp-tint' as string]: tint }}>
                <div className="rp-kpi-icon">
                  <Icon size={18} strokeWidth={2} />
                </div>
                <p className="text-[11px] font-semibold uppercase" style={{ letterSpacing: '.6px', color: 'var(--text3)' }}>{label}</p>
                <p className="text-[26px] font-bold leading-tight mt-2" style={{ fontFamily: 'var(--font-head)', letterSpacing: '-.5px', color: 'var(--text)' }}>{value}</p>
                <p className="text-xs mt-2" style={{ color: 'var(--text3)' }}>{sub}</p>
              </div>
            ))}
          </div>

          {/* TAT & Process Efficiency Metrics — plain thin border, status
              carried by the small pill only (no colored card edge). */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-8">
            {/* AVG TAT (Login→Disb) */}
            <div className="rp-metric-card">
              <div className="flex items-start justify-between mb-6">
                <p className="text-xs font-semibold uppercase flex items-center gap-2" style={{ letterSpacing: '.4px', color: 'var(--text3)' }}>
                  <Clock size={15} /> Avg TAT (Login→Disb)
                </p>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1"
                  style={{ color: tatStatus.accent, background: tatStatus.tint }}>
                  {tatStatus.icon} {tatStatus.status}
                </span>
              </div>

              <div className="mb-6">
                {tatLoginToDisbDays > 0 ? (
                  <>
                    <p className="text-3xl font-bold" style={{ color: 'var(--text)' }}>{tatLoginToDisbDays.toFixed(1)}</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>days ({data?.disbursedLoans ?? 0} disbursed)</p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-bold" style={{ color: 'var(--border2)' }}>No Data</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>No disbursed loans in period</p>
                  </>
                )}
              </div>

              <div className="space-y-2 mb-5">
                <div className="flex items-center justify-between text-xs">
                  <span style={{ color: 'var(--text3)' }}>Target</span>
                  <span className="font-semibold" style={{ color: 'var(--text)' }}>{tatLoginToDisbTarget} days</span>
                </div>
                {tatLoginToDisbDays > 0 && (
                  <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface2)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, (tatLoginToDisbDays / tatLoginToDisbTarget) * 100)}%`, background: tatStatus.accent }} />
                  </div>
                )}
              </div>

              {tatLoginToDisbDays > 0 && (
                <div className="flex items-center justify-between pt-4 border-t mb-5" style={{ borderColor: 'var(--border)' }}>
                  <span className="text-xs" style={{ color: 'var(--text3)' }}>Trend</span>
                  <span className="text-sm font-semibold" style={{ color: tatLoginToDisbTrend > 0 ? 'var(--danger)' : 'var(--success)' }}>
                    {tatLoginToDisbTrend > 0 ? '↑' : '↓'} {Math.abs(tatLoginToDisbTrend).toFixed(2)} days
                  </span>
                </div>
              )}

              <div className="text-xs leading-relaxed" style={{ color: 'var(--text3)' }}>
                <span className="font-semibold" style={{ color: 'var(--text2)' }}>Benchmark. </span>
                Industry avg is 10 days. {tatLoginToDisbDays > 0 && tatLoginToDisbDays <= 10 ? 'Your performance is excellent!' : 'Room for improvement.'}
              </div>
            </div>

            {/* LOGIN-TO-DDR RATIO */}
            <div className="rp-metric-card">
              <div className="flex items-start justify-between mb-6">
                <p className="text-xs font-semibold uppercase flex items-center gap-2" style={{ letterSpacing: '.4px', color: 'var(--text3)' }}>
                  <Zap size={15} /> Login-to-DDR Ratio
                </p>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1"
                  style={{ color: ddrStatus.accent, background: ddrStatus.tint }}>
                  {ddrStatus.icon} {ddrStatus.status}
                </span>
              </div>

              <div className="mb-6">
                {data?.disbursedLoans && data.disbursedLoans > 0 ? (
                  <>
                    <p className="text-3xl font-bold" style={{ color: 'var(--text)' }}>{(loginToDdrRatio * 100).toFixed(1)}%</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>Applications with DDR</p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-bold" style={{ color: 'var(--border2)' }}>No Data</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>No completed loans to analyze</p>
                  </>
                )}
              </div>

              <div className="space-y-2 mb-5">
                <div className="flex items-center justify-between text-xs">
                  <span style={{ color: 'var(--text3)' }}>Target</span>
                  <span className="font-semibold" style={{ color: 'var(--text)' }}>{(loginToDdrTarget * 100).toFixed(0)}%</span>
                </div>
                {data?.disbursedLoans && data.disbursedLoans > 0 && (
                  <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface2)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, loginToDdrRatio * 100)}%`, background: ddrStatus.accent }} />
                  </div>
                )}
              </div>

              {data?.disbursedLoans && data.disbursedLoans > 0 && (
                <div className="flex items-center justify-between pt-4 border-t mb-5" style={{ borderColor: 'var(--border)' }}>
                  <span className="text-xs" style={{ color: 'var(--text3)' }}>Trend</span>
                  <span className="text-sm font-semibold" style={{ color: loginToDdrTrend > 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {loginToDdrTrend > 0 ? '↑' : '↓'} {Math.abs(loginToDdrTrend).toFixed(2)}%
                  </span>
                </div>
              )}

              <div className="text-xs leading-relaxed" style={{ color: 'var(--text3)' }}>
                <span className="font-semibold" style={{ color: 'var(--text2)' }}>Status. </span>
                {data?.disbursedLoans && data.disbursedLoans > 0
                  ? `${((1 - loginToDdrRatio) * 100).toFixed(1)}% applications may lack DDR`
                  : 'Waiting for completed loan data'}
              </div>
            </div>

            {/* STAGE TAT BREAKDOWN - Only show if we have TAT data */}
            {tatLoginToDisbDays > 0 && (
            <div className="rp-metric-card">
              <p className="text-xs font-semibold uppercase flex items-center gap-2 mb-6" style={{ letterSpacing: '.4px', color: 'var(--text3)' }}>
                <Target size={15} /> Stage TAT Breakdown
              </p>

              <div className="space-y-4">
                {[
                  { stage: 'Login→UW', days: Math.round(tatLoginToDisbDays * 0.1 * 10) / 10, color: 'var(--accent)' },
                  { stage: 'UW→Disb', days: Math.round(tatLoginToDisbDays * 0.9 * 10) / 10, color: '#7c3aed' },
                  { stage: 'Total TAT', days: tatLoginToDisbDays, color: 'var(--success)', isBold: true },
                ].map(({ stage, days, color, isBold }) => (
                  <div key={stage} className={isBold ? 'pt-3 border-t' : ''} style={isBold ? { borderColor: 'var(--border)' } : undefined}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold" style={{ color: isBold ? 'var(--text)' : 'var(--text2)' }}>{stage}</span>
                      <span className={`font-bold ${isBold ? 'text-base' : 'text-sm'}`} style={{ color: 'var(--text)' }}>{days.toFixed(1)} days</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface2)' }}>
                      <div className="h-full rounded-full" style={{ width: `${(days / tatLoginToDisbDays) * 100}%`, background: color }} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="text-xs leading-relaxed mt-6" style={{ color: 'var(--text3)' }}>
                <span className="font-semibold" style={{ color: 'var(--text2)' }}>Insight. </span>
                UW stage takes ~90% of time. Consider process optimization.
              </div>
            </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-8">
            {/* By Status — meter bars */}
            <div className="rp-card">
              <div className="rp-card-head">
                <span className="rp-card-icon" style={{ color: 'var(--accent)' }}><BarChart3 size={15} /></span>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Loans by Status</h3>
              </div>
              <div className="rp-card-body space-y-4">
                {totalByStatus.map(s => {
                  const total = totalByStatus.reduce((a, b) => a + b.count, 0)
                  const pct = total ? Math.round((s.count / total) * 100) : 0
                  // Each status gets its own hue (same palette Badge.tsx and
                  // the Applications table already use), instead of every
                  // bar being the same flat accent blue — makes the mix of
                  // statuses readable at a glance rather than just the counts.
                  const statusColor = STATUS_COLORS[s.status]?.color ?? 'var(--accent)'
                  return (
                    <div key={s.status} className="flex items-center gap-3">
                      <span className="flex items-center gap-2 text-sm w-28 shrink-0" style={{ color: 'var(--text2)' }}>
                        <span className="inline-block rounded-full shrink-0" style={{ width: 7, height: 7, background: statusColor }} />
                        {s.status}
                      </span>
                      <div className="flex-1 meter-track">
                        <div className="meter-fill" style={{ width: `${pct}%`, ['--meter-accent' as string]: statusColor }} />
                      </div>
                      <span className="text-sm font-bold w-8 text-right" style={{ color: 'var(--text)' }}>{s.count}</span>
                    </div>
                  )
                })}
                {totalByStatus.length === 0 && <p className="text-sm" style={{ color: 'var(--text3)' }}>No data available</p>}
              </div>
            </div>

            {/* By Type */}
            <div className="rp-card">
              <div className="rp-card-head">
                <span className="rp-card-icon" style={{ color: '#7c3aed' }}><Users size={15} /></span>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Loans by Type</h3>
              </div>
              <div className="rp-card-body space-y-1">
                {totalByType.map(t => (
                  <div key={t.loanType} className="flex items-center justify-between py-2 px-1 border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                    <span className="text-sm font-medium" style={{ color: 'var(--text2)' }}>{t.loanType}</span>
                    <div className="text-right">
                      <p className="font-bold text-sm" style={{ color: 'var(--text)' }}>{formatCurrency(t.totalAmount)}</p>
                      <p className="text-xs" style={{ color: 'var(--text3)' }}>{t.count} loans</p>
                    </div>
                  </div>
                ))}
                {totalByType.length === 0 && <p className="text-sm" style={{ color: 'var(--text3)' }}>No data available</p>}
              </div>
            </div>

            {/* Top Agents — ranked medallion list */}
            <div className="rp-card">
              <div className="rp-card-head">
                <span className="rp-card-icon" style={{ color: 'var(--warn)' }}><Award size={15} /></span>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Top Agents</h3>
              </div>
              <div className="rp-card-body" style={{ paddingTop: 0, paddingBottom: 0 }}>
                {/* Vanilla's agent leaderboard is a plain table (index.html:
                    #rpt-leaderboard-table) — rank number, name, loans, amount;
                    no medallion decoration. */}
                {data?.topAgents?.length ? (
                  <div className="v-table-wrap">
                    <table className="v-table">
                      <thead><tr><th>#</th><th>Agent</th><th style={{ textAlign: 'right' }}>Loans</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                      <tbody>
                        {data.topAgents.slice(0, 10).map((a, i) => (
                          <tr key={a.agentName}>
                            <td style={{ color: 'var(--text3)', fontWeight: 700 }}>{i + 1}</td>
                            <td><span style={{ color: 'var(--text)', fontWeight: 600 }}>{a.agentName}</span></td>
                            <td style={{ textAlign: 'right' }}>{a.loanCount}</td>
                            <td style={{ textAlign: 'right', color: 'var(--text)', fontWeight: 700 }}>{formatCurrency(a.totalAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="text-sm py-4" style={{ color: 'var(--text3)' }}>No data available</p>}
              </div>
            </div>

            {/* Monthly disbursements */}
            <div className="rp-card">
              <div className="rp-card-head">
                <span className="rp-card-icon" style={{ color: 'var(--success)' }}><TrendingUp size={15} /></span>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Monthly Disbursements</h3>
              </div>
              <div className="rp-card-body space-y-1">
                {(data?.monthlyDisbursements ?? []).slice(-6).reverse().map(m => (
                  <div key={m.month} className="flex items-center justify-between py-2 px-1 border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                    <span className="text-sm font-medium" style={{ color: 'var(--text2)' }}>{m.month}</span>
                    <div className="text-right">
                      <p className="font-bold text-sm" style={{ color: 'var(--text)' }}>{formatCurrency(m.amount)}</p>
                      <p className="text-xs" style={{ color: 'var(--text3)' }}>{m.count} loans</p>
                    </div>
                  </div>
                ))}
                {!data?.monthlyDisbursements?.length && <p className="text-sm" style={{ color: 'var(--text3)' }}>No data available</p>}
              </div>
            </div>
          </div>

          {/* Analytics tabs — pipeline / agent performance / monthly trend /
              disbursement register / rejection analysis / targets. Each hits
              a ReportsController endpoint that already existed but had no
              React caller (only /summary was ever used). */}
          <ReportAnalyticsTabs filters={filters} />

          {/* Offer → deviation → credit approval → sanction → disbursement
              register (GET /api/reports/offer-pipeline, scoped + masked server-side). */}
          <OfferPipelineReport />

          {/* Monthly Target achievement (Disb. Amount / Login Count / Disb.
              Count) — Vanilla's "Monthly Targets & Achievements" cards
              (efin-app.js renderReports, ~13290-13323). Not part of the
              Active Time leaderboard below — traced separately, see
              TargetAchievement's doc comment server-side. */}
          <MonthlyTargetAchievement filters={filters} />

          {/* Active Time aggregation (by user / team) — Vanilla's
              renderActiveTimeAgg() leaderboard (efin-app.js:12399). */}
          <ActiveTimeAgg filters={filters} />
        </>
      )}
      </div>
    </div>
  )
}

// ── Monthly Target achievement ──────────────────────────────────────────────
// Parity with Vanilla's "Monthly Targets & Achievements" cards (efin-app.js
// renderReports, ~13290-13323: Disbursed Amount / Login Count / Disbursed
// Count, each shown as achieved-vs-target with a progress bar). Always the
// current calendar month — Vanilla builds this from `now`, not the Reports
// page's date-range filter, so only the scope/userId/teamId part of
// `filters` is forwarded (see reportsApi.getTargetAchievement).
//
// "Login Count" here = applications created this month that have moved past
// the initial Draft/Personal-Details stage (current status ≠ Draft) — a
// snapshot of current status, NOT a count of literal login/session events.
// Vanilla's own source comment on the sibling `logins` variable it reuses
// (efin-app.js ~13092-13096) explains why: the old 'EFIN-Login' tracking-entry
// lookup never matched anything, since no such tracking entry is ever
// created, so it was replaced with this current-status check.
function MonthlyTargetAchievement({ filters }: { filters: ReportFilters }) {
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'target-achievement', filters.scope, filters.userId, filters.teamId],
    queryFn: () => reportsApi.getTargetAchievement(filters).then(r => r.data.data),
    staleTime: 120_000,
  })
  if (isLoading || !data) return null

  const monthLabelText = (() => {
    const [y, mo] = data.month.split('-').map(Number)
    if (!y || !mo) return data.month
    return new Date(y, mo - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  })()

  const cards = [
    { label: 'Disbursed Amount', ach: data.achDisbAmt, tgt: data.tgtDisbAmt, fmt: formatCurrency },
    { label: 'Login Count', ach: data.achLoginCnt, tgt: data.tgtLoginCnt, fmt: (v: number) => String(v) },
    { label: 'Disbursed Count', ach: data.achDisbCnt, tgt: data.tgtDisbCnt, fmt: (v: number) => String(v) },
  ]

  return (
    <Card className="mt-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Target size={16} style={{ color: 'var(--accent)' }} />
          <h3 className="text-sm font-bold" style={{ color: 'var(--text)' }}>Monthly Targets & Achievements</h3>
        </div>
        <span className="text-xs" style={{ color: 'var(--text3)' }}>{monthLabelText}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map(({ label, ach, tgt, fmt }) => {
          const pct = tgt > 0 ? Math.min(100, Math.round((ach / tgt) * 100)) : 0
          const color = pct >= 100 ? 'var(--success)' : pct >= 70 ? 'var(--warn)' : 'var(--accent2)'
          return (
            <div key={label} className="rounded-xl border p-3.5" style={{ background: 'var(--surface2)', borderColor: 'var(--border)' }}>
              <div className="text-[11px] font-bold uppercase mb-2" style={{ color: 'var(--text3)', letterSpacing: '.5px' }}>{label}</div>
              <div className="flex justify-between items-baseline mb-2">
                <span className="font-black text-lg" style={{ fontFamily: 'var(--font-head)', color }}>{fmt(ach)}</span>
                <span className="text-[11px]" style={{ color: 'var(--text3)' }}>/ {fmt(tgt)}</span>
              </div>
              <div className="rounded-full h-2 overflow-hidden" style={{ background: 'var(--surface3)' }}>
                <div className="h-full rounded-full" style={{ background: color, width: `${pct}%`, transition: 'width .6s' }} />
              </div>
              <div className="text-[11px] font-bold mt-1" style={{ color }}>{pct}% achieved</div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ── Active Time aggregation (by user / team) ────────────────────────────────
// Parity with Vanilla's renderActiveTimeAgg() (efin-app.js:12399): a ranked
// leaderboard of apps / disbursed / avg + total active time per user or team,
// with a User↔Group toggle and a TOTAL row. Admin/Manager only (matches the
// GET /api/reports/active-time [Authorize]).
function fmtHours(h: number): string {
  const v = Math.max(0, Number(h) || 0)
  if (v < 1) return `${Math.round(v * 60)} min`
  const d = Math.floor(v / 24), r = Math.round(v % 24)
  return `${v.toFixed(2)} Hours${d > 0 ? ` (${d}d ${r}h)` : ''}`
}

function ActiveTimeAgg({ filters }: { filters: ReportFilters }) {
  const role = useAuthStore(s => s.user?.role)
  const [mode, setMode] = useState<'user' | 'group'>('user')
  const canView = role === 'Admin' || role === 'Manager'
  const { data: rows, isLoading } = useQuery({
    queryKey: ['reports', 'active-time', filters, mode],
    queryFn: () => reportsApi.getActiveTime(filters, mode).then(r => r.data.data ?? [] as ActiveTimeRow[]),
    enabled: canView,
    staleTime: 120_000,
  })
  if (!canView) return null

  const list = rows ?? []
  const grand = list.reduce((a, r) => ({
    count: a.count + r.count, disbursed: a.disbursed + r.disbursed, hours: a.hours + r.totalHours,
  }), { count: 0, disbursed: 0, hours: 0 })
  const grandAvg = grand.count ? grand.hours / grand.count : 0
  const maxH = Math.max(1, ...list.map(r => r.totalHours))
  const medal = (i: number) => (i < 3 ? ['🥇', '🥈', '🥉'][i] : `#${i + 1}`)

  return (
    <Card className="mt-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Clock size={16} style={{ color: 'var(--accent)' }} />
          <h3 className="text-sm font-bold" style={{ color: 'var(--text)' }}>Active Time Leaderboard</h3>
        </div>
        <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: 'var(--surface2)' }}>
          {(['user', 'group'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className="px-3 py-1 rounded-md text-xs font-semibold transition-colors"
              style={mode === m ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text3)' }}>
              {m === 'user' ? 'By User' : 'By Team'}
            </button>
          ))}
        </div>
      </div>
      {isLoading ? <LoadingSpinner /> : list.length === 0 ? (
        <p className="text-sm text-center py-6" style={{ color: 'var(--text3)' }}>No active-time data for current scope</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                {['#', mode === 'group' ? 'Group / Team' : 'User', 'Apps', 'Disbursed', 'Avg Active Time', 'Longest', 'Total Active Time'].map((h, i) => (
                  <th key={h} className="py-2 px-2 text-[11px] font-semibold uppercase" style={{ color: 'var(--text3)', textAlign: i <= 1 ? 'left' : i >= 6 ? 'right' : 'center' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => (
                <tr key={r.name} className="border-b" style={{ borderColor: 'var(--border)' }}>
                  <td className="py-2 px-2 font-bold">{medal(i)}</td>
                  <td className="py-2 px-2 font-semibold" style={{ color: 'var(--text)' }}>{r.name}</td>
                  <td className="py-2 px-2 text-center">{r.count}</td>
                  <td className="py-2 px-2 text-center font-bold" style={{ color: 'var(--success)' }}>{r.disbursed}</td>
                  <td className="py-2 px-2 text-center" style={{ color: 'var(--accent)' }}>{fmtHours(r.avgHours)}</td>
                  <td className="py-2 px-2 text-center" style={{ color: 'var(--text3)' }}>{fmtHours(r.longestHours)}</td>
                  <td className="py-2 px-2 text-right">
                    <div className="font-bold" style={{ color: 'var(--accent)' }}>{fmtHours(r.totalHours)}</div>
                    <div className="rounded-full h-1 mt-1 overflow-hidden" style={{ background: 'var(--surface2)' }}>
                      <div className="h-full rounded-full" style={{ background: 'var(--accent-light)', width: `${Math.round(r.totalHours / maxH * 100)}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--accent)', background: 'var(--surface2)' }}>
                <td className="py-2 px-2" />
                <td className="py-2 px-2 font-extrabold">TOTAL ({list.length} {mode === 'group' ? 'groups' : 'users'})</td>
                <td className="py-2 px-2 text-center font-extrabold">{grand.count}</td>
                <td className="py-2 px-2 text-center font-extrabold" style={{ color: 'var(--success)' }}>{grand.disbursed}</td>
                <td className="py-2 px-2 text-center font-extrabold" style={{ color: 'var(--accent)' }}>{fmtHours(grandAvg)}</td>
                <td className="py-2 px-2" />
                <td className="py-2 px-2 text-right font-extrabold" style={{ color: 'var(--accent)' }}>{fmtHours(grand.hours)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
