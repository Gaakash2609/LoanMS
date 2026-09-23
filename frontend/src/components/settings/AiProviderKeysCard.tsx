import { useState, type ComponentType } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardHeader } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Save, Trash2, Sparkles, Bot } from 'lucide-react'
import { aiKeysApi, type AiKeyProvider, type AiKeyProviderStatus } from '@/api/aiKeysApi'

// ── AI Provider Keys — KYC Vision & AI Features (Settings → AI & KYC Vision) ─
// Ports legacy's "AI Provider Keys — KYC Vision & AI Features" panel onto
// React (efin-app.js:26406 _renderKycProxySettingsCard, :26356 _aiKeyRow,
// :26463 _aiKeySave, :26485 _aiKeyClear). This was the one piece of the AI
// tab SettingsPage.tsx had left unbuilt — the tab previously showed only the
// static AI:Enabled/AI:ApiKey module-status message with no way to actually
// configure a key from the UI. These two are real, working keys:
// SettingsController's ai-keys endpoints (GetAiKeys/SaveAiKey/ClearAiKey)
// store them encrypted in AppSettings and AiKeyStore reads them from there
// at request time to authenticate Gemini/OpenAI — same encryption purpose
// string on both ends, so a key saved here is usable immediately, no
// restart required. Whole controller is [Authorize(Roles = "Admin")].
//
// Visual pass (this revision): each provider is its own compact tile (icon
// badge + name + a Badge status pill) in a two-column grid, rather than
// legacy's stacked full-width rows with a heavy colored banner under each —
// same information, read at a glance instead of via a block of colored text.

const PROVIDERS: {
  providerKey: AiKeyProvider
  label: string
  docsUrl: string
  docsLabel: string
  icon: ComponentType<{ size?: number }>
  iconBg: string
  iconFg: string
}[] = [
  {
    providerKey: 'gemini', label: 'Gemini',
    docsUrl: 'https://aistudio.google.com/apikey', docsLabel: 'aistudio.google.com/apikey',
    icon: Sparkles, iconBg: 'rgba(124, 58, 237, .1)', iconFg: '#7c3aed',
  },
  {
    providerKey: 'openai', label: 'OpenAI',
    docsUrl: 'https://platform.openai.com/api-keys', docsLabel: 'platform.openai.com/api-keys',
    icon: Bot, iconBg: 'rgba(26, 115, 64, .1)', iconFg: 'var(--success)',
  },
]

export default function AiProviderKeysCard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['aiKeys'],
    queryFn: () => aiKeysApi.get().then(r => r.data.data),
  })

  return (
    <Card>
      <CardHeader
        title="AI Provider Keys"
        subtitle="Keys that power KYC Vision auto-fill and other AI features — Gemini is primary, with automatic failover to OpenAI. Saved encrypted on the server and used immediately, no restart needed."
      />
      {isLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <p className="text-sm text-red-600">Could not load AI key status. Try refreshing.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {PROVIDERS.map(p => (
            <ProviderKeyTile key={p.providerKey} {...p} status={data?.[p.providerKey]} />
          ))}
        </div>
      )}
    </Card>
  )
}

function ProviderKeyTile({
  providerKey, label, docsUrl, docsLabel, icon: Icon, iconBg, iconFg, status,
}: {
  providerKey: AiKeyProvider
  label: string
  docsUrl: string
  docsLabel: string
  icon: ComponentType<{ size?: number }>
  iconBg: string
  iconFg: string
  status?: AiKeyProviderStatus
}) {
  const qc = useQueryClient()
  const [value, setValue] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const configured = status?.configured ?? false

  const invalidate = () => qc.invalidateQueries({ queryKey: ['aiKeys'] })

  const save = useMutation({
    mutationFn: () => aiKeysApi.save(providerKey, value.trim()),
    onSuccess: (res) => {
      if (!res.data.success) { setMessage({ ok: false, text: res.data.message || 'Could not save key' }); return }
      setMessage({ ok: true, text: 'Key saved ✓' })
      setValue('')
      invalidate()
    },
    onError: (err: unknown) => {
      const res = (err as { response?: { data?: { message?: string } } }).response
      setMessage({ ok: false, text: res?.data?.message || 'Network error while saving key' })
    },
  })

  const clear = useMutation({
    mutationFn: () => aiKeysApi.clear(providerKey),
    onSuccess: (res) => {
      if (!res.data.success) { setMessage({ ok: false, text: res.data.message || 'Could not remove key' }); return }
      setMessage({ ok: true, text: 'Key removed' })
      invalidate()
    },
    onError: () => setMessage({ ok: false, text: 'Network error while removing key' }),
  })

  function handleSave() {
    if (!value.trim()) { setMessage({ ok: false, text: 'Please paste an API key first' }); return }
    setMessage(null)
    save.mutate()
  }

  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
      <div className="flex items-center gap-2.5 mb-3.5">
        <span className="w-9 h-9 rounded-[11px] flex items-center justify-center shrink-0" style={{ background: iconBg, color: iconFg }}>
          <Icon size={16} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-bold text-[color:var(--text)]">{label}</p>
          <p className="text-[11px] text-[color:var(--text3)]">API Key</p>
        </div>
        <Badge variant={configured ? 'success' : 'default'}>{configured ? 'Configured' : 'Not set'}</Badge>
      </div>

      <div className="flex gap-2 items-start mb-2.5">
        <div className="flex-1 min-w-0">
          <Input
            type="password"
            autoComplete="new-password"
            value={value}
            onChange={e => { setValue(e.target.value); if (message) setMessage(null) }}
            placeholder={configured ? 'Paste a new key to replace the saved one' : `Paste your ${label} API key`}
          />
        </div>
        <Button size="sm" loading={save.isPending} onClick={handleSave} title="Save key">
          <Save size={14} />
        </Button>
        {configured && (
          <Button size="sm" variant="secondary" loading={clear.isPending} onClick={() => clear.mutate()} title="Remove key">
            <Trash2 size={14} />
          </Button>
        )}
      </div>

      <p className="text-[11px] text-[color:var(--text3)] leading-relaxed">
        {configured
          ? <>Saved ({status?.masked}) — used on the server for AI requests.</>
          : <>No key saved yet. Get one at{' '}
              <a href={docsUrl} target="_blank" rel="noopener noreferrer" className="underline text-[color:var(--accent)]">{docsLabel}</a>.
            </>}
      </p>

      {message && (
        <p className={`text-xs mt-1.5 font-medium ${message.ok ? 'text-[color:var(--success)]' : 'text-red-600'}`}>{message.text}</p>
      )}
    </div>
  )
}
