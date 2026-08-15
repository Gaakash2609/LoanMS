import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { expertExportApi } from '@/api/expertExportApi'

// Matches legacy's STG_EE_BACKEND_ROLES exactly.
const BACKEND_ROLES = ['Admin', 'Manager', 'Sales']

// ── Expert Export Access (Settings → Roles & Permissions) ──────────────────
// Reproduces legacy's stgRenderExpertExport/stgEeRenderUserList/stgEeApply
// exactly: role checkboxes (Admin always checked + disabled), a searchable
// user checklist, Apply saves both via the same POST /api/expertexport/config
// contract. Admin-only, matching ExpertExportController's [Authorize(Roles
// = "Admin")] on GET/POST /config.
export default function ExpertExportAccessCard() {
  const qc = useQueryClient()
  const [roles, setRoles] = useState<string[]>(['Admin'])
  const [userIds, setUserIds] = useState<number[]>([])
  const [search, setSearch] = useState('')
  const [saved, setSaved] = useState(false)

  const { data: config, isLoading } = useQuery({
    queryKey: ['expertExportConfig'],
    queryFn: () => expertExportApi.getConfig().then(r => r.data),
  })

  useEffect(() => {
    if (!config) return
    setRoles(config.roles.length ? config.roles : ['Admin'])
    setUserIds(config.users.map(u => u.id))
  }, [config])

  const save = useMutation({
    mutationFn: () => {
      const finalRoles = roles.includes('Admin') ? roles : ['Admin', ...roles]
      return expertExportApi.saveConfig(finalRoles, userIds)
    },
    onSuccess: () => {
      setSaved(true)
      qc.invalidateQueries({ queryKey: ['expertExportConfig'] })
      qc.invalidateQueries({ queryKey: ['expertExportAccess'] })
      setTimeout(() => setSaved(false), 2500)
    },
  })

  function toggleRole(r: string) {
    if (r === 'Admin') return // always on, matches legacy's disabled checkbox
    setRoles(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r])
  }
  function toggleUser(id: number) {
    setUserIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const filteredUsers = (config?.allUsers ?? []).filter(u => {
    const q = search.toLowerCase().trim()
    return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
  })

  return (
    <Card>
      <CardHeader title="Expert Export Access" subtitle="Who can download the Expert Export (Admin always included)" />
      {isLoading ? (
        <p className="text-sm text-gray-400 py-4">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-gray-600 mb-2">Roles</p>
            <div className="flex flex-wrap gap-2">
              {BACKEND_ROLES.map(r => {
                const isAdmin = r === 'Admin'
                const checked = isAdmin || roles.includes(r)
                return (
                  <label key={r}
                    className={`flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-semibold ${isAdmin ? '' : 'cursor-pointer'} ${checked ? 'bg-purple-50' : 'bg-white'}`}>
                    <input type="checkbox" checked={checked} disabled={isAdmin} onChange={() => toggleRole(r)} />
                    {r}{isAdmin ? ' (always)' : ''}
                  </label>
                )
              })}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-600 mb-2">Individually Granted Users</p>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2" />
            <div className="flex flex-col gap-0.5 max-h-56 overflow-y-auto border border-gray-200 rounded-lg p-2">
              {filteredUsers.length === 0 ? (
                <p className="text-xs text-gray-400 p-1.5">No users found</p>
              ) : filteredUsers.map(u => (
                <label key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer">
                  <input type="checkbox" checked={userIds.includes(u.id)} onChange={() => toggleUser(u.id)} />
                  <span className="font-semibold">{u.name}</span>
                  <span className="text-gray-400">{u.email} · {u.role}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>Apply</Button>
            {saved && <span className="text-xs font-semibold text-green-600">✓ Saved</span>}
          </div>
        </div>
      )}
    </Card>
  )
}
