import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useIsFetching } from '@tanstack/react-query'
import { useLoaderStore } from '@/store/loaderStore'
import { GlobalLoaderView } from '@/components/ui/LoadingSpinner'

/**
 * The single, app-wide loading screen (the loanms-loader badge).
 *
 * Mounted ONCE in main.tsx (inside <BrowserRouter> + <QueryClientProvider>).
 * Nothing else should draw a page-level loader.
 *
 * WHEN IT SHOWS
 *   - first app load (auth hydration + lazy chunks + first data),
 *   - every route change (pathname change), including login/logout redirects.
 *
 * WHEN IT HIDES  (hide = load finished AND >= MIN_VISIBLE_MS on screen)
 *   "Load finished" means: no <PageLoader/> Suspense/auth source is mounted,
 *   and no react-query query that has no data yet is fetching, quietly for
 *   SETTLE_MS (the short gap between "chunk arrived" and "page's own queries
 *   start" must not look like "done").
 *
 * TIMING RULES
 *   - MIN_VISIBLE_MS (2s): a fast load never flashes; the loader is held until
 *     2s have passed since it appeared.
 *   - SLOW_HINT_MS (5s): the loader is never held artificially past real
 *     completion. If the REAL load is still running at 5s we do NOT reveal a
 *     half-loaded page just because a timer fired — the loader stays until the
 *     load actually finishes, and its caption switches to a "taking longer"
 *     message so the user knows it hasn't frozen.
 *
 * Only the initial load of a route is tracked. Refetches of data the page
 * already has, mutations, and later section/tab/modal loads (which use the
 * same badge via <LoadingSpinner/>) never bring the full-screen loader back.
 */
export const MIN_VISIBLE_MS = 2000
export const SLOW_HINT_MS = 5000
const SETTLE_MS = 150

export default function GlobalLoader() {
  const { pathname } = useLocation()
  const sources = useLoaderStore((s) => s.sources)
  // status 'pending' + no data = first load of that query (not a background refetch).
  const initialFetches = useIsFetching({ predicate: (q) => q.state.data === undefined })

  // Starts true: the very first render of the app is itself a page load.
  const [loading, setLoading] = useState(true)
  const [slow, setSlow] = useState(false)
  const startedAt = useRef(Date.now())
  const loadingRef = useRef(true)

  const busy = sources > 0 || initialFetches > 0

  const start = () => {
    if (loadingRef.current) return // already running: keep original start time
    startedAt.current = Date.now()
    loadingRef.current = true
    setSlow(false)
    setLoading(true)
  }

  // Route change → start a load. Redirect chains (/ → /dashboard, login →
  // `from`) happen while one is already running and must not extend the 2s
  // minimum, hence the guard in start().
  const firstPath = useRef(true)
  useLayoutEffect(() => {
    if (firstPath.current) { firstPath.current = false; return }
    start()
  }, [pathname])

  // A <PageLoader/> (Suspense fallback / auth hydration) mounting outside a
  // route change must still be covered — its own output is empty, so without
  // this the user would see a blank page.
  useLayoutEffect(() => {
    if (sources > 0) start()
  }, [sources])

  // Finish: once not busy, wait until BOTH the settle gap and the 2s minimum
  // are satisfied. If busy flips back on, the timer is cancelled — no timer
  // ever hides the loader while real loading is in progress.
  useEffect(() => {
    if (!loading || busy) return
    const elapsed = Date.now() - startedAt.current
    const wait = Math.max(SETTLE_MS, MIN_VISIBLE_MS - elapsed)
    const t = setTimeout(() => {
      loadingRef.current = false
      setSlow(false)
      setLoading(false)
    }, wait)
    return () => clearTimeout(t)
  }, [loading, busy])

  // Slow-load caption (never hides anything).
  useEffect(() => {
    if (!loading) return
    const t = setTimeout(() => setSlow(true), Math.max(0, SLOW_HINT_MS - (Date.now() - startedAt.current)))
    return () => clearTimeout(t)
  }, [loading])

  if (!loading) return null
  return <GlobalLoaderView message={slow ? 'Still loading — this is taking longer than usual' : 'Loading'} />
}
