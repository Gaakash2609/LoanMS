// ── Perfios types ────────────────────────────────────────────────────────
// Mirrors the exact shapes used throughout legacy perfios-core.js
// (allTxns entries, accountInfo, validation checks, ABB/FinOne/Analysis/
// Breakup/EOD outputs). No fields renamed or restructured relative to the
// legacy in-memory objects — this is a direct type overlay, not a redesign.

export type TxnType = 'CR' | 'DR'

export interface Transaction {
  date: Date
  desc: string
  rawDesc: string
  type: TxnType
  amount: number
  balance: number
  category: string
  _fileIdx?: number
  _balanceMismatch?: boolean
}

export interface AccountInfo {
  bank?: string
  accountNo?: string
  ifsc?: string
  micr?: string
  accountType?: string
  branch?: string
  name?: string
  mobile?: string
  email?: string
  pan?: string
  address?: string
  cif?: string
  periodFrom?: string
  periodTo?: string
}

export interface ValidationCheck {
  id: string
  status: 'pass' | 'warn' | 'fail'
  icon: string
  title: string
  detail: string
  value: string
}

// ── ABB (Average Bank Balance) intermediate structures ──────────────────
export interface TargetDateRow {
  targetDate: Date
  actualDate: Date | null
  fallback: boolean
  eodBalance: number
  txn: Transaction | null
}

export interface AbbMonthData {
  label: string
  dates: Record<number, number> // target-day-of-month -> EOD carry-forward balance
  credits: number
  creditCount: number
  debitCount: number
  debitTotal: number
}

export type AbbData = Record<string, AbbMonthData> // key: 'YYYY-MM'

// ── FinOne1 row (mirrors FinOne1 sheet columns exactly, see buildFinOneData) ──
export interface FinOneRow {
  month: string
  creditsNos: number
  creditsValue: number
  iwChqRet: number
  bal2: number
  bal4: number
  bal10: number
  bal17: number
  bal25: number
  eodLast: number
  kAvg: number
  withdrawalAmt: number
  owChqRet: number
  withdrawlNos: number
  totalChqBounces: number
  pct_ow: number
  minBal: number
  emiReflects: number
  salaryCredit: number
  salaryDate: string
  pct_iw: number
}

// ── Analysis1 row (mirrors buildAnalysisData's metricDefs rows) ─────────
export interface AnalysisRow {
  label: string
  fmt: 'n' | '₹' | '%'
  values: number[]
  total: number
}

// ── Breakup (income/expense category x month matrix) ────────────────────
export interface BreakupRow {
  label: string
  values: number[]
  total: number
  avg: number
}

export interface BreakupData {
  income: BreakupRow[]
  expense: BreakupRow[]
}

// ── EOD grid: day-of-month (1-31) -> { 'YYYY-MM': balance } ─────────────
export type EodData = Record<number, Record<string, number>>

// ── Final summary shape saved via existing PerfiosController contract ───
// (SavePerfiosReportRequestDto — field names match exactly)
export interface PerfiosSummary {
  fileName: string
  averageBankBalance: number | null
  span: number | null
  totalTransactions: number | null
  hasSalary: boolean
  isValid: boolean
  firstTransactionDate: string | null
  lastTransactionDate: string | null
  manualReviewRequired: boolean
  staleDays: number | null
}
