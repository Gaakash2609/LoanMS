import { useNavigate } from 'react-router-dom'
import { useDashboard, useDashboardBreakdown } from '@/hooks/useLoans'
import { Button } from '@/components/ui/Button'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { EmptyState, ErrorState } from '@/components/ui/States'
import ActionQueueWidget from '@/components/shared/ActionQueueWidget'
import { useAuthStore } from '@/store/authStore'
import { useLoanStore } from '@/store/loanStore'
import type { LoanStatus } from '@/types'
// Dashboard metadata/helpers and sub-components — extracted to their own
// modules. computePipelineStages/auditActionColor are re-exported so the
// existing tests keep importing them from '@/pages/DashboardPage'.
import { STAGE_META, auditActionColor, timeAgo } from '@/pages/dashboard/dashboardData'
import {
  StatCard, Panel, PipelineStages, MonthlyDisbursalsChart, LoanTypeMixChart,
  ExpertExportButton, useClock,
} from '@/pages/dashboard/DashboardWidgets'
export { computePipelineStages, auditActionColor } from '@/pages/dashboard/dashboardData'


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
    setLoanFilter({ statuses: ['Submitted', 'UnderReview', 'Offer'] })
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
            style={{ border: '1.5px solid var(--border)', borderRadius: 14, boxShadow: '0 2px 10px rgba(10,88,154,.07)' }}
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
