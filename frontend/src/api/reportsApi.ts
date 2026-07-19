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

export const reportsApi = {
  getSummary: (from?: string, to?: string) =>
    api.get<ApiResponse<ReportData>>('/api/reports/summary', { params: { from, to } }),
}
