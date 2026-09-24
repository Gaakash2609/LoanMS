import { useState } from 'react'
import { SkeletonText } from '@/components/ui/Skeleton'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, RotateCcw, Save } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { emailTemplatesApi, type EmailTemplateOverride } from '@/api/emailTemplatesApi'
import {
  EMAIL_TEMPLATE_DEFS, EMAIL_TEMPLATE_DEFAULTS, BADGE_LABEL,
  type TemplateBadge,
} from '@/constants/emailTemplates'
import { useAuthStore } from '@/store/authStore'
import { apiErrorMessage as errorMessage } from '@/utils/apiError'

// ── Email Templates ─────────────────────────────────────────────────────
// Ports legacy's Settings → Templates panel (stgRenderAllTemplates /
// stgToggleTplRow / stgSaveTpl / stgResetTpl, efin-app.js:36746-36890).
//
// Kept from legacy: the same nine rows in the same order, collapsed
// accordion rows that expand on click, the per-row badge, the subject input
// + body textarea seeded from override-or-default, the placeholder-token
// hint line, and Save / Reset per row. Reset restores the built-in text in
// the editor *and* clears the server override, exactly as legacy does.
//
// "Deal Confirmation" is rendered but not editable here — legacy marks it
// IN MODAL because its content is authored inside the Deal Confirmation
// modal on each application, not in Settings.

const BADGE_CLASS: Record<TemplateBadge, string> = {
  auto:   'bg-efin-blue/10 text-efin-blue border-efin-blue/20',
  admin:  'bg-purple-50 text-purple-700 border-purple-200',
  manual: 'bg-amber-50 text-amber-700 border-amber-200',
  modal:  'bg-gray-100 text-gray-500 border-gray-200',
}


function TemplateRow({
  def, override, canEdit,
}: {
  def: typeof EMAIL_TEMPLATE_DEFS[number]
  override?: EmailTemplateOverride
  canEdit: boolean
}) {
  const qc = useQueryClient()
  const dflt = EMAIL_TEMPLATE_DEFAULTS[def.key]
  const isModal = def.badge === 'modal'

  const [open, setOpen] = useState(false)
  const [subject, setSubject] = useState(override?.subject ?? dflt?.subject ?? '')
  const [body, setBody] = useState(override?.body ?? dflt?.body ?? '')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  // Tracks what the server currently holds, so the row can say whether it is
  // running the default or a customised copy without a refetch round-trip.
  const [customised, setCustomised] = useState(!!override)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['email-templates'] })

  const save = useMutation({
    mutationFn: () => emailTemplatesApi.save(def.key, { subject: subject.trim(), body: body.trim() }),
    onSuccess: () => {
      setError(''); setSaved(true); setCustomised(true)
      setTimeout(() => setSaved(false), 2500)
      invalidate()
    },
    onError: (err: unknown) => setError(errorMessage(err, 'Could not save this template.')),
  })

  const reset = useMutation({
    mutationFn: () => emailTemplatesApi.reset(def.key),
    onSuccess: () => {
      // Legacy puts the built-in text back in the editor as well as clearing
      // the override, so the row immediately shows what will now be sent.
      setSubject(dflt?.subject ?? '')
      setBody(dflt?.body ?? '')
      setError(''); setCustomised(false)
      invalidate()
    },
    onError: (err: unknown) => setError(errorMessage(err, 'Could not reset this template.')),
  })

  // The server requires both fields; block the call rather than let it 400.
  const canSave = subject.trim() !== '' && body.trim() !== ''

  return (
    <div className="border border-token rounded-[13px] overflow-hidden mb-2.5">
      <button
        type="button"
        onClick={() => { if (!isModal) setOpen(o => !o) }}
        aria-expanded={isModal ? undefined : open}
        disabled={isModal}
        className={`w-full flex items-center gap-3 px-4 py-3.5 text-left bg-surface2 ${isModal ? 'cursor-default' : 'hover:brightness-[.98]'}`}
      >
        <span className="w-9 h-9 rounded-[9px] bg-surface flex items-center justify-center text-[17px] shrink-0 border border-token">
          {def.icon}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[13.5px] font-bold" style={{ color: 'var(--text)' }}>{def.title}</span>
          <span className="block text-[11.5px] truncate mt-0.5" style={{ color: 'var(--text3)' }}>{def.sub}</span>
        </span>
        {customised && !isModal && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-green-50 text-green-700 border-green-200 whitespace-nowrap">
            CUSTOMISED
          </span>
        )}
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border whitespace-nowrap ${BADGE_CLASS[def.badge]}`}>
          {BADGE_LABEL[def.badge]}
        </span>
        {!isModal && (
          <ChevronDown size={15} style={{ color: 'var(--text3)', transition: 'transform .2s', transform: open ? 'rotate(180deg)' : undefined }} />
        )}
      </button>

      {open && !isModal && (
        <div className="px-4 py-4 border-t border-token space-y-3">
          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text3)' }}>
              Subject
            </label>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              disabled={!canEdit}
              className="w-full border border-token rounded-lg px-3 py-2 text-sm bg-surface disabled:bg-surface2 disabled:text-gray-400 focus:outline-none focus:ring-2 focus:ring-efin-blue"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text3)' }}>
              Body
            </label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              disabled={!canEdit}
              rows={10}
              className="w-full border border-token rounded-lg px-3 py-2 text-sm font-mono resize-y bg-surface disabled:bg-surface2 disabled:text-gray-400 focus:outline-none focus:ring-2 focus:ring-efin-blue"
            />
          </div>

          {def.vars && (
            <p className="text-[11px]" style={{ color: 'var(--text3)' }}>
              Available placeholders: <span className="font-mono">{def.vars}</span>
            </p>
          )}

          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <Button size="sm" loading={save.isPending} disabled={!canSave || save.isPending} onClick={() => save.mutate()}>
                <Save size={14} className="mr-1" />Save Template
              </Button>
              <Button size="sm" variant="secondary" loading={reset.isPending} disabled={reset.isPending}
                onClick={() => {
                  if (window.confirm(`Reset "${def.title}" to its default text?`)) reset.mutate()
                }}>
                <RotateCcw size={14} className="mr-1" />Reset to default
              </Button>
              {saved && <span className="text-xs font-semibold text-green-600">✓ Saved</span>}
              {!canSave && <span className="text-[11px] text-amber-600">Subject and body are both required.</span>}
            </div>
          ) : (
            <p className="text-[11px]" style={{ color: 'var(--text3)' }}>
              Only an administrator can change email templates.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default function EmailTemplatesCard() {
  const user = useAuthStore(s => s.user)
  // Writes are Admin-only server-side; a Manager can still read the templates.
  const canEdit = user?.role === 'Admin'

  const { data: overrides, isLoading, error } = useQuery({
    queryKey: ['email-templates'],
    queryFn: () => emailTemplatesApi.getAll().then(r => r.data.data ?? []),
  })

  const byKey = new Map((overrides ?? []).map(o => [o.templateKey, o]))

  return (
    <Card>
      <div className="mb-4">
        <h3 className="text-base font-semibold" style={{ color: 'var(--text)' }}>Email Templates</h3>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text3)' }}>
          The messages the system sends on user invites, password resets and loan status changes.
        </p>
      </div>

      {error != null && (
        <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {errorMessage(error, 'Could not load email templates.')}
        </div>
      )}

      {isLoading ? (
        <SkeletonText lines={4} className="py-3" />
      ) : (
        <div>
          {EMAIL_TEMPLATE_DEFS.map(def => (
            <TemplateRow
              // Remount when the stored override changes so the editor seeds
              // from the newest server value rather than keeping stale text.
              key={`${def.key}:${byKey.get(def.key)?.updatedAt ?? 'default'}`}
              def={def}
              override={byKey.get(def.key)}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}
    </Card>
  )
}
