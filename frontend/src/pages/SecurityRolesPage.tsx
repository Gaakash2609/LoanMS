import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { Card } from '@/components/ui/Card'
import PageHeader from '@/components/shared/PageHeader'
import { Shield } from 'lucide-react'

interface AccessRule { name: string; appliedTo: string; domainFilter: string; groups: string }

// Mirrors legacy page-security-roles: Security Groups + Access Rules tabs
const ROLE_DEFINITIONS: Record<string, { color: string; description: string; permissions: string[] }> = {
  Admin: {
    color: 'bg-red-100 text-red-700',
    description: 'Full system access including user management, settings, audit logs',
    permissions: ['All modules','User management','Settings','Audit log','Delete records','Export data'],
  },
  Manager: {
    color: 'bg-blue-100 text-blue-700',
    description: 'Team management, payout approval, reports, all loan operations',
    permissions: ['Loans (all)','Customers (all)','Payout approval','Reports','Teams','DSA management'],
  },
  Sales: {
    color: 'bg-green-100 text-green-700',
    description: 'Create and manage own loan applications, customers, tasks',
    permissions: ['Loans (own)','Customers (own)','New application','Tasks','Tickets','Calculator'],
  },
  Partner: {
    color: 'bg-yellow-100 text-yellow-700',
    description: 'Submit loan applications through DSA channel only',
    permissions: ['New application (DSA channel)','Own applications only','Read-only customer view'],
  },
}

const ACCESS_RULES: AccessRule[] = [
  { name: 'Loan Visibility', appliedTo: 'Loans list', domainFilter: 'Own assignments only (Sales)', groups: 'Sales, Partner' },
  { name: 'Customer Visibility', appliedTo: 'Customers list', domainFilter: 'Created by user (Sales)', groups: 'Sales, Partner' },
  { name: 'Payout Access', appliedTo: 'Payout module', domainFilter: 'All records', groups: 'Admin, Manager' },
  { name: 'User Management', appliedTo: 'Users module', domainFilter: 'All users', groups: 'Admin' },
  { name: 'Settings Access', appliedTo: 'System settings', domainFilter: 'Full access', groups: 'Admin' },
  { name: 'Audit Log', appliedTo: 'Audit log viewer', domainFilter: 'Read-only', groups: 'Admin' },
]

export default function SecurityRolesPage() {
  const [tab, setTab] = useState<'groups'|'rules'>('groups')

  const { data: users } = useQuery({
    queryKey: ['users-all'],
    queryFn: () => api.get<ApiResponse<Array<{ role: string }>>>('/api/users', { params: { pageSize: 500 } })
      .then(r => { const d: unknown = r.data.data; return Array.isArray(d) ? (d as {role:string}[]) : [] }),
    staleTime: 120_000,
  })

  const roleCounts: Record<string, number> = {}
  ;(Array.isArray(users) ? users as Array<{role:string}> : []).forEach((u: {role: string}) => {
    roleCounts[u.role] = (roleCounts[u.role] ?? 0) + 1
  })

  return (
    <div>
      <PageHeader title="Roles & Access Rules" subtitle="Security groups and record-level access rules" />

      <div className="flex gap-2 mb-5">
        {(['groups','rules'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {t === 'groups' ? 'Security Groups' : 'Access Rules'}
          </button>
        ))}
      </div>

      {tab === 'groups' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.entries(ROLE_DEFINITIONS).map(([role, def]) => (
            <Card key={role} className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Shield size={16} className="text-gray-400" />
                  <span className="font-semibold text-gray-900">{role}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${def.color}`}>{role}</span>
                  <span className="text-xs text-gray-500">{roleCounts[role] ?? 0} users</span>
                </div>
              </div>
              <p className="text-xs text-gray-500 mb-3">{def.description}</p>
              <div className="flex flex-wrap gap-1">
                {def.permissions.map(p => (
                  <span key={p} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{p}</span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab === 'rules' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-100">
                  {['Rule Name','Applied To','Domain Filter','Groups'].map(h => (
                    <th key={h} className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {ACCESS_RULES.map(r => (
                  <tr key={r.name} className="hover:bg-gray-50">
                    <td className="py-3 pr-4 font-medium">{r.name}</td>
                    <td className="py-3 pr-4 text-gray-600">{r.appliedTo}</td>
                    <td className="py-3 pr-4 text-gray-600">{r.domainFilter}</td>
                    <td className="py-3">{r.groups}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
