// Step-8 document machinery — extracted verbatim from NewApplicationPage.tsx
// (code-quality refactor, no behaviour change): the backend documentType
// whitelist mapper, mandatory-doc key map, file validation, the three
// document-row components (plain / salary-slip-extraction / Perfios), and the
// Step8 checklist itself. Imported back by the orchestrator and re-exported
// for the existing tests.
import { useState, useEffect, Suspense, lazy } from 'react'
import { AlertCircle, CheckCircle } from 'lucide-react'
import { loansApi } from '@/api/loansApi'
import { type PerfiosReportSaveRequest, type PerfiosReport } from '@/api/perfiosApi'
import type { PerfiosUploadResult } from '@/hooks/usePerfiosUpload'
import { fmtDate as fmtPerfiosDate } from '@/utils/perfios/analysis'
import { serializePerfiosReport } from '@/utils/perfios/persist'
import { getWizardDocs, MANDATORY_DOC_KEY_BY_NAME } from '@/pages/wizard/wizardConstants'
import { formatCurrency as fmtINR } from '@/utils/format'
import type { UploadedDocInfo } from '@/pages/wizard/wizardTypes'

// Lazy-loaded Step-8 extraction modals — pdfjs-dist stays out of the main
// chunk until a modal is actually opened.
const SalarySlipExtractionModal = lazy(() => import('@/components/shared/SalarySlipExtractionModal'))
const PerfiosModal = lazy(() => import('@/components/shared/PerfiosModal'))

// LoansController.UploadDocument enforces a fixed documentType whitelist —
// identity/address/income/bank_statement/salary_slip/itr/gst/property/other —
// and returns 400 "Invalid document type" for anything else (see
// LoanDocumentsCard's DOC_TYPE_VALUE, which hit and fixed this exact issue for
// the detail-page upload card). Step 8's document checklist renders ~90 name
// variants across products/employment types (LOAN_DOCS_MATRIX above), so
// rather than hand-maintain a 90-row map this infers the whitelisted type
// from keywords in the doc's display name — same category logic as Vanilla's
// _docInferMeta (efin-app.js:9818), just mapped onto the backend's enum
// instead of a UI icon/category.
export function mapDocNameToBackendType(name: string): string {
  const n = name.toLowerCase()
  if (/pan card|aadhaar|aadhar|passport|voter|driving licence|driving license|photograph|photo/.test(n)) return 'identity'
  if (/address proof/.test(n)) return 'address'
  if (/salary slip/.test(n)) return 'salary_slip'
  if (/bank statement|banking|current account/.test(n)) return 'bank_statement'
  if (/itr|form 16|computation sheet/.test(n)) return 'itr'
  if (/\bgst\b/.test(n)) return 'gst'
  if (/property|title deed|sale agreement|allotment|building plan|noc from|encumbrance|property tax|khata|chain of title/.test(n)) return 'property'
  if (/business vintage proof|employment proof|appointment letter|employee id|gross receipts|billing statements|practice|business registration|udyam|moa \/ aoa|partnership deed|stock statement|book debt/.test(n)) return 'income'
  return 'other'
}

// The three MANDATORY documents and their backend documentType, derived from
// the same whitelist-safe mapper as every other Step-8 doc (see
// mapDocNameToBackendType) so there is one source of truth for what's a valid
// documentType, not a hand-maintained value that can drift out of sync with
// the backend's allowlist. These are the business-critical docs the
// application cannot be submitted without, so they are uploaded to the draft
// loan the moment they are selected (refresh-safe), and restored from the
// server when a draft is resumed. Their types are 1:1 (unambiguous), which is
// what lets a resumed draft map a server document back to its wizard slot.
// Optional docs remain submit-time uploads (unchanged).
export const MANDATORY_DOC_TYPES: Record<string, string> = {
  salarySlip3mo: mapDocNameToBackendType('Last 3 Month Salary Slips'),
  bankStatement6mo: mapDocNameToBackendType('Last 6 Month Bank Statement'),
  // Self-employed applicants upload Business Vintage Proof instead of salary
  // slips (Vanilla DOC_MANDATORY_INCOME_SELFEMP). Previously mapped to
  // 'business_proof', which is NOT in the backend's allowlist — every
  // self-employed applicant's mandatory document upload was silently
  // rejected with 400 "Invalid document type" (both the immediate
  // draft-persist and the submit-time fallback use this same value). Fixed
  // to the whitelisted 'income' type via the shared mapper.
  bizVintageProof: mapDocNameToBackendType('Business Vintage Proof'),
}

// Gap-2: map a doc-item key/label to its applicant. The wizard already labels
// co-applicant documents (e.g. "Co-applicant Last 3 Month Salary Slips"); every
// other document belongs to the primary applicant. Used to tag uploads so the
// backend can isolate applicant vs co-applicant salary evidence.
export function docApplicantRole(key: string): 'Applicant' | 'CoApplicant' {
  return /co[-\s.]?applicant|coapp/i.test(key) ? 'CoApplicant' : 'Applicant'
}

// Client-side mirror of LoansController.UploadDocument's file restrictions
// (extension allowlist + [RequestSizeLimit(20 MB)]) so an invalid file is
// rejected immediately with a clear message instead of always failing with a
// 400 after the user has already picked it and waited on the request.
const ALLOWED_DOC_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.xlsx', '.csv']
const MAX_DOC_SIZE_BYTES = 20 * 1024 * 1024
export function validateDocFile(file: File): string | null {
  const ext = '.' + (file.name.split('.').pop() || '').toLowerCase()
  if (!ALLOWED_DOC_EXTENSIONS.includes(ext)) {
    return `File type '${ext}' is not allowed. Allowed types: PDF, JPG, PNG, XLSX, CSV.`
  }
  if (file.size > MAX_DOC_SIZE_BYTES) {
    return 'File is larger than 20 MB. Please upload a smaller file.'
  }
  return null
}

// Opens an already-uploaded Step-8 document in a new tab for preview — same
// authenticated-blob technique as LoanDocumentsCard's download(), just
// window.open instead of a forced <a download> so it previews rather than
// saves. fileRef is the server storage path ("{loanId}/{guid}.ext"); the
// download route keys off just the file name, so only the last path segment
// is sent.
async function previewLoanDocument(loanId: number, fileRef: string, onError: (msg: string) => void) {
  try {
    const fileName = fileRef.split(/[\\/]/).pop() ?? fileRef
    const res = await loansApi.downloadDocument(loanId, fileName)
    const url = URL.createObjectURL(res.data)
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  } catch {
    onError('Could not open this document for preview.')
  }
}

// NOTE: MandatoryDoc lives at module scope (not nested inside Step8). Defining
// a component inline inside another component's render body gives it a brand
// new identity on every render of the parent, so React treats it as a
// different component type each time and unmounts/remounts its DOM instead of
// reconciling it — that full unmount/remount is exactly what produced the
// blinking/flickering (upload boxes, borders, icons momentarily disappearing
// and reappearing) whenever `documents`/`errors` changed while on Step 8.
// Hoisting it here keeps a stable component identity across re-renders so
// React reconciles in place instead of remounting.
// `required=false` renders the same real upload control without the * or the
// "required" pill — previously every non-mandatory document type was a dead
// row reading "Upload after submit" with no input at all, so only 2 of the
// ~9 legacy document types could be attached during the wizard.

export function MandatoryDoc({ docKey, label, documents, onDocumentChange, errors, required = true, uploaded, loanId, uploading, onPreviewError }: {
  docKey: string; label: string
  documents: Record<string, File | null>
  onDocumentChange: (key: string, file: File | null) => void
  errors: Record<string, string>
  required?: boolean
  uploaded?: UploadedDocInfo
  loanId?: number
  uploading?: boolean
  onPreviewError: (msg: string) => void
}) {
  const file = documents[docKey]
  // "has a document" = a File picked this session OR one already saved to the
  // draft on the server (survives refresh).
  const displayName = file?.name ?? uploaded?.name
  const has = !!file || !!uploaded
  return (
    <div className={`group flex items-center justify-between gap-3 px-4 py-3 rounded-xl border transition-all ${
      has
        ? 'border-green-200 bg-green-50/60'
        : required
          ? 'border-red-100 bg-white hover:border-efin-blue/40 hover:bg-efin-blue/[0.03]'
          : 'border-gray-100 bg-white hover:border-efin-blue/30 hover:bg-efin-blue/[0.025]'
    }`}>
      {/* Left: icon + label */}
      <div className="flex items-center gap-3 min-w-0">
        <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-base ${
          has ? 'bg-green-100' : required ? 'bg-red-50' : 'bg-gray-100'
        }`}>
          {has ? '✅' : required ? '📄' : '📎'}
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-gray-800 leading-snug">
            {label}{required && <span className="text-red-500 ml-0.5">*</span>}
          </p>
          {displayName && (
            <p className="text-[11px] text-gray-500 truncate max-w-[200px] mt-0.5">{displayName}</p>
          )}
          {errors[docKey] && (
            <p className="mt-0.5 text-[11px] text-red-600 flex items-center gap-1"><AlertCircle size={10} />{errors[docKey]}</p>
          )}
        </div>
      </div>

      {/* Right: badge + actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`hidden sm:inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full ${
          uploading ? 'bg-blue-100 text-blue-700'
            : has ? 'bg-green-100 text-green-700'
            : required ? 'bg-red-50 text-red-500 border border-red-200'
            : 'bg-gray-100 text-gray-500'
        }`}>
          {uploading ? 'Saving…' : uploaded ? 'Saved ✓' : file ? 'Attached' : required ? 'Required' : 'Optional'}
        </span>
        {displayName && uploaded?.fileRef && loanId && (
          <button type="button" onClick={() => previewLoanDocument(loanId, uploaded.fileRef ?? '', onPreviewError)}
            className="text-[11px] text-efin-blue hover:underline font-medium">View</button>
        )}
        {displayName && (
          <button type="button" onClick={() => onDocumentChange(docKey, null)}
            className="text-[11px] text-red-400 hover:text-red-600 font-medium">✕</button>
        )}
        <label className="cursor-pointer">
          <span className={`inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-colors ${
            has
              ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              : 'bg-efin-blue text-white hover:bg-[#064377]'
          }`}>
            {has ? '↩ Replace' : '↑ Upload'}
          </span>
          <input type="file" className="hidden" onChange={e => onDocumentChange(docKey, e.target.files?.[0] ?? null)} />
        </label>
      </div>
    </div>
  )
}

// Maps a completed Perfios analysis to the save DTO — identical shape/values to
// PerfiosAnalysisResults' save call (legacy pfv9ConfirmAttachment): String(abb)/
// String(span), fmtDate dates, first file's name.
export function perfiosSaveRequest(u: PerfiosUploadResult): PerfiosReportSaveRequest {
  return {
    fileName: u.perFileData[0]?.fileName ?? null,
    averageBankBalance: u.abb != null ? String(u.abb) : null,
    span: u.span != null ? String(u.span) : null,
    totalTransactions: u.totalTxns || null,
    hasSalary: !!u.hasSalary,
    isValid: !!u.valid,
    firstTransactionDate: u.firstDate ? fmtPerfiosDate(u.firstDate) : null,
    lastTransactionDate: u.lastDate ? fmtPerfiosDate(u.lastDate) : null,
    manualReviewRequired: !!u.manualReviewRequired,
    staleDays: u.staledays || null,
    // Full report payload so the entire report reloads later on the loan's
    // Reports > Perfios Report tab, not just the summary (same as the detail
    // page's Confirm & Save).
    reportDataJson: serializePerfiosReport(u),
  }
}

// Salary Slip doc row — opens the full "Salary Slip Extraction — Auto Income
// Check" modal (legacy openPerfiosExtractionModal / #pse-overlay). The modal
// reads Net Pay + Month from up to 3 payslips; on confirm the first slip is
// attached as the loan document and the average net pay flows into wizard income.
export function SalarySlipDoc({ docKey, label, documents, onDocumentChange, errors, uploaded, onIncome, loanId, uploading, onPreviewError }: {
  docKey: string; label: string
  documents: Record<string, File | null>
  onDocumentChange: (key: string, file: File | null) => void
  errors: Record<string, string>
  uploaded?: UploadedDocInfo
  onIncome: (amount: number) => void
  loanId?: number
  uploading?: boolean
  onPreviewError: (msg: string) => void
}) {
  const file = documents[docKey]
  const displayName = file?.name ?? uploaded?.name
  const has = !!file || !!uploaded
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  return (
    <div className={`group flex items-center justify-between gap-3 px-4 py-3 rounded-xl border transition-all ${
      has ? 'border-green-200 bg-green-50/60' : 'border-red-100 bg-white hover:border-efin-blue/40 hover:bg-efin-blue/[0.03]'
    }`}>
      {/* Left: icon + label */}
      <div className="flex items-center gap-3 min-w-0">
        <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-base ${has ? 'bg-green-100' : 'bg-amber-50'}`}>
          {has ? '✅' : '⚡'}
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-gray-800 leading-snug">
            {label}<span className="text-red-500 ml-0.5">*</span>
          </p>
          {displayName && (
            <p className="text-[11px] text-gray-500 truncate max-w-[200px] mt-0.5">{displayName}</p>
          )}
          {note && <p className="text-[11px] text-green-700 mt-0.5">{note}</p>}
          {errors[docKey] && (
            <p className="mt-0.5 text-[11px] text-red-600 flex items-center gap-1"><AlertCircle size={10} />{errors[docKey]}</p>
          )}
        </div>
      </div>

      {/* Right: badge + actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`hidden sm:inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full ${
          uploading ? 'bg-blue-100 text-blue-700'
            : has ? 'bg-green-100 text-green-700'
            : 'bg-red-50 text-red-500 border border-red-200'
        }`}>
          {uploading ? 'Saving…' : uploaded ? 'Saved ✓' : file ? 'Attached' : 'Required'}
        </span>
        {displayName && uploaded?.fileRef && loanId && (
          <button type="button" onClick={() => previewLoanDocument(loanId, uploaded.fileRef ?? '', onPreviewError)}
            className="text-[11px] text-efin-blue hover:underline font-medium">View</button>
        )}
        {displayName && (
          <button type="button" onClick={() => { onDocumentChange(docKey, null); setNote(null) }}
            className="text-[11px] text-red-400 hover:text-red-600 font-medium">✕</button>
        )}
        <button type="button" onClick={() => setOpen(true)}
          className={`inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-colors ${
            has ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-efin-blue text-white hover:bg-[#064377]'
          }`}>
          ⚡ {has ? 'Re-upload' : 'Upload Document'}
        </button>
      </div>

      {open && (
        <Suspense fallback={null}>
          <SalarySlipExtractionModal
            onClose={() => setOpen(false)}
            onConfirm={(files, avgNet) => {
              if (files[0]) onDocumentChange(docKey, files[0])
              if (avgNet > 0) { onIncome(avgNet); setNote(`${files.length} slip${files.length !== 1 ? 's' : ''} read · avg net ${fmtINR(avgNet)}/mo → set as monthly income`) }
              setOpen(false)
            }}
          />
        </Suspense>
      )}
    </div>
  )
}

// Vanilla routes EVERY doc name containing "bank statement" or "banking"
// through the Perfios popup (efin-app.js:9536 markDocUploaded, :9937
// _docDrop, :10080 checklist render — all three gated on this exact test,
// with pfv9Open(itemId, docName) called regardless of whose statement it is
// or the statement period) — own salary-account, co-applicant's, and
// self-employed current/6-or-12-month current-account statements alike.
// Single source of truth for which Step-8 doc rows get the Perfios flow
// instead of a plain file input.
export function isBankStatementDocName(name: string): boolean {
  return /bank statement|banking/i.test(name)
}

// Formats a Perfios verification restored from the server (draft resume) the
// same way a fresh in-session result is formatted below, from the summary
// fields PerfiosController already returns (ABB/span/totalTransactions/
// isValid) — no fabricated data, no re-implementation of the full report.
function formatRestoredPerfiosSummary(r: PerfiosReport): string {
  const abb = r.averageBankBalance != null ? Math.round(Number(r.averageBankBalance)) : 0
  return `Perfios: ABB ${fmtINR(abb)} · ${r.span ?? '—'}d · ${r.totalTransactions ?? 0} txns · ${r.isValid ? 'Valid' : 'Needs review'}`
}

// Bank Statement doc row — opens the full Perfios v9 5-step analysis modal
// (legacy pfv9Open / perfios/index.html). On Confirm Attachment the statement is
// attached as the loan document and the finished report is handed up to persist
// once the loan id exists (post-submit) — matching legacy's attach-then-save.
// Reused for every bank-statement-labelled doc-item (own / co-applicant /
// current-account), not just the one mandatory slot — each rendered instance
// keeps its own `summary`/`open` state, so they process and display
// independently (mirrors legacy's per-doc-item _BFP_STORE keying).
export function BankStatementDoc({ docKey, label, documents, onDocumentChange, errors, uploaded, onPerfios, restored, required = true, loanId, uploading, onPreviewError }: {
  docKey: string; label: string
  documents: Record<string, File | null>
  onDocumentChange: (key: string, file: File | null) => void
  errors: Record<string, string>
  uploaded?: UploadedDocInfo
  onPerfios: (docKey: string, result: PerfiosUploadResult) => void
  // Verification restored from the server for THIS doc-item on draft resume
  // (matched by file name — see the resume effect). Only seeds the badge; a
  // fresh in-session run always takes precedence and is never overwritten by
  // a late-arriving restore.
  restored?: PerfiosReport
  required?: boolean
  loanId?: number
  uploading?: boolean
  onPreviewError: (msg: string) => void
}) {
  const file = documents[docKey]
  const has = !!file || !!uploaded
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)

  // Seed the badge from a restored server-side verification once it arrives
  // (it resolves asynchronously, after mount) — but only if this doc-item
  // hasn't already produced a fresher in-session summary.
  useEffect(() => {
    if (restored && !summary) setSummary(formatRestoredPerfiosSummary(restored))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored])

  return (
    <div className={`group flex items-center justify-between gap-3 px-4 py-3 rounded-xl border transition-all ${
      summary || has
        ? 'border-green-200 bg-green-50/60'
        : required
          ? 'border-red-100 bg-white hover:border-efin-blue/40 hover:bg-efin-blue/[0.03]'
          : 'border-gray-100 bg-white hover:border-efin-blue/30 hover:bg-efin-blue/[0.025]'
    }`}>
      {/* Left: icon + label */}
      <div className="flex items-center gap-3 min-w-0">
        <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-base ${
          summary ? 'bg-green-100' : has ? 'bg-green-100' : required ? 'bg-blue-50' : 'bg-gray-100'
        }`}>
          {summary ? '✅' : has ? '🏦' : '🏦'}
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-gray-800 leading-snug">
            {label}{required && <span className="text-red-500 ml-0.5">*</span>}
          </p>
          {file && (
            <p className="text-[11px] text-gray-500 truncate max-w-[200px] mt-0.5">{file.name}</p>
          )}
          {summary && <p className="text-[11px] text-green-700 mt-0.5">{summary}</p>}
          {errors[docKey] && (
            <p className="mt-0.5 text-[11px] text-red-600 flex items-center gap-1"><AlertCircle size={10} />{errors[docKey]}</p>
          )}
        </div>
      </div>

      {/* Right: badge + actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`hidden sm:inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full ${
          uploading ? 'bg-blue-100 text-blue-700'
            : summary ? 'bg-green-100 text-green-700'
            : has ? 'bg-green-100 text-green-700'
            : required ? 'bg-red-50 text-red-500 border border-red-200'
            : 'bg-gray-100 text-gray-500'
        }`}>
          {uploading ? 'Saving…' : summary ? 'Perfios Verified ✓' : uploaded ? 'Saved ✓' : file ? 'Attached' : required ? 'Required' : 'Optional'}
        </span>
        {!file && uploaded?.fileRef && loanId && (
          <button type="button" onClick={() => previewLoanDocument(loanId, uploaded.fileRef ?? '', onPreviewError)}
            className="text-[11px] text-efin-blue hover:underline font-medium">View</button>
        )}
        {file && (
          <button type="button" onClick={() => { onDocumentChange(docKey, null); setSummary(null) }}
            className="text-[11px] text-red-400 hover:text-red-600 font-medium">✕</button>
        )}
        <button type="button" onClick={() => setOpen(true)}
          className={`inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-colors ${
            has ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-efin-blue text-white hover:bg-[#064377]'
          }`}>
          🏦 {has ? 'Re-run Perfios' : 'Upload Statement'}
        </button>
      </div>

      {open && (
        <Suspense fallback={null}>
          <PerfiosModal
            onClose={() => setOpen(false)}
            onConfirm={(result, f) => {
              if (f) onDocumentChange(docKey, f)
              onPerfios(docKey, result)
              setSummary(`Perfios: ABB ${fmtINR(Math.round(result.abb))} · ${result.span}d · ${result.totalTxns} txns · ${result.valid ? 'Valid' : 'Needs review'}`)
              setOpen(false)
            }}
          />
        </Suspense>
      )}
    </div>
  )
}

export function Step8({ documents, onDocumentChange, errors, uploadedDocs, empType, loanType, onIncome, onPerfios, perfiosRestored, loanId, uploadingKeys, onPreviewError }: {
  documents: Record<string, File | null>
  onDocumentChange: (key: string, file: File | null) => void
  errors: Record<string, string>
  uploadedDocs: Record<string, UploadedDocInfo>
  empType: string
  loanType: string
  onIncome: (amount: number) => void
  onPerfios: (docKey: string, result: PerfiosUploadResult) => void
  // Perfios verification restored on draft resume, keyed by doc-item key —
  // see the resume effect in the parent wizard component.
  perfiosRestored: Record<string, PerfiosReport>
  loanId?: number
  uploadingKeys: Record<string, boolean>
  // A preview/download failure (expired session, file removed server-side,
  // etc.) surfaces through the same shared upload-warning banner already
  // rendered above the wizard body, rather than a second ad-hoc error UI.
  onPreviewError: (msg: string) => void
}) {
  // Product + employment-type specific document checklist — Vanilla parity
  // (getWizardDocs / renderEnhancedDocChecklist). The list order (KYC → income
  // → product-specific) mirrors the matrix. Mandatory income docs render with
  // their stable persistence key + a "*"; everything else is optional, keyed by
  // its own name (uploaded at submit under that name as documentType).
  const docList = getWizardDocs(loanType, empType)
  // Required / Uploaded / Remaining progress — an at-a-glance summary of the
  // mandatory-document checklist (mandatory = docs that carry a stable
  // persistence key, i.e. the ones the submit gate enforces). A doc counts as
  // provided once it's attached locally or already persisted to the draft.
  // Presentation only — computeStepErrors still enforces each mandatory doc.
  const mandatoryNames = docList.filter(name => MANDATORY_DOC_KEY_BY_NAME[name] != null)
  const requiredTotal = mandatoryNames.length
  const uploadedCount = mandatoryNames.filter(name => {
    const key = MANDATORY_DOC_KEY_BY_NAME[name]
    return !!uploadedDocs[key] || !!documents[key]
  }).length
  const remaining = Math.max(0, requiredTotal - uploadedCount)
  const pct = requiredTotal > 0 ? Math.round((uploadedCount / requiredTotal) * 100) : 100
  return (
    <div className="space-y-4">
      {/* ── Intro text ── */}
      <p className="text-[13px] text-gray-500 leading-relaxed">
        Upload the documents for this loan product. Documents marked with <span className="text-red-500 font-semibold">*</span> are mandatory and must be uploaded before submission. Other documents can be added after submission.
        <span className="ml-1 text-gray-400">Accepted: PDF, JPG, PNG, XLSX, CSV — max 20 MB per file.</span>
      </p>

      {/* ── Progress tracker ── */}
      {requiredTotal > 0 && (
        <div className="rounded-2xl border overflow-hidden"
          style={{ borderColor: remaining === 0 ? '#bbf7d0' : '#e5e7eb', background: remaining === 0 ? '#f0fdf4' : '#f9fafb' }}>
          <div className="px-4 pt-3 pb-2">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-4 text-[12px]">
                <span className="text-gray-500">Required <span className="font-bold text-gray-800 ml-1">{requiredTotal}</span></span>
                <span className="text-green-600">Uploaded <span className="font-bold ml-1">{uploadedCount}</span></span>
                <span className={remaining > 0 ? 'text-amber-600' : 'text-gray-400'}>
                  Remaining <span className="font-bold ml-1">{remaining}</span>
                </span>
              </div>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                remaining === 0 ? 'bg-green-100 text-green-700' : 'bg-efin-blue/10 text-efin-blue'
              }`}>{pct}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className={`h-full rounded-full transition-all duration-500 ${remaining > 0 ? 'bg-efin-blue' : 'bg-green-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          {remaining === 0 && (
            <div className="px-4 py-2 border-t border-green-200 flex items-center gap-1.5 text-[12px] text-green-700 font-medium">
              <CheckCircle size={13} /> All mandatory documents provided — ready to continue.
            </div>
          )}
        </div>
      )}

      {/* ── Document list ── */}
      <div>
        <p className="wiz-section-head">Required Documents</p>
        <div className="space-y-2 mt-2">
          {docList.map(name => {
            // The map's keys ARE the mandatory doc names, so a hit ⟺ mandatory.
            const mandKey = MANDATORY_DOC_KEY_BY_NAME[name]
            const isMandatory = mandKey != null
            const key = mandKey ?? name
            const uploading = !!uploadingKeys[key]
            // Vanilla wizard doc-item behaviour: the Salary Slip item runs PSE
            // extraction; EVERY bank-statement-labelled doc-item runs Perfios —
            // own salary-account statement, co-applicant's, and self-employed
            // current-account statement (6 or 12 month) alike. Vanilla gates this
            // purely on the doc name (efin-app.js:9536 markDocUploaded, :9937
            // _docDrop, :10080 checklist render — all three test
            // /bank statement|banking/i with no exception for who/which account
            // it belongs to), not on whether the doc happens to be the one
            // mandatory bank-statement slot — mirrored here via
            // isBankStatementDocName so a co-applicant's or current-account
            // statement gets the same Perfios flow instead of falling through to
            // a plain file input.
            if (mandKey === 'salarySlip3mo') {
              return <SalarySlipDoc key={name} docKey={key} label={name} uploaded={uploadedDocs[key]} loanId={loanId} uploading={uploading} onPreviewError={onPreviewError}
                documents={documents} onDocumentChange={onDocumentChange} errors={errors} onIncome={onIncome} />
            }
            if (isBankStatementDocName(name)) {
              return <BankStatementDoc key={name} docKey={key} label={name} required={isMandatory} uploaded={uploadedDocs[key]} loanId={loanId} uploading={uploading} onPreviewError={onPreviewError}
                documents={documents} onDocumentChange={onDocumentChange} errors={errors} onPerfios={onPerfios} restored={perfiosRestored[key]} />
            }
            return (
              <MandatoryDoc key={name} docKey={key} label={name} required={isMandatory}
                uploaded={uploadedDocs[key]} loanId={loanId} uploading={uploading} onPreviewError={onPreviewError}
                documents={documents} onDocumentChange={onDocumentChange} errors={errors} />
            )
          })}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 mt-2 italic">
        Optional documents can also be added later from the application detail view.
      </p>
    </div>
  )
}
