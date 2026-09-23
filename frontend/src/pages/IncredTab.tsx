import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { formatCurrency, formatDateTime } from '@/utils/format'
import { incredLoanApi } from '@/api/incredLoanApi'
import { incredRmApi, type IncredRm } from '@/api/incredRmApi'
import { loansApi } from '@/api/loansApi'
import { LOAN_KEYS } from '@/hooks/useLoans'
import type { Loan } from '@/types'
import { Zap, AlertCircle, RefreshCw, CheckCircle2, UserCog } from 'lucide-react'

const OFFER_STATUS_VARIANT: Record<string, 'success' | 'warning' | 'info' | 'danger' | 'default'> = {
  completed: 'success', approved: 'success',
  pending: 'warning', in_progress: 'warning',
  rejected: 'danger', error: 'danger',
}

// Vanilla's `app.rm` value is exactly this format (efin-app.js:14165 —
// `app.rm = _r.name + ' (' + (_r.location||'') + ')'`). Kept identical so a
// name saved here reverse-matches an RM record the same way on reload.
function rmLabel(rm: IncredRm): string {
  return `${rm.name} (${rm.location || ''})`
}

// ── InCred RM (Relationship Manager) picker ─────────────────────────────
// Mirrors legacy's `incred-rm-select-<id>` block (efin-app.js:2979-2998 /
// 3025-3039): a select over the RM Emails master list, shown both before and
// after the InCred application exists, with an "✓ Assigned" chip + the
// RM's email/phone once picked, or a warning when none is set.
//
// Persisted via the existing PATCH /api/loans/{id}/overview `incredRmName`
// field (LoansController.UpdateOverview) — already wired for the Overview
// tab's read-only display; no new backend endpoint or column needed here.
//
// NOTE (flagged, not silently changed): legacy also threads the resolved RM
// email into the InCred `application/init` call as `PARTNER_DATA.RM_EMAIL`
// (incred_mixin.py parity). The current `/api/incred/loan/{id}/create`
// endpoint does not do this — it has no RM parameter at all. Closing that
// part requires a backend change to IncredController.cs and is intentionally
// left out of this frontend-only fix pending sign-off.
function IncredRmPicker({ loan }: { loan: Loan }) {
  const qc = useQueryClient()
  const [rmError, setRmError] = useState('')

  const { data: rmList } = useQuery({
    queryKey: ['incred-rm'],
    queryFn: () => incredRmApi.getAll().then(r => r.data.data ?? []),
  })

  const currentRm = (rmList ?? []).find(r => rmLabel(r) === loan.incredRmName) ?? null
  const [sel, setSel] = useState<string>(currentRm ? String(currentRm.id) : '')

  const save = useMutation({
    mutationFn: (rm: IncredRm | null) =>
      loansApi.updateOverview(loan.id, { incredRmName: rm ? rmLabel(rm) : null }),
    onSuccess: () => {
      setRmError('')
      qc.invalidateQueries({ queryKey: LOAN_KEYS.detail(loan.id) })
    },
  })

  function handleChange(value: string) {
    setSel(value)
    setRmError('')
    const rm = (rmList ?? []).find(r => String(r.id) === value) ?? null
    save.mutate(rm)
  }

  return (
    <div className="bg-white/70 border border-indigo-100 rounded-xl px-4 py-3.5">
      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide font-bold text-indigo-300 mb-2">
        <UserCog size={12} /> InCred RM (Relationship Manager)
      </p>
      <div className="flex gap-2 items-center">
        <select
          className="flex-1 border border-indigo-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-900"
          value={sel}
          onChange={e => handleChange(e.target.value)}
          disabled={save.isPending}
        >
          <option value="">— Select RM Email —</option>
          {(rmList ?? []).map(rm => (
            <option key={rm.id} value={rm.id}>{rm.name} ({rm.location}) — {rm.email}</option>
          ))}
        </select>
        {currentRm && (
          <span className="text-xs text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full font-semibold whitespace-nowrap">
            ✓ Assigned
          </span>
        )}
      </div>
      {currentRm ? (
        <p className="mt-1.5 text-[11.5px] text-gray-500">
          📧 {currentRm.email} &nbsp;|&nbsp; 📞 {currentRm.contactNo || '—'}
        </p>
      ) : (
        <p className="mt-1.5 text-[11.5px] text-amber-700">
          ⚠ No RM assigned — PARTNER_DATA.RM_EMAIL will not be sent
        </p>
      )}
      {rmError && <p className="mt-1.5 text-[11.5px] text-red-600">⚠ {rmError}</p>}
    </div>
  )
}

export default function IncredTab({ loanId, loan }: { loanId: number; loan: Loan }) {
  const qc = useQueryClient()

  const { data: info, isLoading } = useQuery({
    queryKey: ['incred-loan', loanId],
    queryFn: () => incredLoanApi.getInfo(loanId).then(r => r.data.data),
  })

  // "+ Create InCred App" — single click, no form. Uses the loan's existing
  // customer data; nothing is collected from the user here.
  const createApp = useMutation({
    mutationFn: () => incredLoanApi.create(loanId),
    onSuccess: (res) => {
      qc.setQueryData(['incred-loan', loanId], res.data.data)
    },
  })

  const refreshOffer = useMutation({
    mutationFn: () => incredLoanApi.refreshOffer(loanId),
    onSuccess: (res) => qc.setQueryData(['incred-loan', loanId], res.data.data),
  })

  const [createWarning, setCreateWarning] = useState('')

  // Mirrors legacy's incredCreateApp() gate exactly (efin-app.js:14158-14175):
  // an RM must be picked before the application is created; the click is
  // aborted with a warning, the button itself is never disabled.
  function handleCreateClick() {
    if (!loan.incredRmName) {
      setCreateWarning('Please select an RM from the InCred tab first')
      return
    }
    setCreateWarning('')
    createApp.mutate()
  }

  if (isLoading) return <LoadingSpinner />

  const errorMessage =
    (createApp.isError && (createApp.error as { response?: { data?: { errors?: string[]; message?: string } } })?.response?.data?.errors?.[0]) ||
    (createApp.isError && (createApp.error as { response?: { data?: { message?: string } } })?.response?.data?.message) ||
    info?.incredErrorMessage

  // ── Not yet an InCred application ─────────────────────────────────────────
  if (!info?.isIncredApplication) {
    return (
      <Card>
        <div className="border-2 border-dashed border-indigo-100 bg-indigo-50/40 rounded-2xl py-10 px-6 flex flex-col items-center text-center">
          <Zap size={40} className="text-orange-400 mb-4" strokeWidth={2} />
          <h3 className="text-lg font-bold text-gray-900 mb-1">Not an InCred Application</h3>
          <p className="text-sm text-gray-500 mb-5">This application was not sourced through InCred.</p>
          <div className="w-full max-w-md mb-5 text-left">
            <IncredRmPicker loan={loan} />
          </div>
          <Button
            className="rounded-full px-5"
            loading={createApp.isPending}
            onClick={handleCreateClick}
          >
            + Create InCred App
          </Button>
          {createWarning && (
            <div className="mt-5 w-full max-w-md p-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700 flex items-start gap-2 text-left">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{createWarning}</span>
            </div>
          )}
          {errorMessage && (
            <div className="mt-5 w-full max-w-md p-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700 flex items-start gap-2 text-left">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>
      </Card>
    )
  }

  // ── Already an InCred application: show application + offers ─────────────
  const offerVariant = OFFER_STATUS_VARIANT[info.incredOfferStatus?.toLowerCase() ?? ''] ?? 'default'

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-orange-400" />
            <h3 className="text-base font-semibold text-gray-900">InCred Application</h3>
          </div>
          <Badge variant={offerVariant}>{info.incredOfferStatus ?? 'Pending'}</Badge>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm mb-4">
          <div>
            <p className="text-gray-500 text-xs">InCred Application ID</p>
            <p className="font-mono font-medium text-gray-900 mt-0.5">{info.incredApplicationId ?? '—'}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">InCred Customer ID</p>
            <p className="font-mono font-medium text-gray-900 mt-0.5">{info.incredCustomerId ?? '—'}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">Offer Request ID</p>
            <p className="font-mono font-medium text-gray-900 mt-0.5">{info.incredRequestId ?? '—'}</p>
          </div>
          {info.incredLastSyncedAt && (
            <div>
              <p className="text-gray-500 text-xs">Last Synced</p>
              <p className="font-medium text-gray-900 mt-0.5">{formatDateTime(info.incredLastSyncedAt)}</p>
            </div>
          )}
        </div>

        <IncredRmPicker loan={loan} />

        {info.incredRejectReason && (
          <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700 flex items-start gap-2">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>Rejected: {info.incredRejectReason}</span>
          </div>
        )}
        {info.incredErrorMessage && !info.incredRejectReason && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700 flex items-start gap-2">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{info.incredErrorMessage}</span>
          </div>
        )}

        <div className="mt-5 pt-4 border-t border-gray-100">
          <Button
            variant="secondary" size="sm"
            loading={refreshOffer.isPending}
            onClick={() => refreshOffer.mutate()}
          >
            <RefreshCw size={13} className="mr-1.5" /> Refresh Offer Status
          </Button>
        </div>
      </Card>

      <Card>
        <h4 className="text-sm font-semibold text-gray-900 mb-4">Loan Offers</h4>
        {info.offers.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">
            No offers yet — InCred is still evaluating this application.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {info.offers.map(offer => (
              <div key={offer.id} className="border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <Badge variant="info">{offer.offerType ?? 'OFFER'}</Badge>
                  <CheckCircle2 size={16} className="text-green-500" />
                </div>
                <p className="text-2xl font-bold text-gray-900">{formatCurrency(offer.loanAmount)}</p>
                <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                  <div>
                    <p className="text-gray-500">Tenure</p>
                    <p className="font-medium text-gray-900">{offer.loanMaxTenure} mo</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Rate</p>
                    <p className="font-medium text-gray-900">{offer.loanRate}%</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Processing Fee</p>
                    <p className="font-medium text-gray-900">{offer.processingFee}%</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
