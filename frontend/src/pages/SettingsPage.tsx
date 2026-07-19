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

export default function SettingsPage() {
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()
  const [editKey, setEditKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.getAll().then(r => r.data.data ?? []),
  })

  const { data: aiStatus } = useQuery({
    queryKey: ['ai', 'status'],
    queryFn: () => aiApi.status().then(r => r.data.data),
    staleTime: 60_000,
  })

  const update = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      settingsApi.update(key, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      setEditKey(null)
    },
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

  const groupedSettings = (settings ?? []).reduce<Record<string, AppSetting[]>>((acc, s) => {
    const cat = s.category ?? 'General'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(s)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <PageHeader title="System Settings" subtitle="Configure application behavior" />

      {/* AI Status */}
      <Card>
        <CardHeader
          title="AI Module Status"
          subtitle={aiStatus?.enabled ? 'AI features are active' : 'AI features are disabled'}
          action={<Sparkles size={16} className={aiStatus?.enabled ? 'text-purple-500' : 'text-gray-300'} />}
        />
        <p className="text-sm text-gray-600">
          {aiStatus?.enabled
            ? 'AI is enabled and ready. Loan insights, customer summaries, and smart features are active.'
            : 'To enable AI, set AI:Enabled=true and AI:ApiKey in your environment variables, then restart the server.'}
        </p>
      </Card>

      {/* App Settings */}
      {isLoading ? <LoadingSpinner /> : Object.entries(groupedSettings).map(([category, items]) => (
        <Card key={category}>
          <CardHeader title={category} />
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
                      className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <Button size="sm" onClick={() => update.mutate({ key: setting.key, value: editValue })}
                      loading={update.isPending}>Save</Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditKey(null)}>Cancel</Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 font-mono bg-gray-50 px-2 py-0.5 rounded">
                      {setting.value.length > 30 ? setting.value.slice(0, 30) + '...' : setting.value}
                    </span>
                    <button
                      onClick={() => { setEditKey(setting.key); setEditValue(setting.value) }}
                      className="text-xs text-blue-600 hover:underline"
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
      ))}
    </div>
  )
}
