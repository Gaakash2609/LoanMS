import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { payoutApi, type PayoutClaim } from '@/api/payoutApi'
import { loansApi } from '@/api/loansApi'
import { useAuthStore } from '@/store/authStore'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import DataTable, { type Column } from '@/components/shared/DataTable'
import { formatCurrency, formatDate, cn } from '@/utils/format'
import { BarChart3, Download, Plus, Search, ClipboardList, X, SlidersHorizontal, Trash2, Wallet, ListChecks } from 'lucide-react'
import type { ReactNode } from 'react'
import { buildCsv, downloadCsv } from '@/utils/loanExport'
import ClaimStatusModal from '@/components/shared/ClaimStatusModal'
import PayoutRulesTab from '@/components/settings/PayoutRulesTab'
import { Navigate } from 'react-router-dom'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { useToast } from '@/store/toastStore'
import { usePartnerMappedToDsa } from '@/hooks/usePermissions'
import { SkeletonText } from '@/components/ui/Skeleton'
import { settingsApi } from '@/api/settingsApi'
import { NumberInput } from '@/components/ui/NumberInput'

const STATUS_VARIANTS: Record<string, 'default'|'success'|'warning'|'danger'|'info'> = {
  // Verified is the backend's real "approved" state (see
  // PayoutController.UpdateStatus's whitelist); OnHold was never styled.
  Pending: 'warning', Verified: 'success', Approved: 'success',
  Paid: 'info', Rejected: 'danger', OnHold: 'warning',
}

// Legacy displays "Approved" for the backend's Verified state (PAYOUT_STATUS_META
// / pmStatusBadge, efin-app.js) — the stored enum value is "Verified". Use this
// for every user-facing status label so the page reads like the Vanilla one.
const PAYOUT_STATUS_LABELS: Record<string, string> = {
  Pending: 'Pending', Verified: 'Approved', Approved: 'Approved',
  Paid: 'Paid', Rejected: 'Rejected', OnHold: 'On Hold',
}
const payoutStatusLabel = (s: string) => PAYOUT_STATUS_LABELS[s] ?? s

// The claim lifecycle, in the order money moves through it. Drives both the
// proportional bar and the clickable legend, so colour + count + amount for
// a status are defined once. The backend stores "approved" as Verified.
type StatusKey = 'Pending' | 'Verified' | 'Paid' | 'OnHold' | 'Rejected'
const PIPELINE: { key: StatusKey; label: string; bar: string }[] = [
  { key: 'Pending',  label: 'Pending',  bar: 'bg-amber-400' },
  { key: 'Verified', label: 'Approved', bar: 'bg-efin-blue' },
  { key: 'Paid',     label: 'Paid',     bar: 'bg-teal-600' },
  { key: 'OnHold',   label: 'On hold',  bar: 'bg-gray-400' },
  { key: 'Rejected', label: 'Rejected', bar: 'bg-red-500' },
]
const statusKeyOf = (s: string): string => (s === 'Approved' ? 'Verified' : s)

type StatusTotals = Record<StatusKey, { count: number; total: number }>

function PayoutSummary({ disbursed, claimCount, payout, rateLabel, rate, rateNote }: {
  disbursed: number; claimCount: number; payout: number
  rateLabel: string; rate: number; rateNote: string
}) {
  return (
    <div className="payout-kpi-panel">
      <div>
        <div className="payout-kpi-label">Total disbursed</div>
        <div className="payout-kpi-value tabular-nums" style={{ color: 'var(--accent)' }}>{formatCurrency(disbursed)}</div>
        <div className="payout-kpi-sub">{claimCount} {claimCount === 1 ? 'claim' : 'claims'}</div>
      </div>
      <div>
        <div className="payout-kpi-label">Total payout</div>
        <div className="payout-kpi-value tabular-nums" style={{ color: 'var(--success)' }}>{formatCurrency(payout)}</div>
        <div className="payout-kpi-sub">Approved and paid</div>
      </div>
      <div>
        <div className="payout-kpi-label">{rateLabel}</div>
        <div className="payout-kpi-value tabular-nums" style={{ color: 'var(--success)' }}>{rate}%</div>
        <div className="payout-kpi-sub">{rateNote}</div>
      </div>
    </div>
  )
}

// One bar shows where the claimed money currently sits; each legend item is
// also the status filter, so the numbers stay visible while you filter.
function StatusPipeline({ totals, active, onSelect, thisMonthCount, thisMonthTotal }: {
  totals: StatusTotals
  active: string
  onSelect: (key: string) => void
  thisMonthCount: number
  thisMonthTotal: number
}) {
  const grand = PIPELINE.reduce((sum, p) => sum + totals[p.key].total, 0)
  return (
    <section aria-label="Claims by status" className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Claims by status</h3>
        <p className="text-xs text-gray-500 tabular-nums">
          This month: {thisMonthCount} {thisMonthCount === 1 ? 'claim' : 'claims'}, {formatCurrency(thisMonthTotal)}
        </p>
      </div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100 gap-px" role="img"
        aria-label={grand > 0 ? 'Share of claimed amount by status' : 'No claims yet'}>
        {grand > 0 && PIPELINE.map(p => totals[p.key].total > 0 && (
          <div key={p.key} className={p.bar}
            style={{ width: `${(totals[p.key].total / grand) * 100}%`, minWidth: 6 }} />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {PIPELINE.map(p => {
          const s = totals[p.key]
          const on = active === p.key
          return (
            <button key={p.key} type="button" aria-pressed={on}
              onClick={() => onSelect(on ? '' : p.key)}
              className={cn(
                'text-left rounded-lg border px-3 py-2.5 transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-efin-blue',
                on ? 'border-efin-blue bg-efin-blue-light' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50',
              )}>
              <span className="flex items-center gap-2 text-xs font-medium text-gray-600">
                <span className={cn('w-2 h-2 rounded-full shrink-0', p.bar)} aria-hidden />
                {p.label}
              </span>
              <span className="mt-1 block text-lg font-bold text-gray-900 tabular-nums leading-tight">{s.count}</span>
              <span className="block text-xs text-gray-500 tabular-nums">{formatCurrency(s.total)}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function TabButton({ active, onClick, icon, children }: {
  active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode
}) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick}
      className={cn(
        'pb-3 px-1 -mb-px inline-flex items-center gap-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-efin-blue rounded-t',
        active ? 'text-efin-blue border-efin-blue' : 'text-gray-600 border-transparent hover:text-gray-900',
      )}>
      {icon}{children}
    </button>
  )
}

const FIELD_CLASS = 'px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-900 ' +
  'hover:border-gray-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-efin-blue'

const PAGE_SIZE = 20

// ── Phase 11 Priority-2: New Claim modal ────────────────────────────────────
// Reuses the existing POST /api/payout endpoint exactly as-is (ClaimCreateDto
// — see payoutApi.ts's doc-comment). claimAmount/claimType are only shown
// for Admin only, matching the backend's own documented behavior that
// these fields are ignored for every other role (server computes the amount
// from the configured PayoutRule and derives claimType from the caller's own
// role instead).
// Legacy CLAIMS modal (index.html #claim-modal-overlay + efin-app.js
// openClaimModal/submitClaim) — the full detail form. In legacy every field
// was collected + validated but only {loanId, month, notes} ever reached the
// server (the rest evaporated). They are ALL persisted now (ClaimCreateDto +
// PayoutClaim expanded). The claim AMOUNT stays server-computed from the
// payout rule (shown in the suggestion box), exactly as legacy — no amount
// field. Loan Number/APAC resolves to the actual disbursed loan, since the
// backend needs the Loan FK and payout is disbursed-only.
// ── Claim form dropdown defaults ──────────────────────────────────────────
// These are FALLBACK defaults only. Actual values are loaded from AppSettings
// (key: 'efin_payout_claim_lists', Admin-editable under Payout Rules → Claim Lists).
// This means you NEVER need to change code to add/remove banks, contests, etc.
//
// Contests auto-generate for the current and previous year — no code change
// needed as years roll over. Admin can override/add custom contests via settings.

const CLAIM_LISTS_SETTING_KEY = 'efin_payout_claim_lists'

/** Generate quarterly + annual contest options for a given year. */
function buildContestsForYear(year: number): { v: string; l: string }[] {
  return [
    { v: `q1_${year}`, l: `Q1 ${year} Contest` },
    { v: `q2_${year}`, l: `Q2 ${year} Contest` },
    { v: `q3_${year}`, l: `Q3 ${year} Contest` },
    { v: `q4_${year}`, l: `Q4 ${year} Contest` },
    { v: `annual_${year}`, l: `Annual ${year}` },
  ]
}

/** Auto-generated contest list: previous year + current year. Never stale. */
function buildDefaultContests(): { v: string; l: string }[] {
  const now = new Date().getFullYear()
  return [...buildContestsForYear(now - 1), ...buildContestsForYear(now)]
}

const DEFAULT_CLAIM_BANKS = ['InCred', 'HDFC', 'ICICI', 'Bajaj', 'Axis', 'Kotak', 'SBI', 'PNB', 'IDFC', 'Tata Capital']
const DEFAULT_CLAIM_PRODUCTS = [
  { v: 'personal_loan', l: 'Personal Loan' }, { v: 'home_loan', l: 'Home Loan' },
  { v: 'business_loan', l: 'Business Loan' }, { v: 'new_car_loan', l: 'New Car Loan' },
  { v: 'used_car_loan', l: 'Used Car Loan' }, { v: 'education_loan', l: 'Education Loan' },
  { v: 'loan_against_property', l: 'Loan Against Property' },
]
const DEFAULT_CLAIM_BIZ_CATS = [
  { v: 'loan_tbc', l: 'Loan TBC' }, { v: 'personal_loan', l: 'Personal Loan' },
  { v: 'home_loan', l: 'Home Loan' }, { v: 'business_loan', l: 'Business Loan' },
  { v: 'auto_loan', l: 'Auto Loan' }, { v: 'lap', l: 'Loan Against Property' },
]

interface ClaimLists {
  banks: string[]
  products: { v: string; l: string }[]
  contests: { v: string; l: string }[]
  bizCats: { v: string; l: string }[]
}

/** Parse the stored JSON blob from AppSettings, falling back to defaults per-list. */
function parseClaimLists(raw?: string | null): ClaimLists {
  let parsed: Partial<Record<string, unknown>> = {}
  if (raw) {
    try {
      const p = JSON.parse(raw)
      if (p && typeof p === 'object' && !Array.isArray(p)) parsed = p
    } catch { /* fall through to defaults */ }
  }

  const banks = Array.isArray(parsed.banks) && (parsed.banks as unknown[]).every(b => typeof b === 'string')
    ? (parsed.banks as string[]).filter(Boolean)
    : DEFAULT_CLAIM_BANKS

  const products = Array.isArray(parsed.products) && (parsed.products as unknown[]).every(
    p => p && typeof p === 'object' && 'v' in (p as object) && 'l' in (p as object))
    ? (parsed.products as { v: string; l: string }[])
    : DEFAULT_CLAIM_PRODUCTS

  const contests = Array.isArray(parsed.contests) && (parsed.contests as unknown[]).every(
    c => c && typeof c === 'object' && 'v' in (c as object) && 'l' in (c as object))
    ? (parsed.contests as { v: string; l: string }[])
    : buildDefaultContests()

  const bizCats = Array.isArray(parsed.bizCats) && (parsed.bizCats as unknown[]).every(
    c => c && typeof c === 'object' && 'v' in (c as object) && 'l' in (c as object))
    ? (parsed.bizCats as { v: string; l: string }[])
    : DEFAULT_CLAIM_BIZ_CATS

  return { banks, products, contests, bizCats }
}
const BLANK_CLAIM = {
  userType: 'individual', dsaMobile: '', contests: '', bank: '', product: '',
  fname: '', lname: '', loanNum: '', apac: '', company: '', disbAmount: '', disbDate: '',
  claimMonth: '', city: '', bizCat: 'loan_tbc', confirmationRequired: false, splitCase: false,
  bankerEmail: '', bankerName: '', bankerMobile: '', asmEmail: '', asmName: '', asmMobile: '',
  vendorRemark: '',
}
// Module-level so it keeps a stable component identity across the modal's
// re-renders — a nested (per-render) wrapper around inputs would remount them
// and drop focus on every keystroke.
const CLAIM_INP = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white'
// Styled select — appearance-none removes the native OS chevron so the custom
// arrow SVG (via bg-image) is used instead, giving consistent cross-browser
// rendering. pr-8 leaves room for the arrow. cursor-pointer + focus ring match
// the rest of the form inputs. Truncation is prevented by the min-w-0 on the
// parent grid cell.
const CLAIM_SELECT = [
  'w-full border border-gray-200 rounded-lg px-3 py-2 pr-8 text-sm bg-white',
  'appearance-none cursor-pointer',
  'focus:outline-none focus:ring-2 focus:ring-efin-blue focus:border-efin-blue',
  'hover:border-gray-400 transition-colors',
  'bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20width%3D%2716%27%20height%3D%2716%27%20viewBox%3D%270%200%2024%2024%27%20fill%3D%27none%27%20stroke%3D%27%236b7280%27%20stroke-width%3D%272%27%20stroke-linecap%3D%27round%27%20stroke-linejoin%3D%27round%27%3E%3Cpolyline%20points%3D%276%209%2012%2015%2018%209%27%2F%3E%3C%2Fsvg%3E")]',
  'bg-no-repeat bg-[right_0.5rem_center] bg-[length:1.1rem_1.1rem]',
].join(' ')
function ClaimField({ label, req, children }: { label: string; req?: boolean; children: ReactNode }) {
  return <div><label className="text-[11px] font-semibold text-gray-500 block mb-1">{label}{req ? ' *' : ''}</label>{children}</div>
}

function NewClaimModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [f, setF] = useState(BLANK_CLAIM)
  const [error, setError] = useState('')
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(p => ({ ...p, [k]: v }))

  // Claim dropdown lists — loaded from AppSettings so Admin can manage them
  // without code changes. Falls back to defaults if the key is not set yet.
  const { data: claimListsRaw } = useQuery({
    queryKey: ['claim-lists'],
    queryFn: () => settingsApi.getByKey(CLAIM_LISTS_SETTING_KEY).then(r => r.data.data?.value ?? null),
    staleTime: 5 * 60_000,
  })
  const claimLists = parseClaimLists(claimListsRaw)

  // Disbursed loans — payout is disbursed-only (backend gate). The typed Loan
  // Number / APAC resolves to one of these, mirroring legacy submitClaim
  // resolving the number against APPLICATIONS to get the loan's real id.
  const { data: disbursedLoans } = useQuery({
    queryKey: ['loans', 'disbursed-for-claim'],
    queryFn: () => loansApi.getAll({ status: 'Disbursed', pageSize: 500 }).then(r => r.data.data?.items ?? []),
    staleTime: 60_000,
  })
  const matchedLoan = useMemo(() => {
    const keys = [f.loanNum.trim().toLowerCase(), f.apac.trim().toLowerCase()].filter(Boolean)
    if (!keys.length) return undefined
    return (disbursedLoans ?? []).find(l => keys.includes(l.loanNumber.toLowerCase()))
  }, [disbursedLoans, f.loanNum, f.apac])

  // Auto payout suggestion (legacy cl-suggested-amount-box) once the loan resolves.
  const { data: suggestion, isFetching: suggestLoading } = useQuery({
    queryKey: ['payout-suggest', matchedLoan?.id],
    queryFn: () => {
      if (!matchedLoan) throw new Error('No application selected.')   // unreachable: enabled: !!matchedLoan
      return payoutApi.suggestPayout(matchedLoan.id).then(r => r.data.data)
    },
    enabled: !!matchedLoan, retry: false, staleTime: 30_000,
  })

  // BUGFIX (confirmed real gap): PayoutController.Suggest has always returned
  // `canOverride` (true for Admin only) plus minPayout/maxPayout so the
  // caller can adjust the claim amount within the rule's band — and
  // Submit() already honors a submitted `claimAmount` for exactly this case
  // (PayoutController.cs:148-153). But no field here ever collected or sent
  // one, so the override was silently unreachable from the UI. Worse: when
  // no rule exists for the loan type, Submit() falls back to
  // `serverAmount = dto.ClaimAmount` for Admin (line 145) — since
  // this form never sent ClaimAmount, that claim silently amount to ₹0
  // with no warning. Fixed by collecting an explicit amount whenever the
  // suggestion says this caller can override, pre-filled with the
  // suggestion when one exists and required when it doesn't.
  const canOverrideAmount = !!suggestion?.canOverride
  const [overrideAmount, setOverrideAmount] = useState('')
  useEffect(() => {
    if (!suggestion) { setOverrideAmount(''); return }
    setOverrideAmount(suggestion.ruleConfigured ? String(suggestion.suggestedAmount) : '')
  }, [matchedLoan?.id, suggestion])

  const submit = useMutation({
    mutationFn: async () => {
      if (!matchedLoan) throw new Error('Select an application first.')
      return payoutApi.submitClaim({
      loanId: matchedLoan.id,
      // Only meaningful (and only honored server-side) for Admin —
      // everyone else's value here is ignored by the backend anyway, but
      // omitting it for them keeps the payload matching what actually
      // takes effect.
      claimAmount: canOverrideAmount && overrideAmount.trim() ? Number(overrideAmount) : undefined,
      month: f.claimMonth || undefined,
      notes: f.vendorRemark || undefined,
      userType: f.userType || undefined,
      dsaMobile: f.dsaMobile || undefined,
      contests: f.contests || undefined,
      bankName: f.bank || undefined,
      productName: f.product || undefined,
      firstName: f.fname || undefined,
      lastName: f.lname || undefined,
      loanNumberRef: f.loanNum || undefined,
      apacRef: f.apac || undefined,
      companyName: f.company || undefined,
      disbursementAmount: f.disbAmount ? Number(f.disbAmount) : undefined,
      disbursementDate: f.disbDate || undefined,
      city: f.city || undefined,
      businessCategory: f.bizCat || undefined,
      confirmationRequired: f.confirmationRequired,
      splitCase: f.splitCase,
      bankerEmail: f.bankerEmail || undefined,
      bankerName: f.bankerName || undefined,
      bankerMobile: f.bankerMobile || undefined,
      asmEmail: f.asmEmail || undefined,
      asmName: f.asmName || undefined,
      asmMobile: f.asmMobile || undefined,
    })
    },
    onSuccess: () => onSuccess(),
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      setError(msg?.message || msg?.errors?.join(' ') || 'Could not submit claim. Please try again.')
    },
  })

  function handleSubmit() {
    // Legacy submitClaim's actual required set: APAC, Loan Number, Bank, Claim
    // Month, Disbursement Amount, City (efin-app.js:4950) — NOT every *-labelled
    // field. Matched exactly (not stricter).
    if (!f.apac.trim() || !f.loanNum.trim() || !f.bank || !f.claimMonth || !f.disbAmount || !f.city.trim()) {
      setError('Please fill all required fields (*)'); return
    }
    if (!matchedLoan) {
      setError('No disbursed loan matches this Loan Number / APAC — payout can only be claimed on a disbursed loan.'); return
    }
    if (canOverrideAmount && suggestion && !suggestion.ruleConfigured
        && (!overrideAmount.trim() || Number(overrideAmount) <= 0)) {
      setError('No payout rule is configured for this loan type — enter a payout amount to continue.'); return
    }
    setError('')
    if (submit.isPending) return
    submit.mutate()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[var(--z-modal)] p-4">
      <Card className="w-full max-w-3xl max-h-[92vh] overflow-y-auto p-0">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white z-[1] rounded-t-xl">
          <p className="text-base font-extrabold text-efin-blue">CLAIMS</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="px-6 py-5">
          {suggestLoading && (
            <div className="mb-4 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-500">⏳ Calculating suggested payout…</div>
          )}
          {!suggestLoading && suggestion && (
            <div className="mb-4 rounded-lg border px-3 py-2 text-xs" style={{ background: 'var(--accent-subtle)', borderColor: 'rgba(10,88,154,.2)', color: 'var(--text2)' }}>
              {suggestion.ruleConfigured
                ? <>💰 <strong>Suggested payout: {formatCurrency(suggestion.suggestedAmount)}</strong> — calculated automatically from the configured payout rule.</>
                : <>⚠ No payout rule configured for this loan type yet.{!canOverrideAmount && ' A claim cannot be submitted until an Admin sets one.'}</>}

              {/* Admin override — the backend already accepts and clamps
                  this (PayoutController.Submit); this field is what actually
                  reaches it. */}
              {canOverrideAmount && (
                <div className="mt-2 pt-2 border-t" style={{ borderColor: 'rgba(10,88,154,.15)' }}>
                  <label className="text-[11px] font-semibold text-gray-600 block mb-1">
                    Payout Amount (₹) {!suggestion.ruleConfigured && <span className="text-red-500">*</span>}
                  </label>
                  <NumberInput
                    min="0"
                    value={overrideAmount}
                    onChange={e => setOverrideAmount(e.target.value)}
                    placeholder={suggestion.ruleConfigured ? 'Suggested amount above' : 'Enter payout amount'}
                    className="w-full max-w-[200px] border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                  />
                  {(suggestion.minPayout != null || suggestion.maxPayout != null) && (
                    <p className="text-[11px] text-gray-500 mt-1">
                      Allowed range: {suggestion.minPayout != null ? formatCurrency(suggestion.minPayout) : 'No floor'} – {suggestion.maxPayout != null ? formatCurrency(suggestion.maxPayout) : 'No cap'}.
                      An amount outside this range is ignored and the suggested amount is used instead.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5 mb-4">
            <ClaimField label="User Type" req>
              <select value={f.userType} onChange={e => set('userType', e.target.value)} className={CLAIM_SELECT}>
                <option value="individual">Individual</option>
                <option value="company">Company</option>
              </select>
            </ClaimField>
            <ClaimField label="DSA Mobile Number" req>
              <input value={f.dsaMobile} onChange={e => set('dsaMobile', e.target.value)} placeholder="10-digit number" className={CLAIM_INP} />
            </ClaimField>
            <ClaimField label="Contests">
              <select value={f.contests} onChange={e => set('contests', e.target.value)} className={CLAIM_SELECT}>
                <option value="">-- Select --</option>
                {claimLists.contests.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
              </select>
            </ClaimField>
            <ClaimField label="Bank Name" req>
              <select value={f.bank} onChange={e => set('bank', e.target.value)} className={CLAIM_SELECT}>
                <option value="">-- Select Bank --</option>
                {claimLists.banks.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </ClaimField>
            <ClaimField label="Product Name" req>
              <select value={f.product} onChange={e => set('product', e.target.value)} className={CLAIM_SELECT}>
                <option value="">-- Select --</option>
                {claimLists.products.map(p => <option key={p.v} value={p.v}>{p.l}</option>)}
              </select>
            </ClaimField>
            <ClaimField label="First Name"><input value={f.fname} onChange={e => set('fname', e.target.value)} placeholder="First Name" className={CLAIM_INP} /></ClaimField>
            <ClaimField label="Last Name"><input value={f.lname} onChange={e => set('lname', e.target.value)} placeholder="Last Name" className={CLAIM_INP} /></ClaimField>
            <ClaimField label="Loan Number" req><input value={f.loanNum} onChange={e => set('loanNum', e.target.value)} placeholder="Loan Number" className={CLAIM_INP} /></ClaimField>
            <ClaimField label="APAC Ref. LOS Number" req><input value={f.apac} onChange={e => set('apac', e.target.value)} placeholder="APAC / LOS Number" className={CLAIM_INP} /></ClaimField>
            <ClaimField label="Company Name"><input value={f.company} onChange={e => set('company', e.target.value)} placeholder="Company Name" className={CLAIM_INP} /></ClaimField>
            <ClaimField label="Disbursement Amount" req><NumberInput value={f.disbAmount} onChange={e => set('disbAmount', e.target.value)} placeholder="Amount in ₹" className={CLAIM_INP} /></ClaimField>
            <ClaimField label="Disbursement Date"><input type="date" value={f.disbDate} onChange={e => set('disbDate', e.target.value)} className={CLAIM_INP} /></ClaimField>
            <ClaimField label="Claim Month" req><input type="month" value={f.claimMonth} onChange={e => set('claimMonth', e.target.value)} className={CLAIM_INP} /></ClaimField>
            <ClaimField label="City" req><input value={f.city} onChange={e => set('city', e.target.value)} placeholder="City" className={CLAIM_INP} /></ClaimField>
            <ClaimField label="Business Categories" req>
              <select value={f.bizCat} onChange={e => set('bizCat', e.target.value)} className={CLAIM_SELECT}>
                {claimLists.bizCats.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
              </select>
            </ClaimField>
            <label className="flex items-center gap-2 text-sm pt-5 cursor-pointer">
              <input type="checkbox" checked={f.confirmationRequired} onChange={e => set('confirmationRequired', e.target.checked)} className="w-4 h-4" />
              Confirmation Required
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium mb-5 cursor-pointer">
            <input type="checkbox" checked={f.splitCase} onChange={e => set('splitCase', e.target.checked)} className="w-4 h-4" />
            Split Case
          </label>

          <div className="border-b border-gray-200 pb-4 mb-4">
            <p className="text-sm font-bold mb-3">Banker Details</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <ClaimField label="Banker Email" req><input type="email" value={f.bankerEmail} onChange={e => set('bankerEmail', e.target.value)} placeholder="banker@bank.com" className={CLAIM_INP} /></ClaimField>
              <ClaimField label="Banker Name" req><input value={f.bankerName} onChange={e => set('bankerName', e.target.value)} placeholder="Full Name" className={CLAIM_INP} /></ClaimField>
              <ClaimField label="Banker Mobile" req><input value={f.bankerMobile} onChange={e => set('bankerMobile', e.target.value)} placeholder="10-digit number" className={CLAIM_INP} /></ClaimField>
            </div>
          </div>
          <div className="border-b border-gray-200 pb-4 mb-4">
            <p className="text-sm font-bold mb-3">ASM Details</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <ClaimField label="ASM Email"><input type="email" value={f.asmEmail} onChange={e => set('asmEmail', e.target.value)} placeholder="asm@bank.com" className={CLAIM_INP} /></ClaimField>
              <ClaimField label="ASM Name"><input value={f.asmName} onChange={e => set('asmName', e.target.value)} placeholder="Full Name" className={CLAIM_INP} /></ClaimField>
              <ClaimField label="ASM Mobile"><input value={f.asmMobile} onChange={e => set('asmMobile', e.target.value)} placeholder="10-digit number" className={CLAIM_INP} /></ClaimField>
            </div>
          </div>
          <ClaimField label="Vendor Remark">
            <textarea value={f.vendorRemark} onChange={e => set('vendorRemark', e.target.value)} rows={3} placeholder="Enter vendor remark…" className={CLAIM_INP} />
          </ClaimField>

          <div className="flex gap-2 mt-5">
            <Button loading={submit.isPending} disabled={submit.isPending} onClick={handleSubmit} className="min-w-[120px]">SUBMIT</Button>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

// ── Phase 11 Priority-2: Earnings modal ─────────────────────────────────────
// Reuses the existing GET /api/payout/my-earnings endpoint exactly as-is —
// server-scoped to the caller's own claims, grouped by status.
function EarningsModal({ onClose }: { onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['payout-earnings'],
    queryFn: () => payoutApi.getMyEarnings().then(r => r.data.data ?? []),
  })

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[var(--z-modal)] p-4">
      <Card className="w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold">My Earnings</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {isLoading ? (
          <SkeletonText lines={3} className="py-3" />
        ) : !data?.length ? (
          <p className="text-sm text-gray-400 py-6 text-center">No claims yet.</p>
        ) : (
          <div className="space-y-2">
            {data.map(g => (
              <div key={g.status} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <Badge variant={STATUS_VARIANTS[g.status] ?? 'default'}>{g.status}</Badge>
                  <span className="text-xs text-gray-500 ml-2">{g.count} claim{g.count !== 1 ? 's' : ''}</span>
                </div>
                <span className="font-semibold text-green-700">{formatCurrency(g.total)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}


// Vanilla's showPage guard (efin-app.js:1839): a Partner mapped to a DSA has
// no Payout of its own — the mapped DSA user tracks it.
export default function PayoutPage() {
  const mappedToDsa = usePartnerMappedToDsa()
  const toast = useToast()
  useEffect(() => {
    if (mappedToDsa) toast.error('Access Denied — your Payout is managed by your linked DSA')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappedToDsa])
  if (mappedToDsa === undefined) return <PageLoader />
  if (mappedToDsa) return <Navigate to="/dashboard" replace />
  return <PayoutPageContent />
}

function PayoutPageContent() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  // Claim deletion is strictly Admin — the endpoint's own [Authorize(Roles =
  // "Admin")] (PayoutController) and legacy's _isAdminRole() gate.
  const isAdmin = user?.role === 'Admin'
  // EXACT legacy tab gating (efin-app.js renderPayoutPage/payoutSwitchTab
  // :4124-4154): the "My Claims" tab is for everyone EXCEPT Accounts, and the
  // "Management" (all-claims) tab is for Admin + Accounts ONLY. Manager has
  // Sales-level rights in Payout: My Claims only (own claims, server-computed
  // amount) — no Management tab, no amount override, no status changes and no
  // Payout Rules.
  const canMine = user?.role !== 'Accounts'
  const canMgmt = user?.role === 'Accounts' || user?.role === 'Admin'
  const [activeTab, setActiveTab] = useState<'claims' | 'management' | 'rules'>(
    canMine ? 'claims' : 'management')
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterMonth, setFilterMonth] = useState('')
  const [filterPartner, setFilterPartner] = useState('')
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [page, setPage] = useState(1)

  // Phase 11 Priority-2 — New Claim / Earnings modal visibility. Kept as
  // simple local state, same convention as the show/hide modals already
  // used elsewhere in this app (e.g. UsersPage.tsx's mapping modal).
  const [showNewClaim, setShowNewClaim] = useState(false)
  const [showEarnings, setShowEarnings] = useState(false)

  // BUGFIX (confirmed real, pre-existing gap — Phase 7 audit): see
  // payoutApi.ts's getClaims() doc-comment. PayoutController.GetAll
  // returns a plain array, not a paged shape — data?.items was always
  // undefined, so every KPI card, status card, and the table itself
  // always showed zero regardless of how many real claims existed.
  // Corrected to fetch the full (already status-filtered server-side)
  // array once and paginate client-side, same pattern already proven in
  // UsersPage.tsx/TasksPage.tsx/TicketsPage.tsx.
  // My Claims tab is self-scoped to the caller's OWN claims (legacy
  // getVisiblePayoutClaims — `c.partner === currentUser.name`); Management
  // shows the full list. The backend honours this via ?myOnly=true, so pass
  // it for the claims tab. For non-finance roles the backend self-scopes
  // regardless, so this only changes what Admin/Accounts see on
  // their own "My Claims" tab (previously the full list — a real gap).
  const myOnly = activeTab === 'claims'
  const { data: allClaims, isLoading, error: claimsError, refetch: refetchClaims } = useQuery({
    queryKey: ['payouts', myOnly],
    queryFn: () => payoutApi.getClaims({ myOnly }).then(r => r.data.data),
  })
  // Stable reference across renders (not a fresh `[]` every time allClaims
  // is undefined) so the three useMemo hooks below actually memoize during
  // the loading window instead of recomputing on every render.
  const allList = useMemo(() => allClaims ?? [], [allClaims])
  // BUGFIX (confirmed real): searchQuery and filterMonth were bound to
  // their inputs but never applied to the list — typing in either did
  // nothing at all. Both are now real client-side filters (the backend
  // only supports the status param, which is already passed to the query
  // above).
  // Filtered by search / month / partner only — NOT by status — so the status
  // legend keeps showing every status's real count while one is selected.
  const baseClaims = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return allList.filter(c => {
      const matchesSearch = !q
        || c.loanNumber?.toLowerCase().includes(q)
        || c.customerName?.toLowerCase().includes(q)
        || c.claimedBy?.toLowerCase().includes(q)
      const matchesMonth = !filterMonth || c.month === filterMonth
      // Partner filter was a hardcoded partnerA/partnerB dropdown wired to
      // nothing at all — now a real filter over the claimant.
      const matchesPartner = !filterPartner || c.claimedBy === filterPartner
      return matchesSearch && matchesMonth && matchesPartner
    })
  }, [allList, searchQuery, filterMonth, filterPartner])

  // What the table, export and analytics show: base filters + the chosen status.
  const claims = useMemo(
    () => filterStatus ? baseClaims.filter(c => statusKeyOf(c.status) === filterStatus) : baseClaims,
    [baseClaims, filterStatus])

  const partnerOptions = useMemo(
    () => [...new Set(allList.map(c => c.claimedBy).filter(Boolean))].sort() as string[],
    [allList])

  // Analytics — same three breakdowns legacy's Management-tab analytics
  // panel showed (By Partner, By Status, Monthly), computed from the
  // already-fetched claims rather than a separate endpoint.
  const analytics = useMemo(() => {
    const group = (key: (c: PayoutClaim) => string) => {
      const m = new Map<string, { count: number; total: number }>()
      claims.forEach(c => {
        const k = key(c) || '—'
        const cur = m.get(k) ?? { count: 0, total: 0 }
        m.set(k, { count: cur.count + 1, total: cur.total + (c.claimAmount || 0) })
      })
      return [...m.entries()].sort((a, b) => b[1].total - a[1].total)
    }
    return {
      byPartner: group(c => c.claimedBy),
      byStatus: group(c => payoutStatusLabel(c.status)),
      byMonth: group(c => c.month ?? ''),
    }
  }, [claims])

  // Month options built from the data actually present, replacing the two
  // hardcoded placeholder options that never matched anything.
  const monthOptions = useMemo(
    () => [...new Set(allList.map(c => c.month).filter(Boolean))] as string[],
    [allList])

  const totalCount = claims.length
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const pageItems = claims.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const [statusClaim, setStatusClaim] = useState<PayoutClaim | null>(null)

  const update = useMutation({
    mutationFn: ({ id, newStatus }: { id: number; newStatus: string }) =>
      payoutApi.updateClaimStatus(id, newStatus),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payouts'] }),
  })

  // Restores legacy's pmDeleteClaim (efin-app.js:5416). Legacy already
  // called the real DELETE /payout/{id} and only dropped the local row
  // after the server confirmed success — the same order kept here, since
  // the row is only re-read once invalidateQueries refetches.
  const [deleteError, setDeleteError] = useState('')
  const [deleteFeedback, setDeleteFeedback] = useState('')
  const remove = useMutation({
    mutationFn: (c: PayoutClaim) => payoutApi.deleteClaim(c.id),
    onSuccess: (_res, c) => {
      setDeleteError('')
      setDeleteFeedback(`Claim for ${c.customerName || c.loanNumber} deleted ✓`)
      qc.invalidateQueries({ queryKey: ['payouts'] })
    },
    onError: (err, c) => {
      setDeleteFeedback('')
      const res = (err as { response?: { status?: number; data?: { message?: string; errors?: string[] } } }).response
      if (res?.status === 403) { setDeleteError('Only an Admin can delete payout claims.'); return }
      if (res?.status === 404) {
        // Already gone (deleted in another session) — reconcile the list
        // rather than leaving a stale row the user can keep clicking.
        qc.invalidateQueries({ queryKey: ['payouts'] })
        setDeleteError('That claim no longer exists — the list has been refreshed.')
        return
      }
      setDeleteError(res?.data?.message || res?.data?.errors?.join(' · ')
        || `Could not delete the claim for ${c.customerName || c.loanNumber}.${res?.status ? ` (HTTP ${res.status})` : ''}`)
    },
  })

  function exportCsv() {
    if (claims.length === 0) return
    const csv = buildCsv(
      ['Loan', 'Customer', 'Claimed By', 'Type', 'Month', 'Amount', 'Status', 'Raised', 'Paid At',
       'Payment Mode', 'UTR / Reference', 'Payment Date', 'Bank A/C'],
      claims.map(c => [c.loanNumber, c.customerName, c.claimedBy, c.claimType ?? '',
        c.month ?? '', String(c.claimAmount ?? ''), c.status, formatDate(c.createdAt), c.paidAt ? formatDate(c.paidAt) : '',
        c.paymentMode ?? '', c.paymentReference ?? '', c.paymentDate ? formatDate(c.paymentDate) : '',
        c.bankAccountLast4 ? `****${c.bankAccountLast4}` : '']),
    )
    downloadCsv(csv, `payout-claims-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  // Calculate statistics for both tabs. Mirrors legacy renderMyPayout
  // (efin-app.js:4268-4296): TOTAL PAYOUT = Σ payout of approved+paid claims,
  // the Approved card shows Σ sanctioned, Paid shows Σ received.
  // BUGFIX: the old version (a) counted status 'Approved' — which the backend
  // NEVER stores (its approved state is 'Verified'), so the Approved KPI was
  // always 0; and (b) fed a CLAIM COUNT into formatCurrency() for TOTAL PAYOUT /
  // PAID (showing e.g. "₹3" instead of a rupee sum).
  const claimsStats = useMemo(() => {
    const now = new Date()
    // Claims store their month either as "2026-09" (month picker) or "Sep 2026"
    // (the server's default when none is sent) — match both, or claims made
    // without an explicit month never counted as "this month".
    const monthKeys = new Set([
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      now.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
    ])
    const inThisMonth = (c: PayoutClaim) => !!c.month && monthKeys.has(c.month)
    const sumWhere = (pred: (c: PayoutClaim) => boolean) =>
      baseClaims.filter(pred).reduce((s, c) => s + (c.claimAmount || 0), 0)
    // Count + ₹ per status, from the claims BEFORE the status filter so each
    // legend item stays accurate while one of them is selected.
    const totals = Object.fromEntries(PIPELINE.map(p => [p.key, { count: 0, total: 0 }])) as StatusTotals
    baseClaims.forEach(c => {
      const bucket = totals[statusKeyOf(c.status) as StatusKey]
      if (bucket) { bucket.count += 1; bucket.total += c.claimAmount || 0 }
    })
    const approvedTotal = totals.Verified.total // ₹ sanctioned
    const paidTotal = totals.Paid.total         // ₹ received
    return {
      totals,
      approved: totals.Verified.count,          // 'Verified' = approved
      paid: totals.Paid.count,
      payoutTotal: approvedTotal + paidTotal,   // TOTAL PAYOUT
      // Σ disbursed loan amount — legacy renderMyPayout's totalDisb
      // (efin-app.js:4269). Per-claim like legacy, so split loans count once
      // per claimant, matching Vanilla.
      disbursedTotal: baseClaims.reduce((s, c) => s + (c.disbursedAmount || 0), 0),
      thisMonthCount: baseClaims.filter(inThisMonth).length,
      thisMonthTotal: sumWhere(inThisMonth),
    }
  }, [baseClaims])
  // Legacy approval rate — approved claims / total submitted (efin-app.js:4282).
  const baseCount   = baseClaims.length
  const approvalRate = baseCount > 0 ? Math.round((claimsStats.approved / baseCount) * 100) : 0
  const successRate  = baseCount > 0 ? Math.round((claimsStats.paid / baseCount) * 100) : 0

  const isMgmt = activeTab === 'management'
  const hasFilters = !!(searchQuery || filterStatus || filterMonth || filterPartner)
  function clearFilters() {
    setSearchQuery(''); setFilterStatus(''); setFilterMonth(''); setFilterPartner(''); setPage(1)
  }

  const columns: Column<PayoutClaim>[] = [
    { key: 'loanNumber',    label: 'Loan / APAC',   className: 'font-mono text-xs font-semibold' },
    { key: 'customerName',  label: 'Customer', className: 'font-medium' },
    // BUGFIX (Phase 7): was 'claimedByName', a field that never existed
    // in the actual API response (see payoutApi.ts's doc-comment — the
    // real field is claimedBy) — this column always rendered blank.
    { key: 'claimedBy', label: 'Agent',    className: 'text-gray-700' },
    { key: 'month',         label: 'Month',    render: (r: PayoutClaim) => r.month ?? '—', className: 'text-gray-600' },
    { key: 'claimAmount',   label: 'Amount',   render: (r: PayoutClaim) => <span className="font-semibold text-green-700 tabular-nums">{formatCurrency(r.claimAmount)}</span> },
    { key: 'status',        label: 'Status',   render: (r: PayoutClaim) => (
      <Badge variant={STATUS_VARIANTS[r.status] ?? 'default'}>{payoutStatusLabel(r.status)}</Badge>
    )},
    { key: 'createdAt',     label: 'Raised',     render: (r: PayoutClaim) => formatDate(r.createdAt), className: 'text-gray-600' },
    { key: 'actions',       label: 'Actions',  render: (r: PayoutClaim) => activeTab === 'management' ? (
      <div className="flex gap-2">
        {r.status === 'Pending' && (
          <>
            {/* BUGFIX (confirmed real): this sent newStatus:'Approved',
                but PayoutController.UpdateStatus whitelists only
                Pending/Verified/Paid/Rejected/OnHold — 'Approved' was
                rejected with a 400 every single time. Legacy maps its own
                "approved" label to Verified, which is what's sent now. */}
            <Button size="sm" variant="success" onClick={() => update.mutate({ id: r.id, newStatus: 'Verified' })} className="text-xs">
              Approve
            </Button>
            <Button size="sm" variant="danger" onClick={() => { if (confirm(`Reject claim for ${r.customerName || r.loanNumber}?`)) update.mutate({ id: r.id, newStatus: 'Rejected' }) }} className="text-xs">
              Reject
            </Button>
          </>
        )}
        <Button size="sm" variant="secondary" onClick={() => setStatusClaim(r)} className="text-xs">
          Update status
        </Button>
        {isAdmin && (
          <Button size="sm" variant="danger" className="text-xs"
            onClick={() => { if (confirm(`Permanently delete this payout claim for ${r.customerName || r.loanNumber}? This cannot be undone.`)) remove.mutate(r) }}>
            <Trash2 size={12} className="mr-1" /> Delete
          </Button>
        )}
      </div>
    ) : (
      <button onClick={() => setStatusClaim(r)} className="text-efin-blue hover:underline text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-efin-blue rounded">View</button>
    ) },
  ]

  const tableTitle = filterStatus
    ? `${PIPELINE.find(p => p.key === filterStatus)?.label ?? ''} claims`
    : (isMgmt ? 'All claims' : 'My claims')

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div role="tablist" className="flex items-center gap-6 border-b border-gray-200 mb-6 overflow-x-auto">
          {/* My Claims — everyone EXCEPT Accounts (legacy canMine). */}
          {canMine && (
            <TabButton active={activeTab === 'claims'} icon={<Wallet size={16} />}
              onClick={() => { setActiveTab('claims'); setPage(1) }}>My claims</TabButton>
          )}
          {/* Management (all-claims) tab — Admin + Accounts ONLY (legacy
              canMgmt = accounts||admin). Manager has Sales-level Payout rights
              (own claims only), so it isn't shown here. */}
          {canMgmt && (
            <TabButton active={activeTab === 'management'} icon={<ListChecks size={16} />}
              onClick={() => { setActiveTab('management'); setPage(1) }}>Management</TabButton>
          )}
          {/* PayoutRulesController is [Authorize(Roles="Admin")] — Manager and
              Accounts also reach this page (see AppRoutes) but would only ever
              get a 403 here, so the tab is Admin-only. */}
          {user?.role === 'Admin' && (
            <TabButton active={activeTab === 'rules'} icon={<SlidersHorizontal size={16} />}
              onClick={() => { setActiveTab('rules'); setPage(1) }}>Payout rules</TabButton>
          )}
        </div>

        {activeTab === 'rules' ? (
          <PayoutRulesTab />
        ) : (
          <div className="space-y-5">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  {isMgmt ? 'Claims management' : 'My claims'}
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  {isMgmt
                    ? 'Review, approve and pay all partner commission claims'
                    : 'Track your commission claims, approvals and payments'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isMgmt ? (
                  <Button variant="secondary" aria-pressed={showAnalytics} onClick={() => setShowAnalytics(v => !v)}>
                    <BarChart3 size={16} className="mr-1.5" />Analytics
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => setShowEarnings(true)}>
                    <Download size={16} className="mr-1.5" />Earnings
                  </Button>
                )}
                <Button variant="secondary" onClick={exportCsv} disabled={claims.length === 0}>
                  <ClipboardList size={16} className="mr-1.5" />Export CSV
                </Button>
                <Button onClick={() => setShowNewClaim(true)}>
                  <Plus size={16} className="mr-1.5" />New claim
                </Button>
              </div>
            </header>

            {/* Summary — Vanilla groups the KPIs in ONE panel (index.html:5104). */}
            <PayoutSummary
              disbursed={claimsStats.disbursedTotal}
              claimCount={baseCount}
              payout={claimsStats.payoutTotal}
              rateLabel={isMgmt ? 'Success rate' : 'Approval rate'}
              rate={isMgmt ? successRate : approvalRate}
              rateNote={isMgmt ? 'Paid of all claims' : 'Approved of submitted claims'}
            />

            <StatusPipeline
              totals={claimsStats.totals}
              active={filterStatus}
              onSelect={key => { setFilterStatus(key); setPage(1) }}
              thisMonthCount={claimsStats.thisMonthCount}
              thisMonthTotal={claimsStats.thisMonthTotal}
            />

            {/* Analytics — By Partner / By Status / By Month, matching
                legacy's Management-tab analytics panel. Computed from the
                claims already loaded; reflects the active filters. */}
            {isMgmt && showAnalytics && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {([
                  ['By partner', analytics.byPartner],
                  ['By status', analytics.byStatus],
                  ['By month', analytics.byMonth],
                ] as const).map(([title, rows]) => (
                  <div key={title} className="bg-white border border-gray-200 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-gray-900 mb-2">{title}</h3>
                    {rows.length === 0 ? (
                      <p className="text-xs text-gray-500">No claims to break down</p>
                    ) : (
                      <div className="space-y-1.5">
                        {rows.slice(0, 6).map(([label, v]) => (
                          <div key={label} className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-gray-700 truncate">{label}</span>
                            <span className="text-gray-500 tabular-nums shrink-0">
                              {v.count} · <span className="font-semibold text-green-700">{formatCurrency(v.total)}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* One filter row. Status is filtered from the legend above. */}
            <div className="flex flex-wrap items-center gap-2 bg-white border border-gray-200 rounded-xl p-3">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden />
                <input
                  type="search"
                  aria-label="Search claims"
                  placeholder={isMgmt ? 'Search partner, loan or customer' : 'Search loan or customer'}
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setPage(1) }}
                  className={cn(FIELD_CLASS, 'w-full pl-9')}
                />
              </div>
              {isMgmt && (
                <select aria-label="Filter by partner" value={filterPartner}
                  onChange={e => { setFilterPartner(e.target.value); setPage(1) }} className={FIELD_CLASS}>
                  <option value="">All partners</option>
                  {partnerOptions.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              )}
              <select aria-label="Filter by month" value={filterMonth}
                onChange={e => { setFilterMonth(e.target.value); setPage(1) }} className={FIELD_CLASS}>
                <option value="">All months</option>
                {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <X size={14} className="mr-1" />Clear filters
                </Button>
              )}
            </div>

            <Card>
              <CardHeader title={`${tableTitle} (${totalCount})`} />
              {isMgmt && deleteFeedback && (
                <div className="mx-4 mb-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{deleteFeedback}</div>
              )}
              {isMgmt && deleteError && (
                <div className="mx-4 mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{deleteError}</div>
              )}
              <DataTable
                columns={columns}
                data={pageItems}
                isLoading={isLoading}
                error={claimsError}
                onRetry={() => refetchClaims()}
                totalPages={totalPages}
                currentPage={page}
                onPageChange={setPage}
                totalCount={totalCount}
                emptyTitle={hasFilters ? 'No claims match these filters' : 'No claims yet'}
                emptyDescription={hasFilters
                  ? 'Try a different search, or clear the filters.'
                  : isMgmt
                    ? 'Claims show up here as soon as they are submitted.'
                    : 'Claims are raised for disbursed loans. Use New claim to submit one.'}
                emptyAction={hasFilters
                  ? <Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>
                  : !isMgmt ? <Button size="sm" onClick={() => setShowNewClaim(true)}>New claim</Button> : undefined}
              />
            </Card>
          </div>
        )}
      </div>

      {showNewClaim && (
        <NewClaimModal
          onClose={() => setShowNewClaim(false)}
          onSuccess={() => {
            setShowNewClaim(false)
            // Same invalidation-key the existing status-update mutation
            // already uses — refreshes the list/KPI-cards/status-cards on
            // both tabs, since they all derive from the same ['payouts']
            // query.
            qc.invalidateQueries({ queryKey: ['payouts'] })
          }}
        />
      )}
      {showEarnings && <EarningsModal onClose={() => setShowEarnings(false)} />}
      {statusClaim && <ClaimStatusModal claim={statusClaim} onClose={() => setStatusClaim(null)} />}
    </div>
  )
}
