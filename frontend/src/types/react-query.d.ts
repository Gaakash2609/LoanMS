import '@tanstack/react-query'

// Typed `meta` for the app-wide toast handlers in main.tsx.
interface LoanMsMutationMeta extends Record<string, unknown> {
  /** No toast at all (background / autosave-style work). */
  silent?: boolean
  /** Skip the error toast — the caller already shows a blocking error of its own. */
  errorToast?: boolean
  /** Skip the success toast even when the server returned a message. */
  successToast?: boolean
  /** Success text for mutations whose response carries no server message. */
  successMessage?: string
  /** Fallback error text when the server gives none. */
  errorMessage?: string
}

interface LoanMsQueryMeta extends Record<string, unknown> {
  /** Suppress the network/5xx error toast for this query. */
  silent?: boolean
}

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: LoanMsMutationMeta
    queryMeta: LoanMsQueryMeta
  }
}
