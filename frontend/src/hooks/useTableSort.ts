import { useCallback, useState } from 'react'
import type { SortDir } from '@/components/shared/DataTable'

/**
 * Sort state for pages that sort the FULL list before paginating (so the
 * sort applies across every page, not just the visible slice). Pair with
 * `sortRows` from DataTable and pass sortKey/sortDir/toggle into DataTable's
 * controlled-sort props.
 *
 * key and dir are held as ONE state object so `toggle` is a single pure
 * updater. (An earlier version nested setSortDir inside setSortKey's updater;
 * under React StrictMode the updater is double-invoked, which flipped the
 * direction twice and silently defeated the second click.)
 */
export function useTableSort(initialKey: string | null = null, initialDir: SortDir = 'asc') {
  const [sort, setSort] = useState<{ key: string | null; dir: SortDir }>({ key: initialKey, dir: initialDir })

  const toggle = useCallback((key: string) => {
    setSort(prev =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' })
  }, [])

  return { sortKey: sort.key, sortDir: sort.dir, toggle }
}
