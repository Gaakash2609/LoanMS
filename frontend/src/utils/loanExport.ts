import type { LoanListItem } from '@/types'
import { formatDate } from './format'

// Subset of legacy's EXPORT_COLS whose underlying data actually exists on
// React's LoanListItem (the data the Loans list already loads). Most of
// legacy's 60+ columns — KYC/address/document-check/reference fields — live
// only in the legacy monolith's denormalized in-memory application object
// and have no equivalent field on LoanListItem or its backing endpoint; they
// are intentionally not included here rather than invented. A few real
// fields not in legacy's list (Loan Number, Approved Amount, Interest Rate,
// Tenure, Assigned To) are included since they're genuinely on the data.
export interface ExportColumn {
  key: string
  label: string
  checked: boolean
  get: (l: LoanListItem) => string
}

export function defaultExportColumns(): ExportColumn[] {
  return [
    { key: 'id', label: 'Application ID', checked: true, get: l => String(l.id) },
    { key: 'loanNumber', label: 'Loan Number', checked: true, get: l => l.loanNumber },
    { key: 'name', label: 'Customer Name', checked: true, get: l => l.customerName },
    { key: 'mobile', label: 'Mobile', checked: true, get: l => l.customerPhone },
    { key: 'loanType', label: 'Loan Type', checked: true, get: l => l.loanType },
    { key: 'amount', label: 'Loan Amount (₹)', checked: true, get: l => String(l.requestedAmount) },
    { key: 'approvedAmount', label: 'Approved Amount (₹)', checked: false, get: l => l.approvedAmount != null ? String(l.approvedAmount) : '' },
    { key: 'loanRate', label: 'Interest Rate (%)', checked: false, get: l => String(l.interestRate) },
    { key: 'tenure', label: 'Tenure (months)', checked: false, get: l => String(l.tenureMonths) },
    { key: '_emi', label: 'Approx. EMI (₹)', checked: false, get: l => l.monthlyEmi != null ? String(l.monthlyEmi) : '' },
    { key: 'status', label: 'Status', checked: true, get: l => l.status },
    { key: 'sales', label: 'Created By', checked: true, get: l => l.createdByName },
    { key: 'rm', label: 'Assigned To', checked: false, get: l => l.assignedToName || '' },
    { key: 'date', label: 'Created Date', checked: true, get: l => formatDate(l.createdAt) },
  ]
}

function csvEscape(v: string) {
  return '"' + (v ?? '').replace(/"/g, '""') + '"'
}

// Generic CSV builder reused by the small admin-table "Export CSV" buttons
// (Banks, LenderConfig Companies/Categories/Lines, DSA) — same escaping
// rules as buildLoansCsv above, just without being tied to LoanListItem.
export function buildCsv(header: string[], rows: (string | number)[][]): string {
  const lines = [header.map(h => csvEscape(String(h))).join(',')]
  rows.forEach(r => lines.push(r.map(v => csvEscape(String(v ?? ''))).join(',')))
  return lines.join('\n')
}

// Matches legacy doExport's CSV branch: comma-joined, double-quote-escaped
// fields, one row per loan.
export function buildLoansCsv(loans: LoanListItem[], columns: ExportColumn[]): string {
  const active = columns.filter(c => c.checked)
  const header = active.map(c => csvEscape(c.label)).join(',')
  const rows = loans.map(l => active.map(c => csvEscape(c.get(l))).join(','))
  return [header, ...rows].join('\n')
}

export function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
