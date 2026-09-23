import { create } from 'zustand'
import type { LoanFilter } from '@/types'

interface LoanState {
  filter: LoanFilter
  setFilter: (filter: Partial<LoanFilter>) => void
  resetFilter: () => void
}

// pageSize 25 mirrors legacy's default "Show Result" selection
// (index.html apps-pagesize-label = 25).
const defaultFilter: LoanFilter = { page: 1, pageSize: 25 }

export const useLoanStore = create<LoanState>((set) => ({
  filter: defaultFilter,
  // PHASE 6 FIX: `page: 1` used to sit AFTER the spread, so it clobbered any
  // page the caller passed — setFilter({ page: 2 }) resolved to page 1 and the
  // Applications list could never leave the first page. Changing a filter still
  // resets to page 1 (otherwise a narrower result set can strand the user on a
  // page that no longer exists), but an explicit page is now honoured.
  setFilter: (partial) =>
    set((state) => {
      const filter: LoanFilter = { ...state.filter, ...partial, page: partial.page ?? 1 }
      // Gap 1 — `status` (single) and `statuses` (multi) are mutually
      // exclusive server-side filters (LoanRepository.ApplyListFilters
      // prefers Statuses over Status when both are present). Whichever one
      // this call is setting should replace the other, so e.g. a leftover
      // Dashboard "In Process" multi-status filter doesn't silently linger
      // once the user picks a single status chip on the Applications page,
      // and vice versa. Every existing single-status call site (filter
      // chips, Advanced Filter, "Clear all") already passes `status`
      // (even `undefined`, to clear it) without knowing `statuses` exists,
      // so this is handled once here rather than at each call site.
      if ('statuses' in partial && !('status' in partial)) filter.status = undefined
      if ('status' in partial && !('statuses' in partial)) filter.statuses = undefined
      return { filter }
    }),
  resetFilter: () => set({ filter: defaultFilter }),
}))
