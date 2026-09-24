// Dashboard sub-components — extracted verbatim from DashboardPage.tsx
// (code-quality refactor, no behaviour change).
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/States'
import { expertExportApi } from '@/api/expertExportApi'
import { downloadBlob } from '@/utils/reportExport'
import { useLoanStore } from '@/store/loanStore'
import { useCountUp } from '@/hooks/useCountUp'
import type { LoanListItem, LoanType } from '@/types'
import { VARIANTS, type VariantKey, LOAN_TYPE_META, computePipelineStages } from '@/pages/dashboard/dashboardData'

export function StatCard({
  variant, label, value, sub, onClick,
}: {
  variant: VariantKey
  label: string
  value: number
  sub: React.ReactNode
  onClick?: () => void
}) {
  const v = VARIANTS[variant]
  // Short, controlled count-up (reduced-motion users get the final value
  // instantly). Only the displayed number animates — the value itself is
  // unchanged, as is every drill-down/onClick behaviour.
  const display = useCountUp(value)
  return (
    <button
      type="button"
      onClick={onClick}
      className="kpi-card tap-ring text-left w-full"
      style={{ ['--kpi-accent' as string]: v.accent, ['--kpi-tint' as string]: v.tint, ['--kpi-shadow' as string]: v.shadow }}
    >
      <div className="kpi-icon">{v.emoji}</div>
      <p className="text-[11px] font-bold uppercase" style={{ letterSpacing: '1.5px', color: 'var(--text3)', marginBottom: 14 }}>
        {label}
      </p>
      <p
        className="text-[40px] font-black leading-none"
        style={{ fontFamily: 'var(--font-head)', letterSpacing: '-1px', color: v.num, marginBottom: 12 }}
      >
        {Math.round(display).toLocaleString('en-IN')}
      </p>
      <p className="text-xs" style={{ color: 'var(--text3)' }}>{sub}</p>
    </button>
  )
}

// Titled panel — hairline header with a faint accent wash, unchanged
// contract (title/action/children) from before.
export function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-[18px] border border-token shadow-token overflow-hidden">
      <div
        className="flex items-center gap-3 px-[22px] py-[18px] border-b border-token"
        style={{ background: 'linear-gradient(90deg, rgba(10,88,154,.03), transparent)' }}
      >
        <p className="flex-1 text-[14.5px] font-bold" style={{ fontFamily: 'var(--font-head)', letterSpacing: '-.2px' }}>
          {title}
        </p>
        {action}
      </div>
      {children}
    </div>
  )
}

export function PipelineStages({ loans }: { loans: LoanListItem[] }) {
  const navigate = useNavigate()
  const setLoanFilter = useLoanStore(s => s.setFilter)

  const stages = computePipelineStages(loans)

  if (!stages.length) {
    return <EmptyState title="No active applications" description="Applications will appear here once created." />
  }
  const max = Math.max(...stages.map(s => s.count), 1)

  return (
    <div className="flex flex-col gap-2.5 px-6 py-5">
      {stages.map(s => (
        <div
          key={s.status}
          className="stage-row"
          onClick={() => { setLoanFilter({ status: s.status }); navigate('/loans') }}
        >
          <div className="stage-row-label">{s.label}</div>
          <div className="stage-row-track">
            <div
              className="stage-row-bar"
              style={{ background: `${s.color}22`, borderLeft: `3px solid ${s.color}`, color: s.color, width: `${Math.max(18, (s.count / max) * 100)}%` }}
            >
              {s.count}
            </div>
          </div>
          <div className="stage-row-count">{s.count}</div>
        </div>
      ))}
    </div>
  )
}

// ── Monthly Disbursals chart — legacy #chart-bars (renderChart() in
// efin-app.js): last 6 calendar months, applications-created vs
// disbursed-that-month, as twin CSS bar columns. ─────────────────────────
export function MonthlyDisbursalsChart({ loans }: { loans: LoanListItem[] }) {
  const months = useMemo(() => {
    const now = new Date()
    const buckets = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
      return { label: d.toLocaleString('en-IN', { month: 'short' }), year: d.getFullYear(), month: d.getMonth() }
    })
    return buckets.map(b => {
      const inMonth = loans.filter(l => {
        const d = new Date(l.createdAt)
        return d.getMonth() === b.month && d.getFullYear() === b.year
      })
      return { ...b, applications: inMonth.length, disbursed: inMonth.filter(l => l.status === 'Disbursed').length }
    })
  }, [loans])

  const max = Math.max(...months.map(m => m.applications), 1)
  const currentIdx = months.length - 1

  if (!loans.length) return <EmptyState title="No data yet" description="Monthly figures appear once applications exist." />

  return (
    <>
      <div className="flex items-end gap-1">
        {months.map((m, i) => (
          <div key={`${m.year}-${m.month}`} className="chart-bar-col">
            <div className="chart-bar-track">
              <div
                className="chart-bar-inner"
                style={{ height: `${Math.max(6, (m.applications / max) * 130)}px`, background: i === currentIdx ? 'rgba(10,88,154,.32)' : 'rgba(10,88,154,.22)', borderColor: 'var(--accent)' }}
                title={`${m.applications} applications in ${m.label}`}
              />
              <div
                className="chart-bar-inner"
                style={{ height: `${Math.max(m.disbursed ? 5 : 0, (m.disbursed / max) * 130)}px`, background: i === currentIdx ? 'rgba(0,212,170,.42)' : 'rgba(0,212,170,.26)', borderColor: '#00d4aa' }}
                title={`${m.disbursed} disbursed in ${m.label}`}
              />
            </div>
            <div className="chart-bar-month-label" style={i === currentIdx ? { color: 'var(--accent)', fontWeight: 700 } : undefined}>
              {m.label}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-5 mt-5 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text2)' }}>
          <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: 'var(--accent)' }} />Applications
        </div>
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text2)' }}>
          <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#00d4aa' }} />Disbursed
        </div>
      </div>
    </>
  )
}

// ── Loan Type Mix — legacy #loan-type-chart (renderLoanTypeChart()):
// horizontal percentage bars for the top loan types by volume. ──────────
export function LoanTypeMixChart({ loans }: { loans: LoanListItem[] }) {
  const total = loans.length || 1
  const counts = new Map<string, number>()
  loans.forEach(l => counts.set(l.loanType, (counts.get(l.loanType) ?? 0) + 1))
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)

  if (!loans.length) return <EmptyState title="No data yet" description="Loan type breakdown appears once applications exist." />

  return (
    <div>
      {sorted.map(([type, count]) => {
        const meta = LOAN_TYPE_META[type as LoanType] ?? { label: type, color: 'var(--text3)' }
        const pct = Math.round((count / total) * 100)
        return (
          <div key={type} className="mb-3.5 last:mb-0">
            <div className="flex justify-between mb-1.5">
              <span className="text-xs" style={{ color: 'var(--text2)' }}>{meta.label}</span>
              <span className="text-xs font-bold" style={{ color: 'var(--text)' }}>{pct}%</span>
            </div>
            <div className="progress-wrap">
              <div className="progress-bar" style={{ width: `${pct}%`, background: meta.color }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Expert Export — unchanged behaviour, restyled to the legacy pill ─────
// ExpertExportController's /access gate (hidden entirely when not allowed,
// same as legacy's _expertExportApplyVisibility) + /data blob download.
export function ExpertExportButton() {
  const [error, setError] = useState('')
  const { data: access } = useQuery({
    queryKey: ['expertExportAccess'],
    queryFn: () => expertExportApi.access().then(r => r.data),
    staleTime: 30_000, // matches legacy's 30s access-check cache
  })

  const download = useMutation({
    mutationFn: () => expertExportApi.downloadData(),
    onSuccess: (res) => {
      downloadBlob(res.data, `expert-export-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv')
      setError('')
    },
    onError: (e: unknown) => {
      const status = (e as { response?: { status?: number } })?.response?.status
      setError(status === 403 ? 'You do not have permission for Expert Export' : 'Expert Export failed')
    },
  })

  if (!access?.allowed) return null

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" loading={download.isPending} onClick={() => download.mutate()}>
        <span className="mr-1.5">🧠</span>Expert Export
      </Button>
      {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  )
}

// Legacy's updateClock(): en-IN 2-digit hh:mm, refreshed every 30s.
export function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])
  return now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}
