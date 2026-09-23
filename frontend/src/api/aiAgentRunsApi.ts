import api from './axios'
import type { ApiResponse } from '@/types'

// ── AI Agent (Akshiv) run history ───────────────────────────────────────────
// Ports the legacy bridge wrappers in api-bridge.js:1842 / :1845 / :1848 onto
// AiAgentRunsController, which is [Authorize] at class level
// (AiAgentRunsController.cs:20) — i.e. any authenticated user may read, start
// and update runs, with no role restriction. That is deliberate and matches
// legacy: the agent runs client-side under whichever user triggered it.
//
// Route note: the controller inherits BaseController's [Route("api/[controller]")]
// so it is served at /api/AiAgentRuns. ASP.NET route matching is
// case-insensitive, so the lowercase spelling legacy used works identically —
// the canonical casing is used here to match the controller name.
//
// `stepsJson` is stored as an opaque JSON string server-side
// (AiAgentRunsController.cs:73). It is parsed defensively on read because a
// malformed value must degrade to "no steps", never break the panel — same
// try/catch legacy used at ai-agent.js:95.

/** One row as GetRuns projects it (AiAgentRunsController.cs:34-37). */
export interface AiAgentRunRow {
  id: number
  runId: string
  startedAt: string
  finishedAt?: string | null
  status: string
  error?: string | null
  stepsJson?: string | null
}

/** A step as ai-agent.js:_logStep appends it. */
export interface AiAgentRunStep {
  ts?: string
  stage?: string
  action?: string
  result?: string
  detail?: string
}

/** Server row with `stepsJson` already parsed — what the UI renders. */
export interface AiAgentRun extends Omit<AiAgentRunRow, 'stepsJson'> {
  steps: AiAgentRunStep[]
}

export interface AiAgentRunUpdate {
  stepsJson?: string
  status?: string
  error?: string | null
}

/** Mirrors legacy ai-agent.js:93-104 — tolerate bad JSON, never throw. */
export function parseSteps(stepsJson?: string | null): AiAgentRunStep[] {
  if (!stepsJson) return []
  try {
    const parsed = JSON.parse(stepsJson)
    return Array.isArray(parsed) ? (parsed as AiAgentRunStep[]) : []
  } catch {
    return []
  }
}

export const aiAgentRunsApi = {
  /** Newest first, server caps at 20 (AiAgentRunsController.cs:33). */
  list: (loanApplicationId: number) =>
    api.get<ApiResponse<AiAgentRunRow[]>>(`/api/AiAgentRuns/${loanApplicationId}`),

  /** Server generates a RunId when one isn't supplied (AiAgentRunsController.cs:56). */
  start: (loanApplicationId: number, runId?: string) =>
    api.post<ApiResponse<{ id: number }>>('/api/AiAgentRuns', { loanApplicationId, runId }),

  update: (id: number, patch: AiAgentRunUpdate) =>
    api.put<ApiResponse<boolean>>(`/api/AiAgentRuns/${id}`, patch),
}
