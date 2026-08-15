import type {
  AbbData, AnalysisRow, BreakupData, EodData, FinOneRow, Transaction, ValidationCheck,
} from './types'
import { getEODBalance, getOpeningBalance } from './calculations'
import {
  getACHSubType, getBounceSubType, getChequeSubType, getECSSubType, getNEFTSubType,
  getUPISubType, isACHTxn, isBounceInward, isBounceTxn, isChequeTxn, isECSTxn,
  isNEFTTxn, isSalaryTxn, isUPITxn,
} from './categorizer'

// Ported unchanged from fmtDate/fmt (perfios-core.js:3823-3830).
export function fmtDate(d: Date | null | undefined): string {
  if (!d) return '—'
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}
export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || (n as unknown as string) === '') return ''
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Ported unchanged from buildValidationChecks (perfios-core.js:2067-2229).
 * Restructured to take an explicit parameter object instead of reading
 * module-global state (achTxns/ecsTxns/etc. and pendingFiles) — same
 * computations, same 11 checks, same ids/status/icon/title/detail/value
 * text, in the same order.
 */
export function buildValidationChecks(params: {
  firstDate: Date; lastDate: Date; daysDiff: number; staledays: number
  today: Date; cutoffDate: Date; salaryTxns: Transaction[]
  achTxns: Transaction[]; ecsTxns: Transaction[]; neftTxns: Transaction[]
  upiTxns: Transaction[]; bounceTxns: Transaction[]; overdraftTxns: Transaction[]
  allTxns: Transaction[]; filtered90: Transaction[]; uploadedFileNames: string[]
}): ValidationCheck[] {
  const {
    firstDate, lastDate, daysDiff, staledays, today, cutoffDate, salaryTxns,
    achTxns, ecsTxns, neftTxns, upiTxns, bounceTxns, overdraftTxns,
    allTxns, filtered90, uploadedFileNames,
  } = params
  const checks: ValidationCheck[] = []

  // Check 1: 90-day span
  const span90pass = daysDiff >= 90
  checks.push({
    id: 'span90',
    status: span90pass ? 'pass' : 'fail',
    icon: span90pass ? '✅' : '🚫',
    title: `Rule 1 — 90-Day Statement Span: ${span90pass ? 'PASSED' : 'FAILED'}`,
    detail: span90pass
      ? `Statement spans ${daysDiff} days (${fmtDate(firstDate)} → ${fmtDate(lastDate)}), which meets the minimum 90-day requirement.`
      : `Statement spans only ${daysDiff} days (${fmtDate(firstDate)} → ${fmtDate(lastDate)}). Minimum 90 days required. Perfios processing is blocked.`,
    value: daysDiff + ' days',
  })

  // Check 2: 7-day staleness
  const fresh = staledays <= 7
  checks.push({
    id: 'staleness',
    status: fresh ? 'pass' : 'fail',
    icon: fresh ? '✅' : '🚫',
    title: `Rule 2 — Recent Activity (≤7 Days): ${fresh ? 'PASSED' : 'FAILED'}`,
    detail: fresh
      ? `Last transaction on ${fmtDate(lastDate)} is ${staledays} day(s) before today (${fmtDate(today)}), within the 7-day limit.`
      : `Last transaction on ${fmtDate(lastDate)} is ${staledays} days before today (${fmtDate(today)}), exceeding the 7-day limit. Earliest acceptable date: ${fmtDate(cutoffDate)}.`,
    value: staledays + ' day(s) ago',
  })

  // Check 3: Salary detection
  const hasSalary = salaryTxns.length > 0
  const salaryMonths = [...new Set(salaryTxns.map(t => t.date.toLocaleString('en-IN', { month: 'short', year: '2-digit' })))]
  const totalSalaryAmt = salaryTxns.reduce((s, t) => s + (t.type === 'CR' ? t.amount : 0), 0)
  checks.push({
    id: 'salary',
    status: hasSalary ? 'pass' : 'warn',
    icon: hasSalary ? '💰' : '⚠️',
    title: `Rule 3 — Salary Detection: ${hasSalary ? 'SALARY FOUND' : 'NO SALARY DETECTED'}`,
    detail: hasSalary
      ? `${salaryTxns.length} salary transaction(s) detected across ${salaryMonths.length} month(s): ${salaryMonths.join(', ')}. Total credited: ₹${fmt(totalSalaryAmt)}.`
      : `No transactions matched salary keywords (SAL, SALARY, PAYROLL, INCOME, WAGES, STIPEND, REMUNERATION, etc.). This account may not receive a regular salary.`,
    value: hasSalary ? salaryTxns.length + ' txn(s)' : 'None',
  })

  // Check 4: Password-protected handling
  checks.push({
    id: 'password',
    status: 'pass',
    icon: '🔒',
    title: 'Rule 4 — Password-Protected PDF: Handled',
    detail: 'All uploaded PDFs were successfully processed. Password-protected files were unlocked via password entry. Files that could not be unlocked were skipped.',
    value: uploadedFileNames.join(', ') || '—',
  })

  // Check 5: Transaction count sanity
  const txnCountOk = allTxns.length >= 3
  checks.push({
    id: 'txncount',
    status: txnCountOk ? 'pass' : 'warn',
    icon: txnCountOk ? '✅' : '⚠️',
    title: `Data Quality — Transaction Count: ${allTxns.length} transactions`,
    detail: `${allTxns.length} total transactions found across the full statement period. ${filtered90.length} fall within the 90-day analysis window.`,
    value: allTxns.length + ' total',
  })

  // Check 6: ACH detection
  const hasACH = achTxns.length > 0
  const achCr = achTxns.filter(t => t.type === 'CR').reduce((s, t) => s + t.amount, 0)
  const achDr = achTxns.filter(t => t.type === 'DR').reduce((s, t) => s + t.amount, 0)
  checks.push({
    id: 'ach',
    status: hasACH ? 'pass' : 'warn',
    icon: hasACH ? '🔄' : 'ℹ️',
    title: `ACH / NACH Detection: ${hasACH ? achTxns.length + ' TRANSACTION(S) FOUND' : 'NONE DETECTED'}`,
    detail: hasACH
      ? `${achTxns.length} ACH/NACH/Direct Debit transactions found. Credits: ₹${fmt(achCr)} | Debits: ₹${fmt(achDr)}. Sub-types: ${[...new Set(achTxns.map(t => getACHSubType(t.desc)))].join(', ')}.`
      : 'No ACH, NACH, Direct Debit, Auto Pay, or Standing Instruction transactions found in the statement.',
    value: hasACH ? achTxns.length + ' txn(s)' : 'None',
  })

  // Check 7: ECS detection
  const hasECS = ecsTxns.length > 0
  const ecsReturns = ecsTxns.filter(t => /return|bounce|rej/i.test(getECSSubType(t.desc))).length
  const ecsCr = ecsTxns.filter(t => t.type === 'CR').reduce((s, t) => s + t.amount, 0)
  const ecsDr = ecsTxns.filter(t => t.type === 'DR').reduce((s, t) => s + t.amount, 0)
  checks.push({
    id: 'ecs',
    status: hasECS ? (ecsReturns > 0 ? 'warn' : 'pass') : 'warn',
    icon: hasECS ? (ecsReturns > 0 ? '⚠️' : '⚡') : 'ℹ️',
    title: `ECS Detection: ${hasECS ? ecsTxns.length + ' TRANSACTION(S) FOUND' : 'NONE DETECTED'}${ecsReturns > 0 ? ` · ${ecsReturns} RETURN(S)/BOUNCE(S)` : ''}`,
    detail: hasECS
      ? `${ecsTxns.length} ECS transactions found. Credits: ₹${fmt(ecsCr)} | Debits: ₹${fmt(ecsDr)}${ecsReturns > 0 ? ` | ⚠ ${ecsReturns} ECS return(s)/bounce(s) detected — may indicate failed payments.` : '. No ECS returns detected.'}`
      : 'No ECS transactions found in the statement. ECS is an RBI legacy batch clearing system used for EMI, insurance premiums, SIP deductions, etc.',
    value: hasECS ? ecsTxns.length + ' txn(s)' : 'None',
  })

  // Check 8: NEFT/RTGS detection
  const hasNEFT = neftTxns.length > 0
  const neftCr = neftTxns.filter(t => t.type === 'CR').reduce((s, t) => s + t.amount, 0)
  const neftDr = neftTxns.filter(t => t.type === 'DR').reduce((s, t) => s + t.amount, 0)
  const neftRet = neftTxns.filter(t => /return|reject/i.test(getNEFTSubType(t.rawDesc || t.desc))).length
  const neftSubTypesStr = [...new Set(neftTxns.map(t => getNEFTSubType(t.rawDesc || t.desc)))].join(', ') || '—'
  checks.push({
    id: 'neft',
    status: hasNEFT ? (neftRet > 0 ? 'warn' : 'pass') : 'warn',
    icon: hasNEFT ? (neftRet > 0 ? '⚠️' : '🏦') : 'ℹ️',
    title: `NEFT / RTGS Detection: ${hasNEFT ? neftTxns.length + ' TRANSACTION(S) FOUND' : 'NONE DETECTED'}${neftRet > 0 ? ` · ${neftRet} RETURN(S)` : ''}`,
    detail: hasNEFT
      ? `${neftTxns.length} NEFT/RTGS transactions found. Credits: ₹${fmt(neftCr)} | Debits: ₹${fmt(neftDr)}${neftRet > 0 ? ` | ⚠ ${neftRet} return(s)/rejection(s) detected.` : '. No returns detected.'} Sub-types: ${neftSubTypesStr}.`
      : 'No NEFT or RTGS fund transfer transactions detected in the statement.',
    value: hasNEFT ? neftTxns.length + ' txn(s)' : 'None',
  })

  // Check 9: UPI/IMPS detection
  const hasUPI = upiTxns.length > 0
  const upiCr = upiTxns.filter(t => t.type === 'CR').reduce((s, t) => s + t.amount, 0)
  const upiDr = upiTxns.filter(t => t.type === 'DR').reduce((s, t) => s + t.amount, 0)
  checks.push({
    id: 'upi',
    status: hasUPI ? 'pass' : 'warn',
    icon: hasUPI ? '📲' : 'ℹ️',
    title: `UPI / IMPS Detection: ${hasUPI ? upiTxns.length + ' TRANSACTION(S) FOUND' : 'NONE DETECTED'}`,
    detail: hasUPI
      ? `${upiTxns.length} UPI/IMPS transactions found. Credits: ₹${fmt(upiCr)} | Debits: ₹${fmt(upiDr)}. Sub-types: ${[...new Set(upiTxns.map(t => getUPISubType(t.rawDesc || t.desc)))].join(', ')}.`
      : 'No UPI or IMPS instant payment transactions detected.',
    value: hasUPI ? upiTxns.length + ' txn(s)' : 'None',
  })

  // Check 10: Bounce detection
  const hasBounces = bounceTxns.length > 0
  const inwardBounceNT = bounceTxns.filter(t => isBounceInward(t.rawDesc || t.desc) === true && !/technical/i.test(getBounceSubType(t.rawDesc || t.desc))).length
  const inwardBounceT = bounceTxns.filter(t => /technical/i.test(getBounceSubType(t.rawDesc || t.desc))).length
  const outwardBounce = bounceTxns.filter(t => isBounceInward(t.rawDesc || t.desc) === false).length
  checks.push({
    id: 'bounce',
    status: hasBounces ? 'warn' : 'pass',
    icon: hasBounces ? '⚠️' : '✅',
    title: `Bounce / Return Detection: ${hasBounces ? bounceTxns.length + ' BOUNCE(S) FOUND' : 'CLEAN — NO BOUNCES'}`,
    detail: hasBounces
      ? `${bounceTxns.length} bounce/return transactions detected. Inward (Non-Tech): ${inwardBounceNT} | Inward (Technical): ${inwardBounceT} | Outward: ${outwardBounce}. High bounce count may indicate financial stress.`
      : 'No bounce, return, or dishonoured instrument transactions detected. Statement is bounce-free.',
    value: hasBounces ? bounceTxns.length + ' bounce(s)' : 'Clean',
  })

  // Check 11: Overdraft detection
  const hasOD = overdraftTxns.length > 0
  const odDays = new Set(overdraftTxns.map(t => fmtDate(t.date))).size
  checks.push({
    id: 'overdraft',
    status: hasOD ? 'warn' : 'pass',
    icon: hasOD ? '📉' : '✅',
    title: `Overdraft / Negative Balance: ${hasOD ? overdraftTxns.length + ' EVENT(S) DETECTED' : 'NONE DETECTED'}`,
    detail: hasOD
      ? `Account went overdrawn ${overdraftTxns.length} time(s) across ${odDays} day(s). Most negative balance: ₹${fmt(Math.min(...overdraftTxns.map(t => t.balance)))}. This indicates the account was overdrawn.`
      : 'No negative EOD balance events detected. Account maintained positive balance throughout.',
    value: hasOD ? overdraftTxns.length + ' event(s)' : 'Clean',
  })

  return checks
}

/**
 * Ported unchanged from buildFinOneData (perfios-core.js:1722-1817). Mirrors
 * FinOne1 sheet columns exactly (see original comment): A=Month,
 * B=Credits_Nos, C=Credits_Value, D=IW_Chq_Returns, E-I=Bal@2/4/10/17/25,
 * J=EOD last day, K=AVERAGE(E:I), L=Withdrawal_Amount, M=OW_Chq_Returns,
 * N=Withdrawal_Nos, O=Total_Cheque_Bounces, P=IF(B>0,(M/B)*100,0),
 * Q=Min_Balance, R=EMI_Reflects, S=Salary_Credit, T=Salary_Date,
 * U=IF(N>0,(D/N)*100,0). Includes the TOTAL row (=SUM of each column).
 */
export function buildFinOneData(allTxns: Transaction[], monthOrder: string[], abbData: AbbData): FinOneRow[] {
  const rows: FinOneRow[] = []
  const sortedAll = [...allTxns].sort((a, b) => a.date.getTime() - b.date.getTime())
  const openingBalance = getOpeningBalance(sortedAll)

  for (const mk of monthOrder) {
    const [yr, mo] = mk.split('-').map(Number)
    const monthTxns = allTxns.filter(t => t.date.getFullYear() === yr && t.date.getMonth() === mo - 1)
    const creditTxns = monthTxns.filter(t => t.type === 'CR')
    const debitTxns = monthTxns.filter(t => t.type === 'DR')

    const creditsNos = creditTxns.length
    const creditsValue = creditTxns.reduce((s, t) => s + t.amount, 0)
    const iwChqRet = monthTxns.filter(t => {
      if (!isBounceTxn(t.rawDesc || t.desc)) return false
      const inward = isBounceInward(t.rawDesc || t.desc)
      return inward === true || inward === null
    }).length
    const owChqRet = monthTxns.filter(t => {
      if (!isBounceTxn(t.rawDesc || t.desc)) return false
      return isBounceInward(t.rawDesc || t.desc) === false
    }).length
    const withdrawlNos = debitTxns.length
    const withdrawalAmt = debitTxns.reduce((s, t) => s + t.amount, 0)
    const totalChqBounces = monthTxns.filter(t => isBounceTxn(t.rawDesc || t.desc)).length
    const emiReflects = debitTxns.filter(t => /\bemi\b|\bloan\b|\binstalment\b|\binstallment\b/i.test(t.rawDesc || t.desc)).length

    const bal2 = getEODBalance(yr, mo, 2, sortedAll, openingBalance)
    const bal4 = getEODBalance(yr, mo, 4, sortedAll, openingBalance)
    const bal10 = getEODBalance(yr, mo, 10, sortedAll, openingBalance)
    const bal17 = getEODBalance(yr, mo, 17, sortedAll, openingBalance)
    const bal25 = getEODBalance(yr, mo, 25, sortedAll, openingBalance)
    const kAvg = (bal2 + bal4 + bal10 + bal17 + bal25) / 5

    const daysInMonth = new Date(yr, mo, 0).getDate()
    const eodLast = getEODBalance(yr, mo, daysInMonth, sortedAll, openingBalance)

    let minBal = Infinity
    for (let d = 1; d <= daysInMonth; d++) {
      const b = getEODBalance(yr, mo, d, sortedAll, openingBalance)
      if (b < minBal) minBal = b
    }
    if (minBal === Infinity) minBal = 0

    const salaryTxn = creditTxns.find(t => /salary|sal\b/i.test(t.desc))
    const salaryCredit = salaryTxn ? salaryTxn.amount : 0
    const salaryDate = salaryTxn ? fmtDate(salaryTxn.date) : 'N/A'

    const pct_ow = creditsNos > 0 ? (owChqRet / creditsNos) * 100 : 0
    const pct_iw = withdrawlNos > 0 ? (iwChqRet / withdrawlNos) * 100 : 0

    rows.push({
      month: abbData[mk].label, creditsNos, creditsValue, iwChqRet,
      bal2, bal4, bal10, bal17, bal25, eodLast, kAvg,
      withdrawalAmt, owChqRet, withdrawlNos,
      totalChqBounces, pct_ow, minBal,
      emiReflects, salaryCredit, salaryDate, pct_iw,
    })
  }

  if (rows.length > 0) {
    const tot: FinOneRow = {
      month: 'TOTAL', creditsNos: 0, creditsValue: 0, iwChqRet: 0,
      bal2: 0, bal4: 0, bal10: 0, bal17: 0, bal25: 0, eodLast: 0, kAvg: 0,
      withdrawalAmt: 0, owChqRet: 0, withdrawlNos: 0, totalChqBounces: 0,
      pct_ow: 0, minBal: 0, emiReflects: 0, salaryCredit: 0, salaryDate: '', pct_iw: 0,
    }
    const numericKeys: (keyof FinOneRow)[] = [
      'creditsNos', 'creditsValue', 'iwChqRet', 'bal2', 'bal4', 'bal10', 'bal17', 'bal25',
      'eodLast', 'kAvg', 'withdrawalAmt', 'owChqRet', 'withdrawlNos', 'totalChqBounces',
      'pct_ow', 'minBal', 'emiReflects', 'salaryCredit', 'pct_iw',
    ]
    for (const r of rows) {
      for (const k of numericKeys) {
        (tot[k] as number) += r[k] as number
      }
    }
    rows.push(tot)
  }
  return rows
}

/**
 * Ported unchanged from buildAnalysisData (perfios-core.js:1821-2004).
 * Mirrors Analysis1 sheet rows 18-105 — same metricDefs list, same field
 * computations (sumField), same derived-percentage fields.
 */
export function buildAnalysisData(allTxns: Transaction[], monthOrder: string[]): AnalysisRow[] {
  const months = monthOrder

  const getMonthTxns = (mk: string) => {
    const [yr, mo] = mk.split('-').map(Number)
    return allTxns.filter(t => t.date.getFullYear() === yr && t.date.getMonth() === mo - 1)
  }

  const sumField = (field: string, mk: string): number => {
    const txns = getMonthTxns(mk)
    if (field === 'creditNos') return txns.filter(t => t.type === 'CR').length
    if (field === 'creditAmt') return txns.filter(t => t.type === 'CR').reduce((s, t) => s + t.amount, 0)
    if (field === 'debitNos') return txns.filter(t => t.type === 'DR').length
    if (field === 'debitAmt') return txns.filter(t => t.type === 'DR').reduce((s, t) => s + t.amount, 0)
    if (field === 'selfCreditNos') return txns.filter(t => t.type === 'CR' && /self|own|transfer/i.test(t.category)).length
    if (field === 'selfCreditAmt') return txns.filter(t => t.type === 'CR' && /self|own|transfer/i.test(t.category)).reduce((s, t) => s + t.amount, 0)
    if (field === 'selfDebitNos') return txns.filter(t => t.type === 'DR' && /self|own|transfer/i.test(t.category)).length
    if (field === 'selfDebitAmt') return txns.filter(t => t.type === 'DR' && /self|own|transfer/i.test(t.category)).reduce((s, t) => s + t.amount, 0)
    if (field === 'cashDepNos') return txns.filter(t => t.type === 'CR' && /cash/i.test(t.category)).length
    if (field === 'cashDepAmt') return txns.filter(t => t.type === 'CR' && /cash/i.test(t.category)).reduce((s, t) => s + t.amount, 0)
    if (field === 'cashWdNos') return txns.filter(t => t.type === 'DR' && /cash/i.test(t.category)).length
    if (field === 'cashWdAmt') return txns.filter(t => t.type === 'DR' && /cash/i.test(t.category)).reduce((s, t) => s + t.amount, 0)
    if (field === 'minBal') { const b = txns.map(t => t.balance); return b.length ? Math.min(...b) : 0 }
    if (field === 'maxBal') { const b = txns.map(t => t.balance); return b.length ? Math.max(...b) : 0 }
    if (field === 'avgBal') { const b = txns.map(t => t.balance); return b.length ? b.reduce((s, v) => s + v, 0) / b.length : 0 }
    // These four win over the later "isUPITxn && !imps" duplicates below —
    // JS returns on the first matching `if`, so this earlier, broader
    // (/upi|imps/i on desc, no exclusion) definition is what actually runs;
    // the near-identical block further down (marked accordingly) is
    // unreachable dead code in the original and is preserved as such.
    if (field === 'upiCrAmt') return txns.filter(t => t.type === 'CR' && /upi|imps/i.test(t.desc)).reduce((s, t) => s + t.amount, 0)
    if (field === 'upiCrNos') return txns.filter(t => t.type === 'CR' && /upi|imps/i.test(t.desc)).length
    if (field === 'upiDrAmt') return txns.filter(t => t.type === 'DR' && /upi|imps/i.test(t.desc)).reduce((s, t) => s + t.amount, 0)
    if (field === 'upiDrNos') return txns.filter(t => t.type === 'DR' && /upi|imps/i.test(t.desc)).length
    if (field === 'bizCrAmt') return txns.filter(t => t.type === 'CR' && !/self/i.test(t.category)).reduce((s, t) => s + t.amount, 0)
    if (field === 'bizCrNos') return txns.filter(t => t.type === 'CR' && !/self/i.test(t.category)).length
    if (field === 'bankChargeAmt') return txns.filter(t => /charge|fee|gst/i.test(t.category)).reduce((s, t) => s + t.amount, 0)
    if (field === 'bankChargeNos') return txns.filter(t => /charge|fee|gst/i.test(t.category)).length
    if (field === 'invCrAmt') return txns.filter(t => t.type === 'CR' && /interest/i.test(t.desc)).reduce((s, t) => s + t.amount, 0)
    if (field === 'inwardBounceNT') return txns.filter(t => isBounceTxn(t.rawDesc || t.desc) && isBounceInward(t.rawDesc || t.desc) === true && !/technical/i.test(getBounceSubType(t.rawDesc || t.desc))).length
    if (field === 'inwardBounceT') return txns.filter(t => isBounceTxn(t.rawDesc || t.desc) && /technical/i.test(getBounceSubType(t.rawDesc || t.desc))).length
    if (field === 'outwardBounce') return txns.filter(t => isBounceTxn(t.rawDesc || t.desc) && isBounceInward(t.rawDesc || t.desc) === false).length
    if (field === 'overdraftTimes') return txns.filter(t => t.balance < 0).length
    if (field === 'overdraftDays') return new Set(txns.filter(t => t.balance < 0).map(t => fmtDate(t.date))).size
    if (field === 'achCrAmt') return txns.filter(t => t.type === 'CR' && isACHTxn(t.desc)).reduce((s, t) => s + t.amount, 0)
    if (field === 'achCrNos') return txns.filter(t => t.type === 'CR' && isACHTxn(t.desc)).length
    if (field === 'achDrAmt') return txns.filter(t => t.type === 'DR' && isACHTxn(t.desc)).reduce((s, t) => s + t.amount, 0)
    if (field === 'achDrNos') return txns.filter(t => t.type === 'DR' && isACHTxn(t.desc)).length
    if (field === 'ecsCrAmt') return txns.filter(t => t.type === 'CR' && isECSTxn(t.desc)).reduce((s, t) => s + t.amount, 0)
    if (field === 'ecsCrNos') return txns.filter(t => t.type === 'CR' && isECSTxn(t.desc)).length
    if (field === 'ecsDrAmt') return txns.filter(t => t.type === 'DR' && isECSTxn(t.desc)).reduce((s, t) => s + t.amount, 0)
    if (field === 'ecsDrNos') return txns.filter(t => t.type === 'DR' && isECSTxn(t.desc)).length
    if (field === 'ecsRetNos') return txns.filter(t => isECSTxn(t.desc) && /return|bounce|rej/i.test(getECSSubType(t.desc))).length
    if (field === 'neftCrAmt') return txns.filter(t => t.type === 'CR' && isNEFTTxn(t.rawDesc || t.desc)).reduce((s, t) => s + t.amount, 0)
    if (field === 'neftCrNos') return txns.filter(t => t.type === 'CR' && isNEFTTxn(t.rawDesc || t.desc)).length
    if (field === 'neftDrAmt') return txns.filter(t => t.type === 'DR' && isNEFTTxn(t.rawDesc || t.desc)).reduce((s, t) => s + t.amount, 0)
    if (field === 'neftDrNos') return txns.filter(t => t.type === 'DR' && isNEFTTxn(t.rawDesc || t.desc)).length
    if (field === 'neftRetNos') return txns.filter(t => isNEFTTxn(t.rawDesc || t.desc) && /return|reject/i.test(getNEFTSubType(t.rawDesc || t.desc))).length
    if (field === 'rtgsCrAmt') return txns.filter(t => t.type === 'CR' && /rtgs/i.test(t.desc)).reduce((s, t) => s + t.amount, 0)
    if (field === 'rtgsCrNos') return txns.filter(t => t.type === 'CR' && /rtgs/i.test(t.desc)).length
    if (field === 'rtgsDrAmt') return txns.filter(t => t.type === 'DR' && /rtgs/i.test(t.desc)).reduce((s, t) => s + t.amount, 0)
    if (field === 'rtgsDrNos') return txns.filter(t => t.type === 'DR' && /rtgs/i.test(t.desc)).length
    if (field === 'salCrAmt') return txns.filter(t => t.type === 'CR' && isSalaryTxn(t.desc)).reduce((s, t) => s + t.amount, 0)
    if (field === 'salCrNos') return txns.filter(t => t.type === 'CR' && isSalaryTxn(t.desc)).length
    // UPI / IMPS — legacy defines upiCrNos/upiCrAmt/upiDrNos/upiDrAmt again
    // here, but those four `if`s are unreachable (the earlier definitions
    // above already return first) — only the imps* fields below are
    // actually reachable and are ported.
    if (field === 'impsCrNos') return txns.filter(t => t.type === 'CR' && isUPITxn(t.rawDesc || t.desc) && /imps/i.test(getUPISubType(t.rawDesc || t.desc))).length
    if (field === 'impsCrAmt') return txns.filter(t => t.type === 'CR' && isUPITxn(t.rawDesc || t.desc) && /imps/i.test(getUPISubType(t.rawDesc || t.desc))).reduce((s, t) => s + t.amount, 0)
    if (field === 'impsDrNos') return txns.filter(t => t.type === 'DR' && isUPITxn(t.rawDesc || t.desc) && /imps/i.test(getUPISubType(t.rawDesc || t.desc))).length
    if (field === 'impsDrAmt') return txns.filter(t => t.type === 'DR' && isUPITxn(t.rawDesc || t.desc) && /imps/i.test(getUPISubType(t.rawDesc || t.desc))).reduce((s, t) => s + t.amount, 0)
    if (field === 'chqDepNos') return txns.filter(t => t.type === 'CR' && isChequeTxn(t.rawDesc || t.desc)).length
    if (field === 'chqDepAmt') return txns.filter(t => t.type === 'CR' && isChequeTxn(t.rawDesc || t.desc)).reduce((s, t) => s + t.amount, 0)
    if (field === 'chqIssNos') return txns.filter(t => t.type === 'DR' && isChequeTxn(t.rawDesc || t.desc)).length
    if (field === 'chqIssAmt') return txns.filter(t => t.type === 'DR' && isChequeTxn(t.rawDesc || t.desc)).reduce((s, t) => s + t.amount, 0)
    if (field === 'chqRetNos') return txns.filter(t => isChequeTxn(t.rawDesc || t.desc) && /return|bounce|dishon/i.test(getChequeSubType(t.rawDesc || t.desc))).length
    return 0
  }

  const metricDefs: { label: string; field: string; fmt: 'n' | '₹' | '%'; derived?: boolean }[] = [
    { label: 'Total No. of Credit Transactions', field: 'creditNos', fmt: 'n' },
    { label: 'Total Amount of Credit Transactions', field: 'creditAmt', fmt: '₹' },
    { label: 'Total No. of Debit Transactions', field: 'debitNos', fmt: 'n' },
    { label: 'Total Amount of Debit Transactions', field: 'debitAmt', fmt: '₹' },
    { label: 'Total No. of Self Credit Transactions', field: 'selfCreditNos', fmt: 'n' },
    { label: 'Total Amount of Self Credit Transactions', field: 'selfCreditAmt', fmt: '₹' },
    { label: 'Total No. of Self Debit Transactions', field: 'selfDebitNos', fmt: 'n' },
    { label: 'Total Amount of Self Debit Transactions', field: 'selfDebitAmt', fmt: '₹' },
    { label: 'Total No. of Cash Deposits', field: 'cashDepNos', fmt: 'n' },
    { label: 'Total Amount of Cash Deposits', field: 'cashDepAmt', fmt: '₹' },
    { label: 'Total No.of Cash Withdrawal', field: 'cashWdNos', fmt: 'n' },
    { label: 'Total Amount of Cash Withdrawal', field: 'cashWdAmt', fmt: '₹' },
    { label: 'Total No. of Inward Bounces (Non Technical)', field: 'inwardBounceNT', fmt: 'n' },
    { label: 'Total No. of Inward Bounces (Technical)', field: 'inwardBounceT', fmt: 'n' },
    { label: 'Total No. of outward Bounces', field: 'outwardBounce', fmt: 'n' },
    { label: '%age of Outward Bounces', field: 'pctOwBounce', fmt: '%', derived: true },
    { label: '%age of Inward Bounces (Non Technical)', field: 'zero', fmt: '%' },
    { label: '%age of Inward Bounces (Technical)', field: 'zero', fmt: '%' },
    { label: 'No.of Times Account is Overdrawn', field: 'overdraftTimes', fmt: 'n' },
    { label: 'No.of Days Account is Overdrawn', field: 'overdraftDays', fmt: 'n' },
    { label: '%age of Cash Deposit to Total Credit', field: 'pctCashDep', fmt: '%', derived: true },
    { label: '%age of Cash Withdrawal to Total Debit', field: 'pctCashWd', fmt: '%', derived: true },
    { label: 'Min EOD Balance', field: 'minBal', fmt: '₹' },
    { label: 'Max EOD Balance', field: 'maxBal', fmt: '₹' },
    { label: 'Average EOD Balance', field: 'avgBal', fmt: '₹' },
    { label: 'Total Amount of Bank Charges', field: 'bankChargeAmt', fmt: '₹' },
    { label: 'Total No. of Bank Charges', field: 'bankChargeNos', fmt: 'n' },
    { label: 'Total Amount of UPI Credits', field: 'upiCrAmt', fmt: '₹' },
    { label: 'Total Count of UPI Credits', field: 'upiCrNos', fmt: 'n' },
    { label: 'Total Amount of UPI Debits', field: 'upiDrAmt', fmt: '₹' },
    { label: 'Total Count of UPI Debits', field: 'upiDrNos', fmt: 'n' },
    { label: 'Total Amount of Business Credits', field: 'bizCrAmt', fmt: '₹' },
    { label: 'Total No. of Business Credits', field: 'bizCrNos', fmt: 'n' },
    { label: 'Investment Credit Amount', field: 'invCrAmt', fmt: '₹' },
    { label: '── ACH / NACH ──', field: 'zero', fmt: 'n' },
    { label: 'Total No. of ACH/NACH Credit Transactions', field: 'achCrNos', fmt: 'n' },
    { label: 'Total Amount of ACH/NACH Credits', field: 'achCrAmt', fmt: '₹' },
    { label: 'Total No. of ACH/NACH Debit Transactions', field: 'achDrNos', fmt: 'n' },
    { label: 'Total Amount of ACH/NACH Debits', field: 'achDrAmt', fmt: '₹' },
    { label: '── ECS ──', field: 'zero', fmt: 'n' },
    { label: 'Total No. of ECS Credit Transactions', field: 'ecsCrNos', fmt: 'n' },
    { label: 'Total Amount of ECS Credits', field: 'ecsCrAmt', fmt: '₹' },
    { label: 'Total No. of ECS Debit Transactions', field: 'ecsDrNos', fmt: 'n' },
    { label: 'Total Amount of ECS Debits', field: 'ecsDrAmt', fmt: '₹' },
    { label: 'Total No. of ECS Returns / Bounces', field: 'ecsRetNos', fmt: 'n' },
    { label: '── NEFT / RTGS ──', field: 'zero', fmt: 'n' },
    { label: 'Total No. of NEFT Credit Transactions', field: 'neftCrNos', fmt: 'n' },
    { label: 'Total Amount of NEFT Credits', field: 'neftCrAmt', fmt: '₹' },
    { label: 'Total No. of NEFT Debit Transactions', field: 'neftDrNos', fmt: 'n' },
    { label: 'Total Amount of NEFT Debits', field: 'neftDrAmt', fmt: '₹' },
    { label: 'Total No. of NEFT Returns / Rejections', field: 'neftRetNos', fmt: 'n' },
    { label: 'Total No. of RTGS Credit Transactions', field: 'rtgsCrNos', fmt: 'n' },
    { label: 'Total Amount of RTGS Credits', field: 'rtgsCrAmt', fmt: '₹' },
    { label: 'Total No. of RTGS Debit Transactions', field: 'rtgsDrNos', fmt: 'n' },
    { label: 'Total Amount of RTGS Debits', field: 'rtgsDrAmt', fmt: '₹' },
    { label: '── Salary ──', field: 'zero', fmt: 'n' },
    { label: 'Total No. of Salary Credit Transactions', field: 'salCrNos', fmt: 'n' },
    { label: 'Total Amount of Salary Credits', field: 'salCrAmt', fmt: '₹' },
    { label: '── UPI / IMPS ──', field: 'zero', fmt: 'n' },
    { label: 'Total No. of UPI Credit Transactions', field: 'upiCrNos', fmt: 'n' },
    { label: 'Total Amount of UPI Credits', field: 'upiCrAmt', fmt: '₹' },
    { label: 'Total No. of UPI Debit Transactions', field: 'upiDrNos', fmt: 'n' },
    { label: 'Total Amount of UPI Debits', field: 'upiDrAmt', fmt: '₹' },
    { label: 'Total No. of IMPS Credit Transactions', field: 'impsCrNos', fmt: 'n' },
    { label: 'Total Amount of IMPS Credits', field: 'impsCrAmt', fmt: '₹' },
    { label: 'Total No. of IMPS Debit Transactions', field: 'impsDrNos', fmt: 'n' },
    { label: 'Total Amount of IMPS Debits', field: 'impsDrAmt', fmt: '₹' },
    { label: '── Cheque / CTS ──', field: 'zero', fmt: 'n' },
    { label: 'Total No. of Cheque Deposits', field: 'chqDepNos', fmt: 'n' },
    { label: 'Total Amount of Cheque Deposits', field: 'chqDepAmt', fmt: '₹' },
    { label: 'Total No. of Cheque Issues', field: 'chqIssNos', fmt: 'n' },
    { label: 'Total Amount of Cheque Issues', field: 'chqIssAmt', fmt: '₹' },
    { label: 'Total No. of Cheque Returns/Bounces', field: 'chqRetNos', fmt: 'n' },
  ]

  const result: AnalysisRow[] = []
  for (const def of metricDefs) {
    const row: AnalysisRow = { label: def.label, fmt: def.fmt, values: [], total: 0 }
    for (const mk of months) {
      let val = 0
      if (def.field === 'zero') val = 0
      else if (def.field === 'pctOwBounce') val = 0 // no bounce data from PDF (matches legacy: always 0)
      else if (def.field === 'pctCashDep') {
        const ca = sumField('cashDepAmt', mk); const ta = sumField('creditAmt', mk)
        val = ta > 0 ? ca / ta : 0
      } else if (def.field === 'pctCashWd') {
        const cw = sumField('cashWdAmt', mk); const td = sumField('debitAmt', mk)
        val = td > 0 ? cw / td : 0
      } else val = sumField(def.field, mk)
      row.values.push(val)
      row.total += val
    }
    result.push(row)
  }
  return result
}

/**
 * Ported unchanged from buildBreakupData (perfios-core.js:2007-2043).
 * Income/expense category x month matrices.
 */
export function buildBreakupData(allTxns: Transaction[], monthOrder: string[]): BreakupData {
  const incomeCategories = [
    'Interest Credit', 'Transfer Credit', 'Transfer from Self', 'Salary',
    'ACH Credit', 'ECS Credit', 'NEFT/RTGS Credit', 'UPI/IMPS Credit',
    'Cheque Deposit', 'Other Credit', 'Cash Deposit', 'Loan/EMI Credit',
  ]
  const expenseCategories = [
    'Salary', 'Utility Payment', 'Credit Card Payment', 'Bank Charges', 'Loan/EMI',
    'ACH Debit', 'ECS Debit', 'NEFT/RTGS Debit', 'UPI/IMPS Debit',
    'Cheque Issue', 'Cash Withdrawal', 'Other Debit', 'Bounce',
  ]

  const buildTable = (categories: string[], type: 'CR' | 'DR') => {
    const rows = categories.map(cat => {
      const values = monthOrder.map(mk => {
        const [yr, mo] = mk.split('-').map(Number)
        return allTxns.filter(t =>
          t.date.getFullYear() === yr && t.date.getMonth() === mo - 1 &&
          (type === 'CR' ? t.type === 'CR' : t.type === 'DR') &&
          t.category === cat,
        ).reduce((s, t) => s + t.amount, 0)
      })
      const total = values.reduce((s, v) => s + v, 0)
      const avg = values.length ? total / values.length : 0
      return { label: cat, values, total, avg }
    })
    return rows
  }

  return {
    income: buildTable(incomeCategories, 'CR'),
    expense: buildTable(expenseCategories, 'DR'),
  }
}

/**
 * Ported unchanged from buildEODData (perfios-core.js:2048-2062). Mirrors
 * "EOD Balances1" sheet: Day (1-31) x Month grid, same carry-forward logic.
 */
export function buildEODData(allTxns: Transaction[], monthOrder: string[]): EodData {
  const sortedAll = [...allTxns].sort((a, b) => a.date.getTime() - b.date.getTime())
  const openingBalance = getOpeningBalance(sortedAll)
  const eodGrid: EodData = {}
  for (let d = 1; d <= 31; d++) eodGrid[d] = {}

  for (const mk of monthOrder) {
    const [yr, mo] = mk.split('-').map(Number)
    const daysInMonth = new Date(yr, mo, 0).getDate()
    for (let day = 1; day <= daysInMonth; day++) {
      eodGrid[day][mk] = getEODBalance(yr, mo, day, sortedAll, openingBalance)
    }
  }
  return eodGrid
}
