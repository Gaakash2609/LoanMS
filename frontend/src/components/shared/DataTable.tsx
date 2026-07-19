import { ReactNode } from 'react'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { ChevronLeft, ChevronRight } from 'lucide-react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRecord = Record<string, any>

export interface Column<T extends AnyRecord> {
  key: string
  label: string
  render?: (row: T) => ReactNode
  className?: string
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
}: Props<T>) {
  if (isLoading) return <LoadingSpinner />

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-gray-100">
              {columns.map(col => (
                <th
                  key={col.key}
                  className={`pb-3 pr-4 text-xs font-medium text-gray-500 uppercase tracking-wide ${col.className ?? ''}`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {(data ?? []).map((row, i) => (
              <tr key={String(row[keyField] ?? i)} className="hover:bg-gray-50 transition-colors">
                {columns.map(col => (
                  <td key={col.key} className={`py-3 pr-4 ${col.className ?? ''}`}>
                    {col.render ? col.render(row) : String(row[col.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
            {(!data || data.length === 0) && (
              <tr>
                <td colSpan={columns.length} className="py-12 text-center text-gray-400 text-sm">
                  No records found
                </td>
              </tr>
            )}
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
              className="p-1.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
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
