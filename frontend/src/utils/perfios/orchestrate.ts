import type { PerfiosUploadResult } from '@/hooks/usePerfiosUpload'
import { buildAnalysisData, buildBreakupData, buildEODData, buildFinOneData } from '@/utils/perfios/analysis'
import type { AnalysisRow, BreakupData, EodData, FinOneRow } from '@/utils/perfios/types'

// ── Perfios full analysis orchestration ──────────────────────────────────
// Legacy's finalizeProcessing (perfios-core.js:1404-1607) computes
// allTxns/salaryTxns/.../targetRows/abbData/monthOrder/validChecks FIRST
// (all already done in Phase 2's usePerfiosUpload.finalize()), THEN calls
// renderFinOneTable/renderAnalysisTable/renderBreakupTables/renderEODTable
// — each of which internally calls buildFinOneData/buildAnalysisData/
// buildBreakupData/buildEODData using that same allTxns + monthOrder. This
// orchestration reproduces exactly that second step: same four functions,
// same inputs (Phase 2's allTxns/monthOrder/abbData), same order, called
// only when the results view actually needs them — no recomputation, no
// new formulas.
export interface PerfiosFullAnalysis {
  upload: PerfiosUploadResult
  finOne: FinOneRow[]
  analysis: AnalysisRow[]
  breakup: BreakupData
  eod: EodData
}

export function buildFullAnalysis(upload: PerfiosUploadResult): PerfiosFullAnalysis {
  const { allTxns, monthOrder, abbData } = upload
  return {
    upload,
    finOne: buildFinOneData(allTxns, monthOrder, abbData),
    analysis: buildAnalysisData(allTxns, monthOrder),
    breakup: buildBreakupData(allTxns, monthOrder),
    eod: buildEODData(allTxns, monthOrder),
  }
}
