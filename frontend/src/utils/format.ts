import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { CSSProperties } from 'react'

// These two imports were commented out in favour of local stubs, and the stubs
// were subtly wrong in a way that broke styling across the whole app:
//
//   const clsx = (...classes: any[]) => classes.filter(Boolean).join(' ')
//
// cn() calls clsx(inputs) — passing the rest-parameter ARRAY as a single
// argument. So `classes` was [[a, b, c]], a one-element array, and join(' ')
// stringified the inner array with Array.prototype.toString() — which joins
// with COMMAS. cn('a','b','c') returned "a,b,c": one invalid class token
// instead of three classes. Everything after the first argument was silently
// dropped, so every conditional class, every variant, and every per-instance
// className override on a cn()-based component did nothing. That is a large
// part of why the React screens rendered flatter than the legacy ones.
//
// The stub twMerge was also a no-op pass-through, so Tailwind conflicts
// (e.g. a caller's px-4 against a base px-3) were never resolved — which is
// the entire reason cn() wraps twMerge in the first place.
//
// Both packages are installed and declared in package.json (clsx ^2.1.1,
// tailwind-merge ^3.6.0), so the real implementations are used again.

// Formatting utilities
const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const NUM = new Intl.NumberFormat('en-IN')

export const formatCurrency = (n?: number | null) => n != null ? INR.format(n) : '—'
export const formatNumber   = (n?: number | null) => n != null ? NUM.format(n) : '—'

export const formatDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export const formatDateTime = (d?: string | null) =>
  d ? new Date(d).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }) : '—'

export const formatRelativeDate = (d?: string | null) => {
  if (!d) return '—'
  const diff = Date.now() - new Date(d).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return formatDate(d)
}

// Legacy builds its loan-status pill directly off the raw status value:
// `<span class="badge badge-${a.status}">` (efin-app.js), and app.css
// defines badge-draft/-login/-underwriting/-approved/-disbursed/-rejected
// (:2921-2996) with rgba-tinted backgrounds + accent-toned text -- not
// Tailwind's stock bg-X-100/text-X-700 pairs this used before. Legacy's own
// status vocabulary (draft/login/underwriting/hold/offer/decision/...) is
// richer than and doesn't line up 1:1 with the 7-value LoanStatus enum this
// app actually persists, so each enum value below picks legacy's closest
// semantic stage rather than an invented color:
//   Draft->draft, Submitted->login (legacy's earliest post-creation stage),
//   UnderReview->underwriting, Approved->approved, Disbursed->disbursed,
//   Rejected->rejected. Closed has no clean legacy equivalent -- the
//   nearest same-named class, badge-Complete/-COMPLETE, is a jarring red
//   (rgba(212,43,43,...) + --accent2) that reads as an error/rejection, and
//   turns up in a context (role-badge/ticket markup) that looks unrelated
//   to loan status -- using it for a plain "closed" loan seemed more likely
//   to mislead than to help, so this instead reuses draft's neutral gray.
//   Flagged rather than guessed silently: worth a human decision.
export const STATUS_COLORS: Record<string, CSSProperties> = {
  Draft:       { background: 'rgba(138, 150, 180, .15)', color: '#8a96b4' },
  Submitted:   { background: 'rgba(26, 79, 163, .12)',   color: 'var(--accent)' },
  UnderReview: { background: 'rgba(161, 89, 255, .15)',  color: '#a159ff' },
  Approved:    { background: 'rgba(0, 212, 170, .15)',   color: 'var(--accent2)' },
  Disbursed:   { background: 'rgba(26, 115, 64, .12)',   color: '#1a7340' },
  Rejected:    { background: 'rgba(255, 69, 96, .15)',   color: 'var(--danger)' },
  Closed:      { background: 'rgba(138, 150, 180, .15)', color: '#8a96b4' },
  // Held loans use the warn/amber treatment (legacy's hold color #e67e00).
  OnHold:      { background: 'rgba(230, 126, 0, .14)',   color: 'var(--warn)' },
  // Deviation awaiting decision — legacy's amber/purple 'decision' treatment.
  Decision:    { background: 'rgba(161, 89, 255, .15)',  color: '#a159ff' },
  // Deal confirmation sent, awaiting customer reply / NACH+Agreement —
  // legacy's 'acceptance' stage. Distinct teal so it doesn't collide with
  // Approved's green or Decision's purple.
  Acceptance:  { background: 'rgba(10, 161, 161, .15)',  color: '#0aa1a1' },
}

// Business-facing labels for the loan status enum — legacy renders these
// (efin-app.js STATUSES map, :1419) everywhere it shows a status, never the
// raw enum. React's StatusBadge was printing the enum name ("Submitted"),
// so the applications table read "Submitted" where the reference reads
// "Assign Lender". Keyed on the API enum's own .ToString() names; anything
// unmapped falls back to the raw value in StatusBadge.
export const STATUS_LABELS: Record<string, string> = {
  Draft:       'Personal Details',
  Submitted:   'Assign Lender',
  UnderReview: 'Underwriting',
  Approved:    'Approved',
  Disbursed:   'Disbursed',
  Rejected:    'Rejected',
  OnHold:      'Hold',
  Closed:      'Closed',
  Decision:    'Deviation',
  Acceptance:  'Acceptance',
}

// Not currently consumed anywhere (Tasks/Tickets build their own variant
// maps against the generic Badge component instead) -- corrected for the
// same reason as STATUS_COLORS rather than left with the stock Tailwind
// pairs, since exporting a mismatched palette is itself a latent mismatch
// the moment something starts using it.
export const PRIORITY_COLORS: Record<string, CSSProperties> = {
  High:   { background: 'rgba(255, 69, 96, .15)',  color: 'var(--danger)' },
  Medium: { background: 'rgba(255, 179, 71, .15)', color: 'var(--warn)' },
  Low:    { background: 'rgba(0, 212, 170, .15)',  color: 'var(--accent2)' },
}

// Keyed by the backend enum's own .ToString() names (what the API actually
// returns via LoanType.ToString()) — Car/LAP/Overdraft — so the label shows
// instead of the raw enum name. The extra NewCar/UsedCar/AgainstProperty
// aliases are kept for any caller that still passes those.
export const LOAN_TYPE_LABELS: Record<string, string> = {
  Personal: 'Personal Loan', Business: 'Business Loan', Home: 'Home Loan',
  Car: 'Car Loan', LAP: 'LAP', Education: 'Education', Overdraft: 'Overdraft / CC',
  NewCar: 'New Car', UsedCar: 'Used Car', AgainstProperty: 'LAP', Insurance: 'Insurance',
}

// CIBIL tier — centralizes the >=750/>=650 bands that CustomersPage and
// CustomerDetailPage each independently re-implemented (same thresholds and
// Excellent/Good/Needs Improvement/Not Available labels as before; this is
// only a dedupe, not a business-rule change).
export type CibilTier = 'excellent' | 'good' | 'poor' | 'unknown'

export function cibilTier(score?: number | null): CibilTier {
  if (score == null) return 'unknown'
  if (score >= 750) return 'excellent'
  if (score >= 650) return 'good'
  return 'poor'
}

export function cibilTierMeta(score?: number | null): { label: string; color: string; tint: string } {
  switch (cibilTier(score)) {
    case 'excellent': return { label: 'Excellent',           color: 'var(--success)', tint: 'rgba(26, 115, 64, .12)' }
    case 'good':       return { label: 'Good',                color: 'var(--warn)',    tint: 'rgba(230, 126, 0, .12)' }
    case 'poor':       return { label: 'Needs Improvement',   color: 'var(--danger)',  tint: 'rgba(192, 57, 43, .1)' }
    default:           return { label: 'Not Available',       color: 'var(--text3)',  tint: 'var(--surface2)' }
  }
}

// cn() using clsx + tailwind-merge — handles conditional classes properly
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
