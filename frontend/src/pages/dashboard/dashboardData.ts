// Dashboard presentational metadata + pure helpers — extracted verbatim
// from DashboardPage.tsx (code-quality refactor, no behaviour change).
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
export const STAGE_META: Record<LoanStatus, { label: string; color: string }> = {
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
export const STAGE_ORDER: LoanStatus[] = ['Submitted', 'UnderReview', 'Approved', 'Disbursed', 'OnHold', 'Rejected']

// Keyed by the backend LoanType.ToString() names the API actually returns
// (Car/LAP/Overdraft), so the breakdown shows real labels instead of the raw
// enum string. The NewCar/UsedCar/AgainstProperty aliases are retained only
// to satisfy the LoanType union; the API never emits them.
export const LOAN_TYPE_META: Record<LoanType, { label: string; color: string }> = {
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
export const VARIANTS = {
  blue:   { accent: 'var(--accent)',  num: 'var(--accent)',  tint: 'rgba(10, 88, 154, .1)',  shadow: 'rgba(10, 88, 154, .3)',  emoji: '📋' },
  green:  { accent: 'var(--success)', num: 'var(--accent2)', tint: 'rgba(227, 30, 37, .1)',  shadow: 'rgba(26, 115, 64, .3)',  emoji: '✅' },
  orange: { accent: 'var(--warn)',    num: 'var(--accent3)', tint: 'rgba(230, 126, 0, .1)',  shadow: 'rgba(230, 126, 0, .3)',  emoji: '⚡' },
  red:    { accent: 'var(--danger)',  num: 'var(--danger)',  tint: 'rgba(227, 30, 37, .1)',  shadow: 'rgba(227, 30, 37, .3)',  emoji: '🚫' },
} as const

export type VariantKey = keyof typeof VARIANTS

export function computePipelineStages(loans: LoanListItem[]) {
  return STAGE_ORDER
    .map(status => ({ status, ...STAGE_META[status], count: loans.filter(l => l.status === status).length }))
    .filter(s => s.count > 0)
}

// Legacy renderActivity()'s timeAgo (efin-app.js:13693) — verbatim buckets.
export function timeAgo(iso: string): string {
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
