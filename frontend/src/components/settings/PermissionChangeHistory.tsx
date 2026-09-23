import { useQuery } from '@tanstack/react-query'
import { SkeletonText } from '@/components/ui/Skeleton'
import { permissionsApi } from '@/api/permissionsApi'
import { formatDateTime } from '@/utils/format'

// Permission Change History — efin-app.js's stgRenderPermissionHistory()
// (lines 37215-37275). Read-only, top 25, filtered to permission/menu/
// expert-export-related audit rows.
function kindLabel(entityName: string, newValues?: string) {
  const v = (newValues ?? '').toLowerCase()
  if (v.includes('efin_menu_visibility')) return { label: 'Menu Access', icon: '🧭', color: '#0369a1' }
  if (v.includes('efin_role_permissions')) return { label: 'Role Permissions', icon: '🔐', color: '#7c3aed' }
  if (entityName === 'Expertexport') return { label: 'Expert Export', icon: '📤', color: '#059669' }
  return { label: entityName || 'Settings', icon: '⚙️', color: '#64748b' }
}

export default function PermissionChangeHistory() {
  const { data, isLoading } = useQuery({
    queryKey: ['permissionHistory'],
    queryFn: permissionsApi.getPermissionHistory,
    staleTime: 30_000,
  })

  if (isLoading) return <SkeletonText lines={3} className="py-2" />
  if (!data || data.length === 0) return <p className="text-sm text-gray-400 py-4">No permission changes recorded yet.</p>

  return (
    <div className="divide-y divide-gray-100">
      {data.map(item => {
        const k = kindLabel(item.entityName, item.newValues)
        return (
          <div key={item.id} className="flex items-center gap-3 py-2">
            <span className="text-lg shrink-0">{k.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold" style={{ color: k.color }}>{k.label}</p>
              <p className="text-xs text-gray-500">{item.userName ?? 'Unknown user'} · {item.action ?? 'Updated'}</p>
            </div>
            <span className="text-[11px] text-gray-400 whitespace-nowrap">{formatDateTime(item.createdAt)}</span>
          </div>
        )
      })}
    </div>
  )
}
