import type { LoanListItem } from '@/types'
import { formatDate } from './format'
import { downloadBlob, htmlTable, wrapExcelHtml } from './reportExport'
import { csvEscape } from './csv'

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

// ── Excel (.xls) export ──────────────────────────────────────────────────
// Restores legacy doExport's XLSX branch (exportXLSX), which was the modal's
// DEFAULT format. Uses the same Office-HTML technique the Reports export
// already uses — wrapExcelHtml/htmlTable are imported from reportExport.ts
// rather than re-implemented here, so there is exactly one copy of that
// markup. No spreadsheet library is added.
//
// Cell values are HTML-escaped first: unlike the Reports export (whose cells
// are server-side enum names and numbers), these rows carry free-text
// customer names that can legitimately contain & or <.
function htmlEscape(v: string) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function buildLoansExcelHtml(loans: LoanListItem[], columns: ExportColumn[]): string {
  const active = columns.filter(c => c.checked)
  const header = active.map(c => htmlEscape(c.label))
  const rows = loans.map(l => active.map(c => htmlEscape(c.get(l))))
  const body = `
    <h2 style="font-family:Arial;color:#1a4fa3">LoanMS — Applications Export</h2>
    <p style="font-family:Arial;font-size:12px;color:#666">Rows: ${loans.length} | Generated: ${new Date().toLocaleString('en-IN')}</p>
    ${htmlTable(header, rows)}`
  return wrapExcelHtml('Applications', body)
}

// ── PDF export ───────────────────────────────────────────────────────────
// Restores legacy doExport's PDF branch (efin-app.js:36180 → exportPDF at
// :36202). Legacy's technique, unchanged: a print-styled HTML document opened
// in a new window that calls window.print() itself, letting the browser's own
// "Save as PDF" produce the file — no PDF library. That is the same mechanism
// reportExport.ts already uses for the Reports PDF, so openReportPdfPreview()
// is reused for the window-opening and popup-blocked handling rather than
// duplicated here.
//
// Legacy's two layout rules are preserved verbatim:
//   • A4 landscape, brand-blue header band, zebra rows (efin-app.js:36217-36231)
//   • at most 12 columns, with a red note pointing at XLSX/CSV for the rest
//     (:36209 and :36243) — a wide column set is unreadable on one A4 page.
const PDF_MAX_COLS = 12

export function buildLoansPdfHtml(loans: LoanListItem[], columns: ExportColumn[]): string {
  const active = columns.filter(c => c.checked)
  const shown = active.slice(0, PDF_MAX_COLS)
  const truncated = active.length > PDF_MAX_COLS

  const header = shown.map(c => htmlEscape(c.label))
  // Legacy renders an em-dash for blank cells (efin-app.js:36213).
  const rows = loans.map(l => shown.map(c => htmlEscape(c.get(l)) || '—'))
  const stamp = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Applications Export — ${stamp}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #111; }
  .hdr { display:flex; justify-content:space-between; align-items:flex-end; padding-bottom:8px; border-bottom:2px solid #1a4fa3; margin-bottom:10px; }
  .hdr-title { font-size:15pt; font-weight:800; color:#1a4fa3; }
  .hdr-meta { font-size:8pt; color:#555; text-align:right; line-height:1.5; }
  table { width:100%; border-collapse:collapse; font-size:8pt; }
  thead tr { background:#1a4fa3; color:#fff; }
  thead th { padding:5px 6px; text-align:left; font-weight:700; white-space:nowrap; }
  tbody tr:nth-child(even) { background:#f0f4ff; }
  tbody td { padding:4px 6px; border-bottom:1px solid #dde3f0; vertical-align:top; }
  .truncate-note { color:#e31e25; font-size:8pt; margin-bottom:6px; }
  .footer { margin-top:10px; font-size:7.5pt; color:#888; text-align:right; }
</style></head><body>
<div class="hdr">
  <div>
    <div class="hdr-title">Applications Export</div>
    <div style="font-size:9pt;color:#444;margin-top:2px">${loans.length} record${loans.length === 1 ? '' : 's'} · Generated ${stamp}</div>
  </div>
  <div class="hdr-meta">${new Date().toLocaleTimeString('en-IN')}</div>
</div>
${truncated ? `<div class="truncate-note">⚠ PDF shows the first ${PDF_MAX_COLS} columns. Use Excel or CSV for all ${active.length} columns.</div>` : ''}
<table><thead><tr>${header.map(h => `<th>${h}</th>`).join('')}</tr></thead>
<tbody>${rows.map(r => `<tr>${r.map(v => `<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table>
<div class="footer">Mudrahub Loan Management System — Confidential</div>
<script>window.onload=function(){window.print();}</script>
</body></html>`
}

export function downloadCsv(csv: string, filename: string) {
  downloadBlob(csv, filename, 'text/csv')
}
