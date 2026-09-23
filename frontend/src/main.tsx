import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import AppRoutes from './routes/AppRoutes'
import ToastHost from './components/ui/Toast'
import GlobalLoader from './components/ui/GlobalLoader'
import './styles/globals.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
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
