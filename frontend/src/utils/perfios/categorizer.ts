// ── Transaction type detection & categorization ─────────────────────────
// Ported unchanged from perfios-core.js lines 81-365 (pattern tables +
// detector/getter functions) and 1282-1310 (categorize). Every regex is
// copied verbatim; only TypeScript typing was added around them.
// (Legacy's NEFT_SEP/NEFT_BOUND constants were dead — built but never
// referenced by the actual NEFT_PATTERNS below, which use _neftRe's own
// inline pattern string instead — so they are not carried over here;
// dropping unused, never-read constants changes no behavior.)

interface SubTypePattern { re: RegExp; sub: string }
interface BouncePattern { re: RegExp; sub: string; inward: boolean | null }

// ── Salary keyword patterns (Req 3) ──
export const SALARY_PATTERNS: RegExp[] = [
  /\bSAL\b/i,
  /\bSALARY\b/i,
  /\bSALARIES\b/i,
  /\bPAYROLL\b/i,
  /\bPAY\s*ROLL\b/i,
  /\bINCOME\b/i,
  /\bMONTHLY\s*PAY\b/i,
  /\bEMPLOYEE\s*PAY\b/i,
  /\bSTIPEND\b/i,
  /\bREMUNERATION\b/i,
  /\bHR\s*SALARY\b/i,
  /\bSAL\s*CREDIT\b/i,
  /\bMONTHLY\s*CREDIT\b/i,
  /\bWAGES?\b/i,
  /\bMONTHLY\s*WAGES?\b/i,
]

export function isSalaryTxn(desc: string): boolean {
  return SALARY_PATTERNS.some(p => p.test(desc))
}
export function getSalaryKeyword(desc: string): string {
  for (const p of SALARY_PATTERNS) {
    const m = desc.match(p)
    if (m) return m[0].toUpperCase()
  }
  return ''
}

// ── ACH keyword patterns ── (ACH = Automated Clearing House / NACH in India)
export const ACH_PATTERNS: SubTypePattern[] = [
  { re: /\bACH\b/i, sub: 'ACH Generic' },
  { re: /\bNACH\b/i, sub: 'NACH (National ACH)' },
  { re: /\bACH\s*CR\b/i, sub: 'ACH Credit' },
  { re: /\bACH\s*DR\b/i, sub: 'ACH Debit' },
  { re: /\bNACH\s*CR\b/i, sub: 'NACH Credit' },
  { re: /\bNACH\s*DR\b/i, sub: 'NACH Debit' },
  { re: /\bDIRECT\s*DEBIT\b/i, sub: 'Direct Debit (ACH)' },
  { re: /\bDIRECT\s*CREDIT\b/i, sub: 'Direct Credit (ACH)' },
  { re: /\bMANDATE\b/i, sub: 'ACH Mandate' },
  { re: /\bACH\s*MANDATE\b/i, sub: 'ACH Mandate' },
  { re: /\bNACH\s*MANDATE\b/i, sub: 'NACH Mandate' },
  { re: /\bSI\s*DEBIT\b/i, sub: 'SI Debit (ACH)' },
  { re: /\bSTANDING\s*INST/i, sub: 'Standing Instruction (ACH)' },
  { re: /\bAUTO\s*PAY\b/i, sub: 'Auto Pay (ACH)' },
  { re: /\bAUTO\s*DEBIT\b/i, sub: 'Auto Debit (ACH)' },
  { re: /\bRECURRING\s*DEBIT\b/i, sub: 'Recurring Debit (ACH)' },
  { re: /\bSWEEP\b/i, sub: 'Sweep (ACH)' },
  { re: /\bBULK\s*PAYMENT\b/i, sub: 'Bulk Payment (ACH)' },
  { re: /\bVPAY\b/i, sub: 'VPAY / ACH' },
  { re: /\bCLEARING\b/i, sub: 'Clearing (ACH)' },
]

export function isACHTxn(desc: string): boolean {
  return ACH_PATTERNS.some(p => p.re.test(desc))
}
export function getACHSubType(desc: string): string {
  for (const p of ACH_PATTERNS) { if (p.re.test(desc)) return p.sub }
  return 'ACH'
}
export function getACHKeyword(desc: string): string {
  for (const p of ACH_PATTERNS) { const m = desc.match(p.re); if (m) return m[0].toUpperCase() }
  return ''
}

// ── ECS keyword patterns ── (ECS = Electronic Clearing Service, RBI legacy batch clearing)
export const ECS_PATTERNS: SubTypePattern[] = [
  { re: /\bECS\b/i, sub: 'ECS Generic' },
  { re: /\bECS\s*CR\b/i, sub: 'ECS Credit' },
  { re: /\bECS\s*DR\b/i, sub: 'ECS Debit' },
  { re: /\bECS\s*CREDIT\b/i, sub: 'ECS Credit' },
  { re: /\bECS\s*DEBIT\b/i, sub: 'ECS Debit' },
  { re: /\bECS\s*RETURN\b/i, sub: 'ECS Return / Bounce' },
  { re: /\bECS\s*BOUNCE\b/i, sub: 'ECS Return / Bounce' },
  { re: /\bECS\s*REJ\b/i, sub: 'ECS Rejected' },
  { re: /\bECS\s*REJECT/i, sub: 'ECS Rejected' },
  { re: /\bECS\s*MANDATE\b/i, sub: 'ECS Mandate' },
  { re: /\bECS\s*EMI\b/i, sub: 'ECS EMI Deduction' },
  { re: /\bECS\s*LOAN\b/i, sub: 'ECS Loan Repayment' },
  { re: /\bECS\s*INSUR/i, sub: 'ECS Insurance Premium' },
  { re: /\bECS\s*SIP\b/i, sub: 'ECS SIP / Investment' },
  { re: /\bECS\s*UTIL\b/i, sub: 'ECS Utility' },
  { re: /\bECS\s*MF\b/i, sub: 'ECS Mutual Fund SIP' },
  { re: /\bECS\s*INWARD\b/i, sub: 'ECS Inward Credit' },
  { re: /\bECS\s*OUTWARD\b/i, sub: 'ECS Outward Debit' },
  { re: /\bECS\s*CLG\b/i, sub: 'ECS Clearing' },
  { re: /\bECS\s*CHRG\b/i, sub: 'ECS Charge' },
]

export function isECSTxn(desc: string): boolean {
  return ECS_PATTERNS.some(p => p.re.test(desc))
}
export function getECSSubType(desc: string): string {
  for (const p of ECS_PATTERNS) { if (p.re.test(desc)) return p.sub }
  return 'ECS'
}
export function getECSKeyword(desc: string): string {
  for (const p of ECS_PATTERNS) { const m = desc.match(p.re); if (m) return m[0].toUpperCase() }
  return ''
}

// ── NEFT / RTGS keyword patterns ──
function _neftRe(pat: string): RegExp {
  return new RegExp('(?:^|[^A-Za-z])' + pat + '(?:[^A-Za-z]|$)', 'i')
}

export const NEFT_PATTERNS: SubTypePattern[] = [
  { re: /(?:^|[^A-Za-z])RTGS\/[A-Z0-9]+\//i, sub: 'RTGS Generic' },
  { re: _neftRe('RTGS[\\s\\-\\/]*RETURN'), sub: 'RTGS Return' },
  { re: _neftRe('RTGS[\\s\\-\\/]*REJECT'), sub: 'RTGS Rejected' },
  { re: _neftRe('RTGS[\\s\\-\\/]*INWARD'), sub: 'RTGS Inward' },
  { re: _neftRe('RTGS[\\s\\-\\/]*OUTWARD'), sub: 'RTGS Outward' },
  { re: _neftRe('RTGS[\\s\\-\\/]*CR'), sub: 'RTGS Credit' },
  { re: _neftRe('RTGS[\\s\\-\\/]*DR'), sub: 'RTGS Debit' },
  { re: _neftRe('RTGS[\\s\\-\\/]*CREDIT'), sub: 'RTGS Credit' },
  { re: _neftRe('RTGS[\\s\\-\\/]*DEBIT'), sub: 'RTGS Debit' },
  { re: _neftRe('RTGS'), sub: 'RTGS Generic' },
  { re: /(?:^|[^A-Za-z])NEFT\/[A-Z0-9]+\//i, sub: 'NEFT Generic' },
  { re: _neftRe('NEFT[\\s\\-\\/]*RETURN'), sub: 'NEFT Return' },
  { re: _neftRe('NEFT[\\s\\-\\/]*REJECT'), sub: 'NEFT Rejected' },
  { re: _neftRe('NEFT[\\s\\-\\/]*INWARD'), sub: 'NEFT Inward' },
  { re: _neftRe('NEFT[\\s\\-\\/]*OUTWARD'), sub: 'NEFT Outward' },
  { re: _neftRe('NEFT[\\s\\-\\/]*CR'), sub: 'NEFT Credit' },
  { re: _neftRe('NEFT[\\s\\-\\/]*DR'), sub: 'NEFT Debit' },
  { re: _neftRe('NEFT[\\s\\-\\/]*CREDIT'), sub: 'NEFT Credit' },
  { re: _neftRe('NEFT[\\s\\-\\/]*DEBIT'), sub: 'NEFT Debit' },
  { re: _neftRe('NEFT'), sub: 'NEFT Generic' },
  { re: /NEFT\s*[\/]\s*RTGS/i, sub: 'NEFT/RTGS Combined' },
  { re: /FUND\s*TRANSFER[\s\-\/]*(NEFT|RTGS)/i, sub: 'Fund Transfer NEFT/RTGS' },
  { re: /ONLINE\s*TRANSFER[\s\-\/]*NEFT/i, sub: 'Online Transfer NEFT' },
  { re: /ONLINE\s*TRANSFER[\s\-\/]*RTGS/i, sub: 'Online Transfer RTGS' },
  { re: /INTERBANK[\s\-\/]*TRANSFER/i, sub: 'Interbank Transfer (NEFT/RTGS)' },
]

export function isNEFTTxn(desc: string): boolean {
  return NEFT_PATTERNS.some(p => p.re.test(desc))
}
export function getNEFTSubType(desc: string): string {
  for (const p of NEFT_PATTERNS) { if (p.re.test(desc)) return p.sub }
  return 'NEFT/RTGS'
}
export function getNEFTKeyword(desc: string): string {
  for (const p of NEFT_PATTERNS) { const m = desc.match(p.re); if (m) return m[0].toUpperCase() }
  return ''
}

// ── UPI / IMPS keyword patterns ──
export const UPI_PATTERNS: SubTypePattern[] = [
  { re: /\bUPI\b/i, sub: 'UPI Generic' },
  { re: /\bUPI[\/\-\s]*CR\b/i, sub: 'UPI Credit' },
  { re: /\bUPI[\/\-\s]*DR\b/i, sub: 'UPI Debit' },
  { re: /\bUPI[\/\-\s]*CREDIT\b/i, sub: 'UPI Credit' },
  { re: /\bUPI[\/\-\s]*DEBIT\b/i, sub: 'UPI Debit' },
  { re: /\bUPI[\/\-\s]*REFUND\b/i, sub: 'UPI Refund' },
  { re: /\bUPI[\/\-\s]*REVERSAL\b/i, sub: 'UPI Reversal' },
  { re: /\bUPI[\/\-\s]*RETURN\b/i, sub: 'UPI Return' },
  { re: /\bIMPS\b/i, sub: 'IMPS Generic' },
  { re: /\bIMPS[\/\-\s]*CR\b/i, sub: 'IMPS Credit' },
  { re: /\bIMPS[\/\-\s]*DR\b/i, sub: 'IMPS Debit' },
  { re: /\bIMPS[\/\-\s]*CREDIT\b/i, sub: 'IMPS Credit' },
  { re: /\bIMPS[\/\-\s]*DEBIT\b/i, sub: 'IMPS Debit' },
  { re: /\bIMPS[\/\-\s]*RETURN\b/i, sub: 'IMPS Return' },
  { re: /\bP2P\b/i, sub: 'UPI P2P Transfer' },
  { re: /\bP2M\b/i, sub: 'UPI P2M Payment' },
  { re: /\bBHIM\b/i, sub: 'BHIM UPI' },
  { re: /\bGPAY\b|\bGOOGLE\s*PAY\b/i, sub: 'Google Pay (UPI)' },
  { re: /\bPHONEPE\b/i, sub: 'PhonePe (UPI)' },
  { re: /\bPAYTM\b/i, sub: 'Paytm (UPI)' },
  { re: /\bAMAZON\s*PAY\b/i, sub: 'Amazon Pay (UPI)' },
]

export function isUPITxn(desc: string): boolean { return UPI_PATTERNS.some(p => p.re.test(desc)) }
export function getUPISubType(desc: string): string {
  for (const p of UPI_PATTERNS) { if (p.re.test(desc)) return p.sub }
  return 'UPI/IMPS'
}
export function getUPIKeyword(desc: string): string {
  for (const p of UPI_PATTERNS) { const m = desc.match(p.re); if (m) return m[0].toUpperCase() }
  return ''
}

// ── Cheque / CTS keyword patterns ──
export const CHEQUE_PATTERNS: SubTypePattern[] = [
  { re: /\bCHQ\b/i, sub: 'Cheque Generic' },
  { re: /\bCHEQUE\b/i, sub: 'Cheque Generic' },
  { re: /\bCTS\b/i, sub: 'CTS Clearing' },
  { re: /\bCHQ\s*DEP(?:OSIT)?\b/i, sub: 'Cheque Deposit' },
  { re: /\bCHEQUE\s*DEP(?:OSIT)?\b/i, sub: 'Cheque Deposit' },
  { re: /\bCHQ\s*ISSUE\b|\bCHQ\s*PAYMENT\b/i, sub: 'Cheque Issue' },
  { re: /\bCHEQUE\s*ISSUE\b|\bCHEQUE\s*PAYMENT\b/i, sub: 'Cheque Issue' },
  { re: /\bCHQ\s*RETURN\b|\bCHEQUE\s*RETURN\b/i, sub: 'Cheque Return (Bounce)' },
  { re: /\bCHQ\s*BOUNCE\b|\bCHEQUE\s*BOUNCE\b/i, sub: 'Cheque Bounce' },
  { re: /\bCHQ\s*DISHON/i, sub: 'Cheque Dishonoured' },
  { re: /\bPDC\b/i, sub: 'Post-Dated Cheque' },
  { re: /\bINWARD\s*CLG\b|\bINWARD\s*CLEARING\b/i, sub: 'Inward Clearing' },
  { re: /\bOUTWARD\s*CLG\b|\bOUTWARD\s*CLEARING\b/i, sub: 'Outward Clearing' },
  { re: /\bCLG\s*TXN\b|\bCLEARING\s*TXN\b/i, sub: 'Clearing Transaction' },
  { re: /\bDRAFT\b/i, sub: 'Bank Draft' },
  { re: /\bDD\b/i, sub: 'Demand Draft' },
]

export function isChequeTxn(desc: string): boolean { return CHEQUE_PATTERNS.some(p => p.re.test(desc)) }
export function getChequeSubType(desc: string): string {
  for (const p of CHEQUE_PATTERNS) { if (p.re.test(desc)) return p.sub }
  return 'Cheque'
}
export function getChequeKeyword(desc: string): string {
  for (const p of CHEQUE_PATTERNS) { const m = desc.match(p.re); if (m) return m[0].toUpperCase() }
  return ''
}

// ── Bounce keyword patterns ──
export const BOUNCE_PATTERNS: BouncePattern[] = [
  { re: /\bBOUNCE\b/i, sub: 'Cheque Bounce', inward: null },
  { re: /\bCHQ\s*RETURN\b|\bCHEQUE\s*RETURN\b/i, sub: 'Cheque Return', inward: null },
  { re: /\bCHQ\s*DISHON\b|\bCHEQUE\s*DISHON\b/i, sub: 'Cheque Dishonoured', inward: null },
  { re: /\bINWARD\s*RETURN\b/i, sub: 'Inward Bounce (Non-Technical)', inward: true },
  { re: /\bINWARD\s*BOUNCE\b/i, sub: 'Inward Bounce (Non-Technical)', inward: true },
  { re: /\bOUTWARD\s*RETURN\b/i, sub: 'Outward Bounce', inward: false },
  { re: /\bOUTWARD\s*BOUNCE\b/i, sub: 'Outward Bounce', inward: false },
  { re: /\bECS\s*RETURN\b|\bECS\s*BOUNCE\b/i, sub: 'ECS Return / Bounce', inward: null },
  { re: /\bNACH\s*RETURN\b|\bNACH\s*BOUNCE\b/i, sub: 'NACH Return / Bounce', inward: null },
  { re: /\bACH\s*RETURN\b/i, sub: 'ACH Return', inward: null },
  { re: /\bNEFT\s*RETURN\b/i, sub: 'NEFT Return', inward: null },
  { re: /\bRTGS\s*RETURN\b/i, sub: 'RTGS Return', inward: null },
  { re: /\bREJECTED\b|\bREJECT\b/i, sub: 'Payment Rejected', inward: null },
  { re: /\bDISHONOURED\b/i, sub: 'Instrument Dishonoured', inward: null },
  { re: /\bNOT\s*PAID\b/i, sub: 'Unpaid Instrument', inward: null },
  { re: /\bTECHNICAL\s*RETURN\b/i, sub: 'Inward Bounce (Technical)', inward: true },
]

export function isBounceTxn(desc: string): boolean { return BOUNCE_PATTERNS.some(p => p.re.test(desc)) }
export function getBounceSubType(desc: string): string {
  for (const p of BOUNCE_PATTERNS) { if (p.re.test(desc)) return p.sub }
  return 'Bounce'
}
export function isBounceInward(desc: string): boolean | null {
  for (const p of BOUNCE_PATTERNS) { if (p.re.test(desc)) return p.inward }
  return null
}

/**
 * Ported unchanged from categorize() (perfios-core.js:1282-1310). Same
 * detection priority order: Salary > Bounce > ACH > ECS > NEFT/RTGS >
 * UPI/IMPS > Cheque > generic keyword fallbacks > Other Credit/Debit.
 */
export function categorize(desc: string, type: 'CR' | 'DR'): string {
  if (isSalaryTxn(desc)) return 'Salary'
  if (isBounceTxn(desc)) return 'Bounce'
  if (isACHTxn(desc)) return type === 'CR' ? 'ACH Credit' : 'ACH Debit'
  if (isECSTxn(desc)) return type === 'CR' ? 'ECS Credit' : 'ECS Debit'
  if (isNEFTTxn(desc)) return type === 'CR' ? 'NEFT/RTGS Credit' : 'NEFT/RTGS Debit'
  if (isUPITxn(desc)) return type === 'CR' ? 'UPI/IMPS Credit' : 'UPI/IMPS Debit'
  if (isChequeTxn(desc)) return type === 'CR' ? 'Cheque Deposit' : 'Cheque Issue'
  const d = desc.toLowerCase()
  if (/imps|neft|rtgs|upi|transfer/i.test(d)) {
    if (type === 'CR') return d.includes('self') ? 'Transfer from Self' : 'Transfer Credit'
    return d.includes('self') ? 'Transfer To Self' : 'Transfer Debit'
  }
  if (/interest|int\b/i.test(d)) return type === 'CR' ? 'Interest Credit' : 'Interest Charge'
  if (/emi|loan/i.test(d)) return 'Loan/EMI'
  if (/atm|cash/i.test(d)) return type === 'CR' ? 'Cash Deposit' : 'Cash Withdrawal'
  if (/chq|cheque|check/i.test(d)) return type === 'CR' ? 'Cheque Deposit' : 'Cheque Issue'
  if (/charge|fee|gst/i.test(d)) return 'Bank Charges'
  if (/utility|electricity|gas|water|bill/i.test(d)) return 'Utility Payment'
  if (/credit card|cc\b/i.test(d)) return 'Credit Card Payment'
  return type === 'CR' ? 'Other Credit' : 'Other Debit'
}
