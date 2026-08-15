import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { settingsApi } from '@/api/settingsApi'
import { useAuthStore } from '@/store/authStore'
import { Pencil, Trash2, Check, X } from 'lucide-react'

const SETTING_KEY = 'efin_incred_comment_templates'
const SETTING_CATEGORY = 'Configuration'

// ── Income Check Comment Templates (InCred) ─────────────────────────────────
// Reproduces legacy's ictRender/ictAddTemplate/ictSaveEdit/ictDelete exactly:
// a flat list of preset comment strings shown in the Income Check modal
// during loan processing, editable here. Persisted through the existing
// generic Settings key/value store (POST /api/settings with this exact key
// + category, same as legacy's _ictSaveToServer) — no new backend endpoint.
// GET is available to any authenticated user (this key is explicitly
// whitelisted on SettingsController.Get for that), but POST/Upsert is
// Admin-only at the SettingsController class level, so edits here are
// gated to Admin (matches the other admin config cards on this page).
export default function IncredCommentTemplatesCard() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const canEdit = user?.role === 'Admin'
  const [templates, setTemplates] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [newValue, setNewValue] = useState('')
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [error, setError] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['setting', SETTING_KEY],
    queryFn: () => settingsApi.getByKey(SETTING_KEY).then(r => r.data.data).catch(() => null),
  })

  useEffect(() => {
    if (!data?.value) return
    try {
      const parsed = JSON.parse(data.value)
      if (Array.isArray(parsed)) setTemplates(parsed)
    } catch { /* leave templates as-is on parse failure */ }
  }, [data])

  const save = useMutation({
    mutationFn: (next: string[]) => settingsApi.update(SETTING_KEY, JSON.stringify(next), SETTING_CATEGORY),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['setting', SETTING_KEY] }),
    onError: () => setError('Could not save — please try again.'),
  })

  function persist(next: string[]) {
    setTemplates(next)
    save.mutate(next)
  }

  function addTemplate() {
    const val = newValue.trim()
    if (!val) { setError('Please type a comment template first'); return }
    if (templates.includes(val)) { setError('This template already exists'); return }
    setError('')
    persist([...templates, val])
    setNewValue('')
  }
  function startEdit(i: number) {
    setEditingIdx(i); setEditValue(templates[i]); setError('')
  }
  function cancelEdit() {
    setEditingIdx(null); setEditValue('')
  }
  function saveEdit(i: number) {
    const val = editValue.trim()
    if (!val) { setError('Comment cannot be empty'); return }
    setError('')
    const next = [...templates]; next[i] = val
    persist(next)
    setEditingIdx(null); setEditValue('')
  }
  function deleteTemplate(i: number) {
    if (!confirm(`Delete this template?\n\n"${templates[i]}"`)) return
    persist(templates.filter((_, idx) => idx !== i))
  }

  const filtered = templates
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => !search.trim() || t.toLowerCase().includes(search.toLowerCase().trim()))

  return (
    <Card className="mt-6">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900">Income Check Comment Templates</h3>
        <p className="text-sm text-gray-500 mt-0.5">Preset comment options shown in the Income Check modal during InCred processing</p>
      </div>

      <div className="flex gap-2 mb-3">
        <input value={newValue} onChange={e => setNewValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addTemplate()}
          placeholder="Type new comment template…"
          disabled={!canEdit}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50" />
        {canEdit && <Button size="sm" loading={save.isPending} onClick={addTemplate}>+ Add</Button>}
      </div>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search templates…"
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3" />

      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      {isLoading ? (
        <p className="text-sm text-gray-400 py-4">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">{templates.length === 0 ? 'No templates configured yet.' : 'No templates match your search.'}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {filtered.map(({ t, i }) => (
            <div key={i} className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2">
              <span className="text-xs font-bold text-efin-blue min-w-[20px]">{i + 1}.</span>
              {editingIdx === i ? (
                <>
                  <input value={editValue} onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(i); if (e.key === 'Escape') cancelEdit() }}
                    autoFocus className="flex-1 border border-efin-blue rounded px-2 py-1 text-sm" />
                  <button onClick={() => saveEdit(i)} className="text-green-600 p-1"><Check size={14} /></button>
                  <button onClick={cancelEdit} className="text-gray-400 p-1"><X size={14} /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-gray-800">{t}</span>
                  {canEdit && (
                    <>
                      <button onClick={() => startEdit(i)} className="text-gray-400 hover:text-gray-700 p-1"><Pencil size={13} /></button>
                      <button onClick={() => deleteTemplate(i)} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={13} /></button>
                    </>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
