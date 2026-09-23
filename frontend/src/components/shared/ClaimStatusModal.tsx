import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { payoutApi, type PayoutClaim } from '@/api/payoutApi'
import { formatCurrency, formatDate } from '@/utils/format'
import { useAuthStore } from '@/store/authStore'

// ── Claim Status / Payment modal ───────────────────────────────────────
// Ports legacy's openStatusModal/saveClaimStatus (efin-app.js): change a
// claim's status and, when marking it Paid, capture the payment details
// (mode, UTR/reference, payment date, bank account last-4) plus an
// internal remark.
//
// Payment details go into their own real columns on PayoutClaim
// (PaymentMode / PaymentReference / PaymentDate / BankAccountLast4, added
// in migration AddPayoutPaymentDetails) — so they can be filtered and
// reported on, not just displayed. Notes stays what it always was: the
// free-text internal remark.

// Backend whitelist, verbatim from PayoutController.UpdateStatus:
//   { "Pending", "Verified", "Paid", "Rejected", "OnHold" }
// NOTE: "Approved" is NOT in that list — the page previously sent it from
// its Approve button, so every approve genuinely 400'd. Legacy maps its
// own "approved" label onto Verified, which is what's used here.
export const CLAIM_STATUSES = [
  { value: 'Pending',  label: 'Pending' },
  { value: 'Verified', label: 'Approved / Verified' },
  { value: 'Paid',     label: 'Paid' },
  { value: 'OnHold',   label: 'On Hold' },
  { value: 'Rejected', label: 'Rejected' },
]

const PAYMENT_MODES = ['NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque', 'Cash']

export default function ClaimStatusModal({ claim, onClose }: { claim: PayoutClaim; onClose: () => void }) {
  const qc = useQueryClient()
  // BUGFIX (confirmed real gap): this modal is also opened from the "My
  // Claims" tab's "View" button (PayoutPage.tsx), which any claimant sees
  // on their own claim — but it always rendered the full editable status
  // dropdown + payment fields + Save button, regardless of who opened it.
  // The real PATCH /{id}/status endpoint is
  // [Authorize(Roles = "Admin,Accounts")] (PayoutController), so a
  // Manager/Sales/Dsa/Partner claimant clicking "View" saw a form that looked
  // actionable but could only ever 403 on Save. Mirrored here so those
  // roles instead get a genuine read-only summary, matching the "View"
  // label they were shown.
  const role = useAuthStore(s => s.user?.role)
  const canEdit = role === 'Admin' || role === 'Accounts'
  const [status, setStatus] = useState(claim.status === 'Approved' ? 'Verified' : claim.status)
  const [remark, setRemark] = useState(claim.notes ?? '')
  // Seed from whatever was already recorded, so re-opening a paid claim
  // shows its real payment details rather than blank inputs.
  const [mode, setMode] = useState(claim.paymentMode || PAYMENT_MODES[0])
  const [utr, setUtr] = useState(claim.paymentReference ?? '')
  const [payDate, setPayDate] = useState(
    (claim.paymentDate ?? new Date().toISOString()).slice(0, 10))
  const [acc, setAcc] = useState(claim.bankAccountLast4 ?? '')
  const [error, setError] = useState('')

  const isPaid = status === 'Paid'
  // Legacy requires a UTR/reference before a claim can be marked Paid.
  const utrMissing = isPaid && !utr.trim()

  const save = useMutation({
    mutationFn: () => payoutApi.updateClaimStatus(
      claim.id,
      status,
      remark.trim() || undefined,
      isPaid
        ? { paymentMode: mode, paymentReference: utr.trim(), paymentDate: payDate, bankAccountLast4: acc || undefined }
        : undefined,
    ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payouts'] })
      onClose()
    },
    onError: (err: unknown) => {
      const d = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      setError(d?.message || d?.errors?.join(' ') || 'Could not update this claim.')
    },
  })

  // Read-only view for claimants who don't have status-update rights —
  // shows exactly what was recorded, with no controls that would 403.
  if (!canEdit) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Claim Details"
        size="md"
        className="sm:max-w-lg"
        footer={<Button size="sm" variant="secondary" onClick={onClose}>Close</Button>}
      >
        <div className="space-y-4">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-gray-500">Loan</span><span className="font-mono font-semibold">{claim.loanNumber}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Customer</span><span className="font-medium">{claim.customerName}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Claimed By</span><span>{claim.claimedBy}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Amount</span><span className="font-semibold text-green-700">{formatCurrency(claim.claimAmount)}</span></div>
            <div className="flex justify-between items-center"><span className="text-gray-500">Status</span><Badge variant="default">{claim.status}</Badge></div>
            <div className="flex justify-between"><span className="text-gray-500">Raised</span><span>{formatDate(claim.createdAt)}</span></div>
          </div>

          {claim.status === 'Paid' && (
            <div className="border border-gray-200 rounded-lg p-3 space-y-1 text-sm">
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Payment Details</p>
              <div className="flex justify-between"><span className="text-gray-500">Mode</span><span>{claim.paymentMode || '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">UTR / Reference</span><span className="font-mono">{claim.paymentReference || '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Payment Date</span><span>{claim.paymentDate ? formatDate(claim.paymentDate) : '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Bank A/C</span><span>{claim.bankAccountLast4 ? `****${claim.bankAccountLast4}` : '—'}</span></div>
            </div>
          )}

          {claim.notes && (
            <div>
              <p className="block text-sm font-medium text-gray-700 mb-1">Remark</p>
              <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 whitespace-pre-wrap">{claim.notes}</p>
            </div>
          )}
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Claim Status & Payment"
      size="md"
      className="sm:max-w-lg"
      footer={<>
        <Button size="sm" loading={save.isPending} disabled={utrMissing} onClick={() => save.mutate()}>Save</Button>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
      </>}
    >
      <div className="space-y-4">
        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          {/* Claim summary */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-gray-500">Loan</span><span className="font-mono font-semibold">{claim.loanNumber}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Customer</span><span className="font-medium">{claim.customerName}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Claimed By</span><span>{claim.claimedBy}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Amount</span><span className="font-semibold text-green-700">{formatCurrency(claim.claimAmount)}</span></div>
            <div className="flex justify-between items-center"><span className="text-gray-500">Current Status</span><Badge variant="default">{claim.status}</Badge></div>
            <div className="flex justify-between"><span className="text-gray-500">Raised</span><span>{formatDate(claim.createdAt)}</span></div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Status *</label>
            <select value={status} onChange={e => setStatus(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-efin-blue">
              {CLAIM_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          {/* Payment details — only when marking Paid, same as legacy. */}
          {isPaid && (
            <div className="border border-gray-200 rounded-lg p-3 space-y-3">
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Payment Details</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Payment Mode</label>
                  <select value={mode} onChange={e => setMode(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white">
                    {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Payment Date</label>
                  <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">UTR / Reference *</label>
                  <input value={utr} onChange={e => setUtr(e.target.value)} placeholder="Transaction reference"
                    className={`w-full border rounded-lg px-2.5 py-1.5 text-sm ${utrMissing ? 'border-red-300 bg-red-50' : 'border-gray-200'}`} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Bank A/C (last 4)</label>
                  <input value={acc} maxLength={4} onChange={e => setAcc(e.target.value.replace(/\D/g, ''))} placeholder="1234"
                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm" />
                </div>
              </div>
              {utrMissing && <p className="text-xs text-red-600">UTR / reference is required to mark a claim as Paid.</p>}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Internal Remark</label>
            <textarea value={remark} onChange={e => setRemark(e.target.value)} rows={3}
              placeholder="Optional note recorded against this claim"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-efin-blue" />
          </div>
      </div>
    </Modal>
  )
}
