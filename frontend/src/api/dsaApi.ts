import api from './axios'
import type { ApiResponse } from '@/types'

// Matches DsaController.GetAll's projection exactly. One endpoint feeds
// BOTH the DSA Management and Partner Management pages — the controller's
// own comment says the frontend is expected to filter by PartnerType
// client-side, which is what partnerType below is for. DsaPage previously
// fetched this list without filtering at all, so DSA and Partner records
// were shown merged in one undifferentiated table.
export interface DsaPartner {
  id: number
  name: string
  code: string
  email?: string | null
  phone?: string | null
  city?: string | null
  isActive: boolean
  partnerType: 'Dsa' | 'Partner' | string
  linkedUserId?: number | null
  linkedUser?: string | null
  mappedSalesUser?: string | null
  pan?: string | null
  officeAddress?: string | null
  officeState?: string | null
  officePin?: string | null
  officeAddressType?: string | null
  category?: string | null
  mappedDsaId?: number | null
  mappedDsaName?: string | null
  createdAt: string
  updatedAt?: string | null
}

// Matches DsaController's DsaDto (the create/update body).
export interface DsaSaveRequest {
  name: string
  code: string
  email?: string | null
  phone?: string | null
  city?: string | null
  partnerType: 'Dsa' | 'Partner'
  isActive?: boolean | null
  pan?: string | null
  officeAddress?: string | null
  officeState?: string | null
  officePin?: string | null
  officeAddressType?: string | null
  category?: string | null
  mappedDsaId?: number | null
  mappedSalesUserId?: number | null
  linkedUserId?: number | null
}

// Matches DsaController.GetDocuments' projection.
export interface DsaDocument {
  id: number
  documentName: string
  documentType: string
  fileRef: string
  fileSizeBytes: number
  uploadedAt: string
}

export const dsaApi = {
  getAll: () => api.get<ApiResponse<DsaPartner[]>>('/api/dsa'),
  create: (data: DsaSaveRequest) => api.post<ApiResponse<{ id: number }>>('/api/dsa', data),
  update: (id: number, data: DsaSaveRequest) => api.put<ApiResponse<boolean>>(`/api/dsa/${id}`, data),
  setStatus: (id: number, isActive: boolean) =>
    api.patch<ApiResponse<boolean>>(`/api/dsa/${id}/status`, { isActive }),
  delete: (id: number) => api.delete<ApiResponse<boolean>>(`/api/dsa/${id}`),

  // ── Onboarding / KYC documents ────────────────────────────────────────
  // All three routes already existed on DsaController (same pattern as the
  // loan-document routes) but had no React caller at all — neither the DSA
  // nor the Partner page had any document UI.
  getDocuments: (id: number) =>
    api.get<ApiResponse<DsaDocument[]>>(`/api/dsa/${id}/documents`),
  uploadDocument: (id: number, file: File, documentType: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('documentType', documentType)
    return api.post<ApiResponse<DsaDocument>>(`/api/dsa/${id}/documents`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  downloadDocument: (id: number, fileName: string) =>
    api.get<Blob>(`/api/dsa/${id}/documents/${encodeURIComponent(fileName)}`, { responseType: 'blob' }),

  // GET /api/dsa/export — the server builds the CSV itself and returns it as
  // a file, so this asks for a blob rather than JSON. Legacy calls exactly
  // this endpoint (api-bridge.js:1300).
  //
  // Why this and not a client-side CSV: the endpoint emits all 13 columns
  // (Name, Code, Type, Email, Phone, City, Active, PAN, Office Address,
  // State, PIN, Mapped DSA, Created At) for BOTH DSAs and Partners, and
  // applies the same role scoping GetAll uses — Partner sees only their own
  // record, Dsa sees own + mapped partners, everyone else sees all. A CSV
  // assembled from whatever the list page happens to hold cannot honour any
  // of that.
  exportCsv: () =>
    api.get<Blob>('/api/dsa/export', { responseType: 'blob' }),
}

/**
 * Pulls the filename out of a Content-Disposition header. The export endpoint
 * names the file with a UTC timestamp, so honouring it keeps repeat exports
 * from overwriting each other; legacy hardcoded a single name and lost that.
 */
export function filenameFromDisposition(header: unknown, fallback: string): string {
  if (typeof header !== 'string') return fallback
  const star = header.match(/filename\*=UTF-8''([^;]+)/i)
  if (star) { try { return decodeURIComponent(star[1]) } catch { /* fall through */ } }
  const plain = header.match(/filename="?([^";]+)"?/i)
  return plain ? plain[1].trim() : fallback
}
