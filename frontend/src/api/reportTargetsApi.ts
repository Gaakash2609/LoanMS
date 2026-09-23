import api from './axios'
import type { ApiResponse } from '@/types'

// ── Monthly Report Targets ──────────────────────────────────────────────
// GET/POST/PUT/DELETE /api/report-targets (ReportTargetsController) — full
// CRUD that has never had a React caller. The legacy Reports page drives it
// from the "🎯 Edit Monthly Targets" collapsible card (index.html:4756,
// toggleTargetEditor/addTargetEditorRow in efin-app.js:12555).
//
// This is NOT the same thing as reportsApi.getTargets()/updateTargets(),
// which hit /api/reports/targets — a different route on ReportsController
// holding just two org-wide scalars (TAT days, DDR %). Both are real; they
// manage different records, so both belong on the Targets tab.
//
// Legacy only ever creates org-wide rows (no user/team split), so userId and
// teamId are left null here — that is also the only shape the server
// duplicate-checks, one row per month.

export interface ReportTarget {
  id: number
  /** YYYY-MM. Server rejects anything else (MonthPattern). */
  targetMonth: string
  userId?: number | null
  teamId?: number | null
  disbAmt: number
  loginCount: number
  disbCount: number
  createdAt?: string
  updatedAt?: string
}

export interface ReportTargetCreateRequest {
  targetMonth: string
  userId?: number | null
  teamId?: number | null
  disbAmt: number
  loginCount: number
  disbCount: number
}

/** Update only touches the three figures — the server ignores month/scope. */
export interface ReportTargetUpdateRequest {
  disbAmt: number
  loginCount: number
  disbCount: number
}

export const reportTargetsApi = {
  getAll: () => api.get<ApiResponse<ReportTarget[]>>('/api/report-targets'),

  // Writes are [Authorize(Roles = "Admin,Manager")] — a Sales user gets a 403,
  // which the UI surfaces as a normal error rather than pre-guessing.
  create: (data: ReportTargetCreateRequest) =>
    api.post<ApiResponse<{ id: number }>>('/api/report-targets', data),

  update: (id: number, data: ReportTargetUpdateRequest) =>
    api.put<ApiResponse<boolean>>(`/api/report-targets/${id}`, data),

  // Soft delete server-side (IsDeleted), same convention as Banks/DSA.
  delete: (id: number) =>
    api.delete<ApiResponse<boolean>>(`/api/report-targets/${id}`),
}

/** Legacy defaults for a freshly added month (efin-app.js:12665). */
export const NEW_TARGET_DEFAULTS = { disbAmt: 5_000_000, loginCount: 20, disbCount: 8 }

/**
 * Next month after the latest existing one, else the current month —
 * exactly addTargetEditorRow()'s rule (efin-app.js:12651).
 */
export function nextTargetMonth(existing: string[]): string {
  const sorted = [...existing].sort()
  const last = sorted[sorted.length - 1]
  if (!last) {
    const n = new Date()
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
  }
  const [y, mo] = last.split('-').map(Number)
  // `mo` is 1-12 and the Date constructor's month is 0-indexed, so passing
  // `mo` directly lands on the following month, rolling the year over itself.
  const next = new Date(y, mo)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
}

/** "2026-08" → "Aug 2026", matching legacy's monthLabel(). */
export function monthLabel(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  if (!y || !mo) return m
  return new Date(y, mo - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}
