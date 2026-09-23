import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useDashboard, useDashboardBreakdown } from '@/hooks/useLoans'
import { Button } from '@/components/ui/Button'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { expertExportApi } from '@/api/expertExportApi'
import ActionQueueWidget from '@/components/shared/ActionQueueWidget'
import { useAuthStore } from '@/store/authStore'
import { useLoanStore } from '@/store/loanStore'
import { useCountUp } from '@/hooks/useCountUp'
import type { LoanListItem, LoanStatus, LoanType } from '@/types'

// ── Stage / loan-type visual metadata — legacy PIPELINE_STAGE_META and the
// loan-type `colors` map in renderLoanTypeChart() (efin-app.js), remapped
// onto this app's actual LoanStatus/LoanType enums. Design only: nothing
// here changes what a status or loan type means.
// Phase 9 code-level audit — labels for Submitted/UnderReview/OnHold were
// generic React-enum names ("Submitted", "Under Review", "On Hold") instead
// of the exact vanilla label the backend status actually maps to. Vanilla's
// STATUSES dict (efin-app.js:1419-1425) and api-bridge.js's STATUS_MAP
// (Submitted:'login', UnderReview:'underwriting' — the same mapping
// lenderEmailTemplates.ts's LENDER_EMAIL_VISIBLE_STAGES comment documents)
// give the real correspondence: login→"Assign Lender", underwriting→
// "Underwriting", hold→"Hold". Vanilla's own generic status-change activity
// text (`${id} → ${STATUSES[newStatus]}`) uses these exact labels too, so
// fixing them here keeps the Pipeline and Recent Activity text consistent
// with each other, not just internally consistent with a made-up label.
const STAGE_META: Record<LoanStatus, { label: string; color: string }> = {
  Draft:       { label: 'Draft',          color: '#ffb347' },
  Submitted:   { label: 'Assign Lender',  color: '#3d6fff' },
  UnderReview: { label: 'Underwriting',   color: '#a159ff' },
  Approved:    { label: 'Approved',       color: '#1a7340' },
  Disbursed:   { label: 'Disbursed',      color: '#0a589a' },
  Rejected:    { label: 'Rejected',       color: '#e31e25' },
  Closed:      { label: 'Closed',         color: '#6b7280' },
  OnHold:      { label: 'Hold',           color: '#e67e00' },
  Decision:    { label: 'Decision',       color: '#a159ff' },
  Acceptance:  { label: 'Acceptance',     color: '#0aa1a1' },
}
// Pipeline bars only ever show the exact stage set Vanilla's own
// PIPELINE_STAGE_META lists (efin-app.js:1427-1436: wip/login/underwriting/
// offer/approved/disbursed/hold/rejected) — Decision, Acceptance and Closed
// are deliberately absent from Vanilla's pipeline (a loan in one of those
// statuses contributes to no bar at all there), so they're left out of the
// order below too, even though STAGE_META above still needs an entry for
// every LoanStatus for Recent Activity's dot colour.
//
// BUGFIX (Phase 9 code-level audit) — 'Draft' was wrongly included as an
// extra pipeline bar. renderPipeline() in efin-app.js:11720-11738 builds
// `liveApps` by explicitly filtering OUT drafts (`!a.id.startsWith('H') &&
// !a.is_draft`) before counting into any stage, and PIPELINE_STAGE_META
// itself has no 'draft' entry at all — a draft application contributes to
// no bar there, ever. Backend LoanStatus.Draft is the equivalent of that
// is_draft flag (a loan that has never been submitted — see LoanService.
// CreateAsync), NOT vanilla's 'wip' pipeline stage (api-bridge.js's
// STATUS_MAP entry `Draft:'wip'` is used for non-pipeline status-badge
// display elsewhere, not this list). So Draft is excluded below, matching
// vanilla exactly — and because the current backend enum has no status
// between Draft and Submitted, there is nothing that could ever populate a
// "Personal Details"/wip bar here; a submitted loan goes straight to
// Submitted ("Assign Lender"). Order and colours below mirror vanilla's
// array exactly for every stage the backend enum can actually reach.
const STAGE_ORDER: LoanStatus[] = ['Submitted', 'UnderReview', 'Approved', 'Disbursed', 'OnHold', 'Rejected']

// Keyed by the backend LoanType.ToString() names the API actually returns
// (Car/LAP/Overdraft), so the breakdown shows real labels instead of the raw
// enum string. The NewCar/UsedCar/AgainstProperty aliases are retained only
// to satisfy the LoanType union; the API never emits them.
const LOAN_TYPE_META: Record<LoanType, { label: string; color: string }> = {
  Personal:        { label: 'Personal Loan',      color: 'var(--accent)' },
  Business:        { label: 'Business Loan',      color: 'var(--accent2)' },
  Home:            { label: 'Home Loan',          color: '#a159ff' },
  Car:             { label: 'Car Loan',            color: 'var(--accent3)' },
  LAP:             { label: 'Loan Against Property', color: '#0891b2' },
  // over_draft in Vanilla's renderLoanTypeChart() colour map (efin-app.js)
  // is emerald '#10b981', not a purple — fixed to match exactly.
  Overdraft:       { label: 'Overdraft / CC',      color: '#10b981' },
  NewCar:          { label: 'New Car Loan',        color: 'var(--accent3)' },
  UsedCar:         { label: 'Used Car Loan',       color: '#f59e0b' },
  AgainstProperty: { label: 'Loan Against Property', color: '#0891b2' },
  Education:       { label: 'Education Loan',     color: '#7c3aed' },
  Insurance:       { label: 'Insurance',          color: '#6b7280' },
}

// ── Dashboard stat cards — faithful to Vanilla "Design System v2"
// .stat-card (app.css:4978): tinted 44px icon box holding an EMOJI (not a
// lucide icon), uppercase label, a 40px display value shown directly (no
// count-up), and a pill-shaped .stat-change chip. No corner arrow, no
// per-card entrance stagger — Vanilla has neither. Every value still comes
// from the same DashboardController payload (useDashboard()).
// `num` is the big-number colour, matching Vanilla's .stat-value.{blue,green,
// orange,red} verbatim (app.css:2655) — note the "green" (Disbursed) card's
// number is legacy's red --accent2, and "orange" is --accent3, exactly as
// legacy renders them (kept even though it reads quirky, per Vanilla parity).
const VARIANTS = {
  blue:   { accent: 'var(--accent)',  num: 'var(--accent)',  tint: 'rgba(8, 88, 151, .1)',  shadow: 'rgba(8, 88, 151, .3)',  emoji: '📋' },
  green:  { accent: 'var(--success)', num: 'var(--accent2)', tint: 'rgba(212, 43, 43, .1)',  shadow: 'rgba(26, 115, 64, .3)',  emoji: '✅' },
  orange: { accent: 'var(--warn)',    num: 'var(--accent3)', tint: 'rgba(230, 126, 0, .1)',  shadow: 'rgba(230, 126, 0, .3)',  emoji: '⚡' },
  red:    { accent: 'var(--danger)',  num: 'var(--danger)',  tint: 'rgba(192, 57, 43, .1)',  shadow: 'rgba(192, 57, 43, .3)',  emoji: '🚫' },
} as const

type VariantKey = keyof typeof VARIANTS

function StatCard({
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
function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-[18px] border border-token shadow-token overflow-hidden">
      <div
        className="flex items-center gap-3 px-[22px] py-[18px] border-b border-token"
        style={{ background: 'linear-gradient(90deg, rgba(8,88,151,.03), transparent)' }}
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

// ── Pipeline stage bars — legacy .pipeline-stage/.stage-bar (index.html's
// "Application Pipeline" card body). Proportional horizontal bars, one per
// status that has at least one loan, widest = most loans. Click routes into
// the Loans list pre-filtered to that stage, same as legacy's
// filterByStatus(). ──────────────────────────────────────────────────────
// Exported so a unit test can assert the Vanilla parity behaviour (Draft
// excluded, order/labels, zero-count stages hidden) without rendering the
// component — same pattern as LoansPage.tsx's exported `pageWindow`.
export function computePipelineStages(loans: LoanListItem[]) {
  return STAGE_ORDER
    .map(status => ({ status, ...STAGE_META[status], count: loans.filter(l => l.status === status).length }))
    .filter(s => s.count > 0)
}

function PipelineStages({ loans }: { loans: LoanListItem[] }) {
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
function MonthlyDisbursalsChart({ loans }: { loans: LoanListItem[] }) {
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
                style={{ height: `${Math.max(6, (m.applications / max) * 130)}px`, background: i === currentIdx ? 'rgba(8,88,151,.32)' : 'rgba(8,88,151,.22)', borderColor: 'var(--accent)' }}
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
function LoanTypeMixChart({ loans }: { loans: LoanListItem[] }) {
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
function ExpertExportButton() {
  const [error, setError] = useState('')
  const { data: access } = useQuery({
    queryKey: ['expertExportAccess'],
    queryFn: () => expertExportApi.access().then(r => r.data),
    staleTime: 30_000, // matches legacy's 30s access-check cache
  })

  const download = useMutation({
    mutationFn: () => expertExportApi.downloadData(),
    onSuccess: (res) => {
      const blob = new Blob([res.data], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `expert-export-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
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

// Legacy renderActivity()'s timeAgo (efin-app.js:13693) — verbatim buckets.
function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`
  const days = Math.floor(diff / 86400)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

// Recent Activity 'Audit' rows (AuditLogs-sourced — see RecentActivityDto):
// same Created/Updated/Deleted colour convention AuditLogPage's actionMeta
// already uses, so the dot colour is consistent across both surfaces.
export function auditActionColor(action?: string): string {
  switch (action) {
    case 'Created': return 'var(--success)'
    case 'Deleted': return 'var(--danger)'
    default:        return 'var(--accent)' // Updated / StatusChanged / unknown
  }
}

// Legacy's updateClock(): en-IN 2-digit hh:mm, refreshed every 30s.
function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])
  return now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

export default function DashboardPage() {
  const { data: stats, isLoading, error, refetch } = useDashboard()
  const { data: breakdownLoans, isLoading: breakdownLoading } = useDashboardBreakdown()
  const user = useAuthStore(s => s.user)
  const navigate = useNavigate()
  const setLoanFilter = useLoanStore(s => s.setFilter)
  const clock = useClock()

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good Morning'
    if (h < 17) return 'Good Afternoon'
    return 'Good Evening'
  })()

  // Same arithmetic legacy used (efin-app.js ~line 15739), mapped onto the
  // fields DashboardController actually returns. "Closed" is approved +
  // disbursed; "active" is what's still pending — approved is NOT counted as
  // in-process, exactly as in legacy, so the two lines can't double-count.
  const total     = stats?.totalLoans ?? 0
  const disbursed = stats?.disbursedLoans ?? 0
  const approved  = stats?.approvedLoans ?? 0
  const inProcess = stats?.pendingLoans ?? 0
  const rejected  = stats?.rejectedLoans ?? 0
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0)

  const goToLoans = (status?: LoanStatus) => {
    setLoanFilter(status ? { status } : {})
    navigate('/loans')
  }

  // Gap 1 — "In Process" drills into exactly the statuses its own count is
  // built from (login+underwriting+offer in Vanilla, i.e. Submitted+
  // UnderReview here — offer has no persisted backend status, see the
  // STAGE_ORDER comment above), instead of the single 'UnderReview' this
  // used to send, which silently dropped every Submitted loan from the
  // filtered list even though the card's own number included them.
  const goToInProcess = () => {
    setLoanFilter({ statuses: ['Submitted', 'UnderReview'] })
    navigate('/loans')
  }

  return (
    <div>
      {/* ── Greeting row ── */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1
            className="text-[26px] sm:text-[30px] font-black mb-1.5"
            style={{ fontFamily: 'var(--font-head)', letterSpacing: '-.5px', color: 'var(--text)' }}
          >
            {greeting}, {user?.fullName ?? 'Admin'} 👋
          </h1>
          <p className="text-sm font-medium" style={{ color: 'var(--text3)' }}>
            Here's what's happening with your loan portfolio today.
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <ExpertExportButton />
          <div
            className="flex items-center gap-2.5 bg-surface px-[18px] py-[11px]"
            style={{ border: '1.5px solid var(--border)', borderRadius: 14, boxShadow: '0 2px 10px rgba(8,88,151,.07)' }}
          >
            <span
              className="inline-block w-[9px] h-[9px] rounded-full"
              style={{ background: '#22d3a0', boxShadow: '0 0 8px #22d3a0', animation: 'pulse-dot 2.5s ease-in-out infinite' }}
            />
            <span className="text-[13px] font-semibold" style={{ color: 'var(--text2)' }}>System Online</span>
            <span className="text-[11.5px] font-medium" style={{ color: 'var(--text3)' }}>{clock}</span>
          </div>
        </div>
      </div>

      {/* ── Unified Action Queue ──
          Legacy places this between the greeting row and the stat cards
          (index.html:886); it renders nothing when the queue is empty. */}
      <ActionQueueWidget />

      {/* ── Stat cards ── */}
      {error ? (
        <div className="bg-surface rounded-token border border-token mb-7">
          <ErrorState error={error} fallback="Could not load dashboard figures." onRetry={() => refetch()} />
        </div>
      ) : isLoading ? (
        <PageLoader />
      ) : (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-5 mb-7 lms-stagger">
          <StatCard
            variant="blue" label="Total Applications" value={total}
            sub={<span className="kpi-chip">{approved + disbursed} closed · {inProcess} active</span>}
            onClick={() => goToLoans()}
          />
          <StatCard
            variant="green" label="Disbursed" value={disbursed}
            sub={<span className="kpi-chip">{pct(disbursed)}% conversion rate</span>}
            onClick={() => goToLoans('Disbursed')}
          />
          <StatCard
            variant="orange" label="In Process" value={inProcess}
            sub={<span className="kpi-chip">● {inProcess} need attention</span>}
            onClick={goToInProcess}
          />
          <StatCard
            variant="red" label="Rejected" value={rejected}
            sub={<span className="kpi-chip">{pct(rejected)}% of total</span>}
            onClick={() => goToLoans('Rejected')}
          />
        </div>
      )}

      {/* Vanilla's dashboard has no "amount strip" here — the greeting row,
          stat cards, pipeline/activity and the two charts are the whole page
          (index.html:863-957). The strip was a React-only addition and is
          removed for parity. */}

      {/* ── Pipeline (2fr) + Recent Activity (1fr) ── legacy .grid-3 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-5 mt-5 lms-stagger">
        <Panel
          title="Application Pipeline"
          action={<Button size="sm" variant="ghost" onClick={() => goToLoans()}>View All</Button>}
        >
          {breakdownLoading ? (
            <PageLoader />
          ) : (
            <PipelineStages loans={breakdownLoans ?? []} />
          )}
        </Panel>

        <Panel title="Recent Activity">
          {isLoading ? (
            <PageLoader />
          ) : (stats?.recentActivity ?? []).length === 0 ? (
            // Gap 2 — fed by DashboardController→GetDashboardStatsAsync's
            // RecentActivity (real, persisted LoanStatusHistory rows across
            // every loan visible to this user), not a generated/local feed.
            <EmptyState title="Nothing recent" description="Activity shows up here once applications start moving." />
          ) : (
            // Vanilla's Recent Activity feed (.activity-item / .act-dot /
            // .act-text / .act-time — index.html:13700, app.css:2792): a
            // status-colored dot, a text line (name in bold + what happened),
            // and a relative timestamp. Gap 2 — this now reflects actual
            // status-change events (reverse-chronological, like Vanilla's
            // ACTIVITY_LOG), not just the most recently *created* loans, so a
            // status change on an older loan surfaces here too.
            <div className="activity-list">
              {(stats?.recentActivity ?? []).slice(0, 7).map((a, i) => {
                // 'Audit' rows (Users/Tracking/Incred — Admin-only, see
                // RecentActivityDto) have no loanId to link to and no
                // LoanStatus to look up in STAGE_META, so they render as a
                // plain, non-clickable line instead of forcing them through
                // the loan-shaped branch below.
                if (a.type === 'Audit') {
                  return (
                    <div key={`audit-${a.entityName}-${a.changedAt}-${i}`} className="activity-item">
                      <div className="act-dot" style={{ background: auditActionColor(a.action) }} />
                      <div className="act-content">
                        <div className="act-text">{a.description}</div>
                        <div className="act-time">{timeAgo(a.changedAt)}</div>
                      </div>
                    </div>
                  )
                }
                const meta = STAGE_META[a.status as LoanStatus] ?? { label: a.status, color: 'var(--accent)' }
                return (
                  <div
                    key={`${a.loanId}-${a.changedAt}-${i}`}
                    className="activity-item activity-item-link"
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/loans/${a.loanId}`)}
                  >
                    <div className="act-dot" style={{ background: meta.color }} />
                    <div className="act-content">
                      <div className="act-text">
                        <strong>{a.customerName}</strong> · {a.loanNumber} — {meta.label}
                      </div>
                      <div className="act-time">{timeAgo(a.changedAt)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Panel>
      </div>

      {/* ── Monthly Disbursals + Loan Type Mix ── legacy's grid-2 charts row
          (index.html:927-940), entirely absent from the previous React
          dashboard — restored here off the same breakdown data as the
          pipeline above. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5 lms-stagger">
        <Panel
          title="Monthly Disbursals"
          action={<span className="text-xs" style={{ color: 'var(--text3)' }}>FY 2025–26</span>}
        >
          <div className="p-6">
            {breakdownLoading
              ? <PageLoader />
              : <MonthlyDisbursalsChart loans={breakdownLoans ?? []} />}
          </div>
        </Panel>
        <Panel title="Loan Type Mix">
          <div className="p-6">
            {breakdownLoading
              ? <PageLoader />
              : <LoanTypeMixChart loans={breakdownLoans ?? []} />}
          </div>
        </Panel>
      </div>
    </div>
  )
}
