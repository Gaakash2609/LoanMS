import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Tabs } from '@/components/ui/Tabs'
import { SkeletonText } from '@/components/ui/Skeleton'
import { formatCurrency, formatDate } from '@/utils/format'
import MonthlyTargetsEditor from '@/components/shared/MonthlyTargetsEditor'
import { reportsApi, type PerformanceRow, type ReportFilters } from '@/api/reportsApi'
import { useAuthStore } from '@/store/authStore'
import { NumberInput } from '@/components/ui/NumberInput'

// ── Reports → analytics tabs ───────────────────────────────────────────
// ReportsPage only ever called GET /api/reports/summary. These five tabs
// call the endpoints that already existed on ReportsController but had no
// React caller: /pipeline, /performance, /disbursement, /rejection,
// /monthly, plus the /targets read+write pair.
//
// Each endpoint applies the same ApplyVisibilityScope rule the loans list
// uses, so a Manager sees their own scope here without any extra
// client-side filtering — which is why there is no "Mine/Team/All" scope
// toggle: the server already decides that.

type Tab = 'pipeline' | 'performance' | 'monthly' | 'disbursement' | 'rejection' | 'targets'

const TABS: { key: Tab; label: string; adminOnly?: boolean }[] = [
  { key: 'pipeline',     label: 'Pipeline' },
  { key: 'performance',  label: 'Agent Performance' },
  { key: 'monthly',      label: 'Monthly Trend' },
  { key: 'disbursement', label: 'Disbursement Register' },
  { key: 'rejection',    label: 'Rejection Analysis' },
  { key: 'targets',      label: 'Targets' },
]

const STATUS_ORDER = ['Draft', 'Submitted', 'UnderReview', 'Approved', 'Disbursed', 'Rejected', 'Closed']

function Bar({ value, max, color = '#085897' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

type SortKey = keyof Pick<PerformanceRow, 'salesPerson' | 'totalApps' | 'disbursed' | 'rejected' | 'totalAmount' | 'disbursedAmount'>

export default function ReportAnalyticsTabs({ filters }: { filters: ReportFilters }) {
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('pipeline')
  const [sortKey, setSortKey] = useState<SortKey>('disbursedAmount')
  const [sortDesc, setSortDesc] = useState(true)

  // /performance is Admin,Manager only on the backend — don't offer a tab
  // that would only ever 403.
  const canPerformance = ['Admin', 'Manager'].includes(user?.role ?? '')
  const canEditTargets = user?.role === 'Admin'
  const tabs = TABS.filter(t => t.key !== 'performance' || canPerformance)
  const active = tabs.some(t => t.key === tab) ? tab : tabs[0].key


  const pipeline = useQuery({
    queryKey: ['report-pipeline', filters],
    queryFn: () => reportsApi.getPipeline(filters).then(r => r.data.data ?? []),
    enabled: active === 'pipeline',
  })
  const performance = useQuery({
    queryKey: ['report-performance', filters],
    queryFn: () => reportsApi.getPerformance(filters).then(r => r.data.data ?? []),
    enabled: active === 'performance' && canPerformance,
  })
  const monthly = useQuery({
    queryKey: ['report-monthly'],
    queryFn: () => reportsApi.getMonthly(12).then(r => r.data.data ?? null),
    enabled: active === 'monthly',
  })
  const disbursement = useQuery({
    queryKey: ['report-disbursement', filters],
    queryFn: () => reportsApi.getDisbursement(filters).then(r => r.data.data ?? []),
    enabled: active === 'disbursement',
  })
  const rejection = useQuery({
    queryKey: ['report-rejection', filters],
    queryFn: () => reportsApi.getRejection(filters).then(r => r.data.data ?? []),
    enabled: active === 'rejection',
  })
  const targets = useQuery({
    queryKey: ['report-targets'],
    queryFn: () => reportsApi.getTargets().then(r => r.data.data ?? null),
    enabled: active === 'targets',
  })

  const [tatTarget, setTatTarget] = useState('')
  const [ddrTarget, setDdrTarget] = useState('')
  const [targetError, setTargetError] = useState('')
  const [targetSaved, setTargetSaved] = useState(false)

  const saveTargets = useMutation({
    mutationFn: () => reportsApi.updateTargets({
      tatTargetDays: tatTarget ? Number(tatTarget) : undefined,
      ddrTargetPct: ddrTarget ? Number(ddrTarget) : undefined,
    }),
    onSuccess: () => {
      setTargetError(''); setTargetSaved(true)
      setTimeout(() => setTargetSaved(false), 2500)
      qc.invalidateQueries({ queryKey: ['report-targets'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
    },
    onError: (err: unknown) => {
      const d = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      setTargetError(d?.message || d?.errors?.join(' ') || 'Could not save targets.')
    },
  })

  const perfRows = [...(performance.data ?? [])].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey]
    const cmp = typeof av === 'string' && typeof bv === 'string'
      ? av.localeCompare(bv) : Number(av) - Number(bv)
    return sortDesc ? -cmp : cmp
  })

  const pipelineRows = [...(pipeline.data ?? [])].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
  const pipelineMax = Math.max(1, ...pipelineRows.map(r => r.count))

  const monthMax = Math.max(1, ...(monthly.data?.months ?? []).map(m => m.totalApps))
  const rejMax = Math.max(1, ...(rejection.data ?? []).map(r => r.count))

  function sortBy(k: SortKey) {
    if (k === sortKey) setSortDesc(d => !d)
    else { setSortKey(k); setSortDesc(true) }
  }

  const Loading = () => <SkeletonText lines={4} className="py-4" />
  const Empty = ({ what }: { what: string }) => (
    <p className="text-sm text-gray-400 py-8 text-center">No {what} in this period.</p>
  )

  return (
    <Card>
      {/* Was its own hand-rolled underline bar — one of the five pages
          Tabs.tsx's own doc comment names as still doing this by hand
          (Settings, Payout, Loan Detail, Reports, CIBIL). Swapped for the
          shared component so this tab bar gets the same active/hover
          treatment as the rest of the app, plus keyboard nav and real
          role="tab" semantics it didn't have before. */}
      <Tabs tabs={tabs} active={active} onChange={setTab} className="mb-5" />

      {/* ── Pipeline ── */}
      {active === 'pipeline' && (
        pipeline.isLoading ? <Loading /> : pipelineRows.length === 0 ? <Empty what="applications" /> : (
          <div className="space-y-3">
            {pipelineRows.map(r => (
              <div key={r.status}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium text-gray-800">{r.status}</span>
                  <span className="text-gray-500">
                    {r.count} · <span className="font-semibold text-gray-800">{formatCurrency(r.total)}</span>
                  </span>
                </div>
                <Bar value={r.count} max={pipelineMax} />
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Agent performance (sortable leaderboard) ── */}
      {active === 'performance' && (
        performance.isLoading ? <Loading /> : perfRows.length === 0 ? <Empty what="agent activity" /> : (
          <div className="overflow-x-auto">
            {/* efin-table — legacy's tinted uppercase-microcap header band
                and hairline-bordered rows (globals.css), replacing the
                ad hoc text-xs/border-gray-100 header this table used to
                build by hand. Per-column alignment/cursor/sort styling
                is kept as-is; only the base skin changes. */}
            <table className="efin-table min-w-[640px]">
              <thead>
                <tr>
                  {([
                    ['salesPerson', 'Agent'], ['totalApps', 'Apps'], ['disbursed', 'Disbursed'],
                    ['rejected', 'Rejected'], ['totalAmount', 'Volume'], ['disbursedAmount', 'Disbursed Amt'],
                  ] as [SortKey, string][]).map(([k, label], i) => (
                    <th key={k} onClick={() => sortBy(k)}
                      className={`cursor-pointer select-none hover:text-[color:var(--accent)] ${i > 0 ? 'text-right' : ''}`}>
                      {label}{sortKey === k ? (sortDesc ? ' ↓' : ' ↑') : ''}
                    </th>
                  ))}
                  <th className="text-right">Conv.</th>
                </tr>
              </thead>
              <tbody>
                {perfRows.map(r => {
                  const conv = r.totalApps > 0 ? Math.round((r.disbursed / r.totalApps) * 100) : 0
                  return (
                    <tr key={r.salesPerson}>
                      <td className="font-medium text-[color:var(--text)]">{r.salesPerson}</td>
                      <td className="text-right">{r.totalApps}</td>
                      <td className="text-right font-medium" style={{ color: 'var(--success)' }}>{r.disbursed}</td>
                      <td className="text-right" style={{ color: 'var(--danger)' }}>{r.rejected}</td>
                      <td className="text-right">{formatCurrency(r.totalAmount)}</td>
                      <td className="text-right font-semibold">{formatCurrency(r.disbursedAmount)}</td>
                      <td className="text-right">
                        <Badge variant={conv >= 50 ? 'success' : conv >= 25 ? 'warning' : 'default'}>{conv}%</Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── Monthly trend ── */}
      {active === 'monthly' && (
        monthly.isLoading ? <Loading /> : !monthly.data?.months?.length ? <Empty what="monthly activity" /> : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {([
                ['Total Apps', String(monthly.data.summary.totalApps)],
                ['Disbursed', String(monthly.data.summary.totalDisbursed)],
                ['Total Volume', formatCurrency(monthly.data.summary.totalAmount)],
                ['Disbursed Amt', formatCurrency(monthly.data.summary.disbursedAmt)],
                ['Avg Conversion', `${monthly.data.summary.avgConversion}%`],
              ] as [string, string][]).map(([label, v]) => (
                <div key={label} className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className="text-base font-bold text-gray-900 mt-0.5">{v}</p>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="efin-table min-w-[640px]">
                <thead>
                  <tr>
                    {['Month', 'Apps', 'Approved', 'Rejected', 'Disbursed', 'Volume', 'Conv.'].map((h, i) => (
                      <th key={h} className={i > 0 ? 'text-right' : ''}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {monthly.data.months.map(m => (
                    <tr key={m.month}>
                      <td>
                        <p className="font-medium text-[color:var(--text)]">{m.month}</p>
                        <div className="mt-1 w-28"><Bar value={m.totalApps} max={monthMax} /></div>
                      </td>
                      <td className="text-right">{m.totalApps}</td>
                      <td className="text-right" style={{ color: 'var(--accent)' }}>{m.approved}</td>
                      <td className="text-right" style={{ color: 'var(--danger)' }}>{m.rejected}</td>
                      <td className="text-right font-medium" style={{ color: 'var(--success)' }}>{m.disbursed}</td>
                      <td className="text-right">{formatCurrency(m.totalAmount)}</td>
                      <td className="text-right">{m.conversionRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* ── Disbursement register ── */}
      {active === 'disbursement' && (
        disbursement.isLoading ? <Loading /> : !disbursement.data?.length ? <Empty what="disbursements" /> : (
          <div className="overflow-x-auto">
            <table className="efin-table min-w-[640px]">
              <thead>
                <tr>
                  {['Loan #', 'Customer', 'Type', 'Amount', 'Rate', 'Tenure', 'Agent', 'Disbursed'].map((h, i) => (
                    <th key={h} className={[3, 4, 5].includes(i) ? 'text-right' : ''}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {disbursement.data.map(d => (
                  <tr key={d.loanNumber}>
                    <td className="font-mono text-xs">{d.loanNumber}</td>
                    <td className="font-medium text-[color:var(--text)]">{d.customerName}</td>
                    <td className="text-gray-600">{d.loanType}</td>
                    <td className="text-right font-semibold" style={{ color: 'var(--success)' }}>
                      {d.approvedAmount != null ? formatCurrency(d.approvedAmount) : '—'}
                    </td>
                    <td className="text-right">{d.interestRate}%</td>
                    <td className="text-right">{d.tenureMonths}m</td>
                    <td className="text-gray-600">{d.salesPerson}</td>
                    <td className="text-xs text-gray-500">{d.disbursedAt ? formatDate(d.disbursedAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── Rejection analysis ── */}
      {active === 'rejection' && (
        rejection.isLoading ? <Loading /> : !rejection.data?.length ? <Empty what="rejections" /> : (
          <div className="space-y-3">
            {rejection.data.map(r => (
              <div key={r.loanType}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium text-gray-800">{r.loanType}</span>
                  <span className="text-gray-500">
                    {r.count} rejected · <span className="font-semibold text-gray-800">{formatCurrency(r.total)}</span>
                  </span>
                </div>
                <Bar value={r.count} max={rejMax} color="#e31e25" />
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Targets ── */}
      {active === 'targets' && (
        targets.isLoading ? <Loading /> : (
          <div className="max-w-md space-y-4">
            <CardHeader title="Report Targets" subtitle="Used by the TAT and DDR cards above" />
            {/* Same rgba(192,57,43,.1)/--danger and success pairing as
                ErrorBanner/StatusBadge use elsewhere, in place of the raw
                Tailwind red-50/green-50 (a hue the app's gray-remap
                deliberately leaves untouched, so those classes were
                rendering stock Tailwind colors instead of legacy's
                tokens). */}
            {targetError && (
              <div role="alert" className="text-sm rounded-lg px-3 py-2"
                style={{ color: 'var(--danger)', background: 'rgba(192, 57, 43, .1)', border: '1px solid rgba(192, 57, 43, .25)' }}>
                {targetError}
              </div>
            )}
            {targetSaved && (
              <div className="text-sm rounded-lg px-3 py-2"
                style={{ color: 'var(--success)', background: 'rgba(26, 115, 64, .1)', border: '1px solid rgba(26, 115, 64, .25)' }}>
                Targets updated.
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-600 uppercase block mb-1">TAT Target (days)</label>
                <NumberInput disabled={!canEditTargets}
                  value={tatTarget !== '' ? tatTarget : (targets.data?.tatTargetDays ?? '')}
                  onChange={e => setTatTarget(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 uppercase block mb-1">DDR Target (%)</label>
                <NumberInput disabled={!canEditTargets}
                  value={ddrTarget !== '' ? ddrTarget : (targets.data?.ddrTargetPct ?? '')}
                  onChange={e => setDdrTarget(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50" />
              </div>
            </div>

            {canEditTargets ? (
              <Button size="sm" loading={saveTargets.isPending} onClick={() => saveTargets.mutate()}>Save Targets</Button>
            ) : (
              <p className="text-xs text-gray-400">Only an administrator can change these targets.</p>
            )}
          </div>
        )
      )}

      {/* Monthly per-month targets (/api/report-targets) live on the same
          Targets tab as legacy's Reports page, but are a separate record set
          from the two scalars above (/api/reports/targets). Rendered outside
          the isLoading branch so a slow scalar fetch doesn't hide it. */}
      {active === 'targets' && (
        <div className="mt-6">
          <MonthlyTargetsEditor />
        </div>
      )}
    </Card>
  )
}
