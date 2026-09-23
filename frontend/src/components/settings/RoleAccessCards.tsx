import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import {
  ALL_ROLE_KEYS, CARD_TAB_PERMS, CARD_ACTION_PERMS,
  type RoleKey, type RolePermissionFlags, type RoleRecord,
} from '@/constants/permissions'
import type { RolePermissionsMap } from '@/api/permissionsApi'

// Role Definitions & Access Cards — efin-app.js's renderAccessRights()
// (lines 5716-5947). One card per role, all 11 (incl. Admin). Granted/
// Restricted counts are over every boolean permission key on the role
// (59 keys), not just the ~27 rows shown in the card body — matches
// legacy's count logic exactly (efin-app.js:5806-5808).
function countBooleans(rec: RoleRecord) {
  let granted = 0, restricted = 0
  Object.entries(rec).forEach(([, v]) => {
    if (typeof v === 'boolean') { if (v) granted++; else restricted++ }
  })
  return { granted, restricted }
}

export default function RoleAccessCards({
  roles, userCounts,
}: {
  roles: RolePermissionsMap
  userCounts: Partial<Record<RoleKey, number>>
}) {
  const [expanded, setExpanded] = useState<RoleKey | null>(null)

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {ALL_ROLE_KEYS.map(roleKey => {
        const rec = roles[roleKey]
        const { granted, restricted } = countBooleans(rec)
        const isOpen = expanded === roleKey

        return (
          <div key={roleKey} className="border border-gray-200 rounded-xl overflow-hidden">
            <button
              onClick={() => setExpanded(isOpen ? null : roleKey)}
              className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50"
            >
              <span className="text-xl shrink-0">{rec.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900">{rec.label}</p>
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{rec.desc}</p>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[11px] text-gray-400">
                  <span>Scope: {rec.scope}</span>
                  <span>Team: {rec.teamSize}</span>
                  <span>Users: {userCounts[roleKey] ?? 0}</span>
                </div>
                <div className="flex gap-2 mt-1.5">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-50 text-green-700">{granted} Granted</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600">{restricted} Restricted</span>
                </div>
              </div>
              {isOpen ? <ChevronUp size={16} className="text-gray-400 shrink-0 mt-1" /> : <ChevronDown size={16} className="text-gray-400 shrink-0 mt-1" />}
            </button>

            {isOpen && (
              <div className="px-4 py-3 border-t border-gray-200 space-y-3">
                <div>
                  <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">App Detail Tabs</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                    {CARD_TAB_PERMS.map(([label, mainKey, subKey]) => {
                      const on = rec[mainKey] as boolean
                      const badge = subKey === 'canMaskPersonal' && rec.canMaskPersonal && rec.canViewPersonal ? 'Masked'
                        : subKey === 'canAddBank' && rec.canAddBank && rec.canViewBanks ? '+Add' : null
                      return (
                        <div key={label} className="flex items-center gap-1.5 text-xs">
                          <span className={on ? 'text-green-600' : 'text-gray-300'}>{on ? '✓' : '✕'}</span>
                          <span className={on ? 'text-gray-700' : 'text-gray-400'}>{label}</span>
                          {badge && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-efin-blue/10 text-efin-blue">{badge}</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">Application Actions</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                    {CARD_ACTION_PERMS.map(([label, key]) => {
                      const on = rec[key as keyof RolePermissionFlags] as boolean
                      return (
                        <div key={label} className="flex items-center gap-1.5 text-xs">
                          <span className={on ? 'text-green-600' : 'text-gray-300'}>{on ? '✓' : '✕'}</span>
                          <span className={on ? 'text-gray-700' : 'text-gray-400'}>{label}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Responsibilities</p>
                    <ul className="text-xs text-gray-600 list-disc list-inside space-y-0.5">
                      {rec.responsibilities.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Restrictions</p>
                    <ul className="text-xs text-gray-600 list-disc list-inside space-y-0.5">
                      {rec.restrictions.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
