import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { aiApi } from '@/api/aiApi'
import { Card } from '@/components/ui/Card'
import { Sparkles, ChevronDown, ChevronUp } from 'lucide-react'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'

interface Props {
  loanId?: number   // undefined or 0 = no loan context, show placeholder
  currentStage?: string  // eslint-disable-line @typescript-eslint/no-unused-vars
}

export default function AIInsightPanel({ loanId }: Props) {
  const [expanded, setExpanded] = useState(false)
  const hasLoan = typeof loanId === 'number' && loanId > 0

  const { data: statusData } = useQuery({
    queryKey: ['ai', 'status'],
    queryFn: () => aiApi.status().then(r => r.data.data),
    staleTime: 300_000,
  })

  const { data: insight, isLoading } = useQuery({
    queryKey: ['ai', 'loan', loanId, 'insight'],
    queryFn: () => aiApi.loanInsight(loanId!).then(r => r.data.data),
    // Only fetch when: panel expanded, AI enabled, AND we have a valid loanId
    enabled: expanded && !!statusData?.enabled && hasLoan,
    staleTime: 120_000,
  })

  const aiEnabled = statusData?.enabled

  return (
    <Card>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
        type="button"
      >
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
            aiEnabled && hasLoan ? 'bg-purple-100' : 'bg-gray-100'
          }`}>
            <Sparkles size={14} className={
              aiEnabled && hasLoan ? 'text-purple-600' : 'text-gray-400'
            } />
          </div>
          <span className="text-sm font-medium text-gray-900">AI Insight</span>
          {(!aiEnabled || !hasLoan) && (
            <span className="text-xs text-gray-400">
              {!hasLoan ? '(select a loan)' : '(disabled)'}
            </span>
          )}
        </div>
        {expanded
          ? <ChevronUp size={14} className="text-gray-400" />
          : <ChevronDown size={14} className="text-gray-400" />
        }
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          {!hasLoan ? (
            <p className="text-xs text-gray-500">
              AI insights are available on individual loan applications.
            </p>
          ) : !aiEnabled ? (
            <p className="text-xs text-gray-500">
              AI features are disabled. Set{' '}
              <code className="bg-gray-100 px-1 rounded">AI:Enabled=true</code>{' '}
              and configure an API key to activate smart loan insights.
            </p>
          ) : isLoading ? (
            <LoadingSpinner size="sm" />
          ) : (
            <p className="text-xs text-gray-700 leading-relaxed">
              {insight?.insight ?? 'No insight available.'}
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
