import type { AiAgentRunStep } from '@/api/aiAgentRunsApi'

// AI Agent (Akshiv) readiness loop — restores the automation legacy ai-agent.js
// ran client-side (_startRun → _crossVerifySalary / _extractBankDetails /
// _checkDocs / bureau / summary). It automates the login-team's manual
// readiness checks over the application's REAL data (no business logic is
// duplicated — it reads what KYC/Income/Perfios/Documents features already
// produce) and records an audit trail of steps that persists server-side
// (PUT /api/AiAgentRuns/{id}). Pure + unit-tested; the async data-gathering and
// the optional AI-narrative step live in the panel.

export interface AgentCheckInput {
  panNumber?: string | null
  monthlyIncome?: number | null
  cibilScore?: number | null
  missingDocTypes: string[]
  bankVerified: boolean
  bankAbb?: number | null
  status: string
}

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')

export function buildAgentSteps(i: AgentCheckInput): AiAgentRunStep[] {
  const ts = () => new Date().toISOString()
  const steps: AiAgentRunStep[] = []

  // KYC
  steps.push({
    ts: ts(), stage: 'KYC', action: 'PAN on record',
    result: i.panNumber ? 'PASS' : 'MISSING',
    detail: i.panNumber ? 'Customer PAN captured' : 'No PAN on the customer record',
  })

  // Income
  const inc = i.monthlyIncome || 0
  steps.push({
    ts: ts(), stage: 'Income', action: 'Monthly income verified',
    result: inc > 0 ? 'PASS' : 'MISSING',
    detail: inc > 0 ? `${inr(inc)} / month on record` : 'No verified monthly income (run Income Check)',
  })

  // Banking (Perfios)
  steps.push({
    ts: ts(), stage: 'Banking', action: 'Bank statement (Perfios)',
    result: i.bankVerified ? 'PASS' : 'PENDING',
    detail: i.bankVerified
      ? `Verified statement on file${i.bankAbb != null ? ` · ABB ${inr(i.bankAbb)}` : ''}`
      : 'No verified bank statement analysed yet',
  })

  // CIBIL
  const cibil = i.cibilScore || 0
  steps.push({
    ts: ts(), stage: 'CIBIL', action: 'Bureau score',
    result: cibil >= 700 ? 'PASS' : cibil > 0 ? 'REVIEW' : 'MISSING',
    detail: cibil > 0 ? `Score ${cibil}${cibil < 700 ? ' — below 700, manual review' : ''}` : 'No bureau score on record',
  })

  // Documents
  const missing = i.missingDocTypes
  steps.push({
    ts: ts(), stage: 'Documents', action: 'Required documents',
    result: missing.length === 0 ? 'PASS' : 'PENDING',
    detail: missing.length === 0 ? 'All required documents present' : `${missing.length} pending: ${missing.join(', ')}`,
  })

  // Summary — READY only when no mandatory item is MISSING.
  const missingCount = steps.filter(s => s.result === 'MISSING').length
  const pendingCount = steps.filter(s => s.result === 'PENDING' || s.result === 'REVIEW').length
  steps.push({
    ts: ts(), stage: 'Summary', action: `Readiness at status "${i.status}"`,
    result: missingCount === 0 ? (pendingCount === 0 ? 'READY' : 'READY_WITH_FOLLOWUPS') : 'INCOMPLETE',
    detail: missingCount === 0
      ? (pendingCount === 0 ? 'All mandatory checks satisfied' : `${pendingCount} follow-up item(s) pending`)
      : `${missingCount} mandatory item(s) missing`,
  })

  return steps
}
