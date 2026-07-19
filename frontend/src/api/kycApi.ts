import api from './axios'

export interface KycVisionImage {
  mediaType: string
  data: string
}

export interface KycVisionRequest {
  documentType: 'PAN' | 'AADHAAR'
  images: KycVisionImage[]
  prompt: string
}

export interface KycVisionResponse {
  success: boolean
  provider?: string
  text?: string
  processingTimeMs?: number
  error?: string
  code?: string
}

export const kycApi = {
  // Check if KYC vision is configured
  status: () =>
    api.get<{ configured: boolean; provider: string }>('/api/kyc/vision/status'),

  // Extract data from document images using AI vision
  extractFromImages: (request: KycVisionRequest) =>
    api.post<KycVisionResponse>('/api/kyc/vision', request),
}
