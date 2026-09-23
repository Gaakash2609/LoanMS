import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import {
  MASTER_PERM_GROUPS, NON_ADMIN_ROLE_KEYS, ROLE_DISPLAY,
  type RoleKey, type RolePermissionFlags,
} from '@/constants/permissions'
import type { RolePermissionsMap } from '@/api/permissionsApi'

const CATEGORY_TO_GROUP: Record<string, string> = {
  tabs: 'App Detail Tabs', nav: 'Sidebar Navigation', actions: 'Application Actions',
  data: 'Tab Data Access', timeline: 'Timeline & Tasks', other: 'Other',
}
const CATEGORIES: { key: string; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'tabs', label: '🗂 App Tabs' },
  { key: 'nav', label: '🧭 Sidebar Menus' }, { key: 'actions', label: '⚡ Action Buttons' },
  { key: 'data', label: '👁 Data Access' }, { key: 'timeline', label: '🔵 Timeline & Tasks' },
  { key: 'other', label: '📌 Other' },
]

// Admin Master Control — efin-app.js's MASTER_PERM_GROUPS/
// renderMasterToggleGrid()/toggleSinglePerm()/toggleMasterRole() (lines
// 5950-6208). One card per non-admin role (Admin's own card is always
// locked/full, not editable — matches legacy). Legacy's filter chips and
// search box exist in the HTML but call functions that were never defined
// anywhere in the codebase (masterFilterCategory/masterSearchPerms) — dead
// UI. We wire them up for real here since the grid is otherwise a wall of
// 59 x 10 checkboxes; this isn't a new feature, just completing a control
// that was visibly present but non-functional in legacy.
export default function AdminMasterControl({
  roles, onTogglePerm, onToggleRole, onApply, onReset, saving, savedFlash,
}: {
  roles: RolePermissionsMap
  onTogglePerm: (roleKey: RoleKey, permKey: keyof RolePermissionFlags) => void
  onToggleRole: (roleKey: RoleKey) => void
  onApply: () => void
  onReset: () => void
  saving: boolean
  savedFlash: boolean
}) {
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [openRole, setOpenRole] = useState<RoleKey | null>(NON_ADMIN_ROLE_KEYS[0])

  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    return MASTER_PERM_GROUPS
      .filter(g => category === 'all' || g.group === CATEGORY_TO_GROUP[category])
      .map(g => ({ ...g, perms: g.perms.filter(([, label]) => !q || label.toLowerCase().includes(q)) }))
      .filter(g => g.perms.length > 0)
  }, [category, search])

  const visibleCount = visibleGroups.reduce((n, g) => n + g.perms.length, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {CATEGORIES.map(c => (
          <button
            key={c.key}
            onClick={() => setCategory(c.key)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${
              category === c.key ? 'bg-efin-blue text-white border-efin-blue' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {c.label}
          </button>
        ))}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search permissions…"
          className="ml-auto border border-gray-200 rounded-lg px-3 py-1.5 text-xs w-48"
        />
        <span className="text-[11px] text-gray-400 whitespace-nowrap">{visibleCount} permission{visibleCount === 1 ? '' : 's'}</span>
      </div>

      <div className="border border-dashed border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-500 bg-gray-50">
        🔒 Admin — all {MASTER_PERM_GROUPS.reduce((n, g) => n + g.perms.length, 0)}/{MASTER_PERM_GROUPS.reduce((n, g) => n + g.perms.length, 0)} permissions locked on (not editable)
      </div>

      <div className="space-y-2">
        {NON_ADMIN_ROLE_KEYS.map(roleKey => {
          const rec = roles[roleKey]
          const isOpen = openRole === roleKey
          return (
            <div key={roleKey} className="border border-gray-200 rounded-xl overflow-hidden">
              <button
                onClick={() => setOpenRole(isOpen ? null : roleKey)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50"
              >
                <span className="text-sm font-bold" style={{ color: ROLE_DISPLAY[roleKey].color }}>
                  {ROLE_DISPLAY[roleKey].label}
                </span>
                <span className="ml-auto text-[10px] text-gray-400">{roleKey}</span>
                <button
                  onClick={e => { e.stopPropagation(); onToggleRole(roleKey) }}
                  className="text-[10px] font-semibold text-efin-blue hover:underline ml-2"
                >
                  Toggle All
                </button>
              </button>
              {isOpen && (
                <div className="px-4 py-3 border-t border-gray-200 space-y-3">
                  {visibleGroups.map(group => (
                    <div key={group.group}>
                      <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">{group.group}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
                        {group.perms.map(([permKey, label]) => (
                          <label key={permKey} className="flex items-center gap-1.5 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(rec[permKey])}
                              onChange={() => onTogglePerm(roleKey, permKey)}
                            />
                            <span className="text-gray-700">{label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  {visibleGroups.length === 0 && <p className="text-xs text-gray-400">No permissions match this filter.</p>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button size="sm" loading={saving} onClick={onApply}>Apply All Changes</Button>
        <Button size="sm" variant="ghost" onClick={onReset}>↺ Reset to Defaults</Button>
        {savedFlash && <span className="text-xs font-semibold text-green-600">✓ Saved</span>}
      </div>
    </div>
  )
}
