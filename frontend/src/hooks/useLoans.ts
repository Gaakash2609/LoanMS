import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { loansApi } from '@/api/loansApi'
import type { CreateLoanRequest, LoanFilter } from '@/types'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { emailApi, lenderEmailThreadsApi } from '@/api/lenderEmailApi'
import { buildSubjectAndBody, STATUS_TO_STAGE_KEY, AUTO_EMAIL_TRIGGER_STAGES } from '@/utils/lenderEmailTemplates'

export const LOAN_KEYS = {
  all:       ['loans'] as const,
  list:      (filter: LoanFilter) => ['loans', 'list', filter] as const,
  detail:    (id: number)  => ['loans', 'detail', id] as const,
  dashboard: ['loans', 'dashboard'] as const,
}

export function useLoans(filter: LoanFilter) {
  return useQuery({
    queryKey:        LOAN_KEYS.list(filter),
    queryFn:         () => loansApi.getAll(filter).then((r) => r.data.data),
    // Application List must always reflect the current database state —
    // never serve a cached snapshot, whether from an earlier visit or from
    // right before a new application was created.
    staleTime:       0,
    refetchOnMount:  'always',
  })
}

export function useLoan(id: number) {
  return useQuery({
    queryKey: LOAN_KEYS.detail(id),
    queryFn:  () => loansApi.getById(id).then((r) => r.data.data),
    enabled:  !!id,
  })
}

export function useDashboard() {
  return useQuery({
    queryKey:         LOAN_KEYS.dashboard,
    queryFn:          () => loansApi.getDashboard().then((r) => r.data.data),
    staleTime:        60_000,
    refetchInterval:  120_000,
  })
}

export function useCreateLoan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateLoanRequest) => loansApi.create(data).then((r) => r.data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: LOAN_KEYS.all }),
  })
}

interface BankRow { id: number; bankName: string; rmName?: string; email?: string }

// ── Auto-fire lender email on post-UW stage save ────────────────────────────
// Matches legacy's _hookChangeStatus/sendLenderRmEmail exactly for the two
// stages that have a real backend LoanStatus equivalent (Approved,
// Disbursed — see STATUS_TO_STAGE_KEY/AUTO_EMAIL_TRIGGER_STAGES). Runs
// fire-and-forget after a successful status update (never blocks the UI,
// same as legacy's setTimeout(...,800)); silently skips — no throw, no
// blocking — if no RM email is on file for the loan's bank, same as
// legacy's Gate 3. Runs exactly once per successful mutate() call (React
// Query's onSuccess guarantee), so no separate re-render/refetch dedupe is
// needed — it isn't attached to any query that refetches.
async function fireLenderEmailOnStageChange(loanId: number, stageKey: string, manualNote?: string) {
  try {
    const loanRes = await api.get<ApiResponse<import('@/types').Loan>>(`/api/loans/${loanId}`)
    const loan = loanRes.data.data
    const bankName = loan?.bankLines?.[0]?.bankName
    if (!loan || !bankName) return

    const banksRes = await api.get<ApiResponse<BankRow[]>>('/api/banks')
    const rm = (banksRes.data.data ?? []).find(b => (b.bankName || '').toLowerCase() === bankName.toLowerCase())
    if (!rm?.email) {
      console.warn('[LenderEmail] No lender RM email on file for', bankName, '— skipping auto-send for loan', loanId)
      return
    }

    const { subject, html } = buildSubjectAndBody(loan, rm.rmName || '', stageKey, manualNote)
    const sendRes = await emailApi.send({ to: rm.email, toName: rm.rmName, subject, html })
    if (!sendRes.data.success) {
      console.warn('[LenderEmail] Auto-send failed for loan', loanId, sendRes.data.message)
      return
    }
    await lenderEmailThreadsApi.addEntry({
      loanApplicationId: loanId, direction: 'sent', stage: stageKey,
      rmName: rm.rmName, rmEmail: rm.email, subject, bodyText: html, source: 'auto',
    })
  } catch (e) {
    console.warn('[LenderEmail] Auto-send error for loan', loanId, e)
  }
}

export function useUpdateLoanStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; newStatus: string; comment?: string; approvedAmount?: number }) =>
      loansApi.updateStatus(id, data).then((r) => r.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: LOAN_KEYS.detail(vars.id) })
      qc.invalidateQueries({ queryKey: LOAN_KEYS.all })

      // Auto-fire lender email — fire-and-forget, never blocks the UI or
      // this mutation's own success handling.
      if (AUTO_EMAIL_TRIGGER_STAGES.includes(vars.newStatus)) {
        const stageKey = STATUS_TO_STAGE_KEY[vars.newStatus]
        if (stageKey) void fireLenderEmailOnStageChange(vars.id, stageKey, vars.comment)
      }
    },
  })
}
