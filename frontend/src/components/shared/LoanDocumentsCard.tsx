import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  FileText, FileImage, FileSpreadsheet, Upload, Download, Trash2, File as FileIcon, CheckCircle2, XCircle, RefreshCw,
  MoreHorizontal, HardDrive, Clock, FolderOpen,
} from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/Card'
import { InlineLoader } from '@/components/ui/LoadingSpinner'
import { loansApi, type LoanDocument } from '@/api/loansApi'
import { useHasPermission, useCanVerifyDocs } from '@/hooks/usePermissions'
import { formatDateTime } from '@/utils/format'
import { SkeletonText } from '@/components/ui/Skeleton'

// Review-status → pill + top-strip presentation. Missing/undefined status
// (older backend rows) is treated as Pending.
function statusInfo(status: LoanDocument['status']): { key: 'verified' | 'rejected' | 'pending'; label: string } {
  if (status === 'Verified') return { key: 'verified', label: 'Verified' }
  if (status === 'Rejected') return { key: 'rejected', label: 'Rejected' }
  return { key: 'pending', label: 'Pending' }
}

// Friendly title for the backend's whitelisted documentType keys — the card
// title is now the document TYPE ("Bank Statement"), with the uploaded file
// name shown underneath, because uploaded file names are often meaningless
// ("269.88 Kb", "IMG_2031.jpg").
const DOC_TYPE_LABEL: Record<string, string> = {
  identity: 'Identity Proof',
  address: 'Address Proof',
  income: 'Income Proof',
  bank_statement: 'Bank Statement',
  salary_slip: 'Salary Slip',
  itr: 'Form 16 / ITR',
  gst: 'GST Registration',
  property: 'Property Document',
  other: 'Other Document',
}
export function docTypeLabel(type?: string | null): string {
  const t = (type ?? '').trim()
  if (!t) return 'Document'
  return DOC_TYPE_LABEL[t.toLowerCase()] ?? t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
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
  // Only treat the text after the last dot as an extension when it really
  // looks like one (2–5 letters/digits, no spaces). Names such as
  // "269.88 Kb" or "137.45 Kb (1)" previously produced bogus "88 KB" /
  // "45 KB (1)" type badges.
  const n = (name ?? '').trim()
  const dot = n.lastIndexOf('.')
  const raw = dot > 0 ? n.slice(dot + 1).toLowerCase() : ''
  const ext = /^[a-z][a-z0-9]{1,4}$/.test(raw) ? raw : ''
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
  // Which card's "⋯" overflow menu (Reject / Replace / Delete) is open.
  const [menuId, setMenuId] = useState<number | null>(null)
  useEffect(() => {
    if (menuId == null) return
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest?.('.ldoc-menu-wrap')) setMenuId(null)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuId(null) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [menuId])

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

  const list = docs ?? []
  const counts = list.reduce(
    (acc, d) => { acc[statusInfo(d.status).key]++; return acc },
    { verified: 0, pending: 0, rejected: 0 },
  )
  const subtitle = [
    `${list.length} uploaded`,
    counts.verified ? `${counts.verified} verified` : '',
    counts.pending ? `${counts.pending} pending` : '',
    counts.rejected ? `${counts.rejected} rejected` : '',
  ].filter(Boolean).join(' · ')

  const uploadControls = canUpload ? (
    <div className="ldoc-upload">
      <select value={docType} onChange={e => setDocType(e.target.value)}
        className="ldoc-select" aria-label="Document type">
        {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <input ref={fileRef} type="file" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) upload.mutate(f) }} />
      <button type="button" className="ldoc-upload-btn"
        onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
        {upload.isPending ? <><InlineLoader size={13} /> Uploading…</> : <><Upload size={14} /> Upload</>}
      </button>
    </div>
  ) : undefined

  return (
    <Card>
      <CardHeader
        title={<><span className="section-icon-badge"><FileText size={15} /></span> Documents</>}
        subtitle={isLoading ? undefined : subtitle}
        action={uploadControls}
      />

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</div>}

      {/* Single hidden input reused by every card's Replace action. */}
      <input ref={replaceRef} type="file" className="hidden"
        onChange={e => onReplaceFileChosen(e.target.files?.[0])} />

      {isLoading ? (
        <SkeletonText lines={3} className="py-2" />
      ) : list.length === 0 ? (
        <div className="ldoc-empty">
          <span className="ldoc-empty-icon"><FolderOpen size={22} /></span>
          <p className="ldoc-empty-title">No documents uploaded yet</p>
          {canUpload && <p className="ldoc-empty-sub">Pick a document type and click Upload to add the first one.</p>}
        </div>
      ) : (
        // Modern document cards: status colour strip on top, file-type tile,
        // document TYPE as the title with the file name below, a meta strip
        // (size · uploaded at), and Download / Verify with the less-frequent
        // Reject / Replace / Delete tucked into a "⋯" menu. Same data, same
        // actions, same permission gating as before.
        <div className="ldoc-grid">
          {list.map(d => {
            const { Icon, label } = fileVisual(d.documentName)
            const st = statusInfo(d.status)
            const showVerify = canVerify && d.status !== 'Verified'
            const showReject = canVerify && d.status !== 'Rejected'
            const hasMenu = showReject || canUpload
            return (
              <div key={d.id} className={`ldoc-card ldoc-card--${st.key}`}>
                <div className="ldoc-body">
                  <div className="ldoc-head">
                    <div className="ldoc-file" title={label}>
                      <Icon size={16} strokeWidth={2} />
                      <span>{label}</span>
                    </div>
                    <div className="ldoc-titles">
                      <p className="ldoc-title">{docTypeLabel(d.documentType)}</p>
                      <p className="ldoc-name" title={d.documentName}>{d.documentName || '—'}</p>
                    </div>
                    <span className={`ldoc-pill ldoc-pill--${st.key}`}>{st.label}</span>
                  </div>

                  {(d.applicantRole === 'CoApplicant' || (d.version ?? 1) > 1) && (
                    <div className="ldoc-tags">
                      {d.applicantRole === 'CoApplicant' && <span className="ldoc-tag">Co-Applicant</span>}
                      {(d.version ?? 1) > 1 && <span className="ldoc-tag">v{d.version}</span>}
                    </div>
                  )}

                  <div className="ldoc-meta">
                    <span><HardDrive size={12} /> {fmtSize(d.fileSizeBytes)}</span>
                    <span><Clock size={12} /> {formatDateTime(d.uploadedAt)}</span>
                  </div>

                  {d.status === 'Rejected' && d.reviewNote && (
                    <p className="ldoc-reason"><span>Reason:</span> {d.reviewNote}</p>
                  )}

                  <div className="ldoc-actions">
                    <button type="button" onClick={() => download(d)} className="ldoc-btn ldoc-btn--primary">
                      <Download size={13} /> Download
                    </button>
                    {showVerify && (
                      <button type="button" onClick={() => verify.mutate(d.id)} disabled={verify.isPending}
                        className="ldoc-btn ldoc-btn--verify">
                        <CheckCircle2 size={13} /> Verify
                      </button>
                    )}
                    {hasMenu && (
                      <div className="ldoc-menu-wrap">
                        <button type="button" className="ldoc-more" title="More actions"
                          aria-haspopup="menu" aria-expanded={menuId === d.id}
                          onClick={() => setMenuId(menuId === d.id ? null : d.id)}>
                          <MoreHorizontal size={15} />
                        </button>
                        {menuId === d.id && (
                          <div className="ldoc-menu" role="menu">
                            {showReject && (
                              <button type="button" role="menuitem" disabled={reject.isPending}
                                onClick={() => { setMenuId(null); promptReject(d) }}>
                                <XCircle size={14} /> Reject
                              </button>
                            )}
                            {canUpload && (
                              <button type="button" role="menuitem" disabled={replace.isPending}
                                onClick={() => { setMenuId(null); startReplace(d.id) }}>
                                <RefreshCw size={14} /> Replace (new version)
                              </button>
                            )}
                            {canUpload && (
                              <button type="button" role="menuitem" className="is-danger"
                                onClick={() => { setMenuId(null); if (confirm(`Delete "${d.documentName}"?`)) remove.mutate(d.id) }}>
                                <Trash2 size={14} /> Delete
                              </button>
                            )}
                          </div>
                        )}
                      </div>
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
