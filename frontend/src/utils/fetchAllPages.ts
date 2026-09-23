import type { PagedResult } from '@/types'

// ── Phase 9 code-level audit fix #2 ─────────────────────────────────────────
// useDashboardBreakdown() used to request `pageSize: 1000` in one shot.
// LoansController.GetAll clamps that server-side —
// `if (filter.PageSize is < 1 or > 100) filter.PageSize = 10;` — so a
// pageSize outside [1,100] silently fell back to the 10-row default, not
// 1000. The Pipeline/Monthly Disbursals/Loan Type Mix cards were built off
// only the 10 most recently created loans no matter how many existed.
//
// Vanilla has no such ceiling at all — renderPipeline()/renderChart()/
// renderLoanTypeChart() (efin-app.js) iterate the full in-browser
// APPLICATIONS array. The closest equivalent here, without adding a new
// endpoint or changing the locked API surface, is to page through the
// existing GET /api/loans at the server's real maximum (100) and
// concatenate every page — same endpoint, same ApplyVisibilityScope every
// other loan read already goes through.
//
// A hard page-count ceiling guards against ever spinning forever if a
// future backend bug made `hasNext` never turn false — it caps the fetch at
// MAX_PAGES * pageSize loans, which is comfortably above any real dataset
// today; if that limit is ever hit, the breakdown silently reflects only
// the first MAX_PAGES pages rather than hanging the query indefinitely.
export const MAX_PAGES = 500

/**
 * Fetches every page of a `PagedResult<T>`-shaped endpoint and returns the
 * concatenated items. `fetchPage(page, pageSize)` is the caller's own API
 * call (kept generic/pure so this can be unit-tested without mocking axios
 * or React Query).
 */
export async function fetchAllPages<T>(
  fetchPage: (page: number, pageSize: number) => Promise<PagedResult<T>>,
  pageSize: number,
): Promise<T[]> {
  const items: T[] = []
  let page = 1
  while (page <= MAX_PAGES) {
    const result = await fetchPage(page, pageSize)
    items.push(...result.items)
    if (!result.hasNext) break
    page += 1
  }
  return items
}
