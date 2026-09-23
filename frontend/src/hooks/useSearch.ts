import { useQuery } from '@tanstack/react-query'
import { searchApi } from '@/api/searchApi'

// SearchController.cs requires >=2 trimmed chars and returns empty arrays
// below that rather than erroring — mirrored here so the query key doesn't
// even fire on a single keystroke.
export function useGlobalSearch(query: string) {
  const q = query.trim()
  const enabled = q.length >= 2

  return useQuery({
    queryKey: ['search', 'global', q],
    queryFn:  () => searchApi.query(q).then((r) => r.data.data),
    enabled,
    // Results are a point-in-time lookup the user is actively typing
    // toward, not a list they'll sit and watch — no refetch-on-focus, no
    // long cache. staleTime avoids re-hitting the API on every keystroke
    // for a query string that hasn't actually changed within a session.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
}
