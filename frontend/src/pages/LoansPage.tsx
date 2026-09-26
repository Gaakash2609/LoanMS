import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLoans } from '@/hooks/useLoans'
import AdvancedFilterModal from '@/components/shared/AdvancedFilterModal'
import {
  EMPTY_ADV_FILTER, activeFilterCount, advToServerFilter, FIELD_LABELS, type AdvFilter,
} from '@/constants/advFilter'
import { useLoanStore } from '@/store/loanStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { formatCurrency, formatDate } from '@/utils/format'
import {
  Plus, Search, RefreshCw, AlertTriangle, ChevronLeft, ChevronRight, FileClock, Play, Trash2, Download,
  SlidersHorizontal, Eye, ClipboardList, Inbox, SearchX, X, Archive,
} from 'lucide-react'
import { listDraftMetas, deleteDraftMeta, type WizardDraftSummary } from '@/utils/draftStorage'
import ExportLoansModal from '@/components/shared/ExportLoansModal'
import { loansApi } from '@/api/loansApi'
import { useAuthStore } from '@/store/authStore'

// Vanilla applications filter chips (index.html:963) — business labels
// mapped onto this app's status enum (Personal Details=Draft/WIP, Assign
// Lender=Submitted, Underwriting=UnderReview, Offer=Offer, Hold=OnHold).
// Offer is legacy's 'offer' stage, now a real backend status.
const STATUS_CHIPS: { label: string; value: string }[] = [
  { label: 'All', value: '' },
  { label: 'Personal Details', value: 'Draft' },
  { label: 'Assign Lender', value: 'Submitted' },
  { label: 'Underwriting', value: 'UnderReview' },
  { label: 'Offer', value: 'Offer' },
  { label: 'Approved', value: 'Approved' },
  { label: 'Disbursed', value: 'Disbursed' },
  { label: 'Rejected', value: 'Rejected' },
  { label: 'Hold', value: 'OnHold' },
]

// Target statuses offered for bulk change — mirrors legacy's bulk-action
// dropdown (Under Review / Approved / Rejected / Disbursed). The backend
// validates each record's own permission + transition legality and reports
// per-record succeeded/failed counts, so this list is only about which
// targets to offer, not about enforcement.
// Approved / Disbursed are no longer bulk targets: they are reached only through
// the Offers workflow (credit approval, disbursement record) and the backend
// refuses them on the status route.
const BULK_STATUSES = ['UnderReview', 'Rejected']

// Legacy renderAppsPaginationBar's page window: always 1 and last, plus the
// current page and its immediate neighbours; null marks an elided gap.
export function pageWindow(current: number, total: number): (number | null)[] {
  const set = new Set<number>([1, total])
  for (let p = current - 1; p <= current + 1; p++) if (p > 1 && p < total) set.add(p)
  const sorted = [...set].sort((a, b) => a - b)
  const out: (number | null)[] = []
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push(null)
    out.push(p)
  })
  return out
}

// Two-letter avatar initials for the Applicant column (first + last word).
function initials(name?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2)
  return parts[0][0] + parts[parts.length - 1][0]
}

const NO_FILTER_OPTIONS = {
  salesPeople: [], locations: [], channels: [], banks: [], purposes: [], empTypes: [],
  cities: [], states: [], genders: [], dsaNames: [], partners: [], companies: [],
}

export default function LoansPage() {
  const { filter, setFilter } = useLoanStore()
  const { data, isLoading, isError, isFetching, refetch } = useLoans(filter)
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  // 'archived' = the same server-paged table, asking only for archived
  // applications (filter.archived = 'only'); the default list, its counts and
  // export never include them. Start in whichever view the stored filter is in.
  const [section, setSection] = useState<'applications' | 'archived' | 'drafts'>(
    filter.archived === 'only' ? 'archived' : 'applications')
  const isListSection = section === 'applications' || section === 'archived'
  const switchSection = (next: 'applications' | 'archived' | 'drafts') => {
    setSection(next)
    setSelected([])
    if (next === 'archived' && filter.archived !== 'only') setFilter({ archived: 'only', page: 1 })
    if (next === 'applications' && filter.archived) setFilter({ archived: undefined, page: 1 })
  }
  const [showExport, setShowExport] = useState(false)
  const [drafts, setDrafts] = useState<WizardDraftSummary[]>([])
  const [draftsLoading, setDraftsLoading] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [bulkStatus, setBulkStatus] = useState('')
  const [bulkResult, setBulkResult] = useState('')

  // ── Advanced filter ───────────────────────────────────────────────────
  // Legacy keeps one `advFilter` object and re-renders the table from it.
  // Here every part is pushed into the shared loan filter and evaluated by
  // the server, so paging, totals and export all reflect it.
  const [adv, setAdv] = useState<AdvFilter>(EMPTY_ADV_FILTER)
  const [showAdv, setShowAdv] = useState(false)
  const advCount = activeFilterCount(adv)

  function applyAdv(next: AdvFilter) {
    setAdv(next)
    setShowAdv(false)
    setFilter({
      ...advToServerFilter(next),
      pageSize: filter.pageSize && filter.pageSize <= 100 ? filter.pageSize : 25,
      page: 1,
    })
  }

  function clearSingleFilter(key: keyof AdvFilter) {
    const next: AdvFilter = { ...adv, [key]: '' }
    // Legacy's clearSingleFilter drops the custom range along with the mode.
    if (key === 'dateMode') { next.dateFrom = ''; next.dateTo = '' }
    applyAdv(next)
  }

  function resetAdv() {
    setAdv(EMPTY_ADV_FILTER)
    setFilter({ ...advToServerFilter(EMPTY_ADV_FILTER), pageSize: 25, page: 1 })
  }

  // Matches PATCH /api/loans/bulk-status's [Authorize(Roles=...)] exactly.
  const canBulk = ['Admin', 'Manager', 'LoginTeam', 'TeamLeader', 'LocationHead', 'OperationManager']
    .includes(user?.role ?? '')

  // Legacy shows the row "🗑 Delete" action only to Admin (efin-app.js:2057);
  // DELETE /api/loans/{id} still enforces the real rule server-side
  // (creator-or-Admin/Manager AND Draft-status only).
  const isAdmin = user?.role === 'Admin'

  const deleteLoan = useMutation({
    mutationFn: (id: number) => loansApi.delete(id),
    // Success ("Loan deleted.") and the server's refusal reason ("Only Draft
    // loans can be deleted.") are both raised by the app-wide toast handler.
    meta: { errorMessage: 'Delete failed.' },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loans'] })
    },
  })

  const bulkUpdate = useMutation({
    mutationFn: () => loansApi.bulkUpdateStatus(selected, bulkStatus),
    onSuccess: (res) => {
      const d = res.data.data
      setBulkResult(
        d ? `${d.succeeded} updated${d.failed ? `, ${d.failed} failed` : ''}${d.errors?.length ? ` — ${d.errors.slice(0, 2).join('; ')}` : ''}`
          : 'Bulk update completed.')
      setSelected([])
      setBulkStatus('')
      qc.invalidateQueries({ queryKey: ['loans'] })
    },
    onError: (err: unknown) => {
      const d = (err as { response?: { data?: { message?: string } } })?.response?.data
      setBulkResult(d?.message || 'Bulk update failed.')
    },
  })

  // The server applies every filter, so the page it returns is the result.
  const rows = data?.items ?? []
  // Dropdown options come from ALL loans the user can see (not just this
  // page), so any existing value can be chosen.
  const { data: filterOptions } = useQuery({
    queryKey: ['loan-filter-options'],
    queryFn: () => loansApi.filterOptions().then(r => r.data.data),
    staleTime: 5 * 60_000,
  })

  const pageIds = rows.map(l => l.id)
  const allSelected = pageIds.length > 0 && pageIds.every(id => selected.includes(id))
  const toggleAll = () => setSelected(allSelected ? [] : pageIds)
  const toggleOne = (id: number) =>
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const refreshDrafts = async () => {
    setDraftsLoading(true)
    try {
      setDrafts(await listDraftMetas())
    } finally {
      setDraftsLoading(false)
    }
  }

  useEffect(() => {
    if (section === 'drafts') refreshDrafts()
  }, [section])

  const handleDiscardDraft = async (loanId: number) => {
    await deleteDraftMeta(loanId)
    refreshDrafts()
  }

  // Explicit page navigation — clamped so a stale page number from a previous,
  // larger result set can never be requested.
  const goToPage = (p: number) => {
    const total = data?.totalPages ?? 1
    setFilter({ page: Math.min(Math.max(1, p), Math.max(1, total)) })
  }

  // Search is driven from the top header bar, which writes filter.search.
  // The page shows what is applied and offers the one-click way back out.
  const activeSearch = (filter.search ?? '').trim()
  const total = data?.totalCount ?? 0
  // The request itself failed (network / server / auth) — this is NOT the same
  // as "there are no applications", so it gets its own state instead of a
  // misleading "0 total / No applications found".
  const loadFailed = isError && !data
  const clearSearch = () => setFilter({ search: undefined, searchField: undefined })

  // "Narrowed" = anything that could be hiding rows: header search, a status
  // chip, or an Advanced Filter. Drives the empty state's wording and reset.
  const isNarrowed = !!activeSearch || !!filter.status || advCount > 0
  const resetEverything = () => {
    setAdv(EMPTY_ADV_FILTER)
    setFilter({
      ...advToServerFilter(EMPTY_ADV_FILTER),
      search: undefined, searchField: undefined, pageSize: 25, page: 1,
    })
  }

  return (
    <>
      <div className="apps-page space-y-5">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="ap-head">
          <div className="ap-head-main">
            <span className="ap-head-icon" aria-hidden><ClipboardList size={22} /></span>
            <div className="min-w-0">
              <h1 className="ap-title">Applications</h1>
              <p className="ap-sub">
                <span className="ap-count">{loadFailed ? '—' : total}</span>
                {section === 'archived' ? 'archived' : 'total'} application{total !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <div className="ap-head-actions">
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              <RefreshCw size={14} className="mr-1.5" />Refresh
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setShowExport(true)}>
              <Download size={14} className="mr-1.5" />Export
            </Button>
          </div>
        </div>

        {/* ── Section switch ─────────────────────────────────────────── */}
        <div className="ap-seg" role="tablist" aria-label="Applications section">
          {([
            { key: 'applications', label: 'Applications' },
            { key: 'archived', label: 'Archived' },
            { key: 'drafts', label: 'Drafts' },
          ] as const).map(t => (
            <button key={t.key} type="button" role="tab" aria-selected={section === t.key}
              onClick={() => switchSection(t.key)}
              className={`ap-seg-btn ${section === t.key ? 'is-active' : ''}`}>
              {t.key === 'drafts' && <FileClock size={14} />}
              {t.key === 'archived' && <Archive size={14} />}
              {t.label}
              {t.key === 'drafts' && drafts.length > 0 && (
                <span className="ap-pill-orange">{drafts.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Status tabs + Filters. Search lives in the top header bar (it writes
            the same loan filter), so this row carries only the status chips and
            the advanced Filters button. */}
        {isListSection && (
          <div className="ap-toolbar">
            {STATUS_CHIPS.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => setFilter({ status: (c.value || undefined) as typeof filter.status })}
                className={`filter-chip ${(filter.status ?? '') === c.value ? 'active' : ''}`}
              >
                {c.label}
              </button>
            ))}
            {/* Legacy's #adv-filter-btn with its count badge. */}
            <Button variant="secondary" size="sm" className="ap-filters-btn" onClick={() => setShowAdv(true)}>
              <SlidersHorizontal size={14} className="mr-1.5" />
              Filters
              {advCount > 0 && <span className="ap-pill-orange ml-1.5">{advCount}</span>}
            </Button>
          </div>
        )}

        {isListSection && (
          <Card className="ap-card">

            {/* Shown while the header search is applied, with a way to clear it —
                the page no longer has its own search box to empty. */}
            {activeSearch && (
              <div className="ap-search-note">
                <Search size={14} aria-hidden />
                <span>Results for <strong>“{activeSearch}”</strong></span>
                <span className="ap-search-count">{total} result{total !== 1 ? 's' : ''}</span>
                <button type="button" className="ap-link-btn" onClick={clearSearch}>
                  <X size={12} />Clear search
                </button>
              </div>
            )}

            {/* Active-filter chips — legacy's #af-active-chips, each removable
                on its own (clearSingleFilter) with a Clear all beside them. */}
            {advCount > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mb-4">
                {(Object.keys(adv) as (keyof AdvFilter)[])
                  .filter(k => !!adv[k])
                  .map(k => (
                    <span key={k} className="ap-tag">
                      {FIELD_LABELS[k]}: {adv[k]}
                      <button type="button" onClick={() => clearSingleFilter(k)} title="Remove" aria-label={`Remove ${FIELD_LABELS[k]} filter`}>
                        <X size={10} strokeWidth={3} />
                      </button>
                    </span>
                  ))}
                <button type="button" onClick={resetAdv} className="ap-clear-all">Clear all</button>
              </div>
            )}

            {/* Bulk actions — PATCH /api/loans/bulk-status. Only rendered for
                roles the endpoint actually authorizes, and only once at least
                one row is selected. */}
            {canBulk && section === 'applications' && selected.length > 0 && (
              <div className="ap-bulk">
                <span className="ap-bulk-count">{selected.length} selected</span>
                <select
                  value={bulkStatus}
                  onChange={e => setBulkStatus(e.target.value)}
                  className="ap-select"
                  aria-label="Change status to"
                >
                  <option value="">Change status to…</option>
                  {BULK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <Button
                  size="sm"
                  disabled={!bulkStatus || bulkUpdate.isPending}
                  loading={bulkUpdate.isPending}
                  onClick={() => { if (confirm(`Change status of ${selected.length} application(s) to ${bulkStatus}?`)) bulkUpdate.mutate() }}
                >
                  Apply
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setSelected([]); setBulkResult('') }}>Clear</Button>
              </div>
            )}
            {bulkResult && <div className="ap-note">{bulkResult}</div>}
            {isError && data && (
              <div className="ap-note">
                Couldn't refresh the list — showing the last loaded data.{' '}
                <button type="button" className="underline" onClick={() => refetch()}>Retry</button>
              </div>
            )}

            {/* Table */}
            {isLoading ? <LoadingSpinner /> : (
              <>
                <div className="ap-table-wrap">
                  <table className="ap-table">
                    <colgroup>
                      {canBulk && <col style={{ width: 40 }} />}
                      <col style={{ width: 160 }} />{/* Application ID */}
                      <col style={{ width: 220 }} />{/* Applicant */}
                      <col style={{ width: 110 }} />{/* Loan Type */}
                      <col style={{ width: 120 }} />{/* Amount */}
                      <col style={{ width: 150 }} />{/* Status */}
                      <col style={{ width: 140 }} />{/* Sales Person */}
                      <col style={{ width: 110 }} />{/* Created */}
                      <col style={{ width: 120 }} />{/* Actions */}
                    </colgroup>
                    <thead>
                      <tr>
                        {canBulk && (
                          <th className="ap-th-check">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              onChange={toggleAll}
                              aria-label="Select all on this page"
                            />
                          </th>
                        )}
                        {['Application ID', 'Applicant', 'Loan Type', 'Amount', 'Status', 'Sales Person', 'Created', 'Actions'].map((h, i) => (
                          <th key={h} className={i === 3 ? 'is-right' : undefined}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {loadFailed ? (
                        <tr>
                          <td colSpan={8 + (canBulk ? 1 : 0)}>
                            <div className="ap-empty" role="alert">
                              <span className="ap-empty-icon" aria-hidden><AlertTriangle size={30} /></span>
                              <p className="ap-empty-title">Couldn't load applications</p>
                              <p className="ap-empty-hint">
                                The server didn't respond properly — your data is safe. This is usually momentary; please try again.
                              </p>
                              <div className="ap-empty-actions">
                                <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isFetching}>
                                  <RefreshCw size={13} className="mr-1.5" />{isFetching ? 'Retrying…' : 'Try again'}
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : rows.length === 0 ? (
                        // Vanilla shows a "No applications found" empty-row when the
                        // list/filter yields nothing (index.html empty-state).
                        <tr>
                          <td colSpan={8 + (canBulk ? 1 : 0)}>
                            <div className="ap-empty">
                              <span className="ap-empty-icon" aria-hidden>
                                {isNarrowed ? <SearchX size={30} /> : <Inbox size={30} />}
                              </span>
                              <p className="ap-empty-title">No applications found</p>
                              <p className="ap-empty-hint">
                                {isNarrowed
                                  ? 'Nothing matches the current search or filters. Try a different keyword, or reset to see everything.'
                                  : 'New loan applications will show up here as soon as they are created.'}
                              </p>
                              {isNarrowed && (
                                <div className="ap-empty-actions">
                                  <Button variant="secondary" size="sm" onClick={resetEverything}>
                                    <X size={13} className="mr-1.5" />Reset search &amp; filters
                                  </Button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : rows.map((loan) => (
                        <tr key={loan.id} className={selected.includes(loan.id) ? 'is-selected' : undefined}>
                          {canBulk && (
                            <td className="ap-td-check">
                              <input
                                type="checkbox"
                                checked={selected.includes(loan.id)}
                                onChange={() => toggleOne(loan.id)}
                                aria-label={`Select ${loan.loanNumber}`}
                              />
                            </td>
                          )}
                          <td><span className="efin-mono-id">{loan.loanNumber}</span></td>
                          <td>
                            <div className="ap-person">
                              <span className="ap-avatar" aria-hidden>{initials(loan.customerName)}</span>
                              <div className="min-w-0">
                                <p className="ap-person-name">
                                  {loan.customerName || <span className="ap-muted">—</span>}
                                  {/* Bureau risk-grade chip — legacy filterTable renders
                                      this beside the name (efin-app.js:2266). The value
                                      was already on the list payload (LoanListDto.RiskGrade,
                                      which the Advanced Filter sorts by) but nothing
                                      displayed it. Legacy's own renderTable path omits it;
                                      React has a single render path, so it shows always. */}
                                  {loan.riskGrade && (
                                    <span
                                      title="Bureau risk grade"
                                      className={`ap-risk ${loan.riskGrade === 'A' ? 'ap-risk--a' : loan.riskGrade === 'D' ? 'ap-risk--d' : 'ap-risk--mid'}`}>
                                      {loan.riskGrade}
                                    </span>
                                  )}
                                </p>
                                {/* Mobile number intentionally NOT rendered on the Applications
                                    list (security / PII — screen-share & shoulder-surfing risk).
                                    It is still available on the loan detail page. */}
                              </div>
                            </div>
                          </td>
                          <td><span className="ap-type">{loan.loanType}</span></td>
                          <td className="is-right"><span className="ap-amount">{formatCurrency(loan.requestedAmount)}</span></td>
                          <td><StatusBadge status={loan.status} /></td>
                          <td><span className="ap-muted">{loan.createdByName}</span></td>
                          <td><span className="ap-muted" style={{ whiteSpace: 'nowrap' }}>{formatDate(loan.createdAt)}</span></td>
                          <td>
                            <div className="ap-actions">
                              {/* Legacy gives a Draft row "▶ Continue" back into the
                                  wizard (resumeDraftFromList, efin-app.js:2076), not a
                                  read-only detail view — a half-filled application has
                                  no detail page worth opening. Reuses the same resume
                                  route the Drafts tab already links to. */}
                              {loan.status === 'Draft' ? (
                                <Link to={`/loans/new?draftId=${loan.id}`} className="ap-act ap-act--continue">
                                  <Play size={12} fill="currentColor" aria-hidden />Continue
                                </Link>
                              ) : (
                                <Link to={`/loans/${loan.id}`} className="ap-act ap-act--open">
                                  <Eye size={13} aria-hidden />Open
                                </Link>
                              )}
                              {isAdmin && (
                                <button
                                  type="button"
                                  className="ap-act ap-act--danger ap-act--icon"
                                  title="Delete application"
                                  aria-label={`Delete application ${loan.loanNumber}`}
                                  disabled={deleteLoan.isPending}
                                  onClick={() => {
                                    if (confirm(`Delete application ${loan.loanNumber}? This cannot be undone.`)) deleteLoan.mutate(loan.id)
                                  }}
                                >
                                  <Trash2 size={13} aria-hidden />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination — legacy #apps-pagination-bar (index.html:1034):
                    "Showing X–Y of Z" on the left, page nav + a "Show Result"
                    page-size selector on the right, shown for every non-empty
                    result (not only when there is more than one page). */}
                {data && (
                  <div className="ap-pager">
                    <p className="ap-pager-info">
                      {data.totalCount === 0
                        ? 'No results'
                        : <>Showing <b>{(data.page - 1) * data.pageSize + 1}–{Math.min(data.totalCount, data.page * data.pageSize)}</b> of <b>{data.totalCount}</b></>}
                    </p>
                    <div className="flex items-center gap-4 flex-wrap">
                      {/* Legacy renderAppsPaginationBar draws windowed page numbers
                          (1 … cp-1, cp, cp+1 … last) so the first and last page are
                          always one click away. */}
                      {data.totalPages > 1 && (
                        <div className="ap-pages">
                          <button type="button" className="ap-page-btn" disabled={!data.hasPrev}
                            onClick={() => goToPage(data.page - 1)} aria-label="Previous page">
                            <ChevronLeft size={14} />
                          </button>
                          {pageWindow(data.page, data.totalPages).map((p, i) =>
                            p === null ? (
                              <span key={`gap${i}`} className="px-1 text-xs" style={{ color: 'var(--text3)' }}>…</span>
                            ) : (
                              <button
                                key={p}
                                type="button"
                                onClick={() => goToPage(p)}
                                aria-current={p === data.page ? 'page' : undefined}
                                className={`ap-page-btn ${p === data.page ? 'is-active' : ''}`}>
                                {p}
                              </button>
                            ))}
                          <button type="button" className="ap-page-btn" disabled={!data.hasNext}
                            onClick={() => goToPage(data.page + 1)} aria-label="Next page">
                            <ChevronRight size={14} />
                          </button>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <span className="ap-pager-info">Show Result</span>
                        <select
                          value={filter.pageSize ?? 25}
                          onChange={(e) => setFilter({ pageSize: Number(e.target.value) })}
                          className="ap-select"
                          aria-label="Results per page"
                        >
                          {[25, 50, 75, 100].map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>
        )}

        {section === 'drafts' && (
          <Card className="ap-card">
            <p className="ap-draft-intro">
              In-progress applications are saved here automatically.
              Starting a new application never affects any draft below.
            </p>

            {draftsLoading ? (
              <div className="py-12 flex justify-center"><LoadingSpinner /></div>
            ) : drafts.length === 0 ? (
              <div className="ap-empty">
                <span className="ap-empty-icon" aria-hidden><FileClock size={30} /></span>
                <p className="ap-empty-title">No active drafts</p>
                <p className="ap-empty-hint">Drafts appear here automatically as you fill out a New Application.</p>
                <div className="ap-empty-actions">
                  <Link to="/loans/new">
                    <Button size="sm">
                      <span className="ap-plus" aria-hidden><Plus size={12} strokeWidth={3.2} /></span>New Loan
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="ap-table-wrap">
                <table className="ap-table" style={{ minWidth: 640 }}>
                  <thead>
                    <tr>
                      {['Draft', 'Loan Type', 'Progress', 'Last Saved', ''].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {drafts.map((d) => (
                      <tr key={d.loanId}>
                        <td><span className="ap-person-name">{d.label}</span></td>
                        <td>{d.loanType ? <span className="ap-type">{d.loanType}</span> : <span className="ap-muted">—</span>}</td>
                        <td>
                          {d.step ? (
                            <span className="ap-step">
                              <span className="ap-step-bar" aria-hidden><i style={{ width: `${Math.min(100, (d.step / 9) * 100)}%` }} /></span>
                              Step {d.step} of 9
                            </span>
                          ) : <span className="ap-muted">—</span>}
                        </td>
                        <td><span className="ap-muted">{formatDate(d.updatedAt)}</span></td>
                        <td>
                          <div className="ap-actions">
                            <Link to={`/loans/new?draftId=${d.loanId}`} className="ap-act ap-act--continue">
                              <Play size={12} fill="currentColor" aria-hidden />Resume
                            </Link>
                            <button type="button" onClick={() => handleDiscardDraft(d.loanId)} className="ap-act ap-act--quiet">
                              <Trash2 size={12} aria-hidden />Discard
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* Modals sit outside `.apps-page` on purpose: they are fixed-position
          overlays that keep the app-wide look, so they aren't half-recoloured
          by this page's brand tokens. */}
      {showAdv && (
        <AdvancedFilterModal
          current={adv}
          options={filterOptions ?? NO_FILTER_OPTIONS}
          onApply={applyAdv}
          onClose={() => setShowAdv(false)}
        />
      )}
      {showExport && <ExportLoansModal filter={filter} onClose={() => setShowExport(false)} />}
    </>
  )
}
