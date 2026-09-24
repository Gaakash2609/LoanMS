import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { loansApi } from '@/api/loansApi'
import type { LoanFilter } from '@/types'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { emailApi, lenderEmailThreadsApi } from '@/api/lenderEmailApi'
import { buildSubjectAndBody, STATUS_TO_STAGE_KEY, AUTO_EMAIL_TRIGGER_STAGES } from '@/utils/lenderEmailTemplates'
import { useAuthStore } from '@/store/authStore'

export const LOAN_KEYS = {
  all:       ['loans'] as const,
  list:      (filter: LoanFilter) => ['loans', 'list', filter] as const,
  // userId included so switching accounts never serves one user's role-filtered
  // loan detail to another user in the same browser session.
  detail:    (id: number, userId?: number) => ['loans', 'detail', id, userId ?? 0] as const,
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
  const userId = useAuthStore(s => s.user?.id)
  return useQuery({
    queryKey: LOAN_KEYS.detail(id, userId),
    queryFn:  () => loansApi.getById(id).then((r) => r.data.data),
    enabled:  !!id && !!userId,
    staleTime: 0,
    refetchOnMount: 'always',
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

// ── Dashboard breakdown (Pipeline stage bars / Monthly Disbursals / Loan
// Type Mix) ──────────────────────────────────────────────────────────────
// DashboardController only returns aggregate totals — it has no per-stage,
// per-month, or per-loan-type breakdown endpoint, and the API surface is
// locked for this pass. Legacy computed all three of these client-side from
// the full in-browser APPLICATIONS array (efin-app.js renderPipeline() /
// renderChart() / renderLoanTypeChart()); this does the same thing, off the
// existing GET /api/loans list endpoint, so no backend change is needed and
// server-side visibility scoping (ApplyVisibilityScope) still applies since
// it's the same endpoint every other loan read uses.
//
// BUGFIX (Phase 9 code-level audit) — this used to request a single page of
// `pageSize: 1000`. LoansController.GetAll clamps PageSize server-side to
// the server's own [1,100] range and falls back to 10 for anything outside
// it (`if (filter.PageSize is < 1 or > 100) filter.PageSize = 10;`), so the
// "1000" was silently reset to 10 on every request — Pipeline/Monthly
// Disbursals/Loan Type Mix only ever reflected the 10 most recently created
// loans, incomplete at any dataset size, not just past 1000. Paging through
// the same endpoint at the server's real maximum (100) via fetchAllPages()
// and concatenating every page fixes that at any loan count, still off the
// one existing GET /api/loans endpoint — no duplicate/new endpoint added.
export function useDashboardBreakdown() {
  return useQuery({
    queryKey: ['loans', 'dashboard-breakdown'],
    queryFn:  () => loansApi.getAllPages({}),
    staleTime: 60_000,
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
