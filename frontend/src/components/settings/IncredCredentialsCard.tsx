import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardHeader } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { incredCredentialsApi, type IncredCredentialsResponse } from '@/api/incredCredentialsApi'

// ── InCred API Credentials (Settings → System & Data) ───────────────────────
// Ports the legacy InCred credential panel — efin-app.js:13947 (save),
// :13968 (clear) and :14076 (load) — onto the existing
// /api/settings/incred-credentials endpoints. No new backend, no new library.
//
// Two deliberate differences from legacy, both because legacy's behaviour there
// was demo/static-mode scaffolding rather than real product behaviour:
//
//  1. Legacy kept a hardcoded, obfuscated built-in credential set (the _ia/_ib/
//     _ic byte arrays at efin-app.js:14060) and mirrored every save into
//     localStorage, treating the server call as optional ("server not available
//     — localStorage save is sufficient"). This card is server-only: the server
//     is the single source of truth, and a failed save is reported as a failure
//     rather than silently "saved locally".
//
//  2. Legacy short-circuited when the secret field was left masked — it showed
//     "Credentials confirmed ✓" and skipped the request entirely, so an edit to
//     the Base URL was silently discarded. The endpoint requires all three
//     fields, so this card asks for the secret to be re-entered instead.
//
// Role gate matches the backend exactly: Admin only. (Legacy's client-side
// check also allowed product_team, but the controller has always been
// [Authorize(Roles = "Admin")], so that branch could only ever have produced a
// 403 — it is not reproduced.)

const EMPTY = { baseUrl: '', clientId: '', clientSecret: '' }

export default function IncredCredentialsCard() {
  const qc = useQueryClient()
  const [form, setForm] = useState(EMPTY)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['incredCredentials'],
    queryFn: () => incredCredentialsApi.get().then(r => r.data.data as IncredCredentialsResponse),
  })

  // Populate from the server on load / after any mutation. The secret is never
  // returned, so its input always starts empty and shows the saved-state hint.
  useEffect(() => {
    if (!data) return
    setForm({ baseUrl: data.baseUrl ?? '', clientId: data.clientId ?? '', clientSecret: '' })
  }, [data])

  const configured = data?.configured ?? false

  function validate(): string | null {
    if (!form.baseUrl.trim()) return 'Base URL is required'
    try { new URL(form.baseUrl.trim()) } catch { return 'Base URL is not a valid URL' }
    if (!form.clientId.trim()) return 'Client ID is required'
    if (!form.clientSecret.trim()) {
      return configured
        ? 'Re-enter the Client Secret to save — the server never sends the saved secret back, so it cannot be reused here.'
        : 'Client Secret is required'
    }
    return null
  }

  const save = useMutation({
    mutationFn: () => incredCredentialsApi.save({
      baseUrl: form.baseUrl.trim(),
      clientId: form.clientId.trim(),
      clientSecret: form.clientSecret,
    }),
    onSuccess: (res) => {
      if (!res.data.success) { setMessage({ ok: false, text: res.data.message || 'Save failed' }); return }
      setMessage({ ok: true, text: 'InCred credentials saved ✓ — stored encrypted on the server.' })
      setForm(f => ({ ...f, clientSecret: '' }))
      qc.invalidateQueries({ queryKey: ['incredCredentials'] })
    },
    // A 400 carries the server's own validation text in `errors`; a 500 carries
    // nothing useful, so it must not be reported as "could not reach the
    // server" — the server answered, it just failed. Only a genuinely absent
    // response is a connectivity problem.
    onError: (err) => {
      const res = (err as { response?: { status?: number; data?: { message?: string; errors?: string[] } } }).response
      if (!res) { setMessage({ ok: false, text: 'Could not reach the server to save credentials.' }); return }
      const body = res.data
      const detail = body?.errors?.join(' · ') || body?.message
      setMessage({
        ok: false,
        text: detail || `Server rejected the save (HTTP ${res.status ?? '?'}). Check the API logs for details.`,
      })
    },
  })

  const clear = useMutation({
    mutationFn: () => incredCredentialsApi.clear(),
    onSuccess: () => {
      setMessage({ ok: true, text: 'InCred credentials cleared — the integration is now disconnected.' })
      setForm(EMPTY)
      setConfirmingClear(false)
      qc.invalidateQueries({ queryKey: ['incredCredentials'] })
    },
    onError: (err) => {
      setConfirmingClear(false)
      const res = (err as { response?: { status?: number } }).response
      setMessage({
        ok: false,
        text: res
          ? `Server rejected the clear (HTTP ${res.status ?? '?'}).`
          : 'Could not reach the server to clear credentials.',
      })
    },
  })

  function handleSave() {
    const err = validate()
    if (err) { setMessage({ ok: false, text: err }); return }
    setMessage(null)
    save.mutate()
  }

  const set = (k: keyof typeof EMPTY, v: string) => {
    setForm(f => ({ ...f, [k]: v }))
    if (message) setMessage(null)
  }

  return (
    <Card>
      <CardHeader
        title="InCred Credentials"
        subtitle="API connection used by the InCred integration. The secret is encrypted before it is stored and is never sent back to the browser."
        action={
          configured
            ? <Badge variant="success">Configured</Badge>
            : <Badge variant="default">Not configured</Badge>
        }
      />

      {isLoading ? <LoadingSpinner /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Input
                label="Base URL *"
                value={form.baseUrl}
                onChange={e => set('baseUrl', e.target.value)}
                placeholder="https://api.incred.com"
              />
            </div>
            <Input
              label="Client ID *"
              value={form.clientId}
              onChange={e => set('clientId', e.target.value)}
              placeholder="Partner / client identifier"
            />
            <Input
              label="Client Secret *"
              type="password"
              autoComplete="new-password"
              value={form.clientSecret}
              onChange={e => set('clientSecret', e.target.value)}
              placeholder={configured ? '•••••••••••••••• (saved — retype to change)' : 'Enter the client secret'}
              hint={configured
                ? 'A secret is already saved. Leave blank only if you are not saving; any save requires it to be re-entered.'
                : undefined}
            />
          </div>

          {message && (
            <p className={`text-xs ${message.ok ? 'text-green-600' : 'text-red-600'}`}>{message.text}</p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" loading={save.isPending} onClick={handleSave}>
              {configured ? 'Update Credentials' : 'Save Credentials'}
            </Button>

            {configured && !confirmingClear && (
              <Button size="sm" variant="danger" onClick={() => { setMessage(null); setConfirmingClear(true) }}>
                Clear
              </Button>
            )}

            {/* Inline confirm — same intent as legacy's confirm() at
                efin-app.js:13964, without a blocking browser dialog. */}
            {confirmingClear && (
              <>
                <span className="text-xs text-gray-600">
                  Clear InCred credentials? This disconnects the integration.
                </span>
                <Button size="sm" variant="danger" loading={clear.isPending} onClick={() => clear.mutate()}>
                  Yes, clear
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setConfirmingClear(false)}>
                  Cancel
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
