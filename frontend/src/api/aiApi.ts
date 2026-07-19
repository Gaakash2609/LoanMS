import api from './axios'
import type { AIInsightResponse } from '@/types'

export const aiApi = {
  status: () => api.get<{ data: { enabled: boolean; message: string } }>('/api/ai/status'),

  customerSummary: (customerId: number) =>
    api.get<{ data: { summary?: string; recommendation?: string; aiEnabled: boolean } }>(
      `/api/ai/customer/${customerId}/summary`
    ),

  loanInsight: (loanId: number) =>
    api.get<{ data: AIInsightResponse }>(`/api/ai/loan/${loanId}/insight`),

  underwriting: (loanId: number) =>
    api.get<{ data: AIInsightResponse }>(`/api/ai/loan/${loanId}/underwriting`),

  caseInsight: (loanId: number, stage: string) =>
    api.get<{ data: AIInsightResponse }>(`/api/ai/loan/${loanId}/case-insight`, { params: { stage } }),

  generateNotes: (loanId: number, context: string) =>
    api.post<{ data: AIInsightResponse }>(`/api/ai/loan/${loanId}/notes`, { loanId, context }),
}
