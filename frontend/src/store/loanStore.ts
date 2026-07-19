import { create } from 'zustand'
import type { LoanFilter } from '@/types'

interface LoanState {
  filter: LoanFilter
  setFilter: (filter: Partial<LoanFilter>) => void
  resetFilter: () => void
}

const defaultFilter: LoanFilter = { page: 1, pageSize: 20 }

export const useLoanStore = create<LoanState>((set) => ({
  filter: defaultFilter,
  setFilter: (partial) =>
    set((state) => ({ filter: { ...state.filter, ...partial, page: 1 } })),
  resetFilter: () => set({ filter: defaultFilter }),
}))
