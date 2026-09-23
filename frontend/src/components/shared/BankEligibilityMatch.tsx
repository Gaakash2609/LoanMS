import { useState, useEffect, useRef, useMemo, type ReactNode, type KeyboardEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Landmark, CheckCircle2, Check, Info } from 'lucide-react'
import { InlineLoader } from '@/components/ui/LoadingSpinner'
import { LOAN_PRODUCT_META } from '@/components/shared/LoanProductSelectorModal'
import { emiReducing } from '@/utils/emi'
import { lenderConfigApi, type MatchRequest, type MatchResponse } from '@/api/lenderConfigApi'
import { banksApi, normalizeLoanType, type BankConfig, type BankProductRule } from '@/api/banksApi'

// ── Bank Eligibility Matching (New Application → Step 9 "Loan Analytics") ──
// Ports legacy's laLoadEligibility()/laSaveEligibility() — the wizard's
// final step runs the applicant profile through the lender-matching engine
// (POST /api/lenderconfig/match), shows the eligible banks as "Recommended
// For You" cards, and lets the user pick up to 2 banks (Personal Loan) / 3
// (every other product) to proceed with.
//
// Layout + look mirror the Vanilla page: "N banks eligible (M excluded)" chip →
// Recommended For You + Save Bank Selection → bank cards → excluded-banks
// notice → Selected Banks strip. Matching runs automatically on entering the
// step (Vanilla has no "Check Eligibility" button); the wizard's own Back /
// Submit footer follows this block.
//
// Selection is held in component state and surfaced to the parent via
// onSelectionChange on every toggle; the wizard submits it alongside the rest
// of the application. There is no dedicated "save selected banks" endpoint on
// this codebase's backend, so "Save Bank Selection" only confirms the current
// selection — nothing is persisted separately here.

export interface SelectedBank { bankId: number; bankName: string }

type BankResult = NonNullable<MatchResponse['results']>[number]

// Per-bank display figures Vanilla shows on each card (efin-app.js
// laLoadEligibility's card render). These are NOT stored on, or returned by,
// the match engine — Vanilla derived them CLIENT-SIDE from each bank's
// configured rules (minCibil / foirLimit / isIncred / isElite), so the /match
// result only needs to carry {bankId, eligible, score}. Here we do the exact
// same derivation, sourcing the rules from the existing /api/banks projection
// (BankConfig) rather than re-fetching a separate contract.
interface BankCardMeta {
  interestRate?: number      // heuristic ROI from min-CIBIL (Vanilla's displayRate)
  minCibil?: number          // real configured minimum (per-product effective)
  approvalLabel?: string     // High / Medium / Low from min-CIBIL
  approvalPct?: number       // ~% approval chance from min-CIBIL
  processingTime?: string    // '2–3 Days' / '3–5 Days' / '5–7 Days' by tier
  foirLimit?: number         // real configured FOIR ceiling (per-product effective)
  maxLoanAmt?: number        // for the "Upto ₹XL" fallback when no wizard amount
  maxTenure?: number         // for the "Upto X Mo" fallback when no wizard tenure
  tags: string[]             // InCred / Elite / Open List pills
}

// Resolve a bank's EFFECTIVE rule for the requested product, mirroring the
// backend engine's per-field fallback (LenderConfigController.Match): a
// per-product BankProductRule overrides the base BankMaster column field by
// field; a blank per-product field inherits the base value.
function effectiveRule(bank: BankConfig | undefined, reqLoanType: string) {
  const rule: BankProductRule | undefined =
    bank?.productRules?.find(r => normalizeLoanType(r.productKey) === reqLoanType)
  const pick = (r?: number | null, base?: number | null) =>
    (r != null ? r : base) ?? undefined
  return {
    minCibil:   pick(rule?.minCibil,   bank?.minCibil),
    foirLimit:  pick(rule?.foirLimit,  bank?.foirLimit),
    maxLoanAmt: pick(rule?.maxLoanAmt, bank?.maxLoanAmt),
    maxTenure:  pick(rule?.maxTenure,  bank?.maxTenure),
  }
}

// Derive the card figures from the bank's configured rules, exactly as
// Vanilla's laLoadEligibility did. Defaults mirror Vanilla's `minCibil || 650`
// / `|| 12` branches, so a bank whose config could not be loaded (e.g. a role
// without the Banks menu) still renders sensible numbers instead of blanks.
function deriveBankMeta(bank: BankConfig | undefined, reqLoanType: string): BankCardMeta {
  const eff = effectiveRule(bank, reqLoanType)
  const isIncred = !!bank?.isIncred
  const isElite  = !!bank?.isElite
  const isOpenList = !!bank && (bank.lines?.length ?? 0) === 0

  // Interest rate — Vanilla: minCibil ? max(9, 24 - ((minCibil-650)/100)*8) : 12
  const interestRate = eff.minCibil
    ? Math.round(Math.max(9, 24 - ((eff.minCibil - 650) / 100) * 8) * 100) / 100
    : undefined

  // Approval band — Vanilla: cibil = minCibil || 650
  const cibil = eff.minCibil || 650
  const approvalPct = cibil <= 680 ? 92 : cibil <= 720 ? 85 : cibil <= 750 ? 76 : 68
  const approvalLabel = approvalPct >= 88 ? 'High' : approvalPct >= 78 ? 'Medium' : 'Low'

  const processingTime = isIncred ? '2–3 Days' : isElite ? '3–5 Days' : '5–7 Days'

  const tags: string[] = []
  if (isIncred) tags.push('InCred')
  if (isElite)  tags.push('Elite')
  if (isOpenList) tags.push('Open List')

  return {
    interestRate,
    minCibil: eff.minCibil,
    approvalLabel,
    approvalPct,
    processingTime,
    foirLimit: eff.foirLimit,
    maxLoanAmt: eff.maxLoanAmt,
    maxTenure: eff.maxTenure,
    tags,
  }
}

// ── Look (matches the Vanilla cards) ─────────────────────────────────────
const NAVY = '#0f2a5c'
const LABEL_BLUE = '#085897'

// Tag-pill colours — Vanilla's InCred (amber) / Elite (red) / Open-List (blue)
// pill palette (efin-app.js tagPills).
const TAG_STYLE: Record<string, { color: string; background: string }> = {
  'InCred':    { color: '#b45309', background: 'rgba(245,158,11,.13)' },
  'Elite':     { color: '#b91c1c', background: 'rgba(212,43,43,.10)' },
  'Open List': { color: '#0369a1', background: 'rgba(3,105,161,.10)' },
}

// Logo-tile tints — Vanilla colours each bank's initials tile; a stable hash of
// the bank name picks one so a bank keeps its colour across renders.
const BANK_TINTS = [
  { fg: '#085897', bg: '#eaf1ff', bd: '#d3e2fb' },
  { fg: '#c2570c', bg: '#fdf1e6', bd: '#f6dcc3' },
  { fg: '#0e9f6e', bg: '#e8f8f1', bd: '#c9efdf' },
  { fg: '#6d3fc4', bg: '#f1ecfc', bd: '#ddd0f6' },
  { fg: '#0e7c86', bg: '#e6f6f8', bd: '#c6e8ec' },
]
function tintFor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return BANK_TINTS[h % BANK_TINTS.length]
}

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')

function initials(name: string) {
  const w = name.trim().split(/\s+/).filter(Boolean)
  return ((w[0]?.[0] ?? '') + (w[1]?.[0] ?? '')).toUpperCase() || '🏦'
}

function Metric({ label, value, pre, foot }: { label: string; value: string; pre?: string; foot?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-bold uppercase tracking-wide" style={{ color: LABEL_BLUE }}>{label}</div>
      {pre && <div className="text-[11.5px] leading-tight text-gray-500 mt-0.5">{pre}</div>}
      <div className="text-[17px] font-extrabold leading-tight truncate" style={{ color: NAVY }}>{value}</div>
      {foot && (
        <div className="mt-0.5 flex items-center gap-1 text-[10.5px] text-gray-500">
          <Landmark size={10} /> {foot}
        </div>
      )}
    </div>
  )
}

function InfoChip({ label, value, tone }: { label: string; value: string; tone: 'warn' | 'neutral' | 'success' }) {
  const t = {
    warn:    { color: 'var(--warn)',    bg: 'rgba(230, 126, 0, .10)' },
    neutral: { color: 'var(--text2)',   bg: 'var(--surface2)' },
    success: { color: 'var(--success)', bg: 'rgba(26, 115, 64, .08)' },
  }[tone]
  return (
    <div className="flex-1 min-w-0 rounded-lg px-2 py-1.5 text-center" style={{ background: t.bg }}>
      <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-[11px] font-bold truncate" style={{ color: t.color }}>{value}</div>
    </div>
  )
}

export default function BankEligibilityMatch({
  request, selected, onSelectionChange, interestRate,
}: {
  request: MatchRequest
  selected: SelectedBank[]
  onSelectionChange: (banks: SelectedBank[]) => void
  /** Wizard's loan interest rate (% p.a.) — used for the per-card EMI when the bank carries no rate of its own. */
  interestRate?: number
}) {
  const [result, setResult] = useState<MatchResponse | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [hint, setHint] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const started = useRef(false)
  // Max banks selectable = Vanilla laMaxBanks(loanType) (efin-app.js:15835):
  // Personal Loan → 2, every other product → 3.
  const maxSelection = request.loanType === 'personal_loan' ? 2 : 3

  // Bank config feeds the per-card figures (interest rate, approval, processing,
  // FOIR limit, InCred/Elite/Open-List tags) — Vanilla derived these from the
  // bank rules it already had in memory (LA_DB.banks). We reuse the existing
  // /api/banks/lookup projection (menu-permission-free — see banksApi.getLookup)
  // so every role that reaches this wizard step gets real bank eligibility data
  // instead of falling back to Vanilla's no-config defaults.
  const bankConfigQuery = useQuery({
    queryKey: ['eligibility-bank-configs'],
    queryFn: () => banksApi.getLookup().then(r => r.data.data ?? []),
    staleTime: 60_000,
    retry: false,
  })
  const bankById = useMemo(() => {
    const m = new Map<number, BankConfig>()
    ;(bankConfigQuery.data ?? []).forEach(b => m.set(b.id, b))
    return m
  }, [bankConfigQuery.data])
  const reqLoanType = normalizeLoanType(request.loanType)

  const run = useMutation({
    mutationFn: () => lenderConfigApi.match(request).then(r => r.data.data),
    onSuccess: (data) => { setError(''); setResult(data ?? null) },
    onError: (err: unknown) => {
      const d = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      setError(d?.message || d?.errors?.join(' ') || 'Could not run bank matching. Please try again.')
    },
  })

  // Vanilla laLoadEligibility() runs on entering the step — no manual button.
  useEffect(() => {
    if (started.current) return
    started.current = true
    run.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggle(bankId: number, bankName: string) {
    setSaved(false)
    setHint('')
    if (selected.some(b => b.bankId === bankId)) {
      onSelectionChange(selected.filter(b => b.bankId !== bankId))
    } else if (selected.length < maxSelection) {
      onSelectionChange([...selected, { bankId, bankName }])
    }
  }

  function saveSelection() {
    if (selected.length < 1) { setSaved(false); setHint('Select at least 1 bank to save.'); return }
    setHint('')
    setSaved(true)
  }

  const all = result?.results ?? []
  const ranked = all.filter((r: BankResult) => r.eligible).sort((a: BankResult, b: BankResult) => b.score - a.score)
  const excluded = all.filter((r: BankResult) => !r.eligible)
  const productLabel = LOAN_PRODUCT_META.find(p => p.value === request.loanType)?.label ?? ''
  const amount = request.loanAmount ?? 0
  const months = request.tenure ?? 0

  return (
    <div className="space-y-5">
      {run.isPending && !result && (
        <p className="text-xs text-gray-500 flex items-center gap-2"><InlineLoader size={14} /> Matching banks to profile…</p>
      )}

      {error && (
        <div
          className="text-xs rounded-lg px-3 py-2 flex items-center justify-between gap-3"
          style={{ color: 'var(--danger)', background: 'rgba(192, 57, 43, .1)', border: '1px solid rgba(192, 57, 43, .25)' }}
        >
          <span>{error}</span>
          <button type="button" className="font-semibold underline shrink-0" onClick={() => run.mutate()}>Try again</button>
        </div>
      )}

      {result && (
        <>
          {result.awaitingDetails && (
            <div
              className="text-xs rounded-lg px-3 py-2"
              style={{ color: 'var(--warn)', background: 'rgba(230, 126, 0, .08)', border: '1px solid rgba(230, 126, 0, .25)' }}
            >
              Some profile details are still missing — results may be incomplete. Fill in income, CIBIL, employment type
              and PIN code on the earlier steps for an accurate match.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-efin-blue/10 px-3 py-1 text-xs font-semibold text-efin-blue">
              <Landmark size={12} /> {ranked.length} bank{ranked.length === 1 ? '' : 's'} eligible
            </span>
            <span className="text-[11px] text-gray-400">({excluded.length} excluded)</span>
          </div>

          {ranked.length === 0 ? (
            <p className="text-xs text-gray-500 py-3">
              No banks matched this profile. Adjust the loan amount, tenure or check the applicant's CIBIL and income.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[22px] font-extrabold leading-tight" style={{ color: NAVY }}>Recommended For You</p>
                  <p className="text-[13px] text-gray-500 mt-0.5">Tailored to your profile · Tap a card to select</p>
                </div>
                <button
                  type="button"
                  onClick={saveSelection}
                  className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-transform hover:-translate-y-px"
                  style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)', boxShadow: '0 6px 16px rgba(22,163,74,.28)' }}
                >
                  <Check size={15} strokeWidth={3} /> {saved ? 'Selection Saved' : 'Save Bank Selection'}
                </button>
              </div>
              {hint && <p className="text-[12px] -mt-3" style={{ color: 'var(--danger)' }}>{hint}</p>}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {ranked.map((b: BankResult, idx: number) => {
                  const on = selected.some(s => s.bankId === b.bankId)
                  const atLimit = !on && selected.length >= maxSelection
                  const meta = deriveBankMeta(bankById.get(b.bankId), reqLoanType)
                  const tint = tintFor(b.bankName)
                  // Rate — Vanilla: wizard rate first, then the min-CIBIL heuristic, else 12.
                  const roi = interestRate && interestRate > 0 ? interestRate : (meta.interestRate ?? 12)
                  const emi = amount > 0 && months > 0 && roi > 0 ? emiReducing(amount, roi, months).emi : 0
                  // Match-score bar — Vanilla normalises the raw score against an
                  // ~80-point ceiling (scoreBarWidth), not a straight 0-100.
                  const pct = Math.max(0, Math.min(100, Math.round((b.score / 80) * 100)))
                  const approval = [meta.approvalLabel, meta.approvalPct != null ? `~${meta.approvalPct}%` : undefined]
                    .filter(Boolean).join(' · ')
                  const open = openId === b.bankId

                  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
                    if (e.target !== e.currentTarget) return
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!atLimit) toggle(b.bankId, b.bankName) }
                  }

                  return (
                    <div
                      key={b.bankId}
                      role="button"
                      tabIndex={0}
                      aria-pressed={on}
                      onKeyDown={onKey}
                      onClick={() => { if (!atLimit) toggle(b.bankId, b.bankName) }}
                      title={atLimit ? `You can select up to ${maxSelection} banks` : undefined}
                      className={`relative rounded-2xl p-5 transition-all ${
                        atLimit ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:-translate-y-px'
                      }`}
                      style={{
                        border: on ? '2px solid #085897' : '2px solid #d5def0',
                        background: on ? 'linear-gradient(180deg, #f3f7ff 0%, #ffffff 70%)' : 'linear-gradient(180deg, #fafcff 0%, #ffffff 70%)',
                        boxShadow: on ? '0 8px 24px rgba(8,88,151,.16)' : '0 2px 10px rgba(8,88,151,.06)',
                      }}
                    >
                      {on && (
                        <span
                          aria-hidden
                          className="absolute left-4 right-24 -top-px h-[3px] rounded-b"
                          style={{ background: 'linear-gradient(90deg, #085897, #4f8bff)' }}
                        />
                      )}
                      {idx === 0 && (
                        <span
                          className="absolute -top-px right-6 rounded-b-lg px-3 py-1 text-[10px] font-extrabold tracking-wider text-white"
                          style={{ background: 'linear-gradient(135deg, #085897, #3b7bf0)' }}
                        >
                          BEST MATCH
                        </span>
                      )}

                      <div className="flex items-start gap-3.5 pt-1">
                        <div
                          className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl text-[15px] font-extrabold"
                          style={{ color: tint.fg, background: tint.bg, border: `1px solid ${tint.bd}` }}
                        >
                          {initials(b.bankName)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[15.5px] font-extrabold leading-snug" style={{ color: NAVY }}>
                            {b.bankName}{productLabel ? ` ${productLabel}` : ''}
                          </p>
                          {meta.tags.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {meta.tags.map(tag => (
                                <span
                                  key={tag}
                                  title={tag === 'Open List' ? 'Open to all employers' : undefined}
                                  className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                                  style={TAG_STYLE[tag] ?? { color: '#c2570c', background: '#fdf1e6' }}
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <span
                          aria-hidden
                          className="mt-1 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-white"
                          style={on
                            ? { background: 'linear-gradient(135deg, #085897, #3b7bf0)', border: '2px solid #085897' }
                            : { background: '#fff', border: '2px solid #c9d6ee' }}
                        >
                          {on && <Check size={14} strokeWidth={3.5} />}
                        </span>
                      </div>

                      <div className="mt-4 border-t pt-4" style={{ borderColor: '#e3eaf7' }}>
                        <div className="flex items-center justify-between text-[10.5px] font-bold uppercase tracking-wide" style={{ color: LABEL_BLUE }}>
                          <span>Match Score</span><span style={{ color: NAVY }}>{pct}%</span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full" style={{ background: '#e6edf9' }}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #085897, #4f8bff)' }} />
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
                        <Metric
                          label="Loan Amount"
                          value={amount > 0 ? inr(amount) : (meta.maxLoanAmt ? `Upto ₹${Math.round(meta.maxLoanAmt / 100000)}L` : '—')}
                        />
                        <Metric
                          label="Interest Rate" pre="starting at,"
                          value={roi > 0 ? `${roi}%` : '—'}
                          foot={meta.minCibil ? `CIBIL ${meta.minCibil}+` : undefined}
                        />
                        <Metric
                          label="Tenure"
                          value={months > 0 ? `${months} Months` : (meta.maxTenure ? `Upto ${meta.maxTenure} Mo` : '—')}
                        />
                        <Metric label="EMI" pre="From," value={emi > 0 ? inr(emi) : '—'} />
                      </div>

                      {(approval || meta.processingTime || meta.foirLimit != null) && (
                        <div className="mt-4 flex gap-2">
                          {approval && <InfoChip label="Approval" value={approval} tone="warn" />}
                          {meta.processingTime && <InfoChip label="Processing" value={meta.processingTime} tone="neutral" />}
                          {meta.foirLimit != null && (
                            <InfoChip label="FOIR Limit" value={`${meta.foirLimit}%`} tone="success" />
                          )}
                        </div>
                      )}

                      <div className="mt-4 grid grid-cols-[1fr_1.15fr] gap-3">
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); setOpenId(open ? null : b.bankId) }}
                          className="rounded-xl bg-white py-2.5 text-[13px] font-bold transition-colors hover:bg-efin-blue/5"
                          style={{ color: LABEL_BLUE, border: '1.5px solid #085897' }}
                        >
                          {open ? 'Hide Details' : 'Know More'}
                        </button>
                        <button
                          type="button"
                          disabled={atLimit}
                          onClick={e => { e.stopPropagation(); toggle(b.bankId, b.bankName) }}
                          className="rounded-xl py-2.5 text-[13px] font-bold text-white transition-opacity hover:opacity-95 disabled:cursor-not-allowed"
                          style={{
                            background: on ? 'linear-gradient(135deg, #0f2f6b, #085897)' : 'linear-gradient(135deg, #085897, #3b7bf0)',
                            boxShadow: '0 4px 12px rgba(8,88,151,.28)',
                          }}
                        >
                          {on ? '✓ Selected' : 'Apply Now'}
                        </button>
                      </div>

                      {open && (
                        <div
                          className="mt-3 rounded-xl px-3.5 py-2.5 text-[12px] text-gray-600"
                          style={{ background: 'var(--surface2)' }}
                          onClick={e => e.stopPropagation()}
                        >
                          {b.reason || 'This bank matches the applicant\'s profile.'}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {excluded.length > 0 && (
            <div
              className="flex items-start gap-2 rounded-xl px-3.5 py-3 text-[12px]"
              style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text3)' }}
            >
              <Info size={15} className="mt-0.5 shrink-0 text-efin-blue" />
              <p>
                <strong className="text-gray-700">{excluded.length} bank{excluded.length === 1 ? '' : 's'} excluded:</strong>{' '}
                {excluded.map((b: BankResult) => `${b.bankName}${b.reason ? ` (${b.reason})` : ''}`).join(' · ')}
              </p>
            </div>
          )}

          {selected.length > 0 && (
            <div
              className="rounded-xl px-3.5 py-3"
              style={{ background: 'rgba(192, 57, 43, .06)', border: '1px solid rgba(192, 57, 43, .25)' }}
            >
              <p className="flex items-center gap-1 text-[12px] font-semibold" style={{ color: 'var(--danger)' }}>
                <CheckCircle2 size={13} /> Selected Banks
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {selected.map(b => (
                  <span
                    key={b.bankId}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium"
                    style={{ color: 'var(--danger)', background: 'rgba(192, 57, 43, .10)' }}
                  >
                    <Landmark size={12} /> {b.bankName}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Live Lender-Eligibility Preview ────────────────────────────────────────
// Lightweight, READ-ONLY indicator shown while the applicant's numbers are
// entered in the wizard — ports legacy's debounced wLiveEligibilityPreview
// (efin-app.js:20020). Reuses the SAME POST /lenderconfig/match endpoint as the
// Step-9 matcher above (no duplicate matching logic). It never mutates wizard
// state, so it cannot interfere with the draft autosave; and because react-query
// keys the request, an out-of-order (stale) response can never overwrite a
// newer one. The authoritative full check + bank selection still happens at
// Step 9 via <BankEligibilityMatch> — this is only an early hint.
export function LiveEligibilityPreview({ request }: { request: MatchRequest }) {
  const [debounced, setDebounced] = useState<MatchRequest>(request)
  const key = JSON.stringify(request)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(request), 600)   // legacy's 600ms debounce
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Legacy hid the box until a salary was entered; also require a loan amount
  // so the hint is meaningful rather than matching on income alone.
  const enabled = debounced.salary > 0 && (debounced.loanAmount ?? 0) > 0

  const { data, isFetching } = useQuery({
    queryKey: ['eligibility-preview', JSON.stringify(debounced)],
    queryFn: () => lenderConfigApi.match(debounced).then(r => r.data.data),
    enabled,
    staleTime: 30_000,
    retry: false,
  })

  if (!enabled) return null

  let body: ReactNode = null
  if (isFetching && !data) {
    body = <><InlineLoader size={13} /> Checking lender eligibility…</>
  } else if (!data || data.awaitingDetails) {
    return null
  } else if (data.totalBanksConfigured === 0) {
    body = <>🏦 Lender eligibility rules not yet configured — this will be checked at Step 9.</>
  } else if (data.eligibleCount > 0) {
    body = <><CheckCircle2 size={13} className="shrink-0" /> Potentially eligible lenders: <strong>{data.eligibleCount}</strong> of {data.totalBanksConfigured} configured — full check at Step 9.</>
  } else {
    body = <>No lenders match this profile yet — adjust the loan amount / tenure. Full check at Step 9.</>
  }

  const tone = data && data.totalBanksConfigured > 0 && data.eligibleCount > 0
    ? { color: 'var(--success)', bg: 'rgba(26,115,64,.08)', border: 'rgba(26,115,64,.2)' }
    : { color: 'var(--text3)', bg: 'var(--surface2)', border: 'var(--border)' }

  return (
    <div className="mt-3 flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium"
      style={{ color: tone.color, background: tone.bg, borderColor: tone.border }}>
      {body}
    </div>
  )
}
