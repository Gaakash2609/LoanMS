import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { formatCurrency, formatDateTime } from '@/utils/format'
import { incredLoanApi } from '@/api/incredLoanApi'
import { Zap, AlertCircle, RefreshCw, CheckCircle2 } from 'lucide-react'

const OFFER_STATUS_VARIANT: Record<string, 'success' | 'warning' | 'info' | 'danger' | 'default'> = {
  completed: 'success', approved: 'success',
  pending: 'warning', in_progress: 'warning',
  rejected: 'danger', error: 'danger',
}

export default function IncredTab({ loanId }: { loanId: number }) {
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

  if (isLoading) return <LoadingSpinner />

  const errorMessage =
    (createApp.isError && (createApp.error as { response?: { data?: { errors?: string[]; message?: string } } })?.response?.data?.errors?.[0]) ||
    (createApp.isError && (createApp.error as { response?: { data?: { message?: string } } })?.response?.data?.message) ||
    info?.incredErrorMessage

  // ── Not yet an InCred application ─────────────────────────────────────────
  if (!info?.isIncredApplication) {
    return (
      <Card>
        <div className="border-2 border-dashed border-indigo-100 bg-indigo-50/40 rounded-2xl py-16 px-6 flex flex-col items-center text-center">
          <Zap size={40} className="text-orange-400 mb-4" strokeWidth={2} />
          <h3 className="text-lg font-bold text-gray-900 mb-1">Not an InCred Application</h3>
          <p className="text-sm text-gray-500 mb-6">This application was not sourced through InCred.</p>
          <Button
            className="rounded-full px-5"
            loading={createApp.isPending}
            onClick={() => createApp.mutate()}
          >
            + Create InCred App
          </Button>
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

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
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
