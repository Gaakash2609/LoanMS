import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useHasAnyRole } from '@/hooks/usePermissions'
import type { UserRole } from '@/types'
import {
  incomeVerificationApi,
  type IncomeVerificationResult,
  type IncomeVerificationMonth,
} from '@/api/incomeVerificationApi'
import { NumberInput } from '@/components/ui/NumberInput'

// ── Income Verification Panel (Phase 6) ────────────────────────────────────────
// Renders the AUTHORITATIVE backend verification — it does NOT compute anything.
// It shows the persisted state, the five income figures kept separate, the
// month-by-month evidence, matched transactions, reasons, and drives the run /
// manual-review / salary-override endpoints. Completion (Income Checked) is
// derived by the backend, never asserted here.

const REVIEW_ROLES: UserRole[] = ['Admin', 'Manager', 'TeamLeader', 'LocationHead', 'OperationManager']

const fmtInr = (n?: number | null) =>
  n == null ? '—' : '₹' + Math.round(n).toLocaleString('en-IN')
const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-GB') : '—')

function StatePill({ state }: { state: string }) {
  const map: Record<string, string> = {
    AutoVerified: 'bg-green-100 text-green-800',
    ManualReviewCompleted: 'bg-green-100 text-green-800',
    ManualReviewRequired: 'bg-amber-100 text-amber-800',
    Failed: 'bg-red-100 text-red-800',
    Pending: 'bg-gray-100 text-gray-700',
    LegacyUnverified: 'bg-gray-100 text-gray-700',
  }
  return <span className={`px-2 py-0.5 rounded text-xs font-semibold ${map[state] ?? 'bg-gray-100 text-gray-700'}`}>{state}</span>
}

function statusColor(s: string): string {
  if (s === 'Matched') return 'var(--success)'
  if (s === 'Pending') return 'var(--muted, #888)'
  return 'var(--danger, #c00)'
}

export default function IncomeVerificationPanel({ loanId }: { loanId: number }) {
  const qc = useQueryClient()
  const canReview = useHasAnyRole(REVIEW_ROLES)
  const key = ['income-verification', loanId] as const

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => (await incomeVerificationApi.getLatest(loanId)).data.data ?? null,
  })

  const [reviewReason, setReviewReason] = useState('')
  const [reviewErr, setReviewErr] = useState('')
  const [overrideFor, setOverrideFor] = useState<number | null>(null)
  const [overrideAmt, setOverrideAmt] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [msg, setMsg] = useState('')

  const invalidate = () => qc.invalidateQueries({ queryKey: key })

  const run = useMutation({
    mutationFn: async () => (await incomeVerificationApi.run(loanId)).data,
    onSuccess: () => { setMsg('Verification run completed.'); invalidate() },
    onError: () => setMsg('Could not run verification.'),
  })

  const review = useMutation({
    mutationFn: async (decision: 'Approved' | 'Rejected') => {
      if (!data) throw new Error('no-verification')
      if (!reviewReason.trim()) { throw new Error('reason-required') }
      return (await incomeVerificationApi.manualReview(loanId, data.id, { decision, reason: reviewReason.trim() })).data
    },
    onSuccess: () => { setReviewReason(''); setReviewErr(''); invalidate() },
    onError: (e: unknown) => setReviewErr((e as Error).message === 'reason-required' ? 'A review reason is required.' : 'Could not submit the review.'),
  })

  const override = useMutation({
    mutationFn: async (extractionId: number) => {
      const amt = parseFloat(overrideAmt)
      if (!(amt > 0)) throw new Error('amount')
      if (!overrideReason.trim()) throw new Error('reason')
      return (await incomeVerificationApi.setOverride(loanId, extractionId, { userEditedSalary: amt, reason: overrideReason.trim() })).data
    },
    onSuccess: () => { setOverrideFor(null); setOverrideAmt(''); setOverrideReason(''); setMsg('Override saved — re-run to apply (routes to manual review).'); invalidate() },
    onError: (e: unknown) => setMsg((e as Error).message === 'amount' ? 'Enter a valid override amount.' : (e as Error).message === 'reason' ? 'An override reason is required.' : 'Could not save override.'),
  })

  const result: IncomeVerificationResult | null = data ?? null

  return (
    <Card>
      <CardHeader
        title={<><span className="section-icon-badge">💹</span> Income Verification (Backend-authoritative)</>}
        action={
          <Button size="sm" variant="primary" loading={run.isPending} onClick={() => run.mutate()}>
            {result ? '↻ Re-run' : '▶ Run verification'}
          </Button>
        }
      />

      {isLoading ? (
        <div className="text-sm text-gray-500 p-2">Loading…</div>
      ) : !result ? (
        <div className="text-sm text-gray-500 p-2">
          No verification has run yet. Click <strong>Run verification</strong> to verify salary against the uploaded
          slips and the bank statement. The result is computed and stored by the backend.
        </div>
      ) : (
        <div className="text-sm space-y-3">
          {/* Summary */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <div>Status: <StatePill state={result.state} /></div>
            <div>Verified income: <strong>{fmtInr(result.verifiedIncome)}</strong></div>
            <div className="text-gray-500">Declared: {fmtInr(result.declaredIncome)}</div>
            <div className="text-gray-500">Extracted (avg): {fmtInr(result.extractedIncome)}</div>
            <div className="text-gray-400 text-xs">Run {fmtDate(result.runAt)}</div>
          </div>

          {result.verifiedIncome != null && result.declaredIncome != null &&
            Math.round(result.verifiedIncome) !== Math.round(result.declaredIncome) && (
            <div className="text-amber-700 text-xs">
              ⚠ Declared income ({fmtInr(result.declaredIncome)}) differs from bank-verified ({fmtInr(result.verifiedIncome)}).
              Declared income is never auto-trusted.
            </div>
          )}

          {/* Month-by-month evidence */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-1 pr-3">Month</th>
                  <th className="py-1 pr-3">Original (read-only)</th>
                  <th className="py-1 pr-3">Effective</th>
                  <th className="py-1 pr-3">Matched credit</th>
                  <th className="py-1 pr-3">Status</th>
                  <th className="py-1 pr-3">Reason</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody>
                {result.months.map((m: IncomeVerificationMonth) => (
                  <tr key={`${m.year}-${m.month}`} className="border-b last:border-0 align-top">
                    <td className="py-1 pr-3 font-medium">{m.monthLabel}</td>
                    <td className="py-1 pr-3">{fmtInr(m.originalExtractedSalary)}</td>
                    <td className="py-1 pr-3">{fmtInr(m.effectiveSalary)}</td>
                    <td className="py-1 pr-3">
                      {m.matchedAmount != null
                        ? <>{fmtInr(m.matchedAmount)} <span className="text-gray-400">· {fmtDate(m.matchedTransactionDate)}{m.verificationMethod ? ` · ${m.verificationMethod}` : ''}</span></>
                        : '—'}
                    </td>
                    <td className="py-1 pr-3" style={{ color: statusColor(m.matchStatus) }}>{m.matchStatus}</td>
                    <td className="py-1 pr-3 text-gray-500">{m.reasonCode ?? ''}</td>
                    <td className="py-1">
                      {(() => {
                        const exId = m.salarySlipExtractionId
                        if (exId == null) return null
                        return overrideFor === exId ? (
                          <div className="flex flex-col gap-1 min-w-[180px]">
                            <NumberInput className="efin-input efin-input--sm" placeholder="Edited net ₹" value={overrideAmt}
                              onChange={e => setOverrideAmt(e.target.value)} />
                            <input className="efin-input efin-input--sm" placeholder="Reason (required)" value={overrideReason}
                              onChange={e => setOverrideReason(e.target.value)} />
                            <div className="flex gap-1">
                              <Button size="sm" variant="success" loading={override.isPending}
                                onClick={() => override.mutate(exId)}>Save</Button>
                              <Button size="sm" variant="ghost" onClick={() => setOverrideFor(null)}>Cancel</Button>
                            </div>
                          </div>
                        ) : (
                          <button className="text-xs text-blue-600 underline"
                            onClick={() => { setOverrideFor(exId); setOverrideAmt(''); setOverrideReason('') }}>
                            Edit override
                          </button>
                        )
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Reasons */}
          {result.reasons.length > 0 && (
            <ul className="text-xs text-gray-600 list-disc pl-5 space-y-0.5">
              {result.reasons.map((r, i) => (
                <li key={i}><span className="font-medium">{r.code}</span>{r.monthLabel ? ` (${r.monthLabel})` : ''}: {r.detail}</li>
              ))}
            </ul>
          )}

          {/* Manual review */}
          {result.state === 'ManualReviewRequired' && canReview && (
            <div className="border-t pt-2 space-y-1">
              <div className="text-xs font-semibold text-amber-700">Manual review required</div>
              <input className="efin-input efin-input--sm w-full" placeholder="Reviewer reason (required)"
                value={reviewReason} onChange={e => setReviewReason(e.target.value)} />
              {reviewErr && <div className="text-red-600 text-xs">{reviewErr}</div>}
              <div className="flex gap-2">
                <Button size="sm" variant="success" loading={review.isPending} onClick={() => review.mutate('Approved')}>Approve</Button>
                <Button size="sm" variant="danger" loading={review.isPending} onClick={() => review.mutate('Rejected')}>Reject</Button>
              </div>
            </div>
          )}
          {result.state === 'ManualReviewRequired' && !canReview && (
            <div className="text-xs text-amber-700 border-t pt-2">Awaiting an authorized reviewer.</div>
          )}
          {result.state === 'ManualReviewCompleted' && (
            <div className="text-xs text-gray-600 border-t pt-2">
              Reviewed: <strong>{result.reviewDecision}</strong> — {result.reviewReason} ({fmtDate(result.reviewedAt)})
            </div>
          )}

          {msg && <div className="text-xs text-gray-500">{msg}</div>}
        </div>
      )}
    </Card>
  )
}
