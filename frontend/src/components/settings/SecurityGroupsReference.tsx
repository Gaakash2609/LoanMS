import { SECURITY_GROUPS, SECURITY_GROUP_CATEGORY_COLORS } from '@/constants/permissions'

// Security Groups Reference — efin-app.js's stgRenderSecGroups() (lines
// 37374-37391), data from twSecGroups (24317-24326). Read-only.
export default function SecurityGroupsReference() {
  const categories = [...new Set(SECURITY_GROUPS.map(g => g.cat))]

  return (
    <div className="space-y-4">
      {categories.map(cat => (
        <div key={cat}>
          <p
            className="text-[11px] font-bold uppercase tracking-wide mb-1.5"
            style={{ color: SECURITY_GROUP_CATEGORY_COLORS[cat] ?? '#6b7280' }}
          >
            {cat}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SECURITY_GROUPS.filter(g => g.cat === cat).map(g => (
              <div key={g.id} className="border border-gray-200 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                  <span className="text-sm font-semibold text-gray-800">{g.name}</span>
                  <span className="ml-auto text-[10px] font-mono text-gray-400">{g.id}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">{g.desc}</p>
                {g.implied.length > 0 && (
                  <p className="text-[10px] text-gray-400 mt-1">Implies: {g.implied.join(', ')}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
