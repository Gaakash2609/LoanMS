import type { ReportData } from '@/api/reportsApi'
import type { LoanListItem } from '@/types'
import { formatDate } from './format'

// Legacy's exportReportCSV/Excel/PDF per-application columns: ID, Name,
// Loan Type, Amount, Bank, Status, Sales Person, Team, Date, City, State,
// CIBIL, Lead Source, Channel, Active Time (Hrs). Only the ones with a real
// equivalent on LoanListItem (the existing GET /api/loans row shape) are
// included below — Bank, Team, City, State, CIBIL, Lead Source, Channel,
// and Active Time have no field anywhere in the authorized loan list
// response (that denormalized data lived only in legacy's monolithic
// client-side application object) and are intentionally omitted rather
// than invented.
function loanRows(loans: LoanListItem[]): (string | number)[][] {
  return loans.map(l => [l.id, l.customerName, l.loanType, l.requestedAmount, l.status, l.createdByName, formatDate(l.createdAt)])
}
const LOAN_ROW_HEADER = ['Application ID', 'Applicant Name', 'Loan Type', 'Amount', 'Status', 'Sales Person', 'Date']

// ── Reports export ───────────────────────────────────────────────────────
// Legacy's exportReportCSV/Excel/PDF pull row-level application data (ID,
// Name, Bank, Sales Person, etc.) straight out of its client-side
// APPLICATIONS array. React's Reports page has no equivalent — it only ever
// loads the aggregated summary from GET /api/reports/summary (status/type
// breakdowns, top agents, monthly disbursements, TAT/DDR). So these exports
// serialize the same aggregate tables already rendered on the page, not
// invented per-application rows. Excel here is legacy's exact technique —
// an HTML table saved with a .xls extension and an Office MIME type, which
// Excel opens natively — not a real XLSX binary, so no library is needed.
// PDF is also legacy's exact technique — a print-styled HTML document opened
// in a new window with window.print() called automatically, letting the
// browser's own "Save as PDF" produce the file — not a generated PDF binary.

function csvEscape(v: string | number) {
  return '"' + String(v ?? '').replace(/"/g, '""') + '"'
}

function csvSection(title: string, header: string[], rows: (string | number)[][]) {
  return [title, header.map(csvEscape).join(','), ...rows.map(r => r.map(csvEscape).join(','))].join('\n')
}

export function buildReportCsv(data: ReportData, scopeLabel: string, loans: LoanListItem[] = []): string {
  const sections = [
    csvSection('Summary', ['Metric', 'Value'], [
      ['Total Portfolio', data.totalPortfolio],
      ['Average Loan Amount', data.averageLoanAmount],
      ['Conversion Rate (%)', data.conversionRate],
      ['Avg TAT (days)', data.avgTatDays],
      ['DDR Ratio (%)', data.ddrRatio],
      ['Disbursed Loans', data.disbursedLoans],
    ]),
    csvSection('Loans by Status', ['Status', 'Count'], data.loansByStatus.map(s => [s.status, s.count])),
    csvSection('Loans by Type', ['Loan Type', 'Count', 'Total Amount'], data.loansByType.map(t => [t.loanType, t.count, t.totalAmount])),
    csvSection('Top Agents', ['Agent', 'Loan Count', 'Total Amount'], data.topAgents.map(a => [a.agentName, a.loanCount, a.totalAmount])),
    csvSection('Monthly Disbursements', ['Month', 'Count', 'Amount'], data.monthlyDisbursements.map(m => [m.month, m.count, m.amount])),
  ]
  if (loans.length) sections.push(csvSection('Applications', LOAN_ROW_HEADER, loanRows(loans)))
  return '\uFEFF' + `Scope: ${scopeLabel} | Generated: ${new Date().toLocaleString('en-IN')}\n\n` + sections.join('\n\n')
}

function htmlTable(header: string[], rows: (string | number)[][]) {
  return `<table>
    <thead><tr>${header.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r, i) => `<tr style="background:${i % 2 === 0 ? '#f8faff' : '#fff'}">${r.map(v => `<td>${v}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>`
}

export function buildReportExcelHtml(data: ReportData, scopeLabel: string, loans: LoanListItem[] = []): string {
  const body = `
    <h2 style="font-family:Arial;color:#1a4fa3">LoanMS — Portfolio Report</h2>
    <p style="font-family:Arial;font-size:12px;color:#666">Scope: ${scopeLabel} | Generated: ${new Date().toLocaleString('en-IN')}</p>
    <h3 style="font-family:Arial;color:#1a4fa3">Loans by Status</h3>
    ${htmlTable(['Status', 'Count'], data.loansByStatus.map(s => [s.status, s.count]))}
    <h3 style="font-family:Arial;color:#1a4fa3">Loans by Type</h3>
    ${htmlTable(['Loan Type', 'Count', 'Total Amount'], data.loansByType.map(t => [t.loanType, t.count, t.totalAmount]))}
    <h3 style="font-family:Arial;color:#1a4fa3">Top Agents</h3>
    ${htmlTable(['Agent', 'Loan Count', 'Total Amount'], data.topAgents.map(a => [a.agentName, a.loanCount, a.totalAmount]))}
    <h3 style="font-family:Arial;color:#1a4fa3">Monthly Disbursements</h3>
    ${htmlTable(['Month', 'Count', 'Amount'], data.monthlyDisbursements.map(m => [m.month, m.count, m.amount]))}
    ${loans.length ? `<h3 style="font-family:Arial;color:#1a4fa3">Applications</h3>${htmlTable(LOAN_ROW_HEADER, loanRows(loans))}` : ''}`
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="UTF-8">
    <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
    <x:Name>LoanMS Report</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
    </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
    <style>td,th{border:1px solid #c8d8f8;padding:6px 10px;font-size:12px;font-family:Arial}th{background:#1a4fa3;color:#fff;font-weight:bold}</style>
    </head><body>${body}</body></html>`
}

export function buildReportPdfHtml(data: ReportData, scopeLabel: string, loans: LoanListItem[] = []): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>LoanMS Report — ${new Date().toLocaleDateString('en-IN')}</title>
<style>
  body{font-family:Arial,sans-serif;margin:24px;color:#1a1a2e;font-size:12px}
  h1{color:#1a4fa3;font-size:20px;margin:0 0 4px} h3{color:#1a4fa3;font-size:14px;margin:20px 0 8px}
  .meta{color:#6b7280;font-size:11px;margin-bottom:16px}
  .stats{display:flex;gap:14px;margin-bottom:20px;flex-wrap:wrap}
  .stat{background:#f0f5ff;border:1px solid #c8d8f8;border-radius:8px;padding:10px 16px;min-width:120px}
  .stat-label{font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px}
  .stat-val{font-size:16px;font-weight:bold;color:#1a4fa3}
  table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:10px}
  th{background:#1a4fa3;color:#fff;padding:7px 8px;text-align:left} td{padding:6px 8px;border-bottom:1px solid #e5e7eb}
  @media print{body{margin:10px}@page{size:landscape;margin:10mm}}
</style></head><body>
<h1>📊 LoanMS — Portfolio Report</h1>
<div class="meta">Scope: <strong>${scopeLabel}</strong> | Generated: ${new Date().toLocaleString('en-IN')}</div>
<div class="stats">
  <div class="stat"><div class="stat-label">Total Portfolio</div><div class="stat-val">₹${Number(data.totalPortfolio || 0).toLocaleString('en-IN')}</div></div>
  <div class="stat"><div class="stat-label">Conversion Rate</div><div class="stat-val">${data.conversionRate}%</div></div>
  <div class="stat"><div class="stat-label">Avg TAT</div><div class="stat-val">${data.avgTatDays.toFixed(1)}d</div></div>
  <div class="stat"><div class="stat-label">Disbursed</div><div class="stat-val">${data.disbursedLoans}</div></div>
</div>
<h3>Loans by Status</h3>${htmlTable(['Status', 'Count'], data.loansByStatus.map(s => [s.status, s.count]))}
<h3>Loans by Type</h3>${htmlTable(['Loan Type', 'Count', 'Total Amount'], data.loansByType.map(t => [t.loanType, t.count, t.totalAmount]))}
<h3>Top Agents</h3>${htmlTable(['Agent', 'Loan Count', 'Total Amount'], data.topAgents.map(a => [a.agentName, a.loanCount, a.totalAmount]))}
<h3>Monthly Disbursements</h3>${htmlTable(['Month', 'Count', 'Amount'], data.monthlyDisbursements.map(m => [m.month, m.count, m.amount]))}
${loans.length ? `<h3>Applications</h3>${htmlTable(LOAN_ROW_HEADER, loanRows(loans))}` : ''}
<script>window.onload=function(){window.print();}</script>
</body></html>`
}

export function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Opens the PDF-styled HTML in a new tab; falls back to a download if the
// popup is blocked — matches legacy's exportReportPDF exactly.
export function openReportPdfPreview(html: string): 'opened' | 'blocked' {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 3000)
  return win ? 'opened' : 'blocked'
}
