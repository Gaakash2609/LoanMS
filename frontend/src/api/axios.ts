import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '@/store/authStore'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BASE_URL = (import.meta as any).env?.VITE_API_URL ?? ''

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
})

// ── Request interceptor: attach JWT token ─────────────────────────────────────
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = useAuthStore.getState().accessToken
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  },
  (error) => Promise.reject(error)
)

// Latest persisted session (written by whichever tab refreshed most recently).
function readStoredTokens(): { accessToken?: string | null; refreshToken?: string | null } | null {
  try {
    const raw = localStorage.getItem('efin_auth')
    return raw ? (JSON.parse(raw)?.state ?? null) : null
  } catch {
    return null
  }
}

// ── Response interceptor: handle 401 + refresh token ─────────────────────────
let isRefreshing = false
let failedQueue: Array<{ resolve: (v: string) => void; reject: (e: unknown) => void }> = []

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error)
    else resolve(token!)
  })
  failedQueue = []
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean }

    if (error.response?.status === 401 && !original._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        }).then((token) => {
          original.headers.Authorization = `Bearer ${token}`
          return api(original)
        })
      }

      original._retry = true

      // Multi-tab safety. The session lives in localStorage and the server keeps
      // ONE refresh token per user (rotated on every refresh). If another tab
      // already refreshed, this tab's in-memory tokens are stale: the server would
      // reject our old refresh token and we'd fail the request (the list shows up
      // empty) even though a perfectly valid, newer access token is sitting in
      // storage. Adopt the newer tokens and simply retry.
      const usedAuth = String(original.headers?.Authorization ?? '')
      const stored = readStoredTokens()
      if (stored?.accessToken && `Bearer ${stored.accessToken}` !== usedAuth) {
        useAuthStore.getState().setTokens(stored.accessToken, stored.refreshToken ?? '')
        original.headers.Authorization = `Bearer ${stored.accessToken}`
        return api(original)
      }

      isRefreshing = true

      const refreshToken = useAuthStore.getState().refreshToken

      if (!refreshToken) {
        isRefreshing = false
        processQueue(error, null)
        useAuthStore.getState().logout()
        return Promise.reject(error)
      }

      try {
        const { data } = await axios.post(`${BASE_URL}/api/auth/refresh`, { refreshToken })
        const newToken = data.data.accessToken
        useAuthStore.getState().setTokens(newToken, data.data.refreshToken)
        processQueue(null, newToken)
        original.headers.Authorization = `Bearer ${newToken}`
        return api(original)
      } catch (refreshError) {
        processQueue(refreshError, null)
        const status = (refreshError as AxiosError)?.response?.status
        // Only a token the server actually REJECTED ends the session. A network
        // blip, a 429 rate-limit or a 5xx during refresh says nothing about the
        // token — signing the user out (or leaving the page blank) for that was
        // turning momentary hiccups into "data not loading".
        const rejected = status === 400 || status === 401 || status === 403
        if (rejected) {
          // …unless another tab rotated the token while we were refreshing.
          const latest = readStoredTokens()
          if (latest?.refreshToken && latest.refreshToken !== refreshToken && latest.accessToken) {
            useAuthStore.getState().setTokens(latest.accessToken, latest.refreshToken)
            original.headers.Authorization = `Bearer ${latest.accessToken}`
            return api(original)
          }
          useAuthStore.getState().logout()
        }
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }

    return Promise.reject(error)
  }
)

export default api
