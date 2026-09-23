import api from './axios'
import type { ApiResponse } from '@/types'

export interface ReportData {
  loans?: any
  loansByType: Array<{ loanType: string; count: number; totalAmount: number }>
  loansByStatus: Array<{ status: string; count: number }>
  monthlyDisbursements: Array<{ month: string; count: number; amount: number }>
  topAgents: Array<{ agentName: string; loanCount: number; totalAmount: number }>
  conversionRate: number
  averageLoanAmount: number
  totalPortfolio: number
  // TAT & DDR Metrics
  avgTatDays: number
  tatTarget: number
  disbursedLoans: number
  ddrRatio: number
  ddrTarget: number
  customers: number
  openTasks: number
  openTickets: number
}

// ── Shapes of the ReportsController endpoints the React app never called ──
// All six already existed server-side (each applying the same
// ApplyVisibilityScope rule as Loans/Dashboard), but ReportsPage only ever
// hit /summary — so pipeline, per-agent performance, disbursement register,
// rejection analysis and the monthly trend had no UI at all.

export interface PipelineRow { status: string; count: number; total: number }

export interface PerformanceRow {
  salesPerson: string
  totalApps: number
  disbursed: number
  rejected: number
  totalAmount: number
  disbursedAmount: number
}

// Active Time aggregation row (GET /api/reports/active-time) — Vanilla's
// renderActiveTimeAgg() table, by user or team.
export interface ActiveTimeRow {
  name: string
  count: number
  disbursed: number
  totalHours: number
  avgHours: number
  longestHours: number
}

export interface DisbursementRow {
  loanNumber: string
  customerName: string
  loanType: string
  approvedAmount?: number
  interestRate: number
  tenureMonths: number
  salesPerson: string
  disbursedAt?: string
}

export interface RejectionRow { loanType: string; count: number; total: number }

export interface MonthlyRow {
  month: string
  totalApps: number
  approved: number
  rejected: number
  disbursed: number
  totalAmount: number
  disbursedAmt: number
  conversionRate: number
}

export interface MonthlyReport {
  months: MonthlyRow[]
  summary: {
    totalApps: number; totalDisbursed: number
    totalAmount: number; disbursedAmt: number; avgConversion: number
  }
}

export interface ReportTargets { tatTargetDays?: number; ddrTargetPct?: number }

// Monthly Target achievement (GET /api/reports/target-achievement) — Vanilla's
// "Monthly Targets & Achievements" cards (efin-app.js renderReports). Always
// the current calendar month server-side; only scope/userId/teamId narrow it.
export interface TargetAchievement {
  month: string
  achDisbAmt: number
  achLoginCnt: number
  achDisbCnt: number
  tgtDisbAmt: number
  tgtLoginCnt: number
  tgtDisbCnt: number
}

// ── Reports filters ─────────────────────────────────────────────────────
// Sent to the five app-level report endpoints. Every one of these NARROWS a
// result set the server has already restricted with ApplyVisibilityScope, so
// none of them can widen what a user sees — see ApplyReportNarrowing's own
// doc comment in LoanRepository.
//
// `month` is deliberately absent: legacy treats a YYYY-MM pick as a plain
// date range (efin-app.js:12943, where a custom range overrides it), so the
// caller converts it to from/to rather than the server growing a third way to
// express the same thing.
export interface ReportFilters {
  from?: string
  to?: string
  /** 'all' | 'mine' | 'team'. 'team' is honoured for Admin/TeamLeader only. */
  scope?: string
  userId?: number
  teamId?: number
  status?: string
}

/** Drops empty values so they never reach the query string. */
function reportParams(f: ReportFilters = {}) {
  return {
    from: f.from || undefined,
    to: f.to || undefined,
    scope: f.scope && f.scope !== 'all' ? f.scope : undefined,
    userId: f.userId || undefined,
    teamId: f.teamId || undefined,
    status: f.status || undefined,
  }
}

export const reportsApi = {
  getSummary: (f: ReportFilters = {}) =>
    api.get<ApiResponse<ReportData>>('/api/reports/summary', { params: reportParams(f) }),

  getPipeline: (f: ReportFilters = {}) =>
    api.get<ApiResponse<PipelineRow[]>>('/api/reports/pipeline', { params: reportParams(f) }),

  // Admin/Manager only, matching the endpoint's own [Authorize].
  getPerformance: (f: ReportFilters = {}) =>
    api.get<ApiResponse<PerformanceRow[]>>('/api/reports/performance', { params: reportParams(f) }),

  getDisbursement: (f: ReportFilters = {}) =>
    api.get<ApiResponse<DisbursementRow[]>>('/api/reports/disbursement', { params: reportParams(f) }),

  getRejection: (f: ReportFilters = {}) =>
    api.get<ApiResponse<RejectionRow[]>>('/api/reports/rejection', { params: reportParams(f) }),

  getMonthly: (months = 12) =>
    api.get<ApiResponse<MonthlyReport>>('/api/reports/monthly', { params: { months } }),

  // Admin/Manager only. mode = 'user' (default) | 'group' (by sales team).
  getActiveTime: (f: ReportFilters = {}, mode: 'user' | 'group' = 'user') =>
    api.get<ApiResponse<ActiveTimeRow[]>>('/api/reports/active-time', { params: { ...reportParams(f), mode } }),

  getTargets: () => api.get<ApiResponse<ReportTargets>>('/api/reports/targets'),
  // Admin only.
  updateTargets: (data: ReportTargets) =>
    api.put<ApiResponse<ReportTargets>>('/api/reports/targets', data),

  // Current-month achieved vs. target (Disb. Amount / Login Count / Disb.
  // Count). Only the scope/userId/teamId sales-scope narrows this — from/to
  // are not sent, since Vanilla always uses the real current month here
  // (see TargetAchievement's doc comment server-side).
  getTargetAchievement: (f: Pick<ReportFilters, 'scope' | 'userId' | 'teamId'> = {}) =>
    api.get<ApiResponse<TargetAchievement>>('/api/reports/target-achievement', {
      params: {
        scope: f.scope && f.scope !== 'all' ? f.scope : undefined,
        userId: f.userId || undefined,
        teamId: f.teamId || undefined,
      },
    }),
}
