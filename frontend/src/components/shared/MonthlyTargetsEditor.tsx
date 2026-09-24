import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  reportTargetsApi, nextTargetMonth, monthLabel, NEW_TARGET_DEFAULTS,
  type ReportTarget,
} from '@/api/reportTargetsApi'
import { useAuthStore } from '@/store/authStore'
import { SkeletonText } from '@/components/ui/Skeleton'
import { NumberInput } from '@/components/ui/NumberInput'
import { apiErrorMessage as errorMessage } from '@/utils/apiError'

// ── Edit Monthly Targets ────────────────────────────────────────────────
// Ports legacy's "🎯 Edit Monthly Targets" card (index.html:4756) and its
// handlers toggleTargetEditor / renderTargetEditorRows / addTargetEditorRow /
// updateTarget / deleteTarget (efin-app.js:12555-12673).
//
// Kept from legacy: collapsed by default, rows sorted by month, three numeric
// columns in the same order (Disb. Amount / Logins / Disbursals), a ✕ per row,
// an "Add Month" button that computes the next month and creates the row
// immediately (legacy does this deliberately so it survives navigating away).
//
// Changed from legacy on purpose: legacy debounced field edits and pushed each
// keystroke to the API. Here a row is edited locally and saved on blur, which
// is the same number of writes for a finished edit but cannot leave a
// half-typed number persisted if the user walks away mid-keystroke.

type Draft = Pick<ReportTarget, 'disbAmt' | 'loginCount' | 'disbCount'>


export default function MonthlyTargetsEditor() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  // Server gates every write with [Authorize(Roles = "Admin,Manager")];
  // legacy gates the same two roles in _rptCanEditTargets().
  const canEdit = user?.role === 'Admin' || user?.role === 'Manager'

  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})

  const { data: targets, isLoading } = useQuery({
    queryKey: ['report-targets-monthly'],
    queryFn: () => reportTargetsApi.getAll().then(r => r.data.data ?? []),
    enabled: open,
  })

  const rows = [...(targets ?? [])].sort((a, b) => a.targetMonth.localeCompare(b.targetMonth))

  const invalidate = () => qc.invalidateQueries({ queryKey: ['report-targets-monthly'] })
  const onError = (err: unknown) => setError(errorMessage(err, 'That change could not be saved.'))

  const create = useMutation({
    mutationFn: () => reportTargetsApi.create({
      targetMonth: nextTargetMonth(rows.map(r => r.targetMonth)),
      userId: null,
      teamId: null,
      ...NEW_TARGET_DEFAULTS,
    }),
    onSuccess: () => { setError(''); invalidate() },
    onError,
  })

  const update = useMutation({
    mutationFn: ({ id, values }: { id: number; values: Draft }) => reportTargetsApi.update(id, values),
    onSuccess: (_res, vars) => {
      setError('')
      setDrafts(d => { const { [vars.id]: _drop, ...rest } = d; return rest })
      invalidate()
    },
    onError,
  })

  const remove = useMutation({
    mutationFn: (id: number) => reportTargetsApi.delete(id),
    onSuccess: () => { setError(''); invalidate() },
    onError,
  })

  const valueOf = (t: ReportTarget, field: keyof Draft) =>
    drafts[t.id]?.[field] ?? t[field]

  const setField = (t: ReportTarget, field: keyof Draft, raw: string) => {
    const n = Number(raw)
    setDrafts(d => ({
      ...d,
      [t.id]: {
        disbAmt: d[t.id]?.disbAmt ?? t.disbAmt,
        loginCount: d[t.id]?.loginCount ?? t.loginCount,
        disbCount: d[t.id]?.disbCount ?? t.disbCount,
        [field]: Number.isFinite(n) ? n : 0,
      },
    }))
  }

  const commit = (t: ReportTarget) => {
    const draft = drafts[t.id]
    if (!draft) return
    const unchanged = draft.disbAmt === t.disbAmt
      && draft.loginCount === t.loginCount
      && draft.disbCount === t.disbCount
    if (unchanged) {
      setDrafts(d => { const { [t.id]: _drop, ...rest } = d; return rest })
      return
    }
    update.mutate({ id: t.id, values: draft })
  }

  const inputCls = 'w-full rounded-lg border border-token bg-surface2 px-2.5 py-1.5 text-[13px] tabular-nums disabled:opacity-60'

  return (
    <div className="bg-surface rounded-token border border-token">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <span className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>
          🎯 Edit Monthly Targets
        </span>
        <ChevronDown
          size={16}
          style={{ color: 'var(--text3)', transition: 'transform .2s', transform: open ? 'rotate(180deg)' : undefined }}
        />
      </button>

      {open && (
        <div className="px-5 pb-5">
          {!canEdit && (
            <div className="mb-3 rounded-lg border border-token bg-surface2 px-3 py-2 text-xs" style={{ color: 'var(--text3)' }}>
              You can view these targets. Only an Admin or Manager can change them.
            </div>
          )}

          {error && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
          )}

          {isLoading ? (
            <SkeletonText lines={3} className="py-3" />
          ) : rows.length === 0 ? (
            <p className="py-6 text-sm" style={{ color: 'var(--text3)' }}>
              No monthly targets set yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[560px]">
                <div className="grid grid-cols-[92px_1fr_1fr_1fr_36px] gap-2.5 pb-2 text-[10.5px] font-bold uppercase tracking-wide"
                  style={{ color: 'var(--text3)' }}>
                  <span>Month</span>
                  <span>Disb. Amount (₹)</span>
                  <span>Logins</span>
                  <span>Disbursals</span>
                  <span />
                </div>

                {rows.map(t => (
                  <div key={t.id} className="grid grid-cols-[92px_1fr_1fr_1fr_36px] gap-2.5 items-center mb-2">
                    <span className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>
                      {monthLabel(t.targetMonth)}
                    </span>
                    <NumberInput min="0" className={inputCls} disabled={!canEdit}
                      value={valueOf(t, 'disbAmt')}
                      onChange={e => setField(t, 'disbAmt', e.target.value)}
                      onBlur={() => commit(t)} />
                    <NumberInput min="0" className={inputCls} disabled={!canEdit}
                      value={valueOf(t, 'loginCount')}
                      onChange={e => setField(t, 'loginCount', e.target.value)}
                      onBlur={() => commit(t)} />
                    <NumberInput min="0" className={inputCls} disabled={!canEdit}
                      value={valueOf(t, 'disbCount')}
                      onChange={e => setField(t, 'disbCount', e.target.value)}
                      onBlur={() => commit(t)} />
                    {canEdit ? (
                      <button
                        title="Remove month"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (window.confirm(`Remove the target for ${monthLabel(t.targetMonth)}?`)) remove.mutate(t.id)
                        }}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    ) : <span />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {canEdit && (
            <Button size="sm" variant="secondary" className="mt-3"
              loading={create.isPending} disabled={create.isPending}
              onClick={() => create.mutate()}>
              <Plus size={14} className="mr-1" />Add Month
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
