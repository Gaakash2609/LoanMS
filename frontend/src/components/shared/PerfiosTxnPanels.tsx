import type { Transaction, TargetDateRow, AccountInfo, ValidationCheck } from '@/utils/perfios/types'
import { fmt, fmtDate } from '@/utils/perfios/analysis'
import {
  getSalaryKeyword,
  getACHSubType, getACHKeyword,
  getECSSubType, getECSKeyword,
  getNEFTSubType, getNEFTKeyword,
  getUPISubType, getUPIKeyword,
  getChequeSubType, getChequeKeyword,
  getBounceSubType,
} from '@/utils/perfios/categorizer'
import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'

// ── Perfios transaction-list panels ─────────────────────────────────────
// Renders the sub-tabs legacy shows under Reports > Perfios Report
// (#pfr-tabs: txn / abb / target / salary / ach / ecs / neft / upi /
// cheque / bounce / accounts / validation), which had no React equivalent.
//
// Columns are legacy's, verbatim per panel. Sub-Type and Keyword are not
// invented: they come from the same categorizer helpers the parser already
// uses to bucket each transaction (getACHSubType, getUPIKeyword, …), so the
// values shown are the ones that put the row in that bucket in the first
// place.
//
// Every row here comes from the in-memory PerfiosUploadResult produced by the
// upload/parse step. Nothing is fetched: the backend's PerfiosReport table
// stores an 11-field summary only (no transactions), so a saved report cannot
// repopulate these tables — they are live for the run that produced them.

const monthOf = (d: Date) =>
  d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })

// Legacy status colors (perfios/css/perfios.css --success/--danger), not
// Tailwind's stock green/red-50/700 — same color-token sweep already applied
// elsewhere in the app (see CHANGES.md).
function TypePill({ type }: { type: 'CR' | 'DR' }) {
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold"
      style={type === 'CR'
        ? { background: 'rgba(26,115,64,.08)', color: 'var(--success)' }
        : { background: 'rgba(227,30,37,.08)', color: 'var(--danger)' }}
    >{type}</span>
  )
}

function Empty({ what }: { what: string }) {
  return <p className="py-8 text-center text-sm text-gray-400">No {what} found in this statement.</p>
}

/** Extra per-row columns a panel wants beyond the shared six. */
type ExtraCols = {
  headers: string[]
  cells: (t: Transaction) => (string | number)[]
}

export function TxnTable({
  rows, extra, emptyLabel,
}: { rows: Transaction[]; extra?: ExtraCols; emptyLabel: string }) {
  if (!rows.length) return <Empty what={emptyLabel} />
  return (
    <div className="overflow-auto max-h-[520px]">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-white">
          <tr className="text-left text-gray-500 border-b border-gray-200">
            <th className="py-2 pr-2 font-semibold">#</th>
            <th className="py-2 pr-2 font-semibold">Date</th>
            <th className="py-2 pr-2 font-semibold">Narration</th>
            <th className="py-2 pr-2 font-semibold">Type</th>
            <th className="py-2 pr-2 font-semibold text-right">Amount (₹)</th>
            <th className="py-2 pr-2 font-semibold text-right">Balance (₹)</th>
            {(extra?.headers ?? []).map(h => (
              <th key={h} className="py-2 pr-2 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => (
            <tr key={i} className="border-b border-gray-100 last:border-0">
              <td className="py-1.5 pr-2 text-gray-400 tabular-nums">{i + 1}</td>
              <td className="py-1.5 pr-2 whitespace-nowrap tabular-nums">{fmtDate(t.date)}</td>
              <td className="py-1.5 pr-2 max-w-[320px] truncate" title={t.rawDesc || t.desc}>{t.desc}</td>
              <td className="py-1.5 pr-2"><TypePill type={t.type} /></td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(t.amount)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(t.balance)}</td>
              {(extra?.cells(t) ?? []).map((c, j) => (
                <td key={j} className="py-1.5 pr-2 text-gray-600">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Per-panel extra columns, matching legacy's <th> sets exactly.
export const EXTRA_CATEGORY: ExtraCols = {
  headers: ['Category'],
  cells: t => [t.category || '—'],
}
export const EXTRA_SALARY: ExtraCols = {
  headers: ['Keyword', 'Month'],
  cells: t => [getSalaryKeyword(t.rawDesc || t.desc) || '—', monthOf(t.date)],
}
const subTypePanel = (
  subType: (d: string) => string,
  keyword?: (d: string) => string,
): ExtraCols => ({
  headers: keyword ? ['Sub-Type', 'Keyword', 'Month'] : ['Sub-Type', 'Month'],
  cells: t => {
    const d = t.rawDesc || t.desc
    return keyword
      ? [subType(d) || '—', keyword(d) || '—', monthOf(t.date)]
      : [subType(d) || '—', monthOf(t.date)]
  },
})
export const EXTRA_ACH    = subTypePanel(getACHSubType, getACHKeyword)
export const EXTRA_ECS    = subTypePanel(getECSSubType, getECSKeyword)
export const EXTRA_NEFT   = subTypePanel(getNEFTSubType, getNEFTKeyword)
export const EXTRA_UPI    = subTypePanel(getUPISubType, getUPIKeyword)
export const EXTRA_CHEQUE = subTypePanel(getChequeSubType, getChequeKeyword)
export const EXTRA_BOUNCE = subTypePanel(getBounceSubType)

// ── Target-date / ABB grid ──────────────────────────────────────────────
// Legacy columns: Target Date | Actual Date | Type | Narration | CR/DR |
// Amount (₹) | EOD Balance (₹). "Type" is legacy's fallback marker — whether
// the row landed on the exact target date or carried forward from an
// earlier one (TargetDateRow.fallback).
export function TargetDateTable({ rows }: { rows: TargetDateRow[] }) {
  if (!rows.length) return <Empty what="target-date balances" />
  return (
    <div className="overflow-auto max-h-[520px]">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-white">
          <tr className="text-left text-gray-500 border-b border-gray-200">
            {['Target Date', 'Actual Date', 'Type', 'Narration', 'CR/DR', 'Amount (₹)', 'EOD Balance (₹)'].map(h => (
              <th key={h} className={`py-2 pr-2 font-semibold ${h.includes('₹') ? 'text-right' : ''}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-100 last:border-0">
              <td className="py-1.5 pr-2 whitespace-nowrap tabular-nums">{fmtDate(r.targetDate)}</td>
              <td className="py-1.5 pr-2 whitespace-nowrap tabular-nums">{r.actualDate ? fmtDate(r.actualDate) : '—'}</td>
              <td className="py-1.5 pr-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${r.fallback ? '' : 'bg-gray-100 text-gray-600'}`}
                  style={r.fallback ? { background: 'rgba(230,126,0,.08)', color: 'var(--warn)' } : undefined}
                >{r.fallback ? 'Carried fwd' : 'Exact'}</span>
              </td>
              <td className="py-1.5 pr-2 max-w-[300px] truncate" title={r.txn?.rawDesc ?? ''}>{r.txn?.desc ?? '—'}</td>
              <td className="py-1.5 pr-2">{r.txn ? <TypePill type={r.txn.type} /> : '—'}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{r.txn ? fmt(r.txn.amount) : '—'}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums font-semibold">{fmt(r.eodBalance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Accounts panel ──────────────────────────────────────────────────────
// Legacy renders the extracted account header as a label/value list, not a
// table — same here. Only fields the parser actually found are shown.
const ACCOUNT_FIELDS: [keyof AccountInfo, string][] = [
  ['bank', 'Bank'], ['name', 'Account Holder'], ['accountNo', 'Account Number'],
  ['accountType', 'Account Type'], ['ifsc', 'IFSC'], ['micr', 'MICR'],
  ['branch', 'Branch'], ['cif', 'CIF'], ['pan', 'PAN'],
  ['mobile', 'Mobile'], ['email', 'Email'], ['address', 'Address'],
  ['periodFrom', 'Statement From'], ['periodTo', 'Statement To'],
]

export function AccountsPanel({ info }: { info: AccountInfo }) {
  const present = ACCOUNT_FIELDS.filter(([k]) => {
    const v = info[k]
    return v != null && String(v).trim() !== ''
  })
  if (!present.length) return <Empty what="account details" />
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
      {present.map(([k, label]) => (
        <div key={k} className="flex justify-between gap-4 border-b border-gray-100 pb-2">
          <span className="text-xs text-gray-500">{label}</span>
          <span className="text-xs font-medium text-gray-900 text-right break-all">{String(info[k])}</span>
        </div>
      ))}
    </div>
  )
}

// ── Validation panel ────────────────────────────────────────────────────
const CHECK_ICON = { pass: CheckCircle2, warn: AlertTriangle, fail: XCircle } as const
// Legacy status colors (perfios/css/perfios.css --success/--warn/--danger),
// not Tailwind's stock green/yellow/red-600.
const CHECK_COLOR = {
  pass: 'text-[color:var(--success)]', warn: 'text-[color:var(--warn)]', fail: 'text-[color:var(--danger)]',
} as const

export function ValidationPanel({ checks }: { checks: ValidationCheck[] }) {
  if (!checks.length) return <Empty what="validation checks" />
  return (
    <div className="space-y-2">
      {checks.map(c => {
        const Icon = CHECK_ICON[c.status]
        return (
          <div key={c.id} className="flex items-start gap-3 rounded-lg border border-gray-100 px-3 py-2.5">
            <Icon size={16} className={`${CHECK_COLOR[c.status]} mt-0.5 shrink-0`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900">{c.title}</p>
              <p className="text-xs text-gray-500 mt-0.5">{c.detail}</p>
            </div>
            <span className="text-xs font-semibold text-gray-700 whitespace-nowrap tabular-nums">{c.value}</span>
          </div>
        )
      })}
    </div>
  )
}
