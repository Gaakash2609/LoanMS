import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, AlertCircle } from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/Card'
import { SkeletonText } from '@/components/ui/Skeleton'
import { loansApi } from '@/api/loansApi'

// ── Required Documents checklist ────────────────────────────────────────
// Surfaces GET /api/loans/{id}/missing-documents (which had no React caller):
// the backend-authoritative required-document set (mandatory salary slip +
// bank statement; self-employed adds ITR/GST) and what is still outstanding.
// Mirrors legacy's pending-vs-"All Documents Uploaded ✅" checklist
// (efin-app.js:2909). Read-only — the actual required set is decided
// server-side so the rule stays single-sourced.

// Friendly labels for the backend's document-type keys. Exported + unit-tested.
export function requiredDocLabel(type: string): string {
  const map: Record<string, string> = {
    salary_slip: 'Salary Slips',
    bank_statement: 'Bank Statement',
    itr: 'Form 16 / ITR',
    gst: 'GST Registration',
  }
  return map[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function RequiredDocumentsChecklist({ loanId }: { loanId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['missing-documents', loanId],
    queryFn: () => loansApi.getMissingDocuments(loanId).then(r => r.data.data),
  })

  return (
    <Card className="mb-4">
      <CardHeader title="Required Documents" subtitle="Mandatory documents this application must carry" />
      {isLoading ? (
        <SkeletonText lines={2} className="py-2" />
      ) : !data ? (
        <p className="text-sm text-gray-400 py-2">Could not load the required-document status.</p>
      ) : data.isComplete ? (
        <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
          <CheckCircle2 size={20} className="text-green-600" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-green-800">All required documents attached</p>
            <p className="text-[11px] text-green-700 mt-0.5">Every mandatory document for this application is on file.</p>
          </div>
        </div>
      ) : (
        <ul className="space-y-2">
          {data.missingDocuments.map(d => (
            <li key={d.type} className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
              <AlertCircle size={18} className="text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-900">{requiredDocLabel(d.type)}</p>
                <p className="text-[11px] text-amber-700 mt-0.5">{d.reason}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
