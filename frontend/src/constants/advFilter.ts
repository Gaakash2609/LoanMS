import type { LoanListItem, LoanStatus } from '@/types'

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
 * Everything else here is backed by a real column. status / loanType / the
 * date range go to the server; the rest are evaluated on the returned rows.
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
 * Everything the API cannot express. Status / loan type / dates / search go
 * to the server instead, so they are intentionally absent here.
 *
 * Legacy compares the sales person by exact string against a single `sales`
 * field. This list carries two names — the assignee and the creator — so a
 * row matches when either does, which is what "applications for this person"
 * means to the user in both apps.
 */
export function applyClientSideFilters(rows: LoanListItem[], f: AdvFilter): LoanListItem[] {
  let out = rows
  if (f.amountMin) out = out.filter(r => Number(r.requestedAmount) >= Number(f.amountMin))
  if (f.amountMax) out = out.filter(r => Number(r.requestedAmount) <= Number(f.amountMax))
  if (f.cibilMin)  out = out.filter(r => r.customerCibilScore != null && r.customerCibilScore >= Number(f.cibilMin))
  if (f.cibilMax)  out = out.filter(r => r.customerCibilScore != null && r.customerCibilScore <= Number(f.cibilMax))
  if (f.salesPerson) {
    const want = f.salesPerson.toLowerCase()
    out = out.filter(r =>
      (r.assignedToName ?? '').toLowerCase() === want ||
      (r.createdByName ?? '').toLowerCase() === want)
  }

  // Legacy compares these with exact equality, case-insensitively for the
  // free-text ones (dsaName / linkedPartner / companyName) — reproduced.
  const eq = (v: string | null | undefined, want: string) =>
    (v ?? '').toLowerCase() === want.toLowerCase()

  if (f.location)      out = out.filter(r => eq(r.locationName, f.location))
  if (f.purpose)       out = out.filter(r => eq(r.purpose, f.purpose))
  if (f.bank)          out = out.filter(r => eq(r.selectedLenderNames, f.bank))
  if (f.empType)       out = out.filter(r => eq(r.customerEmploymentType, f.empType))
  if (f.city)          out = out.filter(r => eq(r.customerCity, f.city))
  if (f.state)         out = out.filter(r => eq(r.customerState, f.state))
  if (f.gender)        out = out.filter(r => eq(r.customerGender, f.gender))
  if (f.dsaName)       out = out.filter(r => eq(r.dsaName, f.dsaName))
  if (f.linkedPartner) out = out.filter(r => eq(r.partnerName, f.linkedPartner))
  if (f.companyName)   out = out.filter(r => eq(r.customerCompanyName, f.companyName))
  if (f.channel)       out = out.filter(r => eq(fromRemarks(r.remarks, 'Channel'), f.channel))

  if (f.salaryMin) out = out.filter(r => r.customerMonthlyIncome != null && Number(r.customerMonthlyIncome) >= Number(f.salaryMin))
  if (f.salaryMax) out = out.filter(r => r.customerMonthlyIncome != null && Number(r.customerMonthlyIncome) <= Number(f.salaryMax))

  return out
}

/** Distinct non-empty values for a dropdown, sorted. */
export function distinct(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v && v.trim() !== ''))).sort()
}

/** True when a filter needs the whole result set rather than one page. */
export function needsFullFetch(f: AdvFilter): boolean {
  const serverSide: (keyof AdvFilter)[] = ['status', 'loanType', 'dateMode', 'dateFrom', 'dateTo']
  return (Object.keys(f) as (keyof AdvFilter)[]).some(k => !serverSide.includes(k) && !!f[k])
}

/** Maps an export scope onto the status the server should filter by. */
export function scopeToStatus(scope: ExportScope): LoanStatus | undefined {
  if (scope === 'disbursed') return 'Disbursed' as LoanStatus
  if (scope === 'rejected')  return 'Rejected' as LoanStatus
  return undefined
}

/** Statuses legacy counts as the active pipeline for the 'pending' scope. */
export const PIPELINE_STATUSES = ['Draft', 'Submitted', 'UnderReview', 'Approved'] as const
