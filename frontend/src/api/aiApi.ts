import api from './axios'

export interface AiParseResponse { success: boolean; provider?: string; text?: string; code?: string; error?: string }

export const aiApi = {
  status: () => api.get<{ data: { enabled: boolean; message: string } }>('/api/ai/status'),

  // Generic text parse — AIController.ParseText. Used by the lender-email
  // workflow's bank-reply parser (same request shape as legacy's direct
  // fetch('/api/ai/parse')).
  parse: (systemPrompt: string, userPrompt: string, maxTokens?: number) =>
    api.post<AiParseResponse>('/api/ai/parse', { systemPrompt, userPrompt, maxTokens }),
}
