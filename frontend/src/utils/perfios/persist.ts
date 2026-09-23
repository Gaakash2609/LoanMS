import type { PerfiosUploadResult } from '@/hooks/usePerfiosUpload'
import type { Transaction } from '@/utils/perfios/types'

// ── Perfios full-report persistence (serialize / deserialize) ─────────────
// The backend PerfiosReport row keeps the 10 quick-glance summary columns AND
// a ReportDataJson blob produced here — the COMPLETE analysis result so that
// Reports > Perfios Report can re-render the entire report (every parsed
// transaction, category buckets, ABB month grid, validation checks, account
// header) after a refresh / on another device, instead of losing everything
// but the summary. This is the persistence layer for the same in-memory
// PerfiosUploadResult that PerfiosAnalysisResults already renders live — no
// new report shape, no recomputation, just JSON with Date fields encoded as
// epoch-ms (JSON has no Date type) and decoded back to real Date objects on
// load (the table builders call .getMonth()/.getFullYear() on them).
//
// Nothing here touches localStorage/sessionStorage — the JSON is sent to and
// read from the backend only. It is the server that persists it.

const VERSION = 1

// Keys on PerfiosUploadResult whose value is a Transaction[] — each element
// carries a `date: Date` that must be epoch-encoded. Listed explicitly so a
// future field addition is a deliberate choice, not an accidental omission.
const TXN_ARRAY_KEYS = [
  'allTxns', 'filtered90', 'salaryTxns', 'achTxns', 'ecsTxns', 'neftTxns',
  'upiTxns', 'chequeTxns', 'bounceTxns', 'overdraftTxns',
] as const

type EncodedTxn = Omit<Transaction, 'date'> & { date: number }

function encodeTxn(t: Transaction): EncodedTxn {
  return { ...t, date: t.date instanceof Date ? t.date.getTime() : Number(t.date) }
}

function decodeTxn(raw: EncodedTxn): Transaction {
  return { ...raw, date: new Date(raw.date) }
}

function toMs(d: unknown): number | null {
  if (d instanceof Date) return d.getTime()
  if (typeof d === 'number') return d
  return null
}

/**
 * Serialize a completed Perfios analysis to the JSON stored in
 * PerfiosReport.ReportDataJson. Returns null if there is nothing to store.
 */
export function serializePerfiosReport(u: PerfiosUploadResult | null | undefined): string | null {
  if (!u) return null
  const out: Record<string, unknown> = {
    __v: VERSION,
    valid: u.valid,
    span: u.span,
    staledays: u.staledays,
    firstDate: toMs(u.firstDate),
    lastDate: toMs(u.lastDate),
    abb: u.abb,
    totalTxns: u.totalTxns,
    hasSalary: u.hasSalary,
    hasBounces: u.hasBounces,
    validChecks: u.validChecks,
    accountInfo: u.accountInfo,
    openingBalance: u.openingBalance,
    abbData: u.abbData,
    monthOrder: u.monthOrder,
    perFileData: u.perFileData,
    manualReviewRequired: u.manualReviewRequired,
    staleAttempts: u.staleAttempts,
  }
  for (const k of TXN_ARRAY_KEYS) {
    const arr = (u[k] as Transaction[] | undefined) ?? []
    out[k] = arr.map(encodeTxn)
  }
  try {
    return JSON.stringify(out)
  } catch {
    return null
  }
}

/**
 * Rebuild a PerfiosUploadResult from the stored JSON so
 * PerfiosAnalysisResults can render the full report exactly as it did live.
 * Returns null when the JSON is absent/blank/corrupt so the caller can fall
 * back to the summary card without crashing.
 */
export function deserializePerfiosReport(json: string | null | undefined): PerfiosUploadResult | null {
  if (!json) return null
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null

  const firstMs = raw.firstDate as number | null | undefined
  const lastMs = raw.lastDate as number | null | undefined

  const result = {
    valid: !!raw.valid,
    span: Number(raw.span) || 0,
    staledays: Number(raw.staledays) || 0,
    firstDate: new Date(typeof firstMs === 'number' ? firstMs : Date.now()),
    lastDate: new Date(typeof lastMs === 'number' ? lastMs : Date.now()),
    abb: Number(raw.abb) || 0,
    totalTxns: Number(raw.totalTxns) || 0,
    hasSalary: !!raw.hasSalary,
    hasBounces: !!raw.hasBounces,
    validChecks: Array.isArray(raw.validChecks) ? raw.validChecks : [],
    accountInfo: (raw.accountInfo as Record<string, unknown>) ?? {},
    openingBalance: Number(raw.openingBalance) || 0,
    abbData: (raw.abbData as Record<string, unknown>) ?? {},
    monthOrder: Array.isArray(raw.monthOrder) ? raw.monthOrder : [],
    perFileData: Array.isArray(raw.perFileData) ? raw.perFileData : [],
    manualReviewRequired: !!raw.manualReviewRequired,
    staleAttempts: Number(raw.staleAttempts) || 0,
  } as unknown as Record<string, unknown>

  for (const k of TXN_ARRAY_KEYS) {
    const arr = raw[k]
    result[k] = Array.isArray(arr) ? (arr as EncodedTxn[]).map(decodeTxn) : []
  }

  return result as unknown as PerfiosUploadResult
}
