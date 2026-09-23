import { create } from 'zustand'

/**
 * Global loader bookkeeping. The ONE visible loader (<GlobalLoader/>, drawn
 * with the existing loanms-loader badge in components/ui/LoadingSpinner.tsx)
 * reads this. Anything that means "the page is not ready yet" registers here
 * instead of drawing its own loader:
 *   - <PageLoader/> (Suspense fallbacks, auth hydration) acquires while mounted
 *   - useGlobalLoading(flag) lets any component hold the loader explicitly
 */
interface LoaderState {
  /** Number of active "page not ready" sources. */
  sources: number
  acquire: () => void
  release: () => void
}

export const useLoaderStore = create<LoaderState>((set) => ({
  sources: 0,
  acquire: () => set((s) => ({ sources: s.sources + 1 })),
  release: () => set((s) => ({ sources: Math.max(0, s.sources - 1) })),
}))
