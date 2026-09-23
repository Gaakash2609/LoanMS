import { useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { StatusBadge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { ErrorBanner } from '@/components/ui/States'
import { formatDateTime } from '@/utils/format'
import { stageBadgeClass, trackingStatusClass, routeDisplay, classifyComment, buildFormattedComment, PENDING_DOC_OPTIONS, type CommentType } from '@/utils/timelineFormat'
import { useHasPermission, useCurrentUserDept, useCurrentRole } from '@/hooks/usePermissions'
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react'

interface TrackingEntry {
  id: number; name: string; stage: string; assignedUser: string
  status: string; comment?: string; subNote?: string; createdAt: string
}

const STATUSES = ['Pending', 'In Progress', 'Complete', 'COMPLETE', 'On Hold', 'Cancelled']

const EMPTY_FORM = { name: '', stage: '', assignedUser: '', status: 'Pending', comment: '', subNote: '' }

// ── Comment cell ─────────────────────────────────────────────────────────────
// Renders classifyComment()'s result (from @/utils/timelineFormat) exactly as
// legacy's editableCell did (efin-app.js:3287-3323): a Pending-Docs block →
// badge + bulleted list (+ optional Note); Query / Task → badge with the
// header stripped; any other non-empty comment → a generic "💬 Update" badge.
// React escapes text by default, so legacy's escapeHtml() step is unneeded.
function CommentCell({ text }: { text: string }) {
  const info = classifyComment(text)
  if (info.type === 'pending') {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="trk-type-tag trk-type-pending">📋 Pending Docs</span>
        <div className="tracking-comment">
          {info.docItems.length > 0 && (
            <ul className="trk-doc-list">{info.docItems.map((l, i) => <li key={i}>{l}</li>)}</ul>
          )}
          {info.note && <div className="text-[11.5px] italic mt-1" style={{ color: 'var(--text3)' }}>{info.note}</div>}
        </div>
      </div>
    )
  }
  if (info.type === 'query') {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="trk-type-tag trk-type-query">❓ Query</span>
        <div className="tracking-comment">{info.body}</div>
      </div>
    )
  }
  if (info.type === 'task') {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="trk-type-tag trk-type-task">✅ Task</span>
        <div className="tracking-comment">{info.body}</div>
      </div>
    )
  }
  if (info.type === 'general') {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="trk-type-tag trk-type-general">💬 Update</span>
        <div className="tracking-comment">{info.body}</div>
      </div>
    )
  }
  return <div className="tracking-comment">{info.body}</div>
}

// ── Checks status row ────────────────────────────────────────────────────────
// Legacy's "Checks:" badge row at the top of renderTrackingSection
// (efin-app.js:3160-3169) — ✓ done / ⏳ pending for each verification flag.
// Hidden for partner / dsa_user, exactly like Vanilla. Uses the shared
// .check-badge tokens, which now match Vanilla's own app.css spec (done = red
// tint / accent2, pending = amber / warn) 1:1.
export interface TimelineChecks {
  documentChecked?: boolean
  incomeChecked?: boolean
  bankChecked?: boolean
  ecsReturn?: boolean
  fiReportChecked?: boolean
}
function ChecksRow({ checks }: { checks: TimelineChecks }) {
  const items: [string, boolean | undefined][] = [
    ['📄 Documents', checks.documentChecked],
    ['💰 Income', checks.incomeChecked],
    ['🏦 Bank Details', checks.bankChecked],
    ['🔁 ECS Return', checks.ecsReturn],
    ['📋 FI Report', checks.fiReportChecked],
  ]
  return (
    <div
      className="flex flex-wrap items-center gap-2 mb-4 px-[18px] py-3.5 rounded-xl"
      style={{ background: 'var(--accent-subtle)', border: '1.5px solid var(--border2)' }}
    >
      <span className="text-[10px] uppercase tracking-[0.12em] font-extrabold mr-1 self-center" style={{ color: 'var(--text3)' }}>
        Checks:
      </span>
      {items.map(([label, done]) => (
        <span key={label} className={`check-badge ${done ? 'check-done' : 'check-pending'}`}>
          {done ? '✓' : '⏳'} {label}
        </span>
      ))}
    </div>
  )
}

// ── Timeline table (the legacy .tracking-table, efin-app.js:3258-3343) ────────
// Date/Time · Task · Stage · User · Status · Comment · Sub Note, newest-first,
// with an Admin-only (canEdit/canDelete) Edit/Delete column. This is the single
// timeline presentation for BOTH the embedded loan-detail Timeline tab and the
// standalone /loans/:id/tracking route — Vanilla has one table, so React does
// too (the earlier standalone-only DataTable variant is removed).
function TrackingTable({
  entries, canEdit, canDelete, onEdit, onDelete,
}: {
  entries: TrackingEntry[]
  canEdit: boolean
  canDelete: boolean
  onEdit: (e: TrackingEntry) => void
  onDelete: (id: number) => void
}) {
  const showActions = canEdit || canDelete
  const colCount = 7 + (showActions ? 1 : 0)
  return (
    <div className="overflow-x-auto">
      <table className="tracking-table">
        <thead>
          <tr>
            <th>Date / Time</th><th>Task</th><th>Stage</th><th>User</th>
            <th>Status</th><th>Comment</th><th>Sub Note</th>
            {showActions && <th style={{ textAlign: 'center', width: 110 }}>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 && (
            <tr>
              <td colSpan={colCount} className="!text-center" style={{ color: 'var(--text3)', padding: '24px' }}>
                No tracking entries yet.
              </td>
            </tr>
          )}
          {entries.map(e => {
            const { comment, subNote } = routeDisplay(e)
            return (
              <tr key={e.id}>
                <td style={{ whiteSpace: 'nowrap', fontSize: 11, color: 'var(--text3)' }}>{formatDateTime(e.createdAt)}</td>
                <td style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{e.name}</td>
                <td><span className={`stage-badge ${stageBadgeClass(e.stage)}`}>{e.stage || '—'}</span></td>
                <td style={{ fontSize: 12 }}>{e.assignedUser || '—'}</td>
                <td><span className={`trk-status ${trackingStatusClass(e.status)}`}>{e.status || '—'}</span></td>
                <td><CommentCell text={comment} /></td>
                <td><div className="tracking-subnote">{subNote}</div></td>
                {showActions && (
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {canEdit && (
                      <button title="Edit entry" onClick={() => onEdit(e)}
                        className="p-1.5 rounded-md border text-[color:var(--accent)] hover:bg-[color:var(--accent-subtle)]"
                        style={{ borderColor: 'rgba(8,88,151,.25)' }}>
                        <Pencil size={13} />
                      </button>
                    )}
                    {canDelete && (
                      <button title="Delete entry" onClick={() => onDelete(e.id)}
                        className="p-1.5 rounded-md border text-[color:var(--danger)] hover:bg-[rgba(192,57,43,.08)] ml-1"
                        style={{ borderColor: 'rgba(192,57,43,.25)' }}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * `embeddedLoanId` lets LoanDetailPage render this inside its Timeline tab,
 * which is where legacy puts tracking (#tab-tracking-tab). The standalone
 * /loans/:loanId/tracking route still works unchanged when it is omitted.
 * `status` (embedded) is the loan status shown as the banner badge, matching
 * Vanilla's `badge-${app.status}` (efin-app.js:3155).
 * `checks` (embedded only) drives the legacy "Checks:" status row; pass null
 * to hide it (e.g. for partner / dsa_user, matching Vanilla).
 * `actionsSlot` (embedded only) holds the LEW / action / deviation / AI bars,
 * which legacy renders between the Checks row and the tracking table
 * (efin-app.js:3171-3256) — passed in so the tab keeps Vanilla's vertical
 * order (banner → checks → actions → table).
 * `locked` (embedded only) = loan is in a terminal stage; legacy then allows
 * only Admin to add a Manual Comment (efin-app.js:3218-3222).
 */
export default function TrackingPage({ embeddedLoanId, status, checks, actionsSlot, locked }: { embeddedLoanId?: number; status?: string; checks?: TimelineChecks | null; actionsSlot?: ReactNode; locked?: boolean } = {}) {
  const { loanId } = useParams<{ loanId: string }>()
  const id = embeddedLoanId ?? Number(loanId)
  const embedded = embeddedLoanId != null
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  // Manual-comment typing (legacy openTrackWizard's Comment Type selector):
  // for 'pending' the form.comment field is the Note and docChecks/customDocs
  // build the bulleted doc list; for query/task/general it's the plain body.
  const [commentType, setCommentType] = useState<CommentType>('general')
  const [docChecks, setDocChecks] = useState<string[]>([])
  const [customDocs, setCustomDocs] = useState('')

  const canPost = useHasPermission('canPostTracking')
  const canEdit = useHasPermission('canEditTracking')
  const canDelete = useHasPermission('canDeleteTracking')
  // Legacy sets a manual entry's stage to the poster's dept (rd.dept, the
  // readonly tm-stage field) — not a workflow-stage picker (efin-app.js:3459).
  const dept = useCurrentUserDept()
  // On a terminal loan legacy allows only Admin to post a Manual Comment
  // (efin-app.js:3218-3222); otherwise anyone with canPostTracking.
  const isAdmin = useCurrentRole() === 'Admin'
  const canAddEntry = canPost && (!locked || isAdmin)

  const { data: entries, isLoading, error } = useQuery({
    queryKey: ['tracking', id],
    queryFn: () => api.get<ApiResponse<TrackingEntry[]>>(`/api/loans/${id}/tracking`).then(r => r.data.data ?? []),
    enabled: id > 0,
  })

  const closeForm = () => {
    setShowForm(false); setEditingId(null); setForm(EMPTY_FORM)
    setCommentType('general'); setDocChecks([]); setCustomDocs('')
  }

  const openManualComment = () => {
    setEditingId(null); setForm({ ...EMPTY_FORM, stage: dept })
    setCommentType('general'); setDocChecks([]); setCustomDocs(''); setShowForm(true)
  }

  // Assemble the outgoing entry: the Comment field is run through
  // buildFormattedComment so a Pending/Query/Task type produces the same
  // prefixed string legacy's submitTracking wrote; Pending Docs routes its
  // whole block to Comment and clears Sub Note (legacy COMMENT-side).
  const buildPayload = () => {
    const docItems = commentType === 'pending'
      ? [...docChecks, ...customDocs.split(/[\n,]/).map(s => s.trim()).filter(Boolean)]
      : []
    return {
      ...form,
      comment: buildFormattedComment(commentType, form.comment, docItems),
      subNote: commentType === 'pending' ? '' : form.subNote,
    }
  }

  const add = useMutation({
    mutationFn: () => api.post(`/api/loans/${id}/tracking`, buildPayload()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tracking', id] }); closeForm() },
  })

  const save = useMutation({
    mutationFn: () => api.put(`/api/tracking/${editingId}`, buildPayload()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tracking', id] }); closeForm() },
  })

  const remove = useMutation({
    mutationFn: (entryId: number) => api.delete(`/api/tracking/${entryId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tracking', id] }),
  })

  const startEdit = (e: TrackingEntry) => {
    setEditingId(e.id)
    // Parse the stored comment back into (type + editable body/docs) so a typed
    // comment re-opens with the right selector state — inverse of buildPayload.
    const info = classifyComment(e.comment ?? '')
    if (info.type === 'pending') {
      const predefined = info.docItems.filter(d => (PENDING_DOC_OPTIONS as readonly string[]).includes(d))
      const custom = info.docItems.filter(d => !(PENDING_DOC_OPTIONS as readonly string[]).includes(d))
      setCommentType('pending'); setDocChecks(predefined); setCustomDocs(custom.join(', '))
      setForm({ name: e.name, stage: e.stage, assignedUser: e.assignedUser, status: e.status, comment: info.note ?? '', subNote: '' })
    } else if (info.type === 'query' || info.type === 'task') {
      setCommentType(info.type); setDocChecks([]); setCustomDocs('')
      setForm({ name: e.name, stage: e.stage, assignedUser: e.assignedUser, status: e.status, comment: info.body, subNote: e.subNote ?? '' })
    } else {
      setCommentType('general'); setDocChecks([]); setCustomDocs('')
      setForm({ name: e.name, stage: e.stage, assignedUser: e.assignedUser, status: e.status, comment: e.comment ?? '', subNote: e.subNote ?? '' })
    }
    setShowForm(true)
  }

  if (!id) return <div className="p-8 text-center text-[color:var(--text3)]">Invalid loan ID</div>

  // Newest first — matches legacy's [...app.tracking].reverse().
  const sorted = [...(entries ?? [])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return (
    <div className={embedded ? '' : 'max-w-5xl'}>
      {!embedded && (
        <div className="flex items-center gap-3 mb-6">
          <Link to={`/loans/${id}`} className="p-2 rounded-lg hover:bg-[color:var(--surface2)] text-[color:var(--text3)]"><ArrowLeft size={18} /></Link>
          <div>
            <h1 className="text-xl font-bold text-[color:var(--text)]">Tracking — Loan #{id}</h1>
            <p className="text-sm text-[color:var(--text3)]">Workflow stage tracking</p>
          </div>
        </div>
      )}

      {/* Header banner — legacy's tracking-header gradient card: 🔵 icon,
          "Loan Timeline" title + subtitle, then the loan status badge and the
          entry count (efin-app.js:3148-3158). Rebuilt with the app's own
          theme-aware tokens instead of the legacy inline hex values, so it
          keeps the same blue treatment in light mode and still supports dark. */}
      <div
        className="rounded-2xl border p-4 md:p-5 mb-4 flex items-center gap-3.5"
        style={{
          background: 'linear-gradient(135deg, var(--accent-subtle), var(--surface2))',
          borderColor: 'rgba(8,88,151,.2)',
        }}
      >
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 text-[20px]"
          style={{ background: 'linear-gradient(135deg, var(--accent-light), var(--accent-dark))', boxShadow: 'var(--shadow-accent)' }}
        >
          🔵
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-[15px] md:text-base text-[color:var(--text)]" style={{ fontFamily: 'var(--font-head)' }}>Loan Timeline</h3>
          <p className="text-xs text-[color:var(--text3)] mt-0.5">Full audit trail of this application</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {status && <StatusBadge status={status} />}
          <span
            className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
            style={{ color: 'var(--accent)', background: 'var(--surface)', border: '1px solid var(--border2)' }}
          >
            {entries?.length ?? 0} entries
          </span>
        </div>
      </div>

      {/* Checks status row (embedded only) — legacy's "Checks:" badge bar. */}
      {embedded && checks && <ChecksRow checks={checks} />}

      {/* LEW / action / deviation / AI bars — legacy places these between the
          Checks row and the tracking table (efin-app.js:3171-3256). */}
      {embedded && actionsSlot}

      {/* Manual Comment — legacy's ✏️ Manual Comment button, the right-most
          action just above the tracking table (efin-app.js:3221/3254). On a
          terminal loan only Admin may add one (canAddEntry gate). */}
      {canAddEntry && !showForm && (
        <div className="flex justify-end mb-3">
          <Button size="sm" variant="ghost" onClick={openManualComment}>✏️ Manual Comment</Button>
        </div>
      )}

      {showForm && (
        <Card className="mb-4">
          <CardHeader title={editingId ? 'Edit Timeline Entry' : 'Add Tracking Entry'} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <Input label="Task Name *" value={form.name} placeholder="e.g. EFIN-KYC Verification"
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            <Input label="Assigned User" value={form.assignedUser} placeholder="Team member name"
              onChange={e => setForm(p => ({ ...p, assignedUser: e.target.value }))} />
            <Input label="Stage" value={form.stage} placeholder="e.g. Login Dep"
              onChange={e => setForm(p => ({ ...p, stage: e.target.value }))} />
            <div className="space-y-1">
              <label className="block text-sm font-medium text-[color:var(--text2)]">Status</label>
              <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} className="efin-input">
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Comment Type selector — legacy openTrackWizard's .tm-type-btn row
              (index.html:6344). Drives which fields show and how the comment
              string is formatted (buildFormattedComment). */}
          <div className="mb-3">
            <label className="block text-sm font-medium text-[color:var(--text2)] mb-1.5">Comment Type</label>
            <div className="flex flex-wrap gap-2">
              {([['general', '💬 General'], ['query', '❓ Query / Issue'], ['pending', '📋 Pending Docs'], ['task', '✅ Task Update']] as [CommentType, string][]).map(([t, label]) => (
                <button key={t} type="button" onClick={() => setCommentType(t)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${commentType === t ? 'bg-[color:var(--accent)] text-white border-[color:var(--accent)]' : 'border-[color:var(--border2)] text-[color:var(--text2)]'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {commentType === 'pending' && (
            <div className="mb-3 rounded-lg p-3" style={{ background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.25)' }}>
              <div className="text-[11.5px] font-bold mb-2" style={{ color: '#92400e' }}>📋 Select Pending Documents</div>
              <div className="flex flex-wrap gap-2 mb-2">
                {PENDING_DOC_OPTIONS.map(doc => {
                  const on = docChecks.includes(doc)
                  return (
                    <button key={doc} type="button"
                      onClick={() => setDocChecks(cur => on ? cur.filter(d => d !== doc) : [...cur, doc])}
                      className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${on ? 'bg-[color:var(--accent)] text-white border-[color:var(--accent)]' : 'border-[color:var(--border)] text-[color:var(--text2)]'}`}>
                      {on ? '✓ ' : ''}{doc}
                    </button>
                  )
                })}
              </div>
              <Input label="Other documents (comma-separated)" value={customDocs} placeholder="e.g. GST Returns, Trade License"
                onChange={e => setCustomDocs(e.target.value)} />
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <Input
              label={commentType === 'pending' ? 'Note' : 'Comment'}
              value={form.comment}
              placeholder={
                commentType === 'pending' ? 'Optional note — why the docs are needed'
                : commentType === 'query' ? 'Clearly state the issue or question'
                : commentType === 'task' ? 'Describe the action taken or next step'
                : 'Optional note'
              }
              onChange={e => setForm(p => ({ ...p, comment: e.target.value }))} />
            {commentType !== 'pending' && (
              <Input label="Sub Note" value={form.subNote} placeholder="Additional detail"
                onChange={e => setForm(p => ({ ...p, subNote: e.target.value }))} />
            )}
          </div>
          {(add.isError || save.isError) && <ErrorBanner error={add.error ?? save.error} className="mb-3" />}
          <div className="flex justify-end gap-2">
            <Button size="sm" loading={add.isPending || save.isPending}
              onClick={() => editingId ? save.mutate() : add.mutate()} disabled={!form.name.trim()}>
              Save
            </Button>
            <Button size="sm" variant="secondary" onClick={closeForm}>Cancel</Button>
          </div>
        </Card>
      )}

      <Card padding={false}>
        <div className="p-[22px]">
          {isLoading ? (
            <LoadingSpinner />
          ) : error ? (
            <ErrorBanner error={error} />
          ) : (
            <TrackingTable
              entries={sorted}
              canEdit={canEdit}
              canDelete={canDelete}
              onEdit={startEdit}
              onDelete={entryId => { if (confirm('Delete this tracking entry? This cannot be undone.')) remove.mutate(entryId) }}
            />
          )}
        </div>
      </Card>
    </div>
  )
}
