// ── API error → user-facing message ─────────────────────────────────────────
// Single shared replacement for the nine identical local `errorMessage()`
// helpers that used to live in individual pages/cards. Those copies read
// `data.errors.join(' ')`, which throws a TypeError when ASP.NET returns its
// model-validation ProblemDetails shape (`errors: { Field: [msg, ...] }` — an
// object, not an array), so the error handler itself crashed and the user saw
// nothing. This version understands every shape the backend actually sends:
//
//   • ApiResponseDto            { success:false, message, errors: string[] }
//   • ASP.NET ProblemDetails    { title, errors: { Field: string[] } }
//   • plain-text body           "Something failed"
//   • no response at all        network down / CORS / server unreachable
//   • axios timeout             code === 'ECONNABORTED'

type ErrorBody = {
  message?: unknown
  title?: unknown
  errors?: unknown
}

type AxiosLikeError = {
  code?: string
  message?: string
  response?: { status?: number; data?: unknown }
  request?: unknown
}

function flattenErrors(errors: unknown): string {
  if (Array.isArray(errors)) return errors.filter(e => typeof e === 'string' && e.trim()).join(' ')
  if (errors && typeof errors === 'object') {
    return Object.values(errors as Record<string, unknown>)
      .flatMap(v => (Array.isArray(v) ? v : [v]))
      .filter((e): e is string => typeof e === 'string' && !!e.trim())
      .join(' ')
  }
  return ''
}

/** The HTTP status of an axios error, if the server answered at all. */
export function apiErrorStatus(err: unknown): number | undefined {
  return (err as AxiosLikeError | null)?.response?.status
}

/** True when the request never got an HTTP answer (offline, DNS, CORS, timeout). */
export function isNetworkError(err: unknown): boolean {
  const e = err as AxiosLikeError | null
  return !!e && !e.response && (!!e.request || e.code === 'ERR_NETWORK' || e.code === 'ECONNABORTED')
}

/**
 * Best human-readable message for a failed API call. Server-provided text
 * always wins; otherwise a status-appropriate default; `fallback` last.
 */
export function apiErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const e = err as AxiosLikeError | null
  if (!e) return fallback

  if (e.code === 'ECONNABORTED') return 'The server took too long to respond. Please try again.'
  if (isNetworkError(e)) return 'Could not reach the server. Check your connection and try again.'

  const data = e.response?.data
  if (typeof data === 'string' && data.trim() && !data.trimStart().startsWith('<')) return data.trim()
  if (data && typeof data === 'object') {
    const body = data as ErrorBody
    if (typeof body.message === 'string' && body.message.trim()) return body.message.trim()
    const flat = flattenErrors(body.errors)
    if (flat) return flat
    if (typeof body.title === 'string' && body.title.trim()) return body.title.trim()
  }

  switch (e.response?.status) {
    case 403: return 'You do not have permission to do this.'
    case 404: return 'The record was not found — it may have been deleted in another session.'
    case 409: return 'This record was changed by someone else. Refresh and try again.'
    case 413: return 'The file is too large to upload.'
    case 429: return 'Too many requests. Please wait a moment and try again.'
  }
  if ((e.response?.status ?? 0) >= 500) return 'The server hit an error. Please try again in a moment.'

  // A thrown Error from inside a mutationFn (e.g. "No RM email on file").
  if (!e.response && typeof e.message === 'string' && e.message.trim()) return e.message.trim()
  return fallback
}
