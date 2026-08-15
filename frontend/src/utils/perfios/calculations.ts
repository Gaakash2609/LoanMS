import type { AbbData, TargetDateRow, Transaction } from './types'

// Target days-of-month sampled for Average Bank Balance — ported unchanged
// from perfios-core.js:79 (TARGET_DAYS).
export const TARGET_DAYS = [2, 4, 10, 17, 25]

/**
 * Ported unchanged from getOpeningBalance (perfios-core.js:1621-1630).
 * Opening balance = inferred from the first transaction: if CR, opening =
 * balance - amount; if DR, opening = balance + amount.
 */
export function getOpeningBalance(sortedAllTxns: Transaction[]): number {
  if (!sortedAllTxns.length) return 0
  const first = sortedAllTxns[0]
  return first.type === 'CR' ? first.balance - first.amount : first.balance + first.amount
}

/**
 * Ported unchanged from getEODBalance (perfios-core.js:1632-1643). EOD
 * balance for a target date = running balance carry-forward: the balance
 * after the LAST transaction on or before that date across the entire
 * statement (not "next available after"). targetMonth is 1-based.
 */
export function getEODBalance(
  targetYear: number, targetMonth: number, targetDay: number,
  sortedAllTxns: Transaction[], openingBalance: number,
): number {
  const targetStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`
  let lastBal = openingBalance
  for (const t of sortedAllTxns) {
    const d = t.date
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (ds <= targetStr) lastBal = t.balance
    else break // sorted, so we can stop early
  }
  return lastBal
}

/**
 * Ported unchanged from applyTargetDateFilter (perfios-core.js:1645-1686).
 * For every calendar month present in the statement, computes the EOD
 * carry-forward balance at each of TARGET_DAYS, plus the last actual
 * transaction on/before that date (for display/fallback info).
 */
export function applyTargetDateFilter(sortedAllTxns: Transaction[]): TargetDateRow[] {
  const rows: TargetDateRow[] = []
  const openingBalance = getOpeningBalance(sortedAllTxns)

  const monthSet = new Set<string>()
  for (const t of sortedAllTxns) {
    monthSet.add(`${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, '0')}`)
  }
  const monthKeys = [...monthSet].sort()

  for (const mk of monthKeys) {
    const [yr, mo] = mk.split('-').map(Number)
    for (const targetDay of TARGET_DAYS) {
      const targetDt = new Date(yr, mo - 1, targetDay)
      const eodBal = getEODBalance(yr, mo, targetDay, sortedAllTxns, openingBalance)
      const targetStr = `${yr}-${String(mo).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`
      let lastTxnOnOrBefore: Transaction | null = null
      for (const t of sortedAllTxns) {
        const ds = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, '0')}-${String(t.date.getDate()).padStart(2, '0')}`
        if (ds <= targetStr) lastTxnOnOrBefore = t
        else break
      }
      const hasExactMatch = !!lastTxnOnOrBefore &&
        lastTxnOnOrBefore.date.getFullYear() === yr &&
        lastTxnOnOrBefore.date.getMonth() === mo - 1 &&
        lastTxnOnOrBefore.date.getDate() === targetDay

      rows.push({
        targetDate: targetDt,
        actualDate: lastTxnOnOrBefore ? lastTxnOnOrBefore.date : null,
        fallback: !hasExactMatch,
        eodBalance: eodBal,
        txn: lastTxnOnOrBefore,
      })
    }
  }
  return rows
}

/**
 * Ported unchanged from buildABBFromTargetRows (perfios-core.js:1692-1720).
 * ABB1-sheet-equivalent: each cell = EOD carry-forward balance at a target
 * date; monthly average = AVERAGE(5 target-date balances); overall ABB =
 * AVERAGE of all monthly averages (computed by the caller from this data,
 * matching legacy's own abbVal computation in perfios-popup.js).
 */
export function buildABBFromTargetRows(
  rows: TargetDateRow[], allTxns: Transaction[],
): { abbData: AbbData; monthOrder: string[] } {
  const abbData: AbbData = {}
  const monthOrder: string[] = []

  for (const row of rows) {
    const d = row.targetDate
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = new Date(d.getFullYear(), d.getMonth(), 1)
      .toLocaleString('en-IN', { month: 'short', year: '2-digit' })
    if (!abbData[mk]) {
      abbData[mk] = { label, dates: {}, credits: 0, creditCount: 0, debitCount: 0, debitTotal: 0 }
      monthOrder.push(mk)
    }
    abbData[mk].dates[row.targetDate.getDate()] = row.eodBalance
  }

  for (const t of allTxns) {
    const mk = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, '0')}`
    if (abbData[mk]) {
      if (t.type === 'CR') { abbData[mk].credits += t.amount; abbData[mk].creditCount++ }
      else { abbData[mk].debitTotal += t.amount; abbData[mk].debitCount++ }
    }
  }

  monthOrder.sort()
  return { abbData, monthOrder }
}

/**
 * The overall Average Bank Balance figure — average of each month's average
 * of its target-date EOD balances. Ported unchanged from the identical
 * inline computation duplicated in perfios-popup.js's _postToParent and
 * _updateResetBar (both compute this the same way from abbData/monthOrder).
 */
export function computeOverallAbb(abbData: AbbData, monthOrder: string[]): number {
  if (!monthOrder.length || !Object.keys(abbData).length) return 0
  const avgs = monthOrder.map(mk => {
    const vals = Object.values(abbData[mk].dates)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  })
  return avgs.reduce((a, b) => a + b, 0) / Math.max(1, avgs.length)
}
