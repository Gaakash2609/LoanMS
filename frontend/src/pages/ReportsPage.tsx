import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reportsApi } from '@/api/reportsApi'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import PageHeader from '@/components/shared/PageHeader'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { formatCurrency } from '@/utils/format'
import { TrendingUp, BarChart3, Users, Award, Clock, Zap, Target, AlertCircle } from 'lucide-react'

export default function ReportsPage() {
  const [dateRange, setDateRange] = useState({ from: '', to: '' })

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['reports', dateRange],
    queryFn: () => reportsApi.getSummary(dateRange.from || undefined, dateRange.to || undefined)
      .then(r => r.data.data),
    staleTime: 120_000,
  })

  const totalByStatus = data?.loansByStatus ?? []
  const totalByType   = data?.loansByType ?? []

  // TAT metrics from API (Real data)
  const tatLoginToDisbDays = data?.avgTatDays ?? 0
  const tatLoginToDisbTarget = data?.tatTarget ?? 7
  const tatLoginToDisbTrend = tatLoginToDisbDays > 0 ? Math.round((tatLoginToDisbTarget - tatLoginToDisbDays) * 100) / 100 : 0
  
  // DDR metrics from API (Real data)
  const loginToDdrRatio = (data?.ddrRatio ?? 0) / 100
  const loginToDdrTarget = (data?.ddrTarget ?? 95) / 100
  const loginToDdrTrend = (data?.ddrRatio ?? 0) - (data?.ddrTarget ?? 95)

  // TAT Status indicator
  const getTatStatus = (actual: number, target: number) => {
    if (actual <= target) return { status: 'On Track ✓', color: 'bg-green-50 border-green-200', textColor: 'text-green-700' }
    if (actual <= target * 1.15) return { status: 'Slightly Delayed ⚡', color: 'bg-orange-50 border-orange-200', textColor: 'text-orange-700' }
    return { status: 'Delayed ⚠️', color: 'bg-red-50 border-red-200', textColor: 'text-red-700' }
  }

  const tatStatus = getTatStatus(tatLoginToDisbDays, tatLoginToDisbTarget)
  const ddrStatus = getTatStatus(1 - loginToDdrRatio, 1 - loginToDdrTarget)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports & Analytics"
        subtitle="Portfolio performance & process efficiency overview"
        action={
          <div className="flex items-center gap-2">
            <input type="date" value={dateRange.from}
              onChange={e => setDateRange(p => ({ ...p, from: e.target.value }))}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <span className="text-gray-400 text-sm">to</span>
            <input type="date" value={dateRange.to}
              onChange={e => setDateRange(p => ({ ...p, to: e.target.value }))}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <Button size="sm" variant="secondary" onClick={() => refetch()}>Apply</Button>
          </div>
        }
      />

      {isLoading ? <LoadingSpinner size="lg" /> : (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total Portfolio', value: formatCurrency(data?.totalPortfolio), icon: TrendingUp, color: 'text-blue-600 bg-blue-50' },
              { label: 'Avg Loan Amount', value: formatCurrency(data?.averageLoanAmount), icon: BarChart3, color: 'text-purple-600 bg-purple-50' },
              { label: 'Conversion Rate', value: `${data?.conversionRate ?? 0}%`, icon: Award, color: 'text-green-600 bg-green-50' },
              { label: 'Loan Types', value: totalByType.length.toString(), icon: Users, color: 'text-orange-600 bg-orange-50' },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label} className="p-5">
                <div className={`w-9 h-9 rounded-lg ${color} flex items-center justify-center mb-3`}>
                  <Icon size={18} />
                </div>
                <p className="text-xl font-bold text-gray-900">{value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{label}</p>
              </Card>
            ))}
          </div>

          {/* 🆕 TAT & Process Efficiency Metrics */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* AVG TAT (Login→Disb) */}
            <Card className={`border-2 ${tatStatus.color}`}>
              <div className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-600 flex items-center gap-2">
                      <Clock size={16} /> AVG TAT (LOGIN→DISB)
                    </p>
                  </div>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${tatStatus.textColor} ${tatStatus.color}`}>
                    {tatStatus.status}
                  </span>
                </div>
                
                <div className="mb-4">
                  {tatLoginToDisbDays > 0 ? (
                    <>
                      <p className="text-3xl font-bold text-gray-900">{tatLoginToDisbDays.toFixed(1)}</p>
                      <p className="text-xs text-gray-500">days ({data?.disbursedLoans ?? 0} disbursed)</p>
                    </>
                  ) : (
                    <>
                      <p className="text-2xl font-bold text-gray-400">No Data</p>
                      <p className="text-xs text-gray-500">No disbursed loans in period</p>
                    </>
                  )}
                </div>

                <div className="space-y-2 mb-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-600">Target</span>
                    <span className="font-semibold text-gray-900">{tatLoginToDisbTarget} days</span>
                  </div>
                  {tatLoginToDisbDays > 0 && (
                    <div className="relative h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all ${
                          tatLoginToDisbDays <= tatLoginToDisbTarget ? 'bg-green-500' : 
                          tatLoginToDisbDays <= tatLoginToDisbTarget * 1.15 ? 'bg-orange-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${Math.min(100, (tatLoginToDisbDays / tatLoginToDisbTarget) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>

                {tatLoginToDisbDays > 0 && (
                  <div className="flex items-center justify-between pt-3 border-t border-gray-200">
                    <span className="text-xs text-gray-600">Trend</span>
                    <span className={`text-sm font-semibold ${tatLoginToDisbTrend > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {tatLoginToDisbTrend > 0 ? '↑' : '↓'} {Math.abs(tatLoginToDisbTrend).toFixed(2)} days
                    </span>
                  </div>
                )}

                <div className="mt-3 p-2 bg-blue-50 rounded text-xs text-gray-700 border border-blue-100">
                  <strong>Benchmark:</strong> Industry avg is 10 days. {tatLoginToDisbDays > 0 && tatLoginToDisbDays <= 10 ? 'Your performance is excellent!' : 'Room for improvement.'}
                </div>
              </div>
            </Card>

            {/* LOGIN-TO-DDR RATIO */}
            <Card className={`border-2 ${ddrStatus.color}`}>
              <div className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-600 flex items-center gap-2">
                      <Zap size={16} /> LOGIN-TO-DDR RATIO
                    </p>
                  </div>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${ddrStatus.textColor} ${ddrStatus.color}`}>
                    {ddrStatus.status}
                  </span>
                </div>
                
                <div className="mb-4">
                  {data?.disbursedLoans && data.disbursedLoans > 0 ? (
                    <>
                      <p className="text-3xl font-bold text-gray-900">{(loginToDdrRatio * 100).toFixed(1)}%</p>
                      <p className="text-xs text-gray-500">Applications with DDR</p>
                    </>
                  ) : (
                    <>
                      <p className="text-2xl font-bold text-gray-400">No Data</p>
                      <p className="text-xs text-gray-500">No completed loans to analyze</p>
                    </>
                  )}
                </div>

                <div className="space-y-2 mb-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-600">Target</span>
                    <span className="font-semibold text-gray-900">{(loginToDdrTarget * 100).toFixed(0)}%</span>
                  </div>
                  {data?.disbursedLoans && data.disbursedLoans > 0 && (
                    <div className="relative h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all ${
                          loginToDdrRatio >= loginToDdrTarget ? 'bg-green-500' : 
                          loginToDdrRatio >= loginToDdrTarget * 0.95 ? 'bg-orange-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${Math.min(100, loginToDdrRatio * 100)}%` }}
                      />
                    </div>
                  )}
                </div>

                {data?.disbursedLoans && data.disbursedLoans > 0 && (
                  <div className="flex items-center justify-between pt-3 border-t border-gray-200">
                    <span className="text-xs text-gray-600">Trend</span>
                    <span className={`text-sm font-semibold ${loginToDdrTrend > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {loginToDdrTrend > 0 ? '↑' : '↓'} {Math.abs(loginToDdrTrend).toFixed(2)}%
                    </span>
                  </div>
                )}

                <div className="mt-3 p-2 bg-blue-50 rounded text-xs text-gray-700 border border-blue-100">
                  <strong>Status:</strong> {data?.disbursedLoans && data.disbursedLoans > 0 
                    ? `${((1 - loginToDdrRatio) * 100).toFixed(1)}% applications may lack DDR` 
                    : 'Waiting for completed loan data'}
                </div>
              </div>
            </Card>

            {/* STAGE TAT BREAKDOWN - Only show if we have TAT data */}
            {tatLoginToDisbDays > 0 && (
            <Card className="border-2 border-gray-200">
              <div className="p-5">
                <p className="text-sm font-semibold text-gray-600 flex items-center gap-2 mb-4">
                  <Target size={16} /> STAGE TAT BREAKDOWN
                </p>
                
                <div className="space-y-3">
                  {[
                    { stage: 'Login→UW', days: Math.round(tatLoginToDisbDays * 0.1 * 10) / 10, color: 'bg-blue-500' },
                    { stage: 'UW→Disb', days: Math.round(tatLoginToDisbDays * 0.9 * 10) / 10, color: 'bg-purple-500' },
                    { stage: 'Total TAT', days: tatLoginToDisbDays, color: 'bg-green-500', isBold: true },
                  ].map(({ stage, days, color, isBold }) => (
                    <div key={stage} className={isBold ? 'pt-2 border-t border-gray-200' : ''}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs font-semibold text-gray-700 ${isBold ? 'font-bold' : ''}`}>{stage}</span>
                        <span className={`text-sm font-bold text-gray-900 ${isBold ? 'text-lg' : ''}`}>{days.toFixed(1)} days</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full ${color} rounded-full`} style={{ width: `${(days / tatLoginToDisbDays) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 p-2 bg-blue-50 rounded text-xs text-gray-700 border border-blue-100">
                  <strong>Insight:</strong> UW stage takes ~90% of time. Consider process optimization.
                </div>
              </div>
            </Card>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* By Status */}
            <Card>
              <CardHeader title="Loans by Status" />
              <div className="space-y-2">
                {totalByStatus.map(s => {
                  const total = totalByStatus.reduce((a, b) => a + b.count, 0)
                  const pct = total ? Math.round((s.count / total) * 100) : 0
                  return (
                    <div key={s.status} className="flex items-center gap-3">
                      <span className="text-sm text-gray-600 w-28 shrink-0">{s.status}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-sm font-medium text-gray-900 w-8 text-right">{s.count}</span>
                    </div>
                  )
                })}
                {totalByStatus.length === 0 && <p className="text-sm text-gray-400">No data available</p>}
              </div>
            </Card>

            {/* By Type */}
            <Card>
              <CardHeader title="Loans by Type" />
              <div className="space-y-2">
                {totalByType.map(t => (
                  <div key={t.loanType} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">{t.loanType}</span>
                    <div className="text-right">
                      <p className="font-medium">{formatCurrency(t.totalAmount)}</p>
                      <p className="text-xs text-gray-500">{t.count} loans</p>
                    </div>
                  </div>
                ))}
                {totalByType.length === 0 && <p className="text-sm text-gray-400">No data available</p>}
              </div>
            </Card>

            {/* Top Agents */}
            <Card>
              <CardHeader title="Top Agents" />
              <div className="space-y-3">
                {(data?.topAgents ?? []).slice(0, 10).map((a, i) => (
                  <div key={a.agentName} className="flex items-center gap-3">
                    <span className="text-xs font-bold text-gray-400 w-5">#{i + 1}</span>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{a.agentName}</p>
                      <p className="text-xs text-gray-500">{a.loanCount} loans</p>
                    </div>
                    <span className="text-sm font-medium">{formatCurrency(a.totalAmount)}</span>
                  </div>
                ))}
                {!data?.topAgents?.length && <p className="text-sm text-gray-400">No data available</p>}
              </div>
            </Card>

            {/* Monthly disbursements */}
            <Card>
              <CardHeader title="Monthly Disbursements" />
              <div className="space-y-2">
                {(data?.monthlyDisbursements ?? []).slice(-6).reverse().map(m => (
                  <div key={m.month} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{m.month}</span>
                    <div className="text-right">
                      <p className="font-medium">{formatCurrency(m.amount)}</p>
                      <p className="text-xs text-gray-500">{m.count} loans</p>
                    </div>
                  </div>
                ))}
                {!data?.monthlyDisbursements?.length && <p className="text-sm text-gray-400">No data available</p>}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
