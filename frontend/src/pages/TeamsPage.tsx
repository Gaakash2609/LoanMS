import { useQuery } from '@tanstack/react-query'
import { teamsApi } from '@/api/teamsApi'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import PageHeader from '@/components/shared/PageHeader'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Users } from 'lucide-react'

export default function TeamsPage() {
  const { data: teams, isLoading } = useQuery({
    queryKey: ['teams'],
    queryFn: () => teamsApi.getAll().then(r => r.data.data ?? []),
  })

  if (isLoading) return <LoadingSpinner size="lg" />

  return (
    <div>
      <PageHeader title="Teams" subtitle={`${teams?.length ?? 0} teams`} />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {(teams ?? []).map(team => (
          <Card key={team.id} className="p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="font-semibold text-gray-900">{team.name}</p>
                {team.locationName && <p className="text-xs text-gray-500">{team.locationName}</p>}
              </div>
              <Badge variant={team.type === 'Sales' ? 'info' : 'warning'}>{team.type}</Badge>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5 text-gray-600">
                <Users size={14} />
                <span>{team.memberCount} members</span>
              </div>
              {team.teamLeadName && (
                <div className="text-gray-600">
                  Lead: <span className="font-medium">{team.teamLeadName}</span>
                </div>
              )}
            </div>
          </Card>
        ))}
        {teams?.length === 0 && (
          <div className="col-span-3 text-center py-12 text-gray-400">No teams configured yet.</div>
        )}
      </div>
    </div>
  )
}
