// Salary-slip (payslip) extraction — restores legacy efin-app.js's PSE
// (Pay-Slip Extraction) reader: from an uploaded payslip's text it pulls the
// Net Pay + salary Month so the Income Check can be auto-filled instead of
// typed by hand. Faithful port of the essence of legacy pseTryExtract
// (efin-app.js:41973) + pseDetectMonth (:41634): the currency-stripping amount
// parser, the net-pay label synonyms, and the "for the month of …" detection.
// Pure + unit-tested; the vision/PDF plumbing lives in the caller.

const MON = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec'

// Legacy amt(): strips ₹ / Rs. / INR then reads the first amount token → float
// or 0. (Matches the number token rather than blindly deleting non-digits, so a
// leading "Rs." dot can't turn 1,00,000 into 0.1.)
export function parseAmount(s: string | null | undefined): number {
  if (s == null) return 0
  const cleaned = String(s).replace(/\bINR\.?\b/gi, '').replace(/[₹₹]/g, '').replace(/\bRs\.?\b/gi, '')
  const m = cleaned.match(/\d[\d,]*(?:\.\d{1,2})?/)
  if (!m) return 0
  const v = parseFloat(m[0].replace(/,/g, ''))
  return isFinite(v) && v > 0 ? v : 0
}

// Legacy nums(): every amount token in a string (a number with optional Indian
// comma-grouping and up to 2 decimals, kept as one token).
function numsIn(s: string): number[] {
  return [...String(s).matchAll(/\d[\d,]*(?:\.\d{1,2})?/g)]
    .map(m => parseFloat(m[0].replace(/,/g, '')))
    .filter(v => isFinite(v) && v >= 0)
}

// Legacy isNetLabel() synonym set.
const NET_RE = /\bnet\s*(?:pay(?:able)?|salary|sal|take.?home|wage|earnings?|remuneration|amount|income)\b|\bnet\s*payable\b|\b(?:in.?hand|take.?home)\b|\bamount\s*(?:payable|paid|credited|transferred|disbursed)\b|\b(?:salary|sal)\s*(?:payable|paid|credited|after\s*deductions?)\b/i
const GROSS_RE = /\bgross\s*(?:pay|salary|earnings?|total|income)?\b|\btotal\s*earnings?\b/i

function fmtMonth(mon: string, yr: string): string {
  const short = mon.slice(0, 3)
  return short.charAt(0).toUpperCase() + short.slice(1).toLowerCase() + ' ' + yr
}

// Port of pseDetectMonth: prefer an explicit "for the month of …" phrase; else
// the first month+year pair.
export function detectSalaryMonth(text: string): string | null {
  const flat = text.replace(/\s{2,}/g, ' ')
  const priority = [
    new RegExp('pay\\s*slip\\s+for\\s+the\\s+month\\s+of\\s+(' + MON + ')\\s+(\\d{4})', 'i'),
    new RegExp('salary\\s*slip\\s+for\\s+(?:the\\s+month\\s+of\\s+)?(' + MON + ')\\s+(\\d{4})', 'i'),
    new RegExp('(?:pay|salary)\\s*(?:period|month)\\s*[:-]?\\s*(' + MON + ')\\s+(\\d{4})', 'i'),
    new RegExp('for\\s+the\\s+month\\s+of\\s+(' + MON + ')\\s+(\\d{4})', 'i'),
  ]
  for (const p of priority) {
    const m = flat.match(p)
    if (m) return fmtMonth(m[1], m[2])
  }
  const any = flat.match(new RegExp('\\b(' + MON + ')\\s+(\\d{4})\\b', 'i'))
  return any ? fmtMonth(any[1], any[2]) : null
}

export interface SalarySlipData {
  netPay: number | null
  gross: number | null
  month: string | null
}

// Extract Net Pay + Gross + Month from a payslip's text (PDF-extracted text or
// an AI-vision text response). Returns nulls when a field is not confidently
// found (the UI then leaves it for manual entry — exactly like legacy).
export function parseSalarySlip(text: string): SalarySlipData {
  const lines = text.split(/[\n\r]+/).map(l => l.replace(/\s{2,}/g, ' ').trim()).filter(l => l.length > 1)
  const flat = lines.join(' ')
  let netPay: number | null = null
  let gross: number | null = null
  for (const line of lines) {
    if (netPay == null && NET_RE.test(line)) {
      const n = numsIn(line)
      if (n.length) netPay = Math.max(...n)
    }
    if (gross == null && GROSS_RE.test(line)) {
      const n = numsIn(line)
      if (n.length) gross = Math.max(...n)
    }
  }
  // Flat fallback for net pay when it is not on its own labelled line.
  if (netPay == null) {
    const m = flat.match(/(?:net\s*pay(?:able)?|take.?home|in.?hand|amount\s*credited)\s*[:-]?\s*(?:rs\.?|inr|₹)?\s*(\d[\d,]*(?:\.\d{1,2})?)/i)
    if (m) { const v = parseAmount(m[1]); if (v > 0) netPay = v }
  }
  return { netPay, gross, month: detectSalaryMonth(text) }
}

// The prompt handed to the AI-vision relay for image payslips (mirrors legacy's
// "read Month + Net Pay from the payslip" vision call).
export const SALARY_SLIP_VISION_PROMPT =
  'This is a salary slip / payslip. Extract and return ONLY these lines exactly:\n' +
  'MONTH: <salary month and year, e.g. January 2026>\n' +
  'NET_PAY: <net pay / take-home amount in numbers only>\n' +
  'GROSS: <gross salary amount in numbers only>\n' +
  'If a value is not present, write the label with an empty value.'
