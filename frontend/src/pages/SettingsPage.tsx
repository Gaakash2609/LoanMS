import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsApi, type AppSetting } from '@/api/settingsApi'
import { aiApi } from '@/api/aiApi'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import PageHeader from '@/components/shared/PageHeader'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { useAuthStore } from '@/store/authStore'
import { Sparkles, Shield } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import BrandingCard from '@/components/shared/BrandingCard'
import EmailConfigCard from '@/components/shared/EmailConfigCard'
import CamMatrixCard from '@/components/settings/CamMatrixCard'
import EmailTemplatesCard from '@/components/settings/EmailTemplatesCard'
import WebhookLogsCard from '@/components/settings/WebhookLogsCard'
import IncredCredentialsCard from '@/components/settings/IncredCredentialsCard'
import MasterListsCard from '@/components/settings/MasterListsCard'
import RolesPermissionsTab from '@/components/settings/RolesPermissionsTab'
import AiProviderKeysCard from '@/components/settings/AiProviderKeysCard'

// Legacy's Settings page is a 5-tab shell (Mail & Email / Roles &
// Permissions / System & Data / Logo & Branding / AI & KYC Vision) — see
// index.html:7960-8830. This SPA only had a flat single section before;
// this adds the minimal tab structure needed to host the newly-built
// "Roles & Permissions" tab without moving the existing General content.
// Legacy's five Settings tabs, in legacy's order with legacy's labels
// (settingsSwitchTab, efin-app.js:36684). Existing cards were redistributed
// into them; none were rewritten.
const TABS = [
  'Mail & Email',
  'Roles & Permissions',
  'System & Data',
  'Logo & Branding',
  'AI & KYC Vision',
] as const
type SettingsTab = typeof TABS[number]

// Legacy prefixes each Settings tab with an emoji (index.html Settings tabs).
const TAB_ICON: Record<SettingsTab, string> = {
  'Mail & Email': '📧',
  'Roles & Permissions': '🔒',
  'System & Data': '🔧',
  'Logo & Branding': '🎨',
  'AI & KYC Vision': '🖥️',
}

export default function SettingsPage() {
  const user = useAuthStore(s => s.user)
  const [tab, setTab] = useState<SettingsTab>('Mail & Email')
  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.getAll().then(r => r.data.data ?? []),
  })

  const { data: aiStatus } = useQuery({
    queryKey: ['ai', 'status'],
    queryFn: () => aiApi.status().then(r => r.data.data),
    staleTime: 60_000,
  })


  if (user?.role !== 'Admin') {
    return (
      <div>
        <PageHeader title="Settings" />
        <Card>
          <div className="flex items-center gap-3 text-yellow-600 py-4">
            <Shield size={20} />
            <p className="text-sm font-medium">Only Admins can access system settings.</p>
          </div>
        </Card>
      </div>
    )
  }

  // Branding keys are edited via the dedicated BrandingCard below (with
  // image upload/preview), not the generic raw key/value editor — excluded
  // here so a base64 logo string never gets truncated-and-shown as text.
  const groupedSettings = (settings ?? [])
    .filter(s => s.category !== 'branding')
    .reduce<Record<string, AppSetting[]>>((acc, s) => {
      const cat = s.category ?? 'General'
      if (!acc[cat]) acc[cat] = []
      acc[cat].push(s)
      return acc
    }, {})

  return (
    <div className="space-y-6">
      <PageHeader
        title="⚙️ Settings"
        subtitle="All system configuration in one place — Admin access only"
        action={(
          <span className="text-[11px] font-bold uppercase px-3 py-1 rounded-full"
            style={{ letterSpacing: '.5px', color: 'var(--accent)', background: 'var(--accent-subtle)' }}>
            Admin Only
          </span>
        )}
      />

      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-efin-blue text-efin-blue' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {TAB_ICON[t]} {t}
          </button>
        ))}
      </div>

      {tab === 'Roles & Permissions' && <RolesPermissionsTab />}

      {/* ── Mail & Email ── */}
      {tab === 'Mail & Email' && (
        <>
          {/* Provider / Sender Identity / Brevo / Invitation all live in this
              one card — Admin only, matching SettingsController's class-level
              [Authorize(Roles = "Admin")]. */}
          {user?.role === 'Admin' && <EmailConfigCard />}

          {/* Legacy's "All Email Templates" folder. Reads are open to any
              authenticated user, so this renders read-only for non-Admins
              rather than disappearing. */}
          <EmailTemplatesCard />
        </>
      )}

      {/* ── System & Data ── */}
      {tab === 'System & Data' && (
        <>
          <MasterListsCard />
          {user?.role === 'Admin' && <WebhookLogsCard />}

          {/* InCred API credentials — ported from the legacy InCred page's
              config panel (efin-app.js:13947/13968/14076). Admin-only to match
              SettingsController's class-level [Authorize(Roles = "Admin")]. */}
          {user?.role === 'Admin' && <IncredCredentialsCard />}

          {/* CAM Matrix is not a legacy Settings folder, but it is global
              configuration saved through the same /api/settings upsert, so it
              belongs with the other system data rather than in its own tab. */}
          {user?.role === 'Admin' && <CamMatrixCard />}

          {/* Raw AppSettings key/value editor — kept exactly as it was. */}
          {isLoading ? <LoadingSpinner /> : Object.entries(groupedSettings).map(([category, items]) => (
            <GenericSettingsCard key={category} category={category} items={items} />
          ))}
        </>
      )}

      {/* ── Logo & Branding ── */}
      {tab === 'Logo & Branding' && <BrandingCard settings={settings ?? []} />}

      {/* ── AI & KYC Vision ── */}
      {tab === 'AI & KYC Vision' && (
        <>
          <Card>
            <div className="flex items-start gap-4">
              <span
                className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
                style={aiStatus?.enabled
                  ? { background: 'rgba(124, 58, 237, .1)', color: '#7c3aed' }
                  : { background: 'var(--surface2)', color: 'var(--text3)' }}
              >
                <Sparkles size={20} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-bold text-[color:var(--text)]">AI Module Status</h3>
                  <Badge variant={aiStatus?.enabled ? 'success' : 'default'}>
                    {aiStatus?.enabled ? 'Active' : 'Disabled'}
                  </Badge>
                </div>
                <p className="text-sm text-[color:var(--text3)] mt-1.5 leading-relaxed">
                  {aiStatus?.enabled
                    ? 'AI is enabled and ready. Loan insights, customer summaries, and smart features are active.'
                    : 'To enable AI, set AI:Enabled=true and AI:ApiKey in your environment variables, then restart the server.'}
                </p>
              </div>
            </div>
          </Card>

          {/* Legacy's AI tab also holds a "KYC Vision" folder, which is really
              the AI provider-key editor (GET/POST/DELETE /api/settings/ai-keys
              — efin-app.js:26406 _renderKycProxySettingsCard). Ported here so
              an Admin can actually save/remove the Gemini & OpenAI keys that
              authenticate PAN/Aadhaar auto-fill, instead of only seeing the
              env-var status message above. Admin-only to match
              SettingsController's class-level [Authorize(Roles = "Admin")]
              (this whole tab is already Admin-gated by the guard above). */}
          {user?.role === 'Admin' && <AiProviderKeysCard />}
        </>
      )}
    </div>
  )
}

// Extracted verbatim from the old inline block so the raw AppSettings editor
// has one definition instead of being duplicated per tab. Behaviour unchanged.
function GenericSettingsCard({ category, items }: { category: string; items: AppSetting[] }) {
  const [editKey, setEditKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editCategory, setEditCategory] = useState<string | undefined>(undefined)
  const [error, setError] = useState('')
  const qc = useQueryClient()

  const update = useMutation({
    mutationFn: ({ key, value, category: cat }: { key: string; value: string; category?: string }) =>
      settingsApi.update(key, value, cat),
    onSuccess: () => {
      setError(''); setEditKey(null)
      qc.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: (err: unknown) => {
      const d = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      setError(d?.message || d?.errors?.join(' ') || 'Could not save this setting. Please try again.')
    },
  })

  return (
    <Card>
      <CardHeader title={category} />
      {error && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="space-y-3">
        {items.map(setting => (
          <div key={setting.key} className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-700">{setting.key}</p>
            </div>
            {editKey === setting.key ? (
              <div className="flex items-center gap-2">
                <input
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-efin-blue"
                />
                <Button size="sm" onClick={() => update.mutate({ key: setting.key, value: editValue, category: editCategory })}
                  loading={update.isPending}>Save</Button>
                <Button size="sm" variant="secondary" onClick={() => { setEditKey(null); setError('') }}>Cancel</Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600 font-mono bg-gray-50 px-2 py-0.5 rounded">
                  {setting.value.length > 30 ? setting.value.slice(0, 30) + '...' : setting.value}
                </span>
                <button
                  onClick={() => { setEditKey(setting.key); setEditValue(setting.value); setEditCategory(setting.category); setError('') }}
                  className="text-xs text-efin-blue hover:underline"
                >
                  Edit
                </button>
              </div>
            )}
          </div>
        ))}
        {items.length === 0 && <p className="text-sm text-gray-400">No settings in this category.</p>}
      </div>
    </Card>
  )
}