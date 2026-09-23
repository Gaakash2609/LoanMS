import React from 'react'
import { STATUS_COLORS, STATUS_LABELS } from '@/utils/format'

// The leading dot + hairline ring (vs. legacy's plain filled pill) is a
// deliberate addition that reads calmer against dense tables and matches
// the KPI accent language used elsewhere -- left as-is, this isn't a
// legacy-vs-React color gap. What WAS a gap: the dot used to carry its own
// second, disconnected palette (arbitrary Tailwind-600 hexes that didn't
// match STATUS_COLORS' own text color), so a status's dot and its own pill
// text could render as two different colors. The dot now just reads
// STATUS_COLORS[status].color directly -- one source of truth, not two.

export function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] ?? { background: 'rgba(138, 150, 180, .15)', color: '#8a96b4' }
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ring-1 ring-inset ring-black/5"
      style={colors}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: colors.color }} />
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

// Each variant maps onto legacy's actual status-badge classes (app.css:2921
// `.badge` + the badge-* colour rules starting :2931), not Tailwind's stock
// green/yellow/red/blue-100/700 pairs used across dozens of call sites
// (Users, Teams, Tickets, Tasks, Payout, Locations, Partners, LenderConfig,
// DSA, InCred, the AI Agent panel...). This is a plain `variant` prop, not
// tied to a specific loan status, so each abstract name is mapped to the
// closest matching legacy badge by meaning:
//   default -> .badge-draft   (neutral/unset)
//   warning -> .badge-wip     (in-progress / caution)
//   danger  -> .badge-rejected
//   info    -> .badge-login   (legacy's own "informational" = accent blue)
//   success -> .badge-approved
// Status-color semantics (this is the generic, non-loan Badge used across
// Users/Teams/Tickets/Tasks/Payout/etc.): each variant reads as its meaning.
// Legacy's own .badge-approved paired a teal-tinted background with --accent2
// (#d42b2b — RED) text, so a "success" badge rendered red ink on teal — a
// legacy authoring inconsistency. For the MudraHub polish pass, status colours
// must be semantically consistent, so `success` now uses the green --success
// token for both its tint and its text (the loan StatusBadge above is
// unaffected; this only touches the abstract variant palette).
const BADGE_VARIANTS: Record<'default' | 'success' | 'warning' | 'danger' | 'info', React.CSSProperties> = {
  default: { background: 'rgba(138, 150, 180, .15)', color: '#8a96b4' },
  success: { background: 'rgba(26, 115, 64, .13)',   color: 'var(--success)' },
  warning: { background: 'rgba(255, 179, 71, .15)',  color: 'var(--warn)' },
  danger:  { background: 'rgba(255, 69, 96, .15)',   color: 'var(--danger)' },
  info:    { background: 'rgba(8, 88, 151, .12)',   color: 'var(--accent)' },
}

export function Badge({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' }) {
  return (
    <span
      className="inline-block px-2.5 py-[3px] rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{ letterSpacing: '.3px', ...BADGE_VARIANTS[variant] }}
    >
      {children}
    </span>
  )
}
