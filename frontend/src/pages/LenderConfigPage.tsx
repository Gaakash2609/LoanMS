import { useQuery } from '@tanstack/react-query'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { Card } from '@/components/ui/Card'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import PageHeader from '@/components/shared/PageHeader'
import { Settings } from 'lucide-react'

interface LenderProduct {
  id: number; name: string; loanType: string; minAmount: number; maxAmount: number
  minTenure: number; maxTenure: number; minCibil: number; isActive: boolean
}

export default function LenderConfigPage() {
  const { data: products, isLoading } = useQuery({
    queryKey: ['lender-config'],
    queryFn: () => api.get<ApiResponse<LenderProduct[]>>('/api/lender-config').then(r => r.data.data ?? []),
    staleTime: 120_000,
  })

  return (
    <div>
      <PageHeader title="Lender Configuration" subtitle="Loan product and eligibility settings"
        action={<Settings size={16} className="text-gray-400" />} />
      {isLoading ? <LoadingSpinner /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {(products ?? []).map(p => (
            <Card key={p.id} className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-semibold text-gray-900">{p.name}</p>
                  <p className="text-xs text-gray-500">{p.loanType}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {p.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><p className="text-gray-500">Amount Range</p><p className="font-medium">₹{(p.minAmount/100000).toFixed(0)}L – ₹{(p.maxAmount/100000).toFixed(0)}L</p></div>
                <div><p className="text-gray-500">Tenure</p><p className="font-medium">{p.minTenure}–{p.maxTenure} months</p></div>
                <div><p className="text-gray-500">Min CIBIL</p><p className="font-medium">{p.minCibil}</p></div>
              </div>
            </Card>
          ))}
          {!products?.length && (
            <div className="col-span-3 text-center py-12 text-gray-400 text-sm">
              No lender products configured. Add products via the admin settings or backend seed data.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
