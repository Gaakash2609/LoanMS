import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import AppRoutes from './routes/AppRoutes'
import ToastHost from './components/ui/Toast'
import GlobalLoader from './components/ui/GlobalLoader'
import { useToastStore } from './store/toastStore'
import { apiErrorMessage, apiErrorStatus, isNetworkError } from './utils/apiError'
import './styles/globals.css'

// ── App-wide action feedback (legacy showToast parity) ─────────────────────
// Legacy raised a toast from every save/delete/status action (≈860 showToast
// calls) — React had the toast host mounted but nothing ever called it, so a
// failed action silently did nothing. Instead of re-adding one-off toasts on
// every page, feedback is raised once here for every mutation:
//   • error   → always (server message, else network/status text)
//   • success → when the server returned a message ("User deleted.", ...),
//               or when the mutation supplies meta.successMessage
// A mutation opts out with meta: { silent: true } (background work) or
// meta: { errorToast: false } (it already shows its own blocking error).
// Queries only toast when the server is unreachable / erroring (network,
// timeout, 5xx): 4xx on reads are page-level states each screen handles.
const toast = (message: string, type: 'success' | 'error') => useToastStore.getState().show(message, type)

function successMessageOf(data: unknown): string | undefined {
  const body = (data as { data?: { success?: unknown; message?: unknown } } | null)?.data
  if (body && body.success === true && typeof body.message === 'string' && body.message.trim()) return body.message.trim()
  return undefined
}

const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      const meta = mutation.meta
      if (meta?.silent || meta?.errorToast === false) return
      // 401s are handled by the axios refresh/logout flow — not an action error.
      if (apiErrorStatus(error) === 401) return
      toast(apiErrorMessage(error, meta?.errorMessage ?? 'The action could not be completed. Please try again.'), 'error')
    },
    onSuccess: (data, _vars, _ctx, mutation) => {
      const meta = mutation.meta
      if (meta?.silent || meta?.successToast === false) return
      const msg = meta?.successMessage ?? successMessageOf(data)
      if (msg) toast(msg, 'success')
    },
  }),
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.meta?.silent) return
      const status = apiErrorStatus(error)
      if (isNetworkError(error) || (status !== undefined && status >= 500)) {
        toast(apiErrorMessage(error), 'error')
      }
    },
  }),
  defaultOptions: {
    queries: {
      // One retry only where it can help (network / timeout / 5xx). A 4xx
      // (not found, forbidden, validation) will fail identically again — the
      // old blanket `retry: 1` sent every such request twice.
      retry: (failureCount, error) => {
        if (failureCount >= 1) return false
        const status = apiErrorStatus(error)
        return isNetworkError(error) || status === undefined || status >= 500
      },
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* ROOT CUTOVER: no basename — the app is served from '/' now, not from
          the old /app mount point. ProtectedRoute's useLocation()-based `from`
          capture stays correct because it has always been basename-relative;
          with no basename it is simply the raw path. */}
      <BrowserRouter>
        <AppRoutes />
        {/* The one and only page-level loader (loanms-loader badge). Sits at
            the root so it covers Login/Forgot/Reset and every routed page,
            and owns the 2s-minimum timing. See GlobalLoader.tsx. */}
        <GlobalLoader />
        {/* Toast host lives at the root, outside AppRoutes, so unauthenticated
            screens (Login, Forgot/Reset Password) can raise toasts too —
            legacy's #toast-container was likewise a sibling of the app shell. */}
        <ToastHost />
      </BrowserRouter>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </React.StrictMode>
)
