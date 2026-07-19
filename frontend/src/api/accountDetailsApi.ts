import api from './axios'

export interface AccountExtractionRequest {
  images: Array<{
    mediaType: string
    data: string
  }>
  prompt: string
}

export interface AccountExtractionResponse {
  success: boolean
  provider?: string
  text?: string
  processingTimeMs?: number
  error?: string
  code?: string
}

export const accountDetailsApi = {
  // Check if account extraction is configured
  status: () =>
    api.get<{ configured: boolean; provider: string }>('/api/kyc/vision/status'),

  // Extract account data from bank statement images
  extractFromStatement: (request: AccountExtractionRequest) =>
    api.post<AccountExtractionResponse>('/api/kyc/vision', request),
}
