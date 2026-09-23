import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { dashboardApi } from '@/api/dashboardApi'
import { formatCurrency } from '@/utils/format'

// ── Unified Action Queue ────────────────────────────────────────────────
// Ports legacy renderActionQueue() (efin-app.js:15665) and its markup slot
// (index.html:886), which sits directly under the dashboard greeting row and
// above the stat cards.
//
// Behaviour kept identical to legacy on purpose:
//   • hidden entirely when totalActionItems is 0 — no "0 items" clutter
//   • same priority order: SLA breach → missing docs → stale drafts → payout
//   • capped at 8 rows (legacy: rows.slice(0, 8))
//   • read-only; a row click only navigates, exactly like the stat cards
//   • also hidden on error, so a failing widget never breaks the dashboard
//
// Row tints reuse the legacy rgba() washes, which map onto the MudraHub
// status palette: red = overdue, amber = missing, blue = idle, green = money.
const ROW_TINT = {
  sla:     'rgba(212,43,43,.06)',
  docs:    'rgba(230,126,0,.06)',
  draft:   'rgba(8,88,151,.06)',
  payout:  'rgba(26,115,64,.06)',
} as const

const MAX_ROWS = 8

interface Row {
  key: string
  icon: string
  tint: string
  onClick: () => void
  content: React.ReactNode
}

export default function ActionQueueWidget() {
  const navigate = useNavigate()

  const { data } = useQuery({
    queryKey: ['dashboard-action-queue'],
    queryFn: () => dashboardApi.getActionQueue().then(r => r.data.data),
    staleTime: 60_000,
    retry: false,
  })

  if (!data || !data.totalActionItems) return null

  // Built in legacy's exact priority order — the slice(0, 8) below is what
  // makes that order matter, so it must not be re-sorted.
  const rows: Row[] = [
    ...(data.slaBreached ?? []).map((x): Row => ({
      key: `sla-${x.loanId}`,
      icon: '⏰',
      tint: ROW_TINT.sla,
      onClick: () => navigate(`/loans/${x.loanId}`),
      content: <><strong>{x.loanNumber}</strong> — {x.status}, overdue {x.daysOverdue}d</>,
    })),
    ...(data.missingDocuments ?? []).map((x): Row => ({
      key: `doc-${x.loanId}`,
      icon: '📄',
      tint: ROW_TINT.docs,
      onClick: () => navigate(`/loans/${x.loanId}`),
      content: <><strong>{x.loanNumber}</strong> — missing {x.missingTypes.join(', ')}</>,
    })),
    ...(data.staleDrafts ?? []).map((x): Row => ({
      key: `draft-${x.loanId}`,
      icon: '💤',
      tint: ROW_TINT.draft,
      onClick: () => navigate('/loans'),
      content: <><strong>{x.label}</strong> — draft untouched {x.daysSinceUpdate}d</>,
    })),
    ...(data.pendingPayoutClaims ?? []).map((x): Row => ({
      key: `claim-${x.claimId}`,
      icon: '💰',
      tint: ROW_TINT.payout,
      onClick: () => navigate('/payout'),
      content: <>Payout claim on <strong>{x.loanApac}</strong> — {formatCurrency(x.claimAmount)}, pending {x.submittedDaysAgo}d</>,
    })),
  ]

  const shown = rows.slice(0, MAX_ROWS)
  const hiddenCount = rows.length - shown.length

  return (
    <div
      className="mb-6 bg-surface px-5 py-[18px]"
      style={{ border: '1.5px solid var(--border)', borderRadius: 16, boxShadow: '0 2px 10px rgba(8,88,151,.07)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-bold" style={{ fontFamily: 'var(--font-head)', color: 'var(--text)' }}>
          Needs your attention
        </p>
        <span className="text-xs font-semibold" style={{ color: 'var(--text3)' }}>
          {data.totalActionItems} {data.totalActionItems === 1 ? 'item' : 'items'}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {shown.map(r => (
          <button
            key={r.key}
            onClick={r.onClick}
            className="flex items-center gap-2 rounded-lg px-2.5 py-[7px] text-left text-[13px] w-full hover:brightness-95 transition"
            style={{ background: r.tint, color: 'var(--text2)' }}
          >
            <span aria-hidden="true">{r.icon}</span>
            <span className="flex-1 min-w-0">{r.content}</span>
          </button>
        ))}
      </div>

      {/* Legacy silently truncated at 8 with no indication; saying so is
          strictly more honest and does not change what the widget does. */}
      {hiddenCount > 0 && (
        <p className="text-[11.5px] mt-2.5" style={{ color: 'var(--text3)' }}>
          +{hiddenCount} more not shown
        </p>
      )}
    </div>
  )
}
