import { describe, it, expect, vi } from 'vitest'
import { fetchAllPages, MAX_PAGES } from './fetchAllPages'
import type { PagedResult } from '@/types'

function page<T>(items: T[], page: number, totalPages: number): PagedResult<T> {
  return { items, totalCount: items.length, page, pageSize: items.length, totalPages, hasNext: page < totalPages, hasPrev: page > 1 }
}

describe('fetchAllPages — Phase 9 dashboard-breakdown pagination fix', () => {
  it('concatenates every page until hasNext is false', async () => {
    const fetchPage = vi.fn(async (p: number) => {
      if (p === 1) return page([1, 2], 1, 3)
      if (p === 2) return page([3, 4], 2, 3)
      return page([5], 3, 3)
    })
    const items = await fetchAllPages(fetchPage, 2)
    expect(items).toEqual([1, 2, 3, 4, 5])
    expect(fetchPage).toHaveBeenCalledTimes(3)
  })

  it('stops after a single page when hasNext is already false (regression: old pageSize:1000 request silently became 10)', async () => {
    const fetchPage = vi.fn(async () => page([1, 2, 3], 1, 1))
    const items = await fetchAllPages(fetchPage, 100)
    expect(items).toEqual([1, 2, 3])
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('reproduces more than 1000 items across multiple 100-row pages — the exact scenario the task called out', async () => {
    const totalPages = 11 // 1050 loans at pageSize 100
    const fetchPage = vi.fn(async (p: number) => {
      const count = p < totalPages ? 100 : 50
      return page(Array.from({ length: count }, (_, i) => (p - 1) * 100 + i), p, totalPages)
    })
    const items = await fetchAllPages(fetchPage, 100)
    expect(items).toHaveLength(1050)
    expect(fetchPage).toHaveBeenCalledTimes(totalPages)
  })

  it('always requests the caller-provided page size, never a hardcoded 1000', async () => {
    const fetchPage = vi.fn(async (p: number, pageSize: number) => page([pageSize], p, 1))
    await fetchAllPages(fetchPage, 100)
    expect(fetchPage).toHaveBeenCalledWith(1, 100)
  })

  it('never loops forever if hasNext incorrectly stays true — bounded by MAX_PAGES', async () => {
    const fetchPage = vi.fn(async (p: number) => ({
      items: [p], totalCount: 999999, page: p, pageSize: 1, totalPages: 999999, hasNext: true, hasPrev: p > 1,
    }))
    const items = await fetchAllPages(fetchPage, 1)
    expect(items).toHaveLength(MAX_PAGES)
    expect(fetchPage).toHaveBeenCalledTimes(MAX_PAGES)
  })
})
