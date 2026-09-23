import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { InlineLoader } from '@/components/ui/LoadingSpinner'
import { Modal } from '@/components/ui/Modal'
import { dsaApi } from '@/api/dsaApi'
import { SkeletonText } from '@/components/ui/Skeleton'

// The onboarding document set legacy's DSA form tracked, each with a
// Pending/Uploaded badge (dsaSave's Documents Required section,
// efin-app.js:8946-9042 / dsaDocUpload). `key` is what actually gets sent
// as `documentType` — it MUST match DsaController.UploadDocument's
// allowedDocTypes whitelist ("aadhar","aadhar_back","pan","compan","breg",
// "offaddr","other"); `label` is the legacy display text shown to the user.
// BUGFIX: this previously sent the display label itself as documentType
// (e.g. "Aadhaar Front"), which the backend whitelist rejects outright —
// every upload except "Other" 400'd, and the Pending/Uploaded checklist
// below could never flip to Uploaded either, since it compared against
// those same labels while GetDocuments returns the lowercase key. There is
// no Vanilla "Cancelled Cheque" document type for DSA/Partner onboarding
// (nor a matching backend key) — dropped rather than left silently broken.
const DOC_TYPES: { key: string; label: string }[] = [
  { key: 'aadhar', label: 'Aadhaar Front' },
  { key: 'aadhar_back', label: 'Aadhaar Back' },
  { key: 'pan', label: 'PAN Card' },
  { key: 'compan', label: 'Company PAN Card' },
  { key: 'breg', label: 'Business Registration Proof' },
  { key: 'offaddr', label: 'Office Address Proof' },
  { key: 'other', label: 'Other' },
]

// Documents for a DSA or Partner record. Uses DsaController's existing
// GET/POST /api/dsa/{id}/documents route. Upload-only, matching Vanilla's
// dsaDocUpload (efin-app.js:30697): a per-type file picker with a
// Pending/Uploaded checklist badge — Vanilla never offered a viewer or
// download list for these documents, so this component doesn't add one
// either. There is also no delete route for DSA documents on the backend
// (unlike loan documents), so none is offered here.
export default function DsaDocumentsModal({
  partnerId, partnerName, canUpload, onClose,
}: {
  partnerId: number
  partnerName: string
  canUpload: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [docType, setDocType] = useState(DOC_TYPES[0].key)
  const [error, setError] = useState('')

  const { data: docs, isLoading } = useQuery({
    queryKey: ['dsaDocuments', partnerId],
    queryFn: () => dsaApi.getDocuments(partnerId).then(r => r.data.data ?? []),
  })

  const upload = useMutation({
    mutationFn: (file: File) => dsaApi.uploadDocument(partnerId, file, docType),
    onSuccess: () => {
      setError('')
      qc.invalidateQueries({ queryKey: ['dsaDocuments', partnerId] })
      if (fileRef.current) fileRef.current.value = ''
    },
    onError: (err: unknown) => {
      const d = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      setError(d?.message || d?.errors?.join(' ') || 'Upload failed. Please try again.')
    },
  })

  const uploaded = new Set((docs ?? []).map(d => d.documentType))

  return (
    <Modal
      open
      onClose={onClose}
      title="Documents"
      subtitle={partnerName}
      size="md"
      className="sm:max-w-lg"
      footer={<Button size="sm" variant="secondary" onClick={onClose}>Close</Button>}
    >
      <div className="space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          {/* Required-document checklist with Pending/Uploaded badges */}
          <div>
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Required Documents</p>
            <div className="flex flex-wrap gap-1.5">
              {DOC_TYPES.slice(0, 6).map(t => (
                <span key={t.key} className={`text-[11px] px-2 py-1 rounded-full ${
                  uploaded.has(t.key) ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {uploaded.has(t.key) ? '✓' : '○'} {t.label}
                </span>
              ))}
            </div>
          </div>

          {canUpload && (
            <div className="flex flex-wrap items-end gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">Document Type</label>
                <select value={docType} onChange={e => setDocType(e.target.value)}
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white">
                  {DOC_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">File</label>
                <input ref={fileRef} type="file"
                  onChange={e => { const f = e.target.files?.[0]; if (f) upload.mutate(f) }}
                  className="block w-full text-xs text-gray-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-efin-blue file:text-white" />
              </div>
              {upload.isPending && <span className="text-xs text-gray-500 pb-2 inline-flex items-center gap-1.5"><InlineLoader size={12} /> Uploading…</span>}
            </div>
          )}

          {isLoading && <SkeletonText lines={2} className="py-2" />}
      </div>
    </Modal>
  )
}
