import { LoadingSpinner } from '@/components/ui/LoadingSpinner'

// ── Loading placeholders → the ONE loader ───────────────────────────────
// This app has a single loading animation: the loanms-loader badge
// (components/ui/LoadingSpinner.tsx). Page-level loads are covered by the
// global full-screen loader (GlobalLoader). These placeholders are what a
// card/table/section shows when only ITS OWN data is pending (tab switch,
// pagination, modal), and they now render that same badge instead of a
// separate grey shimmer, so nothing in the app loads with a different style.
// The names/props are unchanged so existing call sites keep working.

/** N lines of fake text → compact loanms badge. `lines` kept for API compat. */
export function SkeletonText({ className }: { lines?: number; className?: string }) {
  return (
    <div className={className}>
      <LoadingSpinner size="sm" />
    </div>
  )
}

/** Table body placeholder → loanms badge (`rows`/`columns` kept for API compat). */
export function TableSkeleton(_props: { rows?: number; columns?: number }) {
  return <LoadingSpinner size="md" />
}
