import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Send, MessageSquare, Activity, Ticket as TicketIcon } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { ticketsApi, type Ticket } from '@/api/ticketsApi'
import { formatDateTime } from '@/utils/format'
import { useAuthStore } from '@/store/authStore'
import { SkeletonText } from '@/components/ui/Skeleton'

// ── Ticket detail: comments/activity thread + status actions ────────────
// Ports legacy's tkOpenDetail comments panel plus its Resolve / Reopen
// actions. All four routes already existed on TicketsController with no
// React caller: GET/POST /{id}/comments, PATCH /{id}/reopen, and PUT /{id}
// (which is how "Resolve" is meant to be sent — see the controller's own
// comment; it rejects "Closed" there so Close keeps its Admin/Manager rule).
const STATUS_VARIANTS: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  Open: 'warning', 'In Progress': 'info', Resolved: 'success', Closed: 'default',
}

export default function TicketDetailModal({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')

  // Close is Admin/Manager only on the backend — don't show a button that
  // would only ever 403.
  const canClose = ['Admin', 'Manager'].includes(user?.role ?? '')

  const { data: comments, isLoading } = useQuery({
    queryKey: ['ticket-comments', ticket.id],
    queryFn: () => ticketsApi.getComments(ticket.id).then(r => r.data.data ?? []),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ticket-comments', ticket.id] })
    qc.invalidateQueries({ queryKey: ['tickets'] })
  }
  const onError = (err: unknown) => {
    const d = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
    setError(d?.message || d?.errors?.join(' ') || 'That action could not be completed.')
  }

  const postComment = useMutation({
    mutationFn: () => ticketsApi.addComment(ticket.id, comment.trim()),
    onSuccess: () => { setError(''); setComment(''); invalidate() },
    onError,
  })

  const setStatus = useMutation({
    mutationFn: (s: 'Open' | 'In Progress' | 'Resolved') => ticketsApi.setStatus(ticket.id, s),
    onSuccess: () => { setError(''); invalidate() },
    onError,
  })

  const close = useMutation({
    mutationFn: () => ticketsApi.close(ticket.id),
    onSuccess: () => { setError(''); invalidate() },
    onError,
  })

  const reopen = useMutation({
    mutationFn: () => ticketsApi.reopen(ticket.id),
    onSuccess: () => { setError(''); invalidate() },
    onError,
  })

  const isClosed = ticket.status === 'Closed'
  const busy = setStatus.isPending || close.isPending || reopen.isPending

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      className="sm:max-w-2xl"
      headerClassName="modal-header-gradient items-start"
      title={
        <div className="flex items-start gap-3">
          <div className="ticket-card-icon shrink-0"><TicketIcon size={19} /></div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-base font-bold" style={{ color: 'var(--text)' }}>{ticket.title}</span>
              <Badge variant={STATUS_VARIANTS[ticket.status] ?? 'default'}>{ticket.status}</Badge>
              <Badge variant={ticket.priority === 'High' ? 'danger' : ticket.priority === 'Medium' ? 'warning' : 'default'}>
                {ticket.priority}
              </Badge>
            </div>
            <p className="text-xs font-normal" style={{ color: 'var(--text3)' }}>
              Raised by {ticket.createdBy ?? '—'}
              {ticket.assignedTo ? ` · Assigned to ${ticket.assignedTo}` : ''}
              {ticket.loanId ? ` · Loan #${ticket.loanId}` : ''}
            </p>
          </div>
        </div>
      }
      footer={<>
        {isClosed ? (
          <Button size="sm" loading={reopen.isPending} disabled={busy} onClick={() => reopen.mutate()}>
            Reopen
          </Button>
        ) : (
          <>
            {ticket.status !== 'In Progress' && (
              <Button size="sm" variant="secondary" disabled={busy}
                onClick={() => setStatus.mutate('In Progress')}>Mark In Progress</Button>
            )}
            {ticket.status !== 'Resolved' && (
              <Button size="sm" disabled={busy} onClick={() => setStatus.mutate('Resolved')}>Resolve</Button>
            )}
            {canClose && (
              <Button size="sm" variant="danger" loading={close.isPending} disabled={busy}
                onClick={() => close.mutate()}>Close</Button>
            )}
          </>
        )}
        <Button size="sm" variant="secondary" onClick={onClose} className="ml-auto">Close window</Button>
      </>}
    >
      <div className="space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          {ticket.description && (
            <div className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 whitespace-pre-wrap">
              {ticket.description}
            </div>
          )}

          <div>
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Notes &amp; Activity</p>
            {isLoading ? (
              <SkeletonText lines={3} className="py-2" />
            ) : (comments ?? []).length === 0 ? (
              <p className="text-sm text-gray-400 py-4">No notes yet.</p>
            ) : (
              <div className="space-y-2.5">
                {(comments ?? []).map(c => {
                  const isActivity = c.type === 'Activity'
                  const initials = (c.user ?? '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
                  return (
                    <div key={c.id} className={`comment-card ${isActivity ? 'is-activity' : 'is-note'}`}>
                      {isActivity
                        ? <span className="comment-avatar shrink-0" style={{ background: 'var(--surface3)', color: 'var(--text3)' }}><Activity size={14} /></span>
                        : <span className="comment-avatar shrink-0">{initials}</span>}
                      <div className="min-w-0 flex-1">
                        <p className={isActivity ? 'text-xs italic' : 'text-sm'} style={{ color: isActivity ? 'var(--text3)' : 'var(--text)' }}>{c.content}</p>
                        <p className="text-[11px] mt-1 flex items-center gap-1.5" style={{ color: 'var(--text3)' }}>
                          {!isActivity && <MessageSquare size={11} />}<span className="font-semibold">{c.user}</span> · {formatDateTime(c.createdAt)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Add a note */}
          <div className="flex gap-2 pt-1 border-t border-gray-100">
            <input
              value={comment}
              onChange={e => setComment(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && comment.trim()) postComment.mutate() }}
              placeholder="Add a note…"
              className="efin-input flex-1 mt-3"
            />
            <Button size="sm" loading={postComment.isPending} disabled={!comment.trim()}
              onClick={() => postComment.mutate()} className="mt-3">
              <Send size={13} />
            </Button>
          </div>
      </div>
    </Modal>
  )
}
