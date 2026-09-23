import { Button } from '@/components/ui/Button'
import {
  ALL_MENU_ITEMS, ALL_ROLE_KEYS, ROLE_DISPLAY, type RoleKey,
} from '@/constants/permissions'
import type { MenuVisibilityMap } from '@/api/permissionsApi'

// Menu Access Control — efin-app.js's stgMacRender()/stgMacToggle()
// (lines 37394-37480). Per-role sidebar-item visibility, grouped by
// section. The 6 canHide:false "Core" items are always visible everywhere
// and shown as static chips, matching legacy's read-only core-items row.
export default function MenuAccessControl({
  visibility, onToggle, onApply, onReset, saving, savedFlash,
}: {
  visibility: MenuVisibilityMap
  onToggle: (itemId: string, roleKey: RoleKey) => void
  onApply: () => void
  onReset: () => void
  saving: boolean
  savedFlash: boolean
}) {
  const coreItems = ALL_MENU_ITEMS.filter(i => !i.canHide)
  const hideable = ALL_MENU_ITEMS.filter(i => i.canHide)
  const sections = [...new Set(hideable.map(i => i.section))]

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">Core (always visible)</p>
        <div className="flex flex-wrap gap-1.5">
          {coreItems.map(i => (
            <span key={i.id} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
              {i.icon} {i.label}
            </span>
          ))}
        </div>
      </div>

      {sections.map(section => (
        <div key={section}>
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">{section}</p>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">Menu Item</th>
                  {ALL_ROLE_KEYS.map(rk => (
                    <th key={rk} className="px-2 py-2 text-center font-semibold whitespace-nowrap" style={{ color: ROLE_DISPLAY[rk].color }}>
                      {ROLE_DISPLAY[rk].label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hideable.filter(i => i.section === section).map(item => (
                  <tr key={item.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-medium text-gray-700 whitespace-nowrap">{item.icon} {item.label}</td>
                    {ALL_ROLE_KEYS.map(rk => {
                      const isAdmin = rk === 'admin'
                      const checked = isAdmin || (visibility[item.id]?.includes(rk) ?? false)
                      return (
                        <td key={rk} className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isAdmin}
                            onChange={() => onToggle(item.id, rk)}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="flex items-center gap-3 pt-1">
        <Button size="sm" loading={saving} onClick={onApply}>Apply Changes</Button>
        <Button size="sm" variant="ghost" onClick={onReset}>↺ Reset to Defaults</Button>
        {savedFlash && <span className="text-xs font-semibold text-green-600">✓ Saved</span>}
      </div>
    </div>
  )
}
