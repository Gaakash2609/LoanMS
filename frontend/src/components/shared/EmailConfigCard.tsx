import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { emailConfigApi, type EmailConfigRequest } from '@/api/emailConfigApi'
import { SkeletonText } from '@/components/ui/Skeleton'

const EMPTY_FORM: EmailConfigRequest = {
  provider: 'smtp', fromEmail: '', name: '', cc: '', replyTo: '', signature: '',
  apiKey: '', smtpUser: '', smtpPass: '', invEnabled: true, invSubject: '', invBody: '',
}

// ── Mail & Email Provider Configuration (Settings → Mail & Email) ──────────
// Reproduces legacy's stgSaveMailConfig/_stgPaintMailForm/stgLoadMailConfig
// exactly: two providers only — Gmail SMTP (fixed smtp.gmail.com:587, not a
// free-form SMTP host, matching legacy's hardcoded payload) or Brevo API
// key — plus From/Name/CC/Reply-To/Signature and invitation-email
// preferences. Secrets are never round-tripped: GET returns only
// hasApiKey/hasSmtpPass + a masked placeholder, and if the admin doesn't
// retype a secret field, the masked placeholder is sent back unchanged so
// the backend keeps the existing value (matches SettingsController.IsMasked).
export default function EmailConfigCard() {
  const qc = useQueryClient()
  const [form, setForm] = useState<EmailConfigRequest>(EMPTY_FORM)
  const [configured, setConfigured] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['emailConfig'],
    queryFn: () => emailConfigApi.get().then(r => r.data.data),
  })

  useEffect(() => {
    if (!data) return
    setConfigured(!!data.configured)
    if (!data.configured) { setForm(EMPTY_FORM); return }
    setForm({
      provider: data.provider === 'brevo' ? 'brevo' : 'smtp',
      fromEmail: data.fromEmail || '',
      name: data.name || '',
      cc: data.cc || '',
      replyTo: data.replyTo || '',
      signature: data.signature || '',
      apiKey: data.apiKeyMasked || '',
      smtpUser: data.smtpUser || '',
      smtpPass: data.smtpPassMasked || '',
      invEnabled: data.invEnabled ?? true,
      invSubject: data.invSubject || '',
      invBody: data.invBody || '',
    })
  }, [data])

  const save = useMutation({
    mutationFn: () => {
      const payload: EmailConfigRequest = {
        ...form,
        // Legacy always sends Gmail's fixed host/port for the smtp
        // provider — this UI only supports Gmail SMTP, not arbitrary hosts.
        smtpHost: form.provider === 'smtp' ? 'smtp.gmail.com' : undefined,
        smtpPort: form.provider === 'smtp' ? '587' : undefined,
        smtpUseSsl: false,
      }
      return emailConfigApi.save(payload)
    },
    onSuccess: (res) => {
      if (!res.data.success) { setMessage({ ok: false, text: res.data.message || 'Save failed' }); return }
      setMessage({ ok: true, text: 'Settings saved ✓ — now live for every email the app sends.' })
      qc.invalidateQueries({ queryKey: ['emailConfig'] })
    },
    onError: () => setMessage({ ok: false, text: 'Could not reach the server to save settings.' }),
  })

  const clear = useMutation({
    mutationFn: () => emailConfigApi.clear(),
    onSuccess: () => {
      setMessage({ ok: true, text: 'Email configuration cleared.' })
      setForm(EMPTY_FORM)
      qc.invalidateQueries({ queryKey: ['emailConfig'] })
    },
  })

  const test = useMutation({
    mutationFn: () => emailConfigApi.test(testTo.trim()),
    onSuccess: (res) => {
      setMessage(res.data.success
        ? { ok: true, text: 'Test email sent ✓ — check the inbox.' }
        : { ok: false, text: res.data.message || 'Test email failed.' })
    },
    onError: () => setMessage({ ok: false, text: 'Could not reach the server to send the test email.' }),
  })

  function validate(): string | null {
    if (!form.fromEmail.trim()) return 'From Email Address is required'
    if (!form.name.trim()) return 'Sender Display Name is required'
    if (form.provider === 'brevo') {
      if (!form.apiKey?.trim()) return 'Brevo API Key is required'
    } else {
      if (!form.smtpUser?.trim()) return 'Gmail address is required'
      if (!form.smtpPass?.trim()) return 'Gmail App Password is required'
    }
    return null
  }

  function handleSave() {
    const err = validate()
    if (err) { setMessage({ ok: false, text: err }); return }
    setMessage(null)
    save.mutate()
  }

  function handleClear() {
    if (!confirm('Clear the saved email configuration? Outbound email will stop working until it is reconfigured.')) return
    clear.mutate()
  }

  return (
    <Card>
      <CardHeader title="Mail & Email" subtitle="Provider used to send every email the app sends" />
      {isLoading ? (
        <SkeletonText lines={3} className="py-2" />
      ) : (
        <div className="space-y-4">
          {!configured && (
            <p className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">Not configured yet — no email can be sent until this is saved.</p>
          )}

          {/* Provider radio cards — legacy .stg-provider-card (index.html:8000):
              rich cards with icon, RECOMMENDED badge and feature chips, not a
              compact toggle. Values stay 'smtp'/'brevo' (backend contract). */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <label className={`stg-provider-card ${form.provider === 'smtp' ? 'selected' : ''}`}
              onClick={() => setForm(f => ({ ...f, provider: 'smtp' }))}>
              <input type="radio" name="ec-provider" checked={form.provider === 'smtp'}
                onChange={() => setForm(f => ({ ...f, provider: 'smtp' }))}
                style={{ accentColor: 'var(--accent)', width: 17, height: 17, marginTop: 3, flexShrink: 0 }} />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-[5px]">
                  <span className="text-[20px]">📧</span>
                  <span style={{ fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 800 }}>Gmail SMTP</span>
                  <span className="stg-badge stg-badge-auto">RECOMMENDED</span>
                </div>
                <div className="text-xs leading-relaxed" style={{ color: 'var(--text3)' }}>Send directly from your own Gmail using an App Password. No daily limits. Works with any Google or Workspace account.</div>
                <div className="mt-[9px] flex flex-wrap gap-1.5">
                  <span className="stg-provider-chip">✓ Your Gmail as From</span>
                  <span className="stg-provider-chip">✓ No daily cap</span>
                  <span className="stg-provider-chip">✓ Free forever</span>
                </div>
              </div>
            </label>
            <label className={`stg-provider-card ${form.provider === 'brevo' ? 'selected' : ''}`}
              onClick={() => setForm(f => ({ ...f, provider: 'brevo' }))}>
              <input type="radio" name="ec-provider" checked={form.provider === 'brevo'}
                onChange={() => setForm(f => ({ ...f, provider: 'brevo' }))}
                style={{ accentColor: 'var(--accent)', width: 17, height: 17, marginTop: 3, flexShrink: 0 }} />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-[5px]">
                  <span className="text-[20px]">⚡</span>
                  <span style={{ fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 800 }}>Brevo API</span>
                </div>
                <div className="text-xs leading-relaxed" style={{ color: 'var(--text3)' }}>Free transactional email API (300 emails/day). Works with any verified sender address. Requires a free Brevo account.</div>
                <div className="mt-[9px] flex flex-wrap gap-1.5">
                  <span className="stg-provider-chip">✓ Any verified address</span>
                  <span className="stg-provider-chip stg-provider-chip-warn">⚠ 300/day limit</span>
                </div>
              </div>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">From Email Address *</label>
              <input value={form.fromEmail} onChange={e => setForm(f => ({ ...f, fromEmail: e.target.value }))}
                placeholder="noreply@yourcompany.com" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Sender Display Name *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="MudraHub" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">CC</label>
              <input value={form.cc} onChange={e => setForm(f => ({ ...f, cc: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Reply-To</label>
              <input value={form.replyTo} onChange={e => setForm(f => ({ ...f, replyTo: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          {form.provider === 'smtp' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Gmail Address *</label>
                <input value={form.smtpUser} onChange={e => setForm(f => ({ ...f, smtpUser: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Gmail App Password *</label>
                <input type="password" value={form.smtpPass} onChange={e => setForm(f => ({ ...f, smtpPass: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
          ) : (
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Brevo API Key *</label>
              <input type="password" value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Signature</label>
            <textarea value={form.signature} onChange={e => setForm(f => ({ ...f, signature: e.target.value }))} rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>

          <div className="pt-2 border-t border-gray-100">
            <label className="flex items-center gap-2 text-xs font-medium text-gray-600 mb-2 cursor-pointer">
              <input type="checkbox" checked={!!form.invEnabled} onChange={e => setForm(f => ({ ...f, invEnabled: e.target.checked }))} />
              Send invitation emails to new users
            </label>
            {form.invEnabled && (
              <div className="space-y-2">
                <input value={form.invSubject} onChange={e => setForm(f => ({ ...f, invSubject: e.target.value }))}
                  placeholder="Invitation subject" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                <textarea value={form.invBody} onChange={e => setForm(f => ({ ...f, invBody: e.target.value }))} rows={3}
                  placeholder="Invitation body" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            )}
          </div>

          {message && (
            <p className={`text-xs ${message.ok ? 'text-green-600' : 'text-red-600'}`}>{message.text}</p>
          )}

          <div className="flex items-center gap-2">
            <Button size="sm" loading={save.isPending} onClick={handleSave}>Save Settings</Button>
            {configured && <Button size="sm" variant="danger" loading={clear.isPending} onClick={handleClear}>Clear</Button>}
          </div>

          {configured && (
            <div className="pt-3 border-t border-gray-100 flex items-center gap-2">
              <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="Send a test email to…"
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <Button size="sm" variant="secondary" loading={test.isPending} disabled={!testTo.trim()} onClick={() => test.mutate()}>Send Test</Button>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
