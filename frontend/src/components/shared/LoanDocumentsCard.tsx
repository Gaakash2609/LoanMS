import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, FileImage, FileSpreadsheet, Upload, Download, Trash2, File as FileIcon, CheckCircle2, XCircle, RefreshCw } from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { InlineLoader } from '@/components/ui/LoadingSpinner'
import { loansApi, type LoanDocument } from '@/api/loansApi'
import { useHasPermission, useCanVerifyDocs } from '@/hooks/usePermissions'
import { formatDateTime } from '@/utils/format'
import { SkeletonText } from '@/components/ui/Skeleton'

// Review-status → badge presentation. Missing/undefined status (older backend
// rows) is treated as Pending.
function statusBadge(status: LoanDocument['status']): { variant: 'success' | 'danger' | 'warning'; label: string } {
  if (status === 'Verified') return { variant: 'success', label: 'Verified' }
  if (status === 'Rejected') return { variant: 'danger', label: 'Rejected' }
  return { variant: 'warning', label: 'Pending' }
}

// Document types offered on upload — mirrors the legacy app-detail
// Documents tab's checklist labels (efin-app.js's per-loan-type required
// document list). The visible label is what the user picks; the value sent
// to the API is a backend-whitelisted documentType.
//
// IMPORTANT: LoansController.UploadDocument enforces a fixed whitelist
// (identity/address/income/bank_statement/salary_slip/itr/gst/property/other)
// and returns 400 "Invalid document type" for anything else — it does NOT
// accept free-form strings. Previously the raw display label ("Bank Statement",
// "Salary Slips", …) was sent verbatim, so EVERY upload/re-upload from this
// card was rejected. Map each label to its canonical whitelisted type here so
// the transmitted documentType always matches what the wizard uses
// (salary_slip / bank_statement) and what the API accepts.
const DOC_TYPE_VALUE: Record<string, string> = {
  'PAN Card':          'identity',
  'Aadhaar Front':     'identity',
  'Aadhaar Back':      'identity',
  'Salary Slips':      'salary_slip',
  'Bank Statement':    'bank_statement',
  'Form 16 / ITR':     'itr',
  'Employment Letter': 'income',
  'Address Proof':     'address',
  'Photo':             'other',
  'Other':             'other',
}
const DOC_TYPES = Object.keys(DOC_TYPE_VALUE)

// Exported so CustomerDocumentsCard (Customer Detail's aggregated,
// cross-loan document view) can reuse the exact same file-size and
// file-type/icon presentation instead of re-implementing it.
export function fmtSize(bytes: number) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// File-type → icon + preview tint, inferred from the extension in
// documentName (the only place a real extension lives — fileRef is a
// server-side storage path, not something to parse for this). Presentation
// only: it does not change what documentType is stored or displayed.
export function fileVisual(name: string) {
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) return { Icon: FileImage, label: ext.toUpperCase() }
  if (['xls', 'xlsx', 'csv'].includes(ext)) return { Icon: FileSpreadsheet, label: ext.toUpperCase() }
  if (ext === 'pdf') return { Icon: FileText, label: 'PDF' }
  if (!ext) return { Icon: FileIcon, label: 'FILE' }
  return { Icon: FileIcon, label: ext.toUpperCase() }
}

// Loan Documents — list / upload / download / delete. The detail page
// previously had no document UI at all, so loansApi.getDocuments and the
// backend's DELETE + download routes were unreachable. Upload/delete are
// gated on canUploadDocs-equivalent roles; the backend enforces the real
// check (RolePermissionService "canViewDocuments" on read, loan-visibility
// on write) — this is only about not showing dead buttons.
export default function LoanDocumentsCard({ loanId }: { loanId: number }) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [docType, setDocType] = useState(DOC_TYPES[0])
  const [error, setError] = useState('')

  // Drives off the Admin-configurable canUploadDocs permission (the same key
  // the backend UploadDocument endpoint enforces via _rolePerm.IsAllowedAsync)
  // instead of a hard-coded role list. Previously the frontend used a static
  // role array, so toggling canUploadDocs for a role in Settings changed what
  // the backend accepted but NOT whether the upload UI appeared — they now
  // agree.
  const canUpload = useHasPermission('canUploadDocs')
  // Verify/Reject mirrors the backend's dual gate (verifier role + canVerifyDocs)
  // so we never render a control the API would 403.
  const canVerify = useCanVerifyDocs()
  const replaceRef = useRef<HTMLInputElement>(null)
  const [replaceId, setReplaceId] = useState<number | null>(null)

  const { data: docs, isLoading } = useQuery({
    queryKey: ['loanDocuments', loanId],
    queryFn: () => loansApi.getDocuments(loanId).then(r => r.data.data ?? []),
  })

  const upload = useMutation({
    // Send the backend-whitelisted documentType for the chosen label, not the
    // raw label (which the API rejects — see DOC_TYPE_VALUE).
    mutationFn: (file: File) => loansApi.uploadDocument(loanId, file, DOC_TYPE_VALUE[docType] ?? 'other'),
    onSuccess: () => {
      setError('')
      qc.invalidateQueries({ queryKey: ['loanDocuments', loanId] })
      // A new upload can satisfy a mandatory (salary_slip / bank_statement)
      // requirement, so refresh the Required Documents completeness checklist too.
      qc.invalidateQueries({ queryKey: ['missing-documents', loanId] })
      if (fileRef.current) fileRef.current.value = ''
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      setError(msg?.message || msg?.errors?.join(' ') || 'Upload failed. Please try again.')
    },
  })

  const remove = useMutation({
    mutationFn: (documentId: number) => loansApi.deleteDocument(loanId, documentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loanDocuments', loanId] })
      // Deleting a mandatory doc makes the application incomplete again — keep
      // the Required Documents checklist in sync (was stale until a reload).
      qc.invalidateQueries({ queryKey: ['missing-documents', loanId] })
    },
  })

  function reviewError(err: unknown, fallbackMsg: string) {
    const msg = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
    setError(msg?.message || msg?.errors?.join(' ') || fallbackMsg)
  }

  const verify = useMutation({
    mutationFn: (documentId: number) => loansApi.verifyDocument(loanId, documentId),
    onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: ['loanDocuments', loanId] }) },
    onError: (e) => reviewError(e, 'Could not verify this document.'),
  })

  const reject = useMutation({
    mutationFn: ({ documentId, note }: { documentId: number; note: string }) =>
      loansApi.rejectDocument(loanId, documentId, note),
    onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: ['loanDocuments', loanId] }) },
    onError: (e) => reviewError(e, 'Could not reject this document.'),
  })

  const replace = useMutation({
    mutationFn: ({ documentId, file }: { documentId: number; file: File }) =>
      loansApi.replaceDocument(loanId, documentId, file),
    onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: ['loanDocuments', loanId] }) },
    onError: (e) => reviewError(e, 'Could not replace this document.'),
  })

  function promptReject(d: LoanDocument) {
    // Reason is mandatory on the backend (400 if blank) — enforce it here too.
    const note = window.prompt(`Reject "${d.documentName}" — enter a reason (required):`)?.trim()
    if (!note) return
    reject.mutate({ documentId: d.id, note })
  }

  function startReplace(documentId: number) {
    setReplaceId(documentId)
    replaceRef.current?.click()
  }

  function onReplaceFileChosen(file: File | undefined) {
    const id = replaceId
    if (file && id != null) replace.mutate({ documentId: id, file })
    setReplaceId(null)
    if (replaceRef.current) replaceRef.current.value = ''
  }

  async function download(doc: LoanDocument) {
    try {
      // fileRef is the stored path; the download route keys off the file
      // name, so send just the last path segment.
      const fileName = doc.fileRef.split(/[\\/]/).pop() ?? doc.fileRef
      const res = await loansApi.downloadDocument(loanId, fileName)
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = doc.documentName || fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError('Could not download this document.')
    }
  }

  return (
    <Card>
      <CardHeader title={<><span className="section-icon-badge"><FileText size={15} /></span> Documents</>} subtitle={`${docs?.length ?? 0} uploaded`} />

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</div>}

      {/* Single hidden input reused by every card's Replace action. */}
      <input ref={replaceRef} type="file" className="hidden"
        onChange={e => onReplaceFileChosen(e.target.files?.[0])} />

      {canUpload && (
        <div className="flex flex-wrap items-end gap-2 mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">Document Type</label>
            <select value={docType} onChange={e => setDocType(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white">
              {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">File</label>
            <input ref={fileRef} type="file"
              onChange={e => { const f = e.target.files?.[0]; if (f) upload.mutate(f) }}
              className="block w-full text-xs text-gray-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-efin-blue file:text-white hover:file:bg-efin-blue-dark" />
          </div>
          {upload.isPending && <span className="text-xs text-gray-500 pb-2 inline-flex items-center gap-1.5"><InlineLoader size={12} /> Uploading…</span>}
        </div>
      )}

      {isLoading ? (
        <SkeletonText lines={3} className="py-2" />
      ) : (docs ?? []).length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">No documents uploaded yet.</p>
      ) : (
        // Real document cards — icon by file type, a preview-area strip,
        // a status badge and download/delete actions — replacing the
        // previous plain divided-row list. Same data, same actions
        // (download/delete), same permission gating as before.
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {(docs ?? []).map(d => {
            const { Icon, label } = fileVisual(d.documentName)
            const sb = statusBadge(d.status)
            return (
              <div key={d.id} className="doc-card">
                <div className="doc-card-preview">
                  <div className="doc-card-icon">
                    <Icon size={20} strokeWidth={2} />
                  </div>
                </div>
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <p className="text-[13px] font-semibold text-gray-800 leading-snug break-words line-clamp-2">{d.documentName}</p>
                    <Badge variant="info">{label}</Badge>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap mb-1">
                    <Badge variant={sb.variant}>{sb.label}</Badge>
                    {(d.version ?? 1) > 1 && <span className="text-[10px] text-gray-400">v{d.version}</span>}
                  </div>
                  <p className="text-[11px] text-gray-500">{d.documentType}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{fmtSize(d.fileSizeBytes)} · {formatDateTime(d.uploadedAt)}</p>
                  {d.status === 'Rejected' && d.reviewNote && (
                    <p className="text-[11px] text-red-600 mt-1 leading-snug"><span className="font-semibold">Reason:</span> {d.reviewNote}</p>
                  )}

                  <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-gray-100">
                    <button onClick={() => download(d)} title="Download"
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold text-efin-blue bg-[color:var(--accent-subtle)] hover:bg-[color:var(--accent-subtle)]/70 transition-colors">
                      <Download size={13} /> Download
                    </button>
                    {canVerify && d.status !== 'Verified' && (
                      <button onClick={() => verify.mutate(d.id)} disabled={verify.isPending} title="Verify"
                        className="p-1.5 rounded-lg hover:bg-green-50 text-gray-400 hover:text-green-600 transition-colors disabled:opacity-50">
                        <CheckCircle2 size={15} />
                      </button>
                    )}
                    {canVerify && d.status !== 'Rejected' && (
                      <button onClick={() => promptReject(d)} disabled={reject.isPending} title="Reject (reason required)"
                        className="p-1.5 rounded-lg hover:bg-amber-50 text-gray-400 hover:text-amber-600 transition-colors disabled:opacity-50">
                        <XCircle size={15} />
                      </button>
                    )}
                    {canUpload && (
                      <button onClick={() => startReplace(d.id)} disabled={replace.isPending} title="Replace (new version)"
                        className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-efin-blue transition-colors disabled:opacity-50">
                        <RefreshCw size={15} />
                      </button>
                    )}
                    {canUpload && (
                      <button
                        onClick={() => { if (confirm(`Delete "${d.documentName}"?`)) remove.mutate(d.id) }}
                        title="Delete"
                        className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!canUpload && (
        <p className="mt-3 text-xs text-gray-400 flex items-center gap-1.5">
          <Upload size={12} /> Your role can view documents but not upload or delete them.
        </p>
      )}
    </Card>
  )
}
