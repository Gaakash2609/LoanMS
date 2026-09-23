import api from './axios'
import type { ApiResponse, CreateLoanRequest, Loan, LoanFilter, LoanListItem, PagedResult, DashboardStats } from '@/types'

// Matches LoansController.GetDocuments' projection exactly.
export interface LoanDocument {
  id: number
  documentName: string
  documentType: string
  fileRef: string
  fileSizeBytes: number
  uploadedAt: string
  // Wizard-to-detail-page linking fix: was already saved on upload but never
  // returned by GetDocuments, so the Documents tab couldn't distinguish a
  // primary applicant's document from a co-applicant's identically-typed one.
  applicantRole?: 'Applicant' | 'CoApplicant'
  applicantKey?: string | null
  // Phase 2/3 (RBAC) verification + versioning surface. Older backends that
  // predate the migration omit these — treat missing status as "Pending".
  status?: 'Pending' | 'Verified' | 'Rejected'
  reviewNote?: string | null
  reviewedByUserId?: string | null
  reviewedAt?: string | null
  version?: number
}

export const loansApi = {
  getAll: (filter: LoanFilter) =>
    api.get<ApiResponse<PagedResult<LoanListItem>>>('/api/loans', {
      params: {
        ...filter,
        // Gap 1 — sent as one comma-separated `statuses` value (matches
        // LoanFilterDto.Statuses' query binding) instead of axios' default
        // array param encoding (`statuses[]=`), which ASP.NET Core's
        // query-string model binder does not parse the same way.
        statuses: filter.statuses?.length ? filter.statuses.join(',') : undefined,
      },
    }),

  getById: (id: number) =>
    api.get<ApiResponse<Loan>>(`/api/loans/${id}`),

  create: (data: CreateLoanRequest) =>
    api.post<ApiResponse<Loan>>('/api/loans', data),

  update: (id: number, data: Partial<CreateLoanRequest>) =>
    api.put<ApiResponse<Loan>>(`/api/loans/${id}`, data),

  // EMI Calculator "Save EMI to Application" (legacy calcSaveToApplication,
  // efin-app.js:11380) — pushes the calculator's Amount/Rate/Tenure onto an
  // editable (Draft/Submitted) loan via the same PUT /api/loans/{id}
  // (UpdateLoanRequestDto). LoanType is the enum NAME string (as GetById
  // returns it); the caller re-reads the loan first and forwards the fields
  // the calculator doesn't touch so they aren't reset.
  updateCoreFigures: (id: number, data: {
    loanType: string; requestedAmount: number; interestRate: number; tenureMonths: number
    purpose?: string | null; remarks?: string | null
    assignedToUserId?: number | null; loginUserId?: number | null
  }) => api.put<ApiResponse<Loan>>(`/api/loans/${id}`, data),

  updateStatus: (id: number, data: { newStatus: string; comment?: string; approvedAmount?: number }) =>
    api.patch<ApiResponse<Loan>>(`/api/loans/${id}/status`, data),

  // ── Dedicated workflow transitions ──────────────────────────────────────
  // These routes exist on LoansController and apply their own server-side
  // semantics that the generic PATCH /status does not: /approve carries
  // ApprovedAmount, /reject carries a Reason, /disburse hard-codes the
  // disbursal comment.
  // Using them keeps the recorded status-history text and approved amount
  // consistent with what the legacy app wrote.
  approve: (id: number, data: { approvedAmount?: number; comment?: string }) =>
    api.patch<ApiResponse<Loan>>(`/api/loans/${id}/approve`, data),
  reject: (id: number, data: { reason?: string }) =>
    api.patch<ApiResponse<Loan>>(`/api/loans/${id}/reject`, data),
  disburse: (id: number) =>
    api.patch<ApiResponse<Loan>>(`/api/loans/${id}/disburse`),

  // Hold / Un-hold — pause an in-flight application and later resume it at
  // whatever status it held before. Backend gates both on canHoldApp
  // (LoansController.Hold/Unhold) on top of the fixed role list, and restores
  // the pre-hold status from LoanStatusHistory. Legacy: holdApp/unholdApp.
  hold: (id: number, reason: string) =>
    api.patch<ApiResponse<Loan>>(`/api/loans/${id}/hold`, { reason }),
  unhold: (id: number, reason?: string) =>
    api.patch<ApiResponse<Loan>>(`/api/loans/${id}/unhold`, { reason }),

  // Re-open a Rejected loan — Admin-only, dedicated route (Vanilla parity for
  // reopenApp). Backend enforces the 45-day-from-creation window and restores
  // the exact pre-rejection stage server-side.
  reopen: (id: number, reason: string) =>
    api.patch<ApiResponse<Loan>>(`/api/loans/${id}/reopen`, { reason }),

  // Policy-band deviation flags (empty = within policy). Gated on canDeviation
  // server-side (LoansController.GetDeviations). Read-only risk signal.
  getDeviations: (id: number) =>
    api.get<ApiResponse<LoanDeviation[]>>(`/api/loans/${id}/deviations`),

  // Deviation workflow — all gated on canDeviation. raise: UnderReview →
  // Decision (type+reason). decide: Decision → Approved (approve) / Rejected;
  // the raiser cannot self-approve unless Admin (backend-enforced). skip:
  // UnderReview → Approved. Legacy confirmDeviation/confirmSkipDeviation.
  raiseDeviation: (id: number, deviationType: string, reason: string) =>
    api.patch<ApiResponse<Loan>>(`/api/loans/${id}/deviation/raise`, { deviationType, reason }),
  decideDeviation: (id: number, approve: boolean, comment?: string) =>
    api.patch<ApiResponse<Loan>>(`/api/loans/${id}/deviation/decide`, { approve, comment }),
  skipDeviation: (id: number, reason?: string) =>
    api.patch<ApiResponse<Loan>>(`/api/loans/${id}/deviation/skip`, { reason }),

  // Per-loan Lender RM override (Lender Email Workflow) — PATCH sets the RM
  // contact used for lender-email enquiries on this application only.
  updateLenderRm: (id: number, data: { rmName: string; rmEmail: string; rmMobile?: string }) =>
    api.patch<ApiResponse<Loan>>(`/api/loans/${id}/lender-rm`, data),

  // Bulk status change — PATCH /api/loans/bulk-status existed on the
  // backend (with per-record permission/transition validation and a
  // succeeded/failed count in the response) but had no React caller.
  bulkUpdateStatus: (loanIds: number[], newStatus: string, comment?: string) =>
    api.patch<ApiResponse<{ succeeded: number; failed: number; errors?: string[] }>>(
      '/api/loans/bulk-status', { loanIds, newStatus, comment }),

  // Whole-set replace of the loan's references (References tab). Route
  // already existed on LoansController with no React caller.
  updateReferences: (id: number, refs: Array<{
    name?: string; mobile?: string; relation?: string; refNumber: number
  }>) => api.put<ApiResponse<boolean>>(`/api/loans/${id}/references`, refs),

  // Whole-set replace of the loan's bank lines (which lenders this
  // application has been submitted to). Used by the wizard's Step 9 to
  // persist the banks picked from the eligibility matcher — previously
  // that selection lived only in component state and was lost on submit.
  updateBankLines: (id: number, bankLines: Array<{
    bankName: string; tempApplicationNumber: string
    applicationNumber?: string; approvedLoan?: number; remarks?: string
  }>) => api.put<ApiResponse<boolean>>(`/api/loans/${id}/bank-lines`, { bankLines }),

  // Loan assignment / reassignment (login user, assigned-to user, sales team,
  // ops manager, location). Route already existed on LoansController
  // (PATCH /assignment) with no React caller — only the audit trail was
  // surfaced. Legacy set these via updateLoginUser / the Team & Assignment
  // panel. Each Clear* flag forces the paired field to null instead of leaving
  // it untouched (backend UpdateLoanAssignmentRequestDto semantics).
  updateAssignment: (id: number, detail: {
    salesTeamName?: string | null; opsManagerId?: number | null
    loginUserId?: number | null; assignedToUserId?: number | null; locationId?: number | null
    clearSalesTeam?: boolean; clearOpsManager?: boolean; clearLoginUser?: boolean
    clearAssignedTo?: boolean; clearLocation?: boolean
  }) => api.patch<ApiResponse<Loan>>(`/api/loans/${id}/assignment`, detail),

  // Sanction detail (processing fee %, GST, insurance, bundling toggles, flat
  // rate, EMI date). Route already existed on LoansController
  // (PUT /sanction-detail, LoanSanctionDetail entity) with no React caller —
  // the detail page had no UI for it. Partial update: only provided fields are
  // written server-side.
  updateSanctionDetail: (id: number, detail: {
    sanctionLoanAmt?: number | null; sanctionTenureMonths?: number | null
    sanctionRoi?: number | null; sanctionEmi?: number | null
    stampDuty?: string | null; gst?: number | null; insurance?: number | null
    pfPercent?: number | null; insuranceInBundled?: boolean | null
    pfInBundled?: boolean | null; isBundled?: boolean | null; isBt?: boolean | null
    flatRate?: number | null; emiDate?: string | null
  }) => api.put<ApiResponse<boolean>>(`/api/loans/${id}/sanction-detail`, detail),

  // Overview parity fields (InCred RM / Analytic Bank / the seven verification
  // flags). Partial update — pass only the field(s) to change. PATCH
  // /api/loans/{id}/overview (LoansController.UpdateOverview).
  updateOverview: (id: number, patch: {
    incredRmName?: string | null; analyticBank?: string | null
    documentChecked?: boolean; incomeChecked?: boolean; bankChecked?: boolean
    ecsReturn?: boolean; fiReportChecked?: boolean
    nachDone?: boolean; customerAgreementDone?: boolean
  }) => api.patch<ApiResponse<Loan>>(`/api/loans/${id}/overview`, patch),

  delete: (id: number) =>
    api.delete<ApiResponse<boolean>>(`/api/loans/${id}`),

  getDashboard: () =>
    api.get<ApiResponse<DashboardStats>>('/api/loans/dashboard'),

  // applicantRole (Gap-2): tag a document's applicant identity ('Applicant' |
  // 'CoApplicant'). Omitted → backend defaults to primary Applicant.
  uploadDocument: (loanId: number, file: File, documentType: string, applicantRole?: 'Applicant' | 'CoApplicant', applicantKey?: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('documentType', documentType)
    if (applicantRole) form.append('applicantRole', applicantRole)
    if (applicantKey) form.append('applicantKey', applicantKey)
    return api.post<ApiResponse<{
      id: number; documentName: string; documentType: string
      fileRef: string; fileSizeBytes: number; uploadedAt: string
    }>>(`/api/loans/${loanId}/documents`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  getDocuments: (loanId: number) =>
    api.get<ApiResponse<LoanDocument[]>>(`/api/loans/${loanId}/documents`),

  // Required-documents completeness check (GET /{id}/missing-documents) —
  // existed on the backend with no React caller. Legacy showed the same
  // pending-vs-complete checklist (efin-app.js:2909). Server decides the
  // required set (mandatory salary_slip + bank_statement; self-employed adds
  // ITR/GST), so the rule stays authoritative and single-sourced.
  getMissingDocuments: (loanId: number) =>
    api.get<ApiResponse<{
      loanId: number
      missingDocuments: { type: string; reason: string }[]
      isComplete: boolean
    }>>(`/api/loans/${loanId}/missing-documents`),

  // DELETE /api/loans/{id}/documents/{documentId} — soft-delete, existed on
  // the backend with no React caller (and no document UI at all on the
  // detail page, so nothing could reach it).
  deleteDocument: (loanId: number, documentId: number) =>
    api.delete<ApiResponse<boolean>>(`/api/loans/${loanId}/documents/${documentId}`),

  // GET /api/loans/{id}/documents/{fileName} — streams the file. Requested
  // as a blob so the caller can trigger a real download; the auth header is
  // attached by the shared axios instance, which a plain <a href> could not
  // do (the endpoint is not anonymous).
  downloadDocument: (loanId: number, fileName: string) =>
    api.get<Blob>(`/api/loans/${loanId}/documents/${encodeURIComponent(fileName)}`, { responseType: 'blob' }),

  // Phase 2 RBAC (G-10) — PATCH verify. Backend gate: Roles(6) + canVerifyDocs.
  verifyDocument: (loanId: number, documentId: number, note?: string) =>
    api.patch<ApiResponse<boolean>>(`/api/loans/${loanId}/documents/${documentId}/verify`, { note }),

  // PATCH reject — reason (note) is mandatory server-side (400 if blank).
  rejectDocument: (loanId: number, documentId: number, note: string) =>
    api.patch<ApiResponse<boolean>>(`/api/loans/${loanId}/documents/${documentId}/reject`, { note }),

  // Phase 2 RBAC (G-11) — POST replace. Backend gate: canUploadDocs. Uploads a
  // new file that supersedes documentId (version+1, status resets to Pending).
  replaceDocument: (loanId: number, documentId: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<ApiResponse<{ id: number; version: number; replacedId: number }>>(
      `/api/loans/${loanId}/documents/${documentId}/replace`, form,
      { headers: { 'Content-Type': 'multipart/form-data' } })
  },

  // GET /api/loans/duplicate-check — the authoritative "recent application on
  // this PAN" check the legacy wizard runs from the PAN field's oninput
  // (wPanCheck, index.html:1491). Server rule: non-Draft loan on the same PAN
  // within 60 days. Warning-only by design — it never blocks submission, it
  // just surfaces the signal. Never 400s: an malformed/short PAN comes back as
  // { hasDuplicate: false }.
  duplicateCheck: (pan: string) =>
    api.get<ApiResponse<LoanDuplicateCheck>>('/api/loans/duplicate-check', { params: { pan } }),
}

// One policy-band breach — matches LoanDeviationDto.
export interface LoanDeviation {
  type: string
  description: string
  badge: string
}

// Shape of DuplicateCheck's two response forms (LoansController.cs:468).
export interface LoanDuplicateCheck {
  hasDuplicate: boolean
  loanNumber?: string
  status?: string
  customerName?: string
  daysAgo?: number
}
