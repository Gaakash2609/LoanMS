import { ReactNode, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRecord = Record<string, any>

export interface Column<T extends AnyRecord> {
  key: string
  label: string
  render?: (row: T) => ReactNode
  className?: string
  /** Opt in to client-side sorting on this column's header. */
  sortable?: boolean
  /** Value to sort by; defaults to row[key]. Use when the display differs
   *  from the sort key (e.g. a formatted date cell sorting on the raw ISO). */
  sortValue?: (row: T) => string | number | Date | null | undefined
}

export type SortDir = 'asc' | 'desc'

/**
 * Sorts a row array by a column's sortValue (or row[key]). Copies before
 * sorting — never mutates the input. Nulls sort last regardless of
 * direction. Exported so pages that paginate BEFORE handing rows to
 * DataTable (Users, Tasks) can sort the FULL list first, using the exact
 * same comparator the table's own header sort uses.
 */
export function sortRows<T extends AnyRecord>(
  rows: T[], columns: Column<T>[], sortKey: string | null, sortDir: SortDir,
): T[] {
  if (!sortKey) return rows
  const col = columns.find(c => c.key === sortKey)
  if (!col) return rows
  const valueOf = (row: T) => (col.sortValue ? col.sortValue(row) : row[col.key])
  return [...rows].sort((a, b) => {
    const av = valueOf(a), bv = valueOf(b)
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    let cmp: number
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv
    else if (av instanceof Date && bv instanceof Date) cmp = av.getTime() - bv.getTime()
    else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
    return sortDir === 'asc' ? cmp : -cmp
  })
}

interface Props<T extends AnyRecord> {
  columns: Column<T>[]
  data?: T[]
  isLoading?: boolean
  keyField?: keyof T
  totalPages?: number
  currentPage?: number
  onPageChange?: (page: number) => void
  totalCount?: number

  // ── Controlled sort (for pages that sort the full list before paginating).
  //    When onSort is provided, the header reflects sortKey/sortDir and calls
  //    onSort, and DataTable does NOT re-sort `data` — the parent already did,
  //    on the full pre-pagination list. Omit all three for the default
  //    internal (uncontrolled) sort used by full-dataset tables. ──────────
  sortKey?: string | null
  sortDir?: SortDir
  onSort?: (key: string) => void

  // ── Optional state props (all default to the previous behaviour) ──────
  /** A failed load. Renders ErrorState instead of a misleading empty table. */
  error?: unknown
  /** Shown as a "Try again" button on the error state. */
  onRetry?: () => void
  /** Wording for the empty state — say what's missing, not "No records". */
  emptyTitle?: string
  emptyDescription?: string
  emptyIcon?: React.ElementType
  /** e.g. a "New Application" button, so an empty table isn't a dead end. */
  emptyAction?: ReactNode
}

export default function DataTable<T extends AnyRecord>({
  columns,
  data,
  isLoading,
  keyField = 'id' as keyof T,
  totalPages = 1,
  currentPage = 1,
  onPageChange,
  totalCount,
  sortKey: sortKeyProp,
  sortDir: sortDirProp,
  onSort,
  error,
  onRetry,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyIcon,
  emptyAction,
}: Props<T>) {
  const controlled = onSort != null
  // Internal sort state — used only in uncontrolled mode. Hooks must run
  // before any early return, so they live at the top.
  const [sortKeyState, setSortKeyState] = useState<string | null>(null)
  const [sortDirState, setSortDirState] = useState<SortDir>('asc')

  const sortKey = controlled ? (sortKeyProp ?? null) : sortKeyState
  const sortDir = controlled ? (sortDirProp ?? 'asc') : sortDirState

  // In controlled mode the parent already sorted the full list before
  // paginating, so `data` is passed through untouched here.
  const sortedRows = useMemo(
    () => (controlled ? (data ?? []) : sortRows(data ?? [], columns, sortKeyState, sortDirState)),
    [controlled, data, columns, sortKeyState, sortDirState],
  )

  function toggleSort(key: string) {
    if (onSort) { onSort(key); return }
    if (sortKeyState === key) setSortDirState(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKeyState(key); setSortDirState('asc') }
  }

  // Order matters: a failed request must never be reported as "empty".
  // Previously both rendered the same grey "No records found", so a 500 or a
  // 403 was indistinguishable from a genuinely empty table.
  if (error != null) return <ErrorState error={error} onRetry={onRetry} />

  // Skeleton rows sized to the real column count keep the header in place and
  // stop the page height jumping when the data lands.
  if (isLoading) return <TableSkeleton columns={columns.length} />

  const rows = sortedRows

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    )
  }

  return (
    <div>
      {/* min-w on the table (not the wrapper) is what makes the horizontal
          scroll actually engage on phones — without it the browser crushes
          columns into unreadable slivers instead of letting them scroll. */}
      <div className="overflow-x-auto -mx-2 px-2">
        <table className="efin-table table-premium min-w-[640px]">
          <thead>
            <tr>
              {columns.map(col => {
                const active = sortKey === col.key
                if (!col.sortable) {
                  return <th key={col.key} className={col.className ?? undefined}>{col.label}</th>
                }
                return (
                  <th key={col.key} className={col.className ?? undefined} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="inline-flex items-center gap-1 select-none hover:text-efin-blue transition-colors"
                    >
                      {col.label}
                      {active
                        ? (sortDir === 'asc'
                            ? <ChevronUp size={13} className="shrink-0 text-efin-blue" />
                            : <ChevronDown size={13} className="shrink-0 text-efin-blue" />)
                        : <ChevronsUpDown size={13} className="shrink-0 opacity-40" />}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={String(row[keyField] ?? i)} className="transition-colors">
                {columns.map(col => (
                  <td key={col.key} className={col.className ?? undefined}>
                    {col.render ? col.render(row) : String(row[col.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && onPageChange && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
          <p className="text-xs text-gray-500">
            Page {currentPage} of {totalPages}
            {totalCount != null ? ` (${totalCount} total)` : ''}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage <= 1}
              aria-label="Previous page"
              className="p-1.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
              aria-label="Next page"
              className="p-1.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
