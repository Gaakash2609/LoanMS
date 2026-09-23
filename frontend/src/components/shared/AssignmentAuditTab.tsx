import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import DataTable, { type Column } from '@/components/shared/DataTable'
import { formatDateTime } from '@/utils/format'
import {
  assignmentAuditApi, parseCandidates, type AssignmentAuditLog,
} from '@/api/assignmentAuditApi'

// ── Assignment Trail ────────────────────────────────────────────────────
// Reads /api/assignment-audit, which has had no React caller. Legacy records
// entries into this table from two places but never renders them — the
// history existed only in the database.
//
// Server-side the endpoint already supports the two things this needs:
// `loanId` (matching either the numeric loan id or the frontend application
// id) and `take` (clamped 1–1000). Both are used rather than pulling the
// whole table and filtering here.
//
// The trail is insert-only by design, so there are deliberately no row
// actions — nothing here can edit or delete an entry.

// `manual`/`unassigned` were stock Tailwind purple-50/amber-50 — no legacy
// token for either color exists (--accent2 is red, not purple/amber), but
// legacy does use both hues elsewhere for category tags: `.badge-underwriting`
// (app.css:2943, literal #a159ff/rgba(161,89,255,.15) — not a CSS var) and
// `.badge-wip` (app.css:2929, rgba(255,179,71,.15) bg / `--warn` text).
// Remapped to those exact values rather than guessing at new ones.
const METHOD_STYLE: Record<string, string> = {
  auto:       'bg-efin-blue/10 text-efin-blue',
  manual:     'bg-[rgba(161,89,255,.15)] text-[#a159ff]',
  unassigned: 'bg-[rgba(255,179,71,.15)] text-[color:var(--warn)]',
}

const TAKE_OPTIONS = [50, 200, 500, 1000]

export default function AssignmentAuditTab() {
  // `loanId` is sent to the server; `search` narrows the returned rows on
  // fields the endpoint has no parameter for.
  const [loanId, setLoanId] = useState('')
  const [appliedLoanId, setAppliedLoanId] = useState('')
  const [take, setTake] = useState(200)
  const [method, setMethod] = useState('')
  const [search, setSearch] = useState('')

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['assignment-audit', appliedLoanId, take],
    queryFn: () => assignmentAuditApi.getAll({
      loanId: appliedLoanId || undefined,
      take,
    }).then(r => r.data.data ?? []),
    staleTime: 30_000,
    // Fail fast rather than retrying three times behind a table that looks
    // empty in the meantime — a failed load must read as failed, not as
    // "no history recorded".
    retry: false,
  })

  const q = search.trim().toLowerCase()
  const rows = (data ?? []).filter(r => {
    if (method && r.method !== method) return false
    if (!q) return true
    return [r.loanFrontendId, r.assignedToUserName, r.assignedByName, r.previousUserName, r.location, r.salesPerson]
      .some(v => (v ?? '').toLowerCase().includes(q))
  })

  const columns: Column<AssignmentAuditLog>[] = [
    { key: 'assignedAt', label: 'When', render: r => formatDateTime(r.assignedAt) },
    { key: 'loanFrontendId', label: 'Application', render: r => (
      <span className="efin-mono-id">{r.loanFrontendId}</span>
    )},
    { key: 'method', label: 'Method', render: r => (
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${METHOD_STYLE[r.method] ?? 'bg-gray-100 text-gray-600'}`}>
        {r.method}
        {r.tieBreak ? ' · tie-break' : ''}
      </span>
    )},
    { key: 'assignedToUserName', label: 'Assigned To', render: r => (
      <div>
        <p className="font-medium text-gray-900">{r.assignedToUserName ?? '— unassigned —'}</p>
        {r.previousUserName && (
          <p className="text-[11px] text-gray-500">was {r.previousUserName}</p>
        )}
      </div>
    )},
    { key: 'assignedByName', label: 'Decided By', render: r => r.assignedByName ?? '—' },
    { key: 'location', label: 'Context', render: r => (
      <div className="text-xs text-gray-600">
        {r.location || '—'}
        {r.salesPerson ? <span className="block text-[11px] text-gray-400">Sales: {r.salesPerson}</span> : null}
      </div>
    )},
    { key: 'candidatesJson', label: 'Considered', render: r => {
      const c = parseCandidates(r.candidatesJson)
      if (!c.length) return <span className="text-gray-400">—</span>
      return (
        <span className="text-xs text-gray-600" title={c.join(', ')}>
          {c.length} candidate{c.length > 1 ? 's' : ''}
        </span>
      )
    }},
    { key: 'reason', label: 'Reason', render: r => (
      <span className="text-xs text-gray-600">{r.reason || '—'}</span>
    )},
  ]

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search user, application, location"
            className="w-full rounded-lg border border-gray-300 bg-gray-50 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue focus:bg-white"
          />
        </div>

        <form
          onSubmit={e => { e.preventDefault(); setAppliedLoanId(loanId.trim()) }}
          className="flex items-center gap-2">
          <input
            value={loanId}
            onChange={e => setLoanId(e.target.value)}
            placeholder="Filter by application ID"
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm w-[190px] focus:outline-none focus:ring-2 focus:ring-efin-blue"
          />
          <button type="submit"
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Apply
          </button>
          {appliedLoanId && (
            <button type="button"
              onClick={() => { setLoanId(''); setAppliedLoanId('') }}
              className="text-xs font-semibold text-efin-blue hover:underline">
              Clear
            </button>
          )}
        </form>

        <select value={method} onChange={e => setMethod(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
          <option value="">All methods</option>
          {['auto', 'manual', 'unassigned'].map(m => <option key={m} value={m}>{m}</option>)}
        </select>

        <select value={take} onChange={e => setTake(Number(e.target.value))}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
          {TAKE_OPTIONS.map(n => <option key={n} value={n}>Last {n}</option>)}
        </select>

        <span className="text-xs" style={{ color: 'var(--text3)' }}>
          {rows.length} of {(data ?? []).length}
        </span>
      </div>

      <Card>
        <DataTable
          columns={columns}
          data={rows}
          isLoading={isLoading}
          error={error}
          onRetry={() => refetch()}
          emptyTitle="No assignment history"
          emptyDescription={
            appliedLoanId
              ? 'Nothing has been recorded for that application yet.'
              : 'Assignment decisions will appear here once applications are assigned.'
          }
        />
      </Card>

      <p className="text-[11px] mt-3" style={{ color: 'var(--text3)' }}>
        This trail is insert-only — entries can be read but never edited or removed.
      </p>
    </div>
  )
}
