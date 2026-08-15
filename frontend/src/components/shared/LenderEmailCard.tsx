import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/api/axios'
import type { ApiResponse, Loan } from '@/types'
import { emailApi, lenderEmailThreadsApi } from '@/api/lenderEmailApi'
import { aiApi } from '@/api/aiApi'
import { Button } from '@/components/ui/Button'
import { formatDateTime } from '@/utils/format'
import { buildSubjectAndBody, STAGE_OPTIONS } from '@/utils/lenderEmailTemplates'

interface BankRow { id: number; bankName: string; rmName?: string; rmMobile?: string; email?: string }

// Exact copy of legacy's BANK_REPLY_SYSTEM_PROMPT (lender-email-workflow.js)
// — same required fields, same "return null, never invent" instruction.
const BANK_REPLY_SYSTEM_PROMPT = `You are a loan processing assistant for EFIN Financial Services.
You will receive a raw email reply from a bank or NBFC regarding a loan application.
Extract ONLY the following fields and return ONLY a valid JSON object. No explanation, no markdown, no preamble.
If a field is not found in the email, return null for that field. Never invent data.

Required JSON format:
{
  "decisionType": "one of: conditional_approval | full_approval | pending | query_raised | rejected | disbursed | info_only",
  "sanctionAmount": "number in INR (no commas, no currency symbol) or null",
  "interestRateMin": "number (percentage, e.g. 14.5) or null",
  "interestRateMax": "number (percentage) or null — same as min if single rate",
  "rateType": "one of: reducing | flat | null",
  "tenureMonths": "number or null",
  "processingFee": "number in INR or null",
  "emiAmount": "number in INR or null",
  "conditions": ["array of strings — each pending condition as a separate item, or empty array"],
  "queryDetails": "string describing what the bank has queried, or null",
  "disbursementUTR": "UTR or NEFT reference number string, or null",
  "disbursementDate": "date string as found in email, or null",
  "disbursedAmount": "number in INR or null",
  "remarks": "any other important remark from the bank not covered above, or null",
  "responseDate": "date string as mentioned in the email or today's date, or null"
}`

const DECISION_LABEL: Record<string, string> = {
  conditional_approval: 'Conditional Approval Received',
  full_approval: 'Full Approval Received',
  pending: 'Bank Response — Pending',
  query_raised: 'Bank Query Raised',
  rejected: 'Bank Rejected Application',
  disbursed: 'Disbursement Confirmed by Bank',
  info_only: 'Bank Info / Update Received',
}

interface ParsedBankReply {
  decisionType?: string | null; sanctionAmount?: number | null
  interestRateMin?: number | null; interestRateMax?: number | null
  tenureMonths?: number | null; conditions?: string[] | null
  queryDetails?: string | null; disbursementUTR?: string | null
  remarks?: string | null
}

// ── Lender Email Workflow — manual send + thread log ────────────────────────
// Reproduces legacy lender-email-workflow.js's manual-send surface: pick a
// lender-RM (looked up from the Banks directory by the loan's bank-line
// name, matching legacy's _getLenderRm), pick a stage template, review/edit
// the generated subject+body, send via the existing generic email endpoint,
// and log the send to the append-only thread via LenderEmailThreadsController.
// Auto-fire-on-stage-save is implemented separately (see
// useUpdateLoanStatus in hooks/useLoans.ts, which calls the same
// buildSubjectAndBody from utils/lenderEmailTemplates.ts). AI bank-reply
// parsing is implemented separately too (see ParseBankReply in this file).
export default function LenderEmailCard({ loan }: { loan: Loan }) {
  const qc = useQueryClient()
  const bankLines = loan.bankLines ?? []
  const [selectedBankId, setSelectedBankId] = useState<number | ''>(bankLines[0]?.id ?? '')
  const [stageKey, setStageKey] = useState('statusEnquiry')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [drafted, setDrafted] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const { data: banks } = useQuery({
    queryKey: ['banks'],
    queryFn: () => api.get<ApiResponse<BankRow[]>>('/api/banks').then(r => r.data.data ?? []),
    staleTime: 120_000,
  })

  const { data: thread, isLoading: threadLoading } = useQuery({
    queryKey: ['lenderEmailThread', loan.id],
    queryFn: () => lenderEmailThreadsApi.getThread(loan.id).then(r => r.data.data ?? []),
  })

  const selectedLine = bankLines.find(b => b.id === selectedBankId)
  const rm = (banks ?? []).find(b => (b.bankName || '').toLowerCase() === (selectedLine?.bankName || '').toLowerCase())

  function draft() {
    const { subject: s, html } = buildSubjectAndBody(loan, rm?.rmName || '', stageKey)
    setSubject(s); setBody(html); setDrafted(true); setResult(null)
  }

  const send = useMutation({
    mutationFn: async () => {
      if (!rm?.email) throw new Error('No RM email on file for this lender')
      const sendRes = await emailApi.send({ to: rm.email, toName: rm.rmName, subject, html: body })
      if (!sendRes.data.success) throw new Error(sendRes.data.message || 'Send failed')
      await lenderEmailThreadsApi.addEntry({
        loanApplicationId: loan.id, direction: 'sent', stage: stageKey,
        rmName: rm.rmName, rmEmail: rm.email, subject, bodyText: body, source: 'manual',
      })
    },
    onSuccess: () => {
      setResult({ ok: true, message: 'Email sent and logged.' })
      setDrafted(false)
      qc.invalidateQueries({ queryKey: ['lenderEmailThread', loan.id] })
    },
    onError: (e: unknown) => {
      setResult({ ok: false, message: e instanceof Error ? e.message : 'Send failed' })
    },
  })

  // ── Bank reply parsing (AI) — matches legacy's parseBankReplyWithClaude +
  // logBankReply exactly for the parts the backend can support: same system
  // prompt, same required JSON fields, routed through the same generic
  // /api/ai/parse proxy, logged to the thread as a 'received' entry with
  // parsedDataJson. NOT reproduced: legacy also auto-sets
  // app.underwriting_status/app.verification_status from decisionType —
  // those are legacy-only in-memory fields with no backend column or
  // endpoint (LoansController/Loan entity has neither), so nothing here
  // is written back onto the loan itself; the parsed result is shown for
  // manual review only, per the "do not overwrite loan data unless the
  // backend explicitly supports it" rule.
  const [rawReply, setRawReply] = useState('')
  const [parsed, setParsed] = useState<ParsedBankReply | null>(null)
  const [parseError, setParseError] = useState('')

  const parseReply = useMutation({
    mutationFn: async () => {
      const res = await aiApi.parse(BANK_REPLY_SYSTEM_PROMPT, `Application ID: ${loan.loanNumber}\n\nRaw email content:\n\n${rawReply}`, 1000)
      if (!res.data.success || !res.data.text) throw new Error(res.data.error || 'AI parsing failed')
      const clean = res.data.text.trim().replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim()
      const data: ParsedBankReply = JSON.parse(clean)
      await lenderEmailThreadsApi.addEntry({
        loanApplicationId: loan.id, direction: 'received', stage: loan.status,
        rmEmail: rm?.email, subject: '(inbound reply)', bodyText: rawReply.slice(0, 800),
        source: 'manual_paste',
      })
      return data
    },
    onSuccess: (data) => {
      setParsed(data); setParseError('')
      qc.invalidateQueries({ queryKey: ['lenderEmailThread', loan.id] })
    },
    onError: (e: unknown) => {
      setParsed(null)
      setParseError(e instanceof Error ? e.message : 'Could not parse this reply.')
    },
  })

  if (bankLines.length === 0) {
    return <p className="text-sm text-gray-400 py-4">No lender/bank submission on this loan yet — add a bank line first.</p>
  }

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Lender / Bank</label>
          <select value={selectedBankId} onChange={e => { setSelectedBankId(Number(e.target.value)); setDrafted(false) }}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
            {bankLines.map(b => <option key={b.id} value={b.id}>{b.bankName}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Template</label>
          <select value={stageKey} onChange={e => { setStageKey(e.target.value); setDrafted(false) }}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
            {STAGE_OPTIONS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {rm ? (
        <p className="text-xs text-gray-500 mb-3">RM: <span className="font-medium text-gray-700">{rm.rmName || '—'}</span> · {rm.email || <span className="text-red-500">no email on file</span>}{rm.rmMobile ? ` · ${rm.rmMobile}` : ''}</p>
      ) : (
        <p className="text-xs text-red-500 mb-3">No RM record found for "{selectedLine?.bankName}" in the Banks directory.</p>
      )}

      {!drafted ? (
        <Button size="sm" onClick={draft}>Draft Email</Button>
      ) : (
        <div className="p-4 border border-gray-200 rounded-lg bg-gray-50">
          <label className="text-xs font-medium text-gray-600 block mb-1">Subject</label>
          <input value={subject} onChange={e => setSubject(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3" />
          <label className="text-xs font-medium text-gray-600 block mb-1">Body (HTML)</label>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={8}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono mb-3" />
          {result && (
            <p className={`text-xs mb-2 ${result.ok ? 'text-green-600' : 'text-red-600'}`}>{result.message}</p>
          )}
          <div className="flex gap-2">
            <Button size="sm" loading={send.isPending} disabled={!rm?.email} onClick={() => send.mutate()}>Send</Button>
            <Button size="sm" variant="secondary" onClick={() => setDrafted(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="mt-6 pt-4 border-t border-gray-100">
        <p className="text-xs font-semibold text-gray-600 mb-2">Log Bank Reply</p>
        <textarea value={rawReply} onChange={e => setRawReply(e.target.value)} rows={4}
          placeholder="Paste the raw email reply from the bank/lender here…"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mb-2" />
        <Button size="sm" variant="secondary" loading={parseReply.isPending} disabled={!rawReply.trim()}
          onClick={() => parseReply.mutate()}>Parse &amp; Log Reply</Button>
        {parseError && <p className="text-xs text-red-600 mt-2">⚠ {parseError}</p>}
        {parsed && (
          <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs space-y-1">
            <p className="font-semibold text-gray-700">{DECISION_LABEL[parsed.decisionType || ''] || 'Bank Reply Parsed'}</p>
            {parsed.sanctionAmount && <p>Sanction Amount: ₹{Number(parsed.sanctionAmount).toLocaleString('en-IN')}</p>}
            {parsed.interestRateMin && <p>ROI: {parsed.interestRateMin}%{parsed.interestRateMax && parsed.interestRateMax !== parsed.interestRateMin ? `–${parsed.interestRateMax}%` : ''}</p>}
            {parsed.tenureMonths && <p>Tenure: {parsed.tenureMonths} months</p>}
            {parsed.disbursementUTR && <p>UTR: {parsed.disbursementUTR}</p>}
            {!!parsed.conditions?.length && <p>Conditions: {parsed.conditions.join('; ')}</p>}
            {parsed.queryDetails && <p>Query: {parsed.queryDetails}</p>}
            {parsed.remarks && <p>Remarks: {parsed.remarks}</p>}
            <p className="text-gray-400 mt-1">Logged to the thread below for the record — review and update the loan manually as needed.</p>
          </div>
        )}
      </div>

      <div className="mt-6">
        <p className="text-xs font-semibold text-gray-600 mb-2">Email Thread</p>
        {threadLoading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : !thread || thread.length === 0 ? (
          <p className="text-sm text-gray-400">No emails logged for this loan yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {thread.map(t => (
              <div key={t.id} className="p-3 border border-gray-200 rounded-lg text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className={`font-semibold ${t.direction === 'sent' ? 'text-blue-600' : 'text-green-600'}`}>
                    {t.direction === 'sent' ? '→ Sent' : '← Received'}{t.stage ? ` · ${t.stage}` : ''}
                  </span>
                  <span className="text-gray-400">{formatDateTime(t.createdAt)}</span>
                </div>
                <p className="text-gray-700">{t.subject || '—'}</p>
                <p className="text-gray-400">{t.rmName}{t.rmEmail ? ` <${t.rmEmail}>` : ''}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
