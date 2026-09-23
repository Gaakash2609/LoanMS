import { useEffect, useState } from 'react'
import { SkeletonText } from '@/components/ui/Skeleton'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { usersApi } from '@/api/usersApi'
import { permissionsApi, type RolePermissionsMap, type MenuVisibilityMap } from '@/api/permissionsApi'
import {
  ALL_MENU_ITEMS, ALL_ROLE_KEYS, BACKEND_TO_ROLE_KEY, DEFAULT_ROLES, MASTER_PERM_GROUPS,
  type RoleKey, type RolePermissionFlags,
} from '@/constants/permissions'
import { useRolePermissionsQuery, useMenuVisibilityQuery } from '@/hooks/usePermissions'
import ExpertExportAccessCard from '@/components/shared/ExpertExportAccessCard'
import RoleAccessCards from './RoleAccessCards'
import MenuAccessControl from './MenuAccessControl'
import AdminMasterControl from './AdminMasterControl'
import PermissionMatrix from './PermissionMatrix'
import SecurityGroupsReference from './SecurityGroupsReference'
import PermissionChangeHistory from './PermissionChangeHistory'

// Same construction as permissionsApi's internal default builder — each
// canHide:true item starts visible only to its `defaultRoles`, canHide:
// false ("Core") items are visible to every role. Used for the "Reset to
// Defaults" action.
function defaultMenuVisibility(): MenuVisibilityMap {
  const vis: MenuVisibilityMap = {}
  ALL_MENU_ITEMS.forEach(item => {
    vis[item.id] = item.canHide ? (item.defaultRoles ?? []) : [...ALL_ROLE_KEYS]
  })
  return vis
}

// Folder shell matching legacy's `.stg-folder` collapsible panels
// (index.html:8248-8466) — same seven sections, same order.
function Folder({
  title, badge, defaultOpen, children,
}: { title: string; badge?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-50 bg-white">
        <span className="text-sm font-bold text-gray-900">{title}</span>
        {badge && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600">{badge}</span>}
        {open ? <ChevronUp size={16} className="text-gray-400 ml-auto" /> : <ChevronDown size={16} className="text-gray-400 ml-auto" />}
      </button>
      {open && <div className="px-4 py-4 border-t border-gray-200">{children}</div>}
    </div>
  )
}

export default function RolesPermissionsTab() {
  const qc = useQueryClient()
  const { data: serverRoles } = useRolePermissionsQuery()
  const { data: serverVisibility } = useMenuVisibilityQuery()
  const { data: usersResp } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.getAll().then(r => r.data.data ?? []) })

  const [localRoles, setLocalRoles] = useState<RolePermissionsMap | null>(null)
  const [localVisibility, setLocalVisibility] = useState<MenuVisibilityMap | null>(null)
  const [macSaved, setMacSaved] = useState(false)
  const [permSaved, setPermSaved] = useState(false)

  // Sync from server once on first load only — never clobber in-progress
  // local edits on a background refetch (same intent as legacy's
  // Object.assign-merge-on-boot, just adapted to React state).
  useEffect(() => { if (serverRoles && !localRoles) setLocalRoles(serverRoles) }, [serverRoles, localRoles])
  useEffect(() => { if (serverVisibility && !localVisibility) setLocalVisibility(serverVisibility) }, [serverVisibility, localVisibility])

  const userCounts: Partial<Record<RoleKey, number>> = {}
  ;(usersResp ?? []).forEach(u => {
    const rk = BACKEND_TO_ROLE_KEY[u.role]
    if (rk) userCounts[rk] = (userCounts[rk] ?? 0) + 1
  })

  const saveMenuVis = useMutation({
    mutationFn: (vis: MenuVisibilityMap) => permissionsApi.saveMenuVisibility(vis),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menuVisibility'] })
      setMacSaved(true)
      setTimeout(() => setMacSaved(false), 2500)
    },
  })

  const saveRolePerms = useMutation({
    mutationFn: (roles: RolePermissionsMap) => permissionsApi.saveRolePermissions(roles),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rolePermissions'] })
      setPermSaved(true)
      setTimeout(() => setPermSaved(false), 2500)
    },
  })

  function toggleMenuRole(itemId: string, roleKey: RoleKey) {
    setLocalVisibility(prev => {
      if (!prev) return prev
      const current = prev[itemId] ?? []
      const next = current.includes(roleKey) ? current.filter(r => r !== roleKey) : [...current, roleKey]
      return { ...prev, [itemId]: next }
    })
  }

  function togglePerm(roleKey: RoleKey, permKey: keyof RolePermissionFlags) {
    if (roleKey === 'admin') return
    setLocalRoles(prev => prev && { ...prev, [roleKey]: { ...prev[roleKey], [permKey]: !prev[roleKey][permKey] } })
  }

  function toggleAllForRole(roleKey: RoleKey) {
    if (roleKey === 'admin') return
    setLocalRoles(prev => {
      if (!prev) return prev
      const allPerms = MASTER_PERM_GROUPS.flatMap(g => g.perms.map(p => p[0]))
      const allCurrentlyTrue = allPerms.every(p => Boolean(prev[roleKey][p]))
      const nextVal = !allCurrentlyTrue
      const updated = { ...prev[roleKey] }
      allPerms.forEach(p => { (updated as unknown as Record<string, boolean>)[p] = nextVal })
      return { ...prev, [roleKey]: updated }
    })
  }

  return (
    <div className="space-y-3">
      <Folder title="Role Definitions & Access Cards" defaultOpen>
        {localRoles ? <RoleAccessCards roles={localRoles} userCounts={userCounts} /> : <SkeletonText lines={3} />}
      </Folder>

      <Folder title="Menu Access Control" badge="ADMIN ONLY">
        {localVisibility ? (
          <MenuAccessControl
            visibility={localVisibility}
            onToggle={toggleMenuRole}
            onApply={() => localVisibility && saveMenuVis.mutate(localVisibility)}
            onReset={() => setLocalVisibility(defaultMenuVisibility())}
            saving={saveMenuVis.isPending}
            savedFlash={macSaved}
          />
        ) : <SkeletonText lines={3} />}
      </Folder>

      <Folder title="Expert Export Permission" badge="ADMIN ONLY">
        <ExpertExportAccessCard />
      </Folder>

      <Folder title="Security Groups Reference">
        <SecurityGroupsReference />
      </Folder>

      <Folder title="Admin Master Control" badge="ADMIN ONLY">
        {localRoles ? (
          <AdminMasterControl
            roles={localRoles}
            onTogglePerm={togglePerm}
            onToggleRole={toggleAllForRole}
            onApply={() => localRoles && saveRolePerms.mutate(localRoles)}
            onReset={() => setLocalRoles(structuredClone(DEFAULT_ROLES))}
            saving={saveRolePerms.isPending}
            savedFlash={permSaved}
          />
        ) : <SkeletonText lines={3} />}
      </Folder>

      <Folder title="Permission Matrix">
        {localRoles ? <PermissionMatrix roles={localRoles} /> : <SkeletonText lines={3} />}
      </Folder>

      <Folder title="Permission Change History" badge="ADMIN ONLY">
        <PermissionChangeHistory />
      </Folder>
    </div>
  )
}
