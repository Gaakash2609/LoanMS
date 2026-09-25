import type { LoanFilter, LoanStatus } from '@/types'

// ── Applications → Advanced Filter ──────────────────────────────────────
// Ports legacy's advFilter surface (efin-app.js:35119-35630): the filter
// modal, its date chips, CIBIL bands, active-filter chips, saved presets and
// the export scope selector.
//
// Legacy filters entirely client-side over its own local APPLICATIONS array.
// Here the fields the API can filter (status / loan type / date range /
// search / assignee) are pushed to the server, and only the ones it cannot
// are evaluated on the returned rows — same result, without pulling the whole
// table into the browser.

export type DateMode =
  | '' | 'today' | 'yesterday' | '7days' | '15days' | '30days'
  | '90days' | 'mtd' | 'qtd' | 'ytd' | 'custom'

/** Legacy's chip set and labels, in legacy's order (index.html setAdvDate). */
export const DATE_MODES: { mode: Exclude<DateMode, ''>; label: string }[] = [
  { mode: 'today',     label: 'Today' },
  { mode: 'yesterday', label: 'Yesterday' },
  { mode: '7days',     label: 'Last 7 Days' },
  { mode: '15days',    label: 'Last 15 Days' },
  { mode: '30days',    label: 'Last 30 Days' },
  { mode: '90days',    label: 'Last 90 Days' },
  { mode: 'mtd',       label: 'MTD' },
  { mode: 'qtd',       label: 'QTD' },
  { mode: 'ytd',       label: 'YTD' },
  { mode: 'custom',    label: 'Custom' },
]

/** Legacy's four bands, with their exact data-min / data-max bounds. */
export const CIBIL_BANDS: { label: string; min: number; max: number }[] = [
  { label: 'Poor <550',      min: 300, max: 549 },
  { label: 'Fair 550-649',   min: 550, max: 649 },
  { label: 'Good 650-749',   min: 650, max: 749 },
  { label: 'Excellent 750+', min: 750, max: 900 },
]

export type ExportScope = 'filtered' | 'all' | 'disbursed' | 'pending' | 'rejected'

/** Legacy's export scope chips (afSetExportScope). */
export const EXPORT_SCOPES: { scope: ExportScope; label: string }[] = [
  { scope: 'filtered',  label: 'Current View / Filters' },
  { scope: 'all',       label: 'All Applications' },
  { scope: 'disbursed', label: 'Disbursed Only' },
  { scope: 'pending',   label: 'Active Pipeline' },
  { scope: 'rejected',  label: 'Rejected Only' },
]

/**
 * Legacy's advFilter set, minus one key. `leadsrc` is deliberately absent:
 * the wizard only ever writes it into a tracking-note string, there is no
 * column, no DTO field and no capture of it in the React wizard either, so a
 * Lead Source control would have nothing to filter on.
 *
 * Everything else here is backed by a real column, and every key is sent to
 * the server (see advToServerFilter) — none is evaluated on one page only.
 */
export interface AdvFilter {
  status: string
  loanType: string
  dateMode: DateMode
  dateFrom: string
  dateTo: string
  amountMin: string
  amountMax: string
  cibilMin: string
  cibilMax: string
  salesPerson: string
  // ── The rest of legacy's advFilter set ──
  location: string
  channel: string
  bank: string
  purpose: string
  empType: string
  city: string
  state: string
  gender: string
  salaryMin: string
  salaryMax: string
  dsaName: string
  linkedPartner: string
  companyName: string
}

export const EMPTY_ADV_FILTER: AdvFilter = {
  status: '', loanType: '', dateMode: '', dateFrom: '', dateTo: '',
  amountMin: '', amountMax: '', cibilMin: '', cibilMax: '', salesPerson: '',
  location: '', channel: '', bank: '', purpose: '', empType: '',
  city: '', state: '', gender: '', salaryMin: '', salaryMax: '',
  dsaName: '', linkedPartner: '', companyName: '',
}

/** Legacy's FIELD_LABELS for the active-filter chips (_afUpdateActiveChips). */
export const FIELD_LABELS: Record<keyof AdvFilter, string> = {
  status: 'Status', loanType: 'Type', dateMode: 'Date',
  dateFrom: 'From', dateTo: 'To',
  amountMin: 'Min ₹', amountMax: 'Max ₹',
  cibilMin: 'CIBIL ≥', cibilMax: 'CIBIL ≤',
  salesPerson: 'Sales',
  location: 'Location', channel: 'Channel', bank: 'Bank', purpose: 'Purpose',
  empType: 'Emp.', city: 'City', state: 'State', gender: 'Gender',
  salaryMin: 'Sal ≥', salaryMax: 'Sal ≤',
  dsaName: 'DSA', linkedPartner: 'Partner', companyName: 'Company',
}

/**
 * Pulls one of the wizard's "Source: x | Channel: y | Lead Source: z" values
 * back out of Loan.Remarks. The backend stores them that way and already
 * parses them the same way in WizardController.GetDraft, so this reads the
 * value the wizard actually wrote rather than inventing a new field.
 */
export function fromRemarks(remarks: string | null | undefined, key: string): string {
  if (!remarks) return ''
  const m = remarks.match(new RegExp(key + String.raw`:\s*([^|]+?)\s*(\||$)`))
  return m ? m[1].trim() : ''
}

/** Legacy counts every non-empty key — including dateFrom/dateTo. */
export function activeFilterCount(f: AdvFilter): number {
  return (Object.keys(f) as (keyof AdvFilter)[]).filter(k => !!f[k]).length
}

/**
 * Resolves a date chip to an inclusive [from, to] pair, matching legacy's
 * arithmetic in _applyAdvFilterToApps exactly — day boundaries at local
 * midnight, "last N days" counted inclusively (7days = today plus the 6
 * before it), MTD/QTD/YTD from the start of the current period.
 * Returns nulls when no date mode is set.
 */
export function resolveDateRange(f: AdvFilter): { from: string | null; to: string | null } {
  if (f.dateMode === 'custom') {
    return { from: f.dateFrom || null, to: f.dateTo || null }
  }
  if (!f.dateMode) return { from: null, to: null }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const iso = (d: Date) => {
    const t = new Date(d)
    t.setMinutes(t.getMinutes() - t.getTimezoneOffset())
    return t.toISOString().slice(0, 10)
  }
  const back = (days: number) => {
    const d = new Date(today)
    d.setDate(d.getDate() - days)
    return d
  }

  switch (f.dateMode) {
    case 'today':     return { from: iso(today), to: iso(today) }
    case 'yesterday': return { from: iso(back(1)), to: iso(back(1)) }
    case '7days':     return { from: iso(back(6)), to: iso(today) }
    case '15days':    return { from: iso(back(14)), to: iso(today) }
    case '30days':    return { from: iso(back(29)), to: iso(today) }
    case '90days':    return { from: iso(back(89)), to: iso(today) }
    case 'mtd':       return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) }
    case 'qtd':       return { from: iso(new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1)), to: iso(today) }
    case 'ytd':       return { from: iso(new Date(today.getFullYear(), 0, 1)), to: iso(today) }
    default:          return { from: null, to: null }
  }
}

/**
 * Maps the Advanced Filter onto the server's LoanFilterDto. Every predicate
 * runs on the server, so pagination, totals and export see the whole
 * result set (these used to be evaluated in the browser on the current page
 * only, silently missing matches on other pages). Empty values clear the key.
 */
export function advToServerFilter(f: AdvFilter): Partial<LoanFilter> {
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v))
  const txt = (v: string) => (v.trim() === '' ? undefined : v.trim())
  const { from, to } = resolveDateRange(f)
  return {
    status: (f.status || undefined) as LoanStatus | undefined,
    loanType: f.loanType || undefined,
    dateFrom: from ?? undefined, dateTo: to ?? undefined,
    minAmount: num(f.amountMin), maxAmount: num(f.amountMax),
    minCibil: num(f.cibilMin), maxCibil: num(f.cibilMax),
    minSalary: num(f.salaryMin), maxSalary: num(f.salaryMax),
    salesPerson: txt(f.salesPerson), location: txt(f.location), channel: txt(f.channel),
    bank: txt(f.bank), purpose: txt(f.purpose), empType: txt(f.empType),
    city: txt(f.city), state: txt(f.state), gender: txt(f.gender),
    dsaName: txt(f.dsaName), partnerName: txt(f.linkedPartner), companyName: txt(f.companyName),
  }
}

/** Maps an export scope onto the status the server should filter by. */
export function scopeToStatus(scope: ExportScope): LoanStatus | undefined {
  if (scope === 'disbursed') return 'Disbursed' as LoanStatus
  if (scope === 'rejected')  return 'Rejected' as LoanStatus
  return undefined
}

/** Statuses legacy counts as the active pipeline for the 'pending' scope. */
export const PIPELINE_STATUSES = ['Draft', 'Submitted', 'UnderReview', 'Offer', 'Approved'] as const
