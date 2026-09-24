import { useState, useEffect } from 'react'
import { SkeletonText } from '@/components/ui/Skeleton'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, ExternalLink } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import {
  masterListsApi, parseStoredMap, buildSaveMap, type MasterListMap,
} from '@/api/masterListsApi'
import { MASTER_LIST_DEFS, SOURCE_SCREEN } from '@/constants/masterLists'
import { useAuthStore } from '@/store/authStore'
import { apiErrorMessage as errorMessage } from '@/utils/apiError'

// ── Loan Form Dropdown Lists ────────────────────────────────────────────
// Ports legacy's Settings → System & Data "Loan Form Dropdown Lists" folder
// (stgMlSelectList / stgMlAddItem / stgMlDeleteItem, efin-app.js:37042-37116).
//
// Kept from legacy: the same five lists in the same order, a tab per list,
// add-by-label, delete with a confirm, and the Admin-or-ProductTeam edit rule
// legacy enforces in stgMlAddItem/stgMlDeleteItem.
//
// The two lists legacy leaves empty (Location, Sales Person) are shown, as
// legacy shows them, but read-only with a link to the screen that actually
// owns those records. Making them editable here would recreate the duplicate
// source of truth legacy removed.


export default function MasterListsCard() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  // Legacy: `if (_r !== 'admin' && _r !== 'product_team')` → reject.
  const canEdit = user?.role === 'Admin' || user?.role === 'ProductTeam'

  const [activeKey, setActiveKey] = useState(MASTER_LIST_DEFS[0].key)
  const [map, setMap] = useState<MasterListMap | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const { data: setting, isLoading } = useQuery({
    queryKey: ['master-lists'],
    queryFn: () => masterListsApi.get().then(r => r.data.data),
    retry: false,
  })

  // Seed the editable copy once, from the stored blob or the built-in defaults.
  useEffect(() => {
    if (map !== null || isLoading) return
    setMap(parseStoredMap(setting?.value))
  }, [setting, isLoading, map])

  const save = useMutation({
    mutationFn: (next: MasterListMap) => masterListsApi.save(buildSaveMap(next)),
    onSuccess: () => {
      setError(''); setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      qc.invalidateQueries({ queryKey: ['master-lists'] })
    },
    onError: (err: unknown) => setError(errorMessage(err, 'Could not save these lists.')),
  })

  if (map === null) {
    return (
      <Card>
        <SkeletonText lines={3} className="py-2" />
      </Card>
    )
  }

  const def = MASTER_LIST_DEFS.find(d => d.key === activeKey)!
  const items = map[activeKey] ?? []
  const source = SOURCE_SCREEN[activeKey]

  function addItem() {
    const label = newLabel.trim()
    if (!label) { setError('Enter an item label.'); return }
    if (items.some(i => i.label.toLowerCase() === label.toLowerCase())) {
      setError('That item is already in this list.'); return
    }
    setError('')
    // Legacy stores the typed text as both value and label.
    const next = { ...map, [activeKey]: [...items, { value: label, label }] }
    setMap(next)
    save.mutate(next)
    setNewLabel('')
  }

  function removeItem(index: number) {
    const item = items[index]
    if (!window.confirm(`Remove "${item.label}" from ${def.label}?`)) return
    setError('')
    const next = { ...map, [activeKey]: items.filter((_, i) => i !== index) }
    setMap(next)
    save.mutate(next)
  }

  return (
    <Card>
      <div className="mb-4">
        <h3 className="text-base font-semibold" style={{ color: 'var(--text)' }}>Loan Form Dropdown Lists</h3>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text3)' }}>
          The options offered in the application wizard's dropdowns.
        </p>
      </div>

      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {saved && <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">Saved.</div>}

      {/* List picker */}
      <div className="flex flex-wrap gap-2 mb-4">
        {MASTER_LIST_DEFS.map(d => {
          const active = d.key === activeKey
          const count = (map[d.key] ?? []).length
          return (
            <button key={d.key} onClick={() => { setActiveKey(d.key); setError(''); setNewLabel('') }}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                active ? 'bg-efin-blue text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              <span>{d.icon}</span>{d.label}
              {!d.sourcedElsewhere && (
                <span className={`text-[11px] ${active ? 'text-white/75' : 'text-gray-400'}`}>{count}</span>
              )}
            </button>
          )
        })}
      </div>

      <p className="text-xs mb-3" style={{ color: 'var(--text3)' }}>
        {def.desc}
        {def.wizardId && <span className="ml-1 font-mono text-[11px]">({def.wizardId})</span>}
      </p>

      {def.sourcedElsewhere ? (
        // Legacy shows these two lists but keeps them empty on purpose — the
        // real records belong to another screen.
        <div className="rounded-lg border border-token bg-surface2 px-4 py-4">
          <p className="text-sm" style={{ color: 'var(--text2)' }}>
            This list is not maintained here.
          </p>
          <p className="text-xs mt-1 mb-3" style={{ color: 'var(--text3)' }}>
            {def.label} options come from the {source?.label} screen, which is the single source of truth for them.
          </p>
          {source && (
            <Button size="sm" variant="secondary" onClick={() => navigate(source.path)}>
              <ExternalLink size={14} className="mr-1" />Open {source.label}
            </Button>
          )}
        </div>
      ) : (
        <>
          {items.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: 'var(--text3)' }}>
              No options in this list yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2 mb-4">
              {items.map((item, i) => (
                <span key={`${item.value}-${i}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-token bg-surface2 pl-3 pr-2 py-1 text-[12.5px]">
                  <span style={{ color: 'var(--text)' }}>{item.label}</span>
                  {canEdit && (
                    <button onClick={() => removeItem(i)} disabled={save.isPending}
                      title={`Remove ${item.label}`}
                      className="text-gray-400 hover:text-red-600 disabled:opacity-50">
                      <Trash2 size={12} />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}

          {canEdit ? (
            <div className="flex items-center gap-2">
              <input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addItem() }}
                placeholder={`Add an option to ${def.label}`}
                className="flex-1 max-w-xs rounded-lg border border-token px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue"
              />
              <Button size="sm" loading={save.isPending} disabled={save.isPending} onClick={addItem}>
                <Plus size={14} className="mr-1" />Add
              </Button>
            </div>
          ) : (
            <p className="text-[11px]" style={{ color: 'var(--text3)' }}>
              Only an Admin or the Product Team can change these lists.
            </p>
          )}
        </>
      )}
    </Card>
  )
}
