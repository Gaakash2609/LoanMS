import { describe, it, expect, beforeEach } from 'vitest'
import { pageWindow } from '@/pages/LoansPage'
import { useLoanStore } from '@/store/loanStore'

// ── Applications list — pagination (Phase 6) ────────────────────────────────
// Two regressions found auditing the Applications module against Vanilla:
//   1. useLoanStore.setFilter put `page: 1` AFTER the spread, so an explicit
//      page was always clobbered and the list could never leave page 1.
//   2. The page bar only had prev/next; Vanilla's renderAppsPaginationBar draws
//      windowed page numbers (1 … cp-1, cp, cp+1 … last).

describe('pageWindow — Vanilla renderAppsPaginationBar parity', () => {
  it('lists every page when they all fit in the window', () => {
    expect(pageWindow(1, 1)).toEqual([1])
    expect(pageWindow(2, 3)).toEqual([1, 2, 3])
    expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5])
  })

  it('always keeps the first and last page reachable', () => {
    const w = pageWindow(20, 40)
    expect(w[0]).toBe(1)
    expect(w[w.length - 1]).toBe(40)
  })

  it('shows the current page with its immediate neighbours', () => {
    expect(pageWindow(20, 40)).toEqual([1, null, 19, 20, 21, null, 40])
  })

  it('marks elided ranges with null rather than dropping them silently', () => {
    expect(pageWindow(10, 100).filter(p => p === null)).toHaveLength(2)
  })

  it('does not emit a gap marker when the pages are contiguous', () => {
    // current=2 of 4 -> 1,2,3,4 with no elision
    expect(pageWindow(2, 4)).toEqual([1, 2, 3, 4])
  })

  it('never repeats a page number', () => {
    const w = pageWindow(1, 2).filter((p): p is number => p !== null)
    expect(new Set(w).size).toBe(w.length)
  })
})

describe('useLoanStore.setFilter — page handling', () => {
  beforeEach(() => useLoanStore.getState().resetFilter())

  it('honours an explicit page (regression: was forced back to 1)', () => {
    useLoanStore.getState().setFilter({ page: 4 })
    expect(useLoanStore.getState().filter.page).toBe(4)
  })

  it('resets to page 1 when a filter changes, so a narrower result set cannot strand the user', () => {
    useLoanStore.getState().setFilter({ page: 6 })
    useLoanStore.getState().setFilter({ status: 'Approved' })
    expect(useLoanStore.getState().filter.page).toBe(1)
  })

  it('resets to page 1 when the page size changes', () => {
    useLoanStore.getState().setFilter({ page: 3 })
    useLoanStore.getState().setFilter({ pageSize: 100 })
    expect(useLoanStore.getState().filter.page).toBe(1)
  })

  it('keeps unrelated filter values while paging', () => {
    useLoanStore.getState().setFilter({ search: 'ABCDE1234F', searchField: 'pan' })
    useLoanStore.getState().setFilter({ page: 2 })
    const f = useLoanStore.getState().filter
    expect(f.search).toBe('ABCDE1234F')
    expect(f.searchField).toBe('pan')
    expect(f.page).toBe(2)
  })
})
