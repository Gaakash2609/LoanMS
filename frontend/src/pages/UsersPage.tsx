import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi } from '@/api/usersApi'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import DataTable, { type Column } from '@/components/shared/DataTable'
import PageHeader from '@/components/shared/PageHeader'
import { formatDate } from '@/utils/format'
import type { User } from '@/types'
import { UserCheck, UserX } from 'lucide-react'

const ROLE_VARIANTS: Record<string, 'info'|'success'|'warning'|'default'> = {
  Admin: 'info', Manager: 'success', Sales: 'warning', Partner: 'default',
}

export default function UsersPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['users', page, query],
    queryFn: () => usersApi.getAll(page, 20, query || undefined).then(r => r.data.data),
  })

  const toggle = useMutation({
    mutationFn: (id: number) => usersApi.toggleActive(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const columns: Column<User>[] = [
    { key: 'fullName', label: 'Name',  render: (u: User) => (
      <div><p className="font-medium">{u.fullName}</p><p className="text-xs text-gray-500">{u.email}</p></div>
    )},
    { key: 'role', label: 'Role', render: (u: User) => (
      <Badge variant={ROLE_VARIANTS[u.role] ?? 'default'}>{u.role}</Badge>
    )},
    { key: 'isActive', label: 'Status', render: (u: User) => (
      <Badge variant={u.isActive ? 'success' : 'danger'}>{u.isActive ? 'Active' : 'Inactive'}</Badge>
    )},
    { key: 'createdAt', label: 'Joined', render: (u: User) => formatDate(u.createdAt) },
    { key: 'actions', label: '', render: (u: User) => (
      <button
        onClick={() => toggle.mutate(u.id)}
        className={`p-1.5 rounded-lg transition-colors ${u.isActive ? 'text-red-500 hover:bg-red-50' : 'text-green-500 hover:bg-green-50'}`}
        title={u.isActive ? 'Deactivate' : 'Activate'}
      >
        {u.isActive ? <UserX size={14} /> : <UserCheck size={14} />}
      </button>
    )},
  ]

  return (
    <div>
      <PageHeader title="User Management" subtitle={`${data?.totalCount ?? 0} users`} />
      <Card>
        <form onSubmit={e => { e.preventDefault(); setQuery(search); setPage(1) }}
          className="flex gap-2 mb-5">
          <input
            type="text" placeholder="Search users..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
          />
          <Button type="submit" variant="secondary" size="sm">Search</Button>
        </form>
        <DataTable
          columns={columns} data={data?.items}
          isLoading={isLoading} totalPages={data?.totalPages}
          currentPage={page} onPageChange={setPage} totalCount={data?.totalCount}
        />
      </Card>
    </div>
  )
}
