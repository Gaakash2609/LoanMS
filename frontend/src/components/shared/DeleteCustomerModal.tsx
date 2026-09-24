import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { customersApi } from '@/api/customersApi'
import { loansApi } from '@/api/loansApi'
import { apiErrorMessage } from '@/utils/apiError'
import { useToastStore } from '@/store/toastStore'

// Statuses the server accepts for a permanent customer delete
// (CustomerDeletionService: every loan must be Closed or Rejected).
const DELETABLE = ['Closed', 'Rejected']

/**
 * Admin-only permanent delete of a customer (DELETE /api/customers/{id}).
 * Irreversible, so the confirmation is deliberate: it lists the customer's
 * loans, says exactly what will be erased, blocks up front when a loan is
 * still active (the server enforces the same rule), and only enables the
 * button once the customer's name is typed exactly.
 */
export function DeleteCustomerModal({ customerId, customerName, onClose, onDeleted }: {
  customerId: number
  customerName: string
  onClose: () => void
  onDeleted: () => void
}) {
  const qc = useQueryClient()
  const toast = useToastStore(s => s.show)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState('')
  const phrase = customerName.trim() || 'DELETE'

  const { data: loans, isLoading } = useQuery({
    queryKey: ['customer-delete-loans', customerId],
    queryFn: () => loansApi.getAllPages({ customerId }),
  })
  const active = (loans ?? []).filter(l => !DELETABLE.includes(l.status))

  const remove = useMutation({
    mutationFn: () => customersApi.delete(customerId),
    // The refusal reason is shown inside this dialog, so no duplicate toast.
    meta: { errorToast: false },
    // The server's success message is shown by the app-wide
    // toast; a partial storage failure additionally gets a warning here.
    onSuccess: res => {
      const failed = res.data.data?.storageFailures?.length ?? 0
      if (failed) toast(`${failed} stored file(s) could not be removed — ask an administrator to check the logs.`, 'warn')
      qc.invalidateQueries({ queryKey: ['loans'] })
      qc.invalidateQueries({ queryKey: ['loan-filter-options'] })
      onDeleted()
    },
    onError: err => setError(apiErrorMessage(err, 'The customer could not be deleted.')),
  })

  const canConfirm = !isLoading && active.length === 0 && typed.trim() === phrase && !remove.isPending

  return (
    <Modal
      onClose={onClose}
      dismissable={!remove.isPending}
      size="md"
      title={<span className="inline-flex items-center gap-2" style={{ color: 'var(--danger)' }}><Trash2 size={17} /> Delete customer permanently</span>}
      subtitle={customerName || `Customer #${customerId}`}
      footer={<>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={remove.isPending}>Cancel</Button>
        <Button variant="danger" size="sm" loading={remove.isPending} disabled={!canConfirm} onClick={() => { setError(''); remove.mutate() }}>
          Delete permanently
        </Button>
      </>}
    >
      <div className="space-y-4 text-sm" style={{ color: 'var(--text2)' }}>
        <div className="flex gap-2.5 rounded-xl px-3.5 py-3" style={{ background: 'rgba(227,30,37,.07)', border: '1.5px solid rgba(227,30,37,.25)' }}>
          <AlertTriangle size={18} className="shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
          <div>
            <p className="font-semibold" style={{ color: 'var(--danger)' }}>This cannot be undone.</p>
            <p className="mt-1">The customer and everything linked to them is erased from the system: all their loans,
              documents and stored files, CIBIL / bureau data, payout claims, timeline and status history, tasks,
              tickets, notifications and related audit entries. Nothing can be recovered afterwards.</p>
          </div>
        </div>

        <div>
          <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text3)' }}>Loans of this customer</p>
          {isLoading ? <p style={{ color: 'var(--text3)' }}>Loading…</p>
            : (loans ?? []).length === 0 ? <p style={{ color: 'var(--text3)' }}>No loans.</p>
            : <ul className="space-y-1.5">
                {(loans ?? []).map(l => (
                  <li key={l.id} className="flex items-center justify-between gap-2">
                    <span className="font-medium" style={{ color: 'var(--text)' }}>{l.loanNumber}</span>
                    <StatusBadge status={l.status} />
                  </li>
                ))}
              </ul>}
        </div>

        {active.length > 0 ? (
          <p className="rounded-xl px-3.5 py-2.5 font-medium" style={{ background: 'rgba(230,126,0,.10)', color: 'var(--warn)' }}>
            {active.length} loan(s) are still active. A customer can only be deleted when every loan is Closed or Rejected.
          </p>
        ) : (
          <label className="block">
            <span className="block mb-1.5">Type <b style={{ color: 'var(--text)' }}>{phrase}</b> to confirm:</span>
            <input
              value={typed}
              onChange={e => setTyped(e.target.value)}
              disabled={isLoading || remove.isPending}
              autoComplete="off"
              aria-label="Type the customer name to confirm"
              className="w-full rounded-lg border border-token px-3 py-2 text-sm focus:outline-none focus:ring-2"
              style={{ background: 'var(--surface)' }}
            />
          </label>
        )}

        {error && <p className="font-medium" style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>
    </Modal>
  )
}

export default DeleteCustomerModal
