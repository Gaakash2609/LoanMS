import { useState } from 'react'
import PerfiosUpload from './PerfiosUpload'
import PerfiosAnalysisResults from './PerfiosAnalysisResults'
import type { PerfiosUploadResult } from '@/hooks/usePerfiosUpload'

// ── Perfios workflow (Upload → Processing → Complete → Analysis Results) ──
// Pure composition/state-machine glue between the two existing pieces —
// no parsing, calculation, or save logic lives here. Kept out of
// LoanDetailPage.tsx to avoid growing that already-large file.
export default function PerfiosWorkflow({ loanId }: { loanId: number }) {
  const [result, setResult] = useState<PerfiosUploadResult | null>(null)

  if (result) {
    return <PerfiosAnalysisResults result={result} loanId={loanId} onReset={() => setResult(null)} />
  }
  return <PerfiosUpload onComplete={setResult} />
}
