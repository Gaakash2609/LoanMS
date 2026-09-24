import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sparkles, TrendingUp, BadgeCheck, RefreshCw, Star, ChevronDown, ChevronUp, Percent, IndianRupee, CheckCircle2, Info } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { settingsApi } from '@/api/settingsApi'
import { emiReducing } from '@/utils/emi'
import { formatCurrency } from '@/utils/format'
import {
  camCalculate, CAM_MATRIX_DEFAULT, CAM_MIN_SALARY,
  CAM_AMOUNT_MIN, CAM_AMOUNT_STEP, CAM_MATRIX_SETTING_KEY,
  type CamBand,
} from '@/constants/cam'
import { NumberInput } from '@/components/ui/NumberInput'

// ── CAM offer panel — wizard Step 6 ─────────────────────────────────────
// Ports legacy's #wstep6-cam-panel (index.html:2467) and camCalculate /
// camSliderChange / camApplyToWizard (efin-app.js:17426-17650).
//
// Legacy prefills cam-salary / cam-obligations from the employment step and
// lets the user override them for a what-if, then "Apply" writes the chosen
// amount / tenure / rate back into the wizard's own loan fields. Same here —
// the panel never submits anything itself, it only fills the form below it.
//
// The matrix comes from AppSettings key `efin_cam_matrix` (readable by any
// authenticated user per SettingsController's whitelist), falling back to
// CAM_MATRIX_DEFAULT when unset — same fallback legacy has.

export function useCamMatrix(): CamBand[] {
  const { data } = useQuery({
    queryKey: ['cam-matrix'],
    queryFn: () => settingsApi.getByKey(CAM_MATRIX_SETTING_KEY).then(r => r.data.data),
    staleTime: 300_000,
    retry: false,
  })
  return useMemo(() => {
    if (!data?.value) return CAM_MATRIX_DEFAULT
    try {
      const parsed = JSON.parse(data.value)
      return Array.isArray(parsed) && parsed.length ? (parsed as CamBand[]) : CAM_MATRIX_DEFAULT
    } catch {
      // A corrupt setting must not break the wizard — fall back silently,
      // exactly as legacy does when the parse throws.
      return CAM_MATRIX_DEFAULT
    }
  }, [data])
}

export default function CamOfferPanel({
  salary, obligations, companyName, applicantName, onApply,
}: {
  salary: string
  obligations: string
  companyName: string
  applicantName: string
  onApply: (offer: { amount: string; tenure: string; loanRate: string }) => void
}) {
  const matrix = useCamMatrix()

  // Seeded from the employment step, then user-overridable — legacy does the
  // same so a sales user can run a what-if without editing Step 3.
  const [salaryInput, setSalaryInput] = useState(salary)
  const [obligInput, setObligInput] = useState(obligations || '0')
  const [ran, setRan] = useState(false)
  const [amount, setAmount] = useState(0)
  const [tenure, setTenure] = useState(0)
  const [warning, setWarning] = useState('')
  const [showRecalc, setShowRecalc] = useState(false)

  // Keep following the wizard until the user runs a calculation; after that,
  // their overrides are theirs to keep.
  useEffect(() => { if (!ran) setSalaryInput(salary) }, [salary, ran])
  useEffect(() => { if (!ran) setObligInput(obligations || '0') }, [obligations, ran])

  const result = useMemo(
    () => camCalculate(parseFloat(salaryInput) || 0, parseFloat(obligInput) || 0, companyName, matrix),
    [salaryInput, obligInput, companyName, matrix],
  )

  function runCalculation(salaryOverride?: string, obligOverride?: string, silent = false) {
    const s = parseFloat(salaryOverride ?? salaryInput) || 0
    const o = parseFloat(obligOverride ?? obligInput) || 0
    const r = camCalculate(s, o, companyName, matrix)
    if (s > 0 && s < CAM_MIN_SALARY) {
      if (!silent) setWarning(`Minimum salary for an offer is ${formatCurrency(CAM_MIN_SALARY)}`)
      setRan(false)
      return
    }
    if (!r.band) {
      if (!silent) setWarning('Enter a gross monthly income to see the offer.')
      setRan(false)
      return
    }
    setWarning('')
    setAmount(r.maxLoanWithBoost)
    setTenure(r.band.tenureMax)
    setRan(true)
  }

  // Auto-run on mount / whenever the step-5 salary arrives — ports Vanilla's
  // camInit() (efin-app.js:17390-17423), which fires on ENTERING physical
  // step 6 and immediately shows the offer card if salary is already known,
  // with no click required. React previously only computed on an explicit
  // "Calculate Offer" click, so a returning/resumed applicant with salary
  // already filled saw an empty panel until they clicked once. `silent`
  // suppresses the "enter income" warning on this automatic pass so it
  // doesn't flash for an applicant who genuinely hasn't entered salary yet.
  // Only auto-runs while the user hasn't taken over with their own edit
  // (mirrors the `!ran` guard already used for salaryInput/obligInput sync).
  useEffect(() => {
    if (!ran && parseFloat(salary) > 0) runCalculation(salary, obligations || '0', true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salary, obligations])

  const showOffer = ran && !!result.band
  const band = result.band
  const { emi } = showOffer && band
    ? emiReducing(amount, result.midRate, tenure)
    : { emi: 0 }

  // Build up to 3 EMI plan options from the band's tenure range
  const emiPlans = useMemo(() => {
    if (!band) return []
    const plans: { tenure: number; emi: number; maxAmount: number }[] = []
    const maxT = band.tenureMax
    const midT = Math.round((band.tenureMin + band.tenureMax) / 2 / 12) * 12
    const minT = band.tenureMin

    const tenures = Array.from(new Set([maxT, midT, minT].filter(t => t >= band.tenureMin && t <= band.tenureMax)))
      .sort((a, b) => b - a)
      .slice(0, 3)

    for (const t of tenures) {
      const { emi: e } = emiReducing(amount, result.midRate, t)
      plans.push({ tenure: t, emi: Math.round(e), maxAmount: amount })
    }
    return plans
  }, [band, amount, result.midRate])

  return (
    <div className="mb-6">
      {/* ── OFFER CONFIRMED CARD ─────────────────────────────────────── */}
      {!showOffer && !warning && (
        <div className="relative rounded-2xl border border-token bg-surface p-5 mb-4 overflow-hidden transition-shadow hover:shadow-md"
          style={{ boxShadow: '0 2px 16px rgba(10,88,154,.06)' }}>
          <div style={{
            position: 'absolute', top: -50, right: -50, width: 180, height: 180, borderRadius: '50%',
            background: 'radial-gradient(circle, var(--accent-subtle) 0%, transparent 70%)', pointerEvents: 'none',
          }} />
          <div className="relative flex items-center gap-2.5 mb-1">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, var(--accent-light), var(--accent-dark))', boxShadow: '0 4px 12px -4px var(--accent)' }}>
              <Sparkles size={14} className="text-white" />
            </div>
            <p className="text-[15px] font-bold" style={{ fontFamily: 'var(--font-head)', color: 'var(--text)', letterSpacing: '-.2px' }}>Eligibility Offer</p>
          </div>
          <p className="text-xs mb-4 relative" style={{ color: 'var(--text3)' }}>
            Works out the maximum this applicant qualifies for, then fills the loan fields below.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end relative">
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text2)' }}>Gross Monthly Income (₹)</label>
              <NumberInput min="0" value={salaryInput} onChange={e => setSalaryInput(e.target.value)}
                placeholder="e.g. 50000"
                className="w-full rounded-lg border border-token bg-surface2 px-3 py-2 text-sm tabular-nums transition-colors focus:border-efin-blue" />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text2)' }}>Existing Obligations (₹)</label>
              <NumberInput min="0" value={obligInput} onChange={e => setObligInput(e.target.value)}
                placeholder="0 if none"
                className="w-full rounded-lg border border-token bg-surface2 px-3 py-2 text-sm tabular-nums transition-colors focus:border-efin-blue" />
            </div>
            <Button size="sm" onClick={() => runCalculation()}>
              <TrendingUp size={14} className="mr-1" />Calculate Offer
            </Button>
          </div>
        </div>
      )}

      {warning && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: 'rgba(217,119,6,.15)' }}>⚠️</span>
          <span className="pt-0.5">{warning}</span>
        </div>
      )}

      {showOffer && band && (
        <div className="rounded-2xl overflow-hidden border border-token transition-shadow" style={{ boxShadow: '0 10px 40px -8px rgba(8,30,80,.22), 0 2px 8px rgba(8,30,80,.08)' }}>

          {/* ── Dark hero section ── */}
          <div
            className="relative px-6 pt-6 pb-7"
            style={{
              background: 'linear-gradient(135deg, #06122f 0%, var(--accent-dark) 48%, #16306e 78%, #0d1f4d 100%)',
            }}
          >
            {/* Subtle background decorative glows */}
            <div style={{
              position: 'absolute', top: -60, right: -60, width: 220, height: 220,
              borderRadius: '50%', background: 'radial-gradient(circle, rgba(26,114,184,.35) 0%, transparent 70%)', pointerEvents: 'none',
            }} />
            <div style={{
              position: 'absolute', bottom: -60, left: '30%', width: 200, height: 200,
              borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,.05) 0%, transparent 70%)', pointerEvents: 'none',
            }} />
            <div style={{
              position: 'absolute', inset: 0, opacity: .5, pointerEvents: 'none',
              background: 'linear-gradient(180deg, rgba(255,255,255,.06) 0%, transparent 40%)',
            }} />

            {/* OFFER CONFIRMED badge */}
            <div className="relative inline-flex items-center gap-1.5 mb-3.5 px-3 py-1.5 rounded-full text-[11px] font-bold tracking-wide"
              style={{ background: 'rgba(34,197,94,0.16)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.35)', boxShadow: '0 2px 10px -4px rgba(34,197,94,.4)' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#4ade80', display: 'inline-block', boxShadow: '0 0 6px #4ade80', animation: 'pulse-dot 1.8s ease-in-out infinite' }} />
              OFFER CONFIRMED &amp; READY
            </div>

            {/* Big loan amount */}
            <div className="relative text-white text-[2.6rem] sm:text-5xl font-extrabold tracking-tight mb-1 tabular-nums leading-none"
              style={{ fontFamily: 'var(--font-head)', textShadow: '0 4px 24px rgba(0,0,0,.25)' }}>
              {formatCurrency(amount)}<span style={{ color: '#4ade80' }}>!</span>
            </div>
            {applicantName && (
              <div className="relative text-white/75 text-[13px] font-medium mt-2">
                Congratulations, <span className="text-white font-bold">{applicantName.toUpperCase()}</span>!
              </div>
            )}
            <div className="relative text-white/45 text-[12px] mt-0.5">Your offer based on information available with us.</div>

            {result.isPremiumEmployer && (
              <div className="relative mt-3.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium"
                style={{ background: 'rgba(250,204,21,0.15)', color: '#fde68a', border: '1px solid rgba(250,204,21,0.3)', boxShadow: '0 2px 10px -4px rgba(250,204,21,.3)' }}>
                <BadgeCheck size={12} />
                <span>{companyName} is a premium employer · +{formatCurrency(result.boost)} boost applied</span>
              </div>
            )}
          </div>

          {/* ── ROI band bar ── */}
          <div
            className="flex items-center justify-center gap-1.5 px-6 py-2.5 text-center text-[12px] font-semibold"
            style={{ background: 'linear-gradient(90deg, #e8f1ff 0%, #dbeafe 50%, #e8f1ff 100%)', color: 'var(--accent-dark)' }}
          >
            <Percent size={12} strokeWidth={2.5} />
            ROI (reducing) per annum&nbsp;:&nbsp;{band.rateMin}.00% – {band.rateMax}.00%
          </div>

          {/* ── EMI display ── */}
          <div className="flex items-center gap-3 px-6 py-4" style={{ background: 'var(--surface, #fff)', borderBottom: '1px solid var(--border)' }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
              <IndianRupee size={18} strokeWidth={2.25} />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-0.5" style={{ color: 'var(--text3)' }}>
                Monthly Installment (EMI)
              </p>
              <p className="text-3xl font-extrabold tabular-nums leading-none" style={{ fontFamily: 'var(--font-head)', color: 'var(--accent-dark)' }}>
                {formatCurrency(Math.round(emi))}
              </p>
            </div>
          </div>

          {/* ── EMI plan cards ── */}
          <div className="px-6 pt-4 pb-4" style={{ background: 'var(--surface, #fff)' }}>
            <p className="text-[12px] font-semibold mb-2.5" style={{ color: 'var(--text2)' }}>Choose your EMI plan</p>
            <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${emiPlans.length}, 1fr)` }}>
              {emiPlans.map((plan, i) => {
                const isSelected = plan.tenure === tenure
                const isRecommended = i === 1
                const { emi: planEmi } = emiReducing(amount, result.midRate, plan.tenure)
                const totalPayable = Math.round(planEmi) * plan.tenure
                return (
                  <button
                    key={plan.tenure}
                    type="button"
                    onClick={() => setTenure(plan.tenure)}
                    className="relative text-left rounded-xl border px-3 py-3 transition-all duration-200"
                    style={{
                      borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                      background: isSelected
                        ? 'linear-gradient(160deg, var(--accent-subtle) 0%, #eff6ff 100%)'
                        : 'var(--surface2, #f9fafb)',
                      boxShadow: isSelected ? '0 0 0 3px var(--accent-glow), 0 8px 20px -10px var(--accent)' : 'none',
                      transform: isSelected ? 'translateY(-2px)' : 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {isSelected && (
                      <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center"
                        style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 2px 8px -2px var(--accent)' }}>
                        <CheckCircle2 size={13} strokeWidth={2.5} />
                      </span>
                    )}
                    <p className="text-[10px] font-bold mb-1 flex items-center gap-1"
                      style={{ color: isSelected ? 'var(--accent-dark)' : 'var(--text3)' }}>
                      {i === 0 ? 'HIGHEST TENURE' : i === 1 ? 'BALANCED PLAN' : 'SHORTER PLAN'}
                      {isRecommended && (
                        <span className="px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase tracking-wide"
                          style={{ background: 'var(--accent3)', color: '#fff' }}>Best</span>
                      )}
                    </p>
                    <p className="text-[9px] font-normal mb-1" style={{ color: 'var(--text3)' }}>OPTION {i + 1}</p>
                    <p className="text-sm font-bold tabular-nums" style={{ color: isSelected ? 'var(--accent-dark)' : 'var(--text)' }}>
                      {formatCurrency(Math.round(planEmi))}/ Month
                    </p>
                    <p className="text-[10px] tabular-nums mt-0.5" style={{ color: 'var(--text3)' }}>
                      {plan.tenure} Months
                    </p>
                    {i > 0 && (
                      <p className="text-[10px] tabular-nums text-amber-600 mt-0.5 font-medium">
                        Max {formatCurrency(totalPayable)}
                      </p>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── Amount slider (Re-Calculate section) ── */}
          <div className="px-6 pt-3 pb-2" style={{ background: 'var(--surface, #fff)' }}>
            <button
              type="button"
              onClick={() => setShowRecalc(v => !v)}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-semibold border border-dashed transition-all hover:border-solid"
              style={{ borderColor: showRecalc ? 'var(--accent)' : 'var(--border2)', color: showRecalc ? 'var(--accent)' : 'var(--text2)', background: showRecalc ? 'var(--accent-subtle)' : 'transparent' }}
            >
              {showRecalc ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {showRecalc ? 'Hide' : 'Show More · Adjust Amount & Income'}
            </button>

            {showRecalc && (
              <div className="mt-4 space-y-4 rounded-xl p-4" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
                {/* Loan Amount slider */}
                <div>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <label className="text-xs font-semibold" style={{ color: 'var(--text2)' }}>Loan Amount</label>
                    <span className="text-base font-extrabold tabular-nums" style={{ color: 'var(--accent-dark)' }}>{formatCurrency(amount)}</span>
                  </div>
                  {(() => {
                    const sliderMax = Math.max(CAM_AMOUNT_MIN, result.maxLoanWithBoost)
                    const pct = sliderMax > CAM_AMOUNT_MIN ? Math.min(100, Math.max(0, ((amount - CAM_AMOUNT_MIN) / (sliderMax - CAM_AMOUNT_MIN)) * 100)) : 0
                    return (
                      <input type="range"
                        min={CAM_AMOUNT_MIN} max={sliderMax} step={CAM_AMOUNT_STEP}
                        value={amount} onChange={e => setAmount(Number(e.target.value))}
                        className="efin-range w-full"
                        style={{ background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--surface3) ${pct}%, var(--surface3) 100%)` }} />
                    )
                  })()}
                  <div className="flex justify-between text-[11px] tabular-nums mt-1" style={{ color: 'var(--text3)' }}>
                    <span>{formatCurrency(CAM_AMOUNT_MIN)}</span>
                    <span>{formatCurrency(result.maxLoanWithBoost)} (Max)</span>
                  </div>
                </div>

                {/* Salary / Obligations override */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text2)' }}>Gross Income (₹)</label>
                    <NumberInput min="0" value={salaryInput} onChange={e => setSalaryInput(e.target.value)}
                      className="w-full rounded-lg border border-token bg-surface px-3 py-2 text-sm tabular-nums transition-colors focus:border-efin-blue" />
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text2)' }}>Obligations (₹)</label>
                    <NumberInput min="0" value={obligInput} onChange={e => setObligInput(e.target.value)}
                      className="w-full rounded-lg border border-token bg-surface px-3 py-2 text-sm tabular-nums transition-colors focus:border-efin-blue" />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-xl p-2.5 transition-transform hover:-translate-y-0.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <p className="text-[10px] font-medium mb-0.5" style={{ color: 'var(--text3)' }}>Rate</p>
                    <p className="text-sm font-bold tabular-nums" style={{ color: 'var(--accent-dark)' }}>{result.midRate.toFixed(2)}%</p>
                  </div>
                  <div className="rounded-xl p-2.5 transition-transform hover:-translate-y-0.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <p className="text-[10px] font-medium mb-0.5" style={{ color: 'var(--text3)' }}>Monthly EMI</p>
                    <p className="text-sm font-bold tabular-nums" style={{ color: 'var(--accent-dark)' }}>{formatCurrency(Math.round(emi))}</p>
                  </div>
                  <div className="rounded-xl p-2.5 transition-transform hover:-translate-y-0.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <p className="text-[10px] font-medium mb-0.5" style={{ color: 'var(--text3)' }}>Max EMI</p>
                    <p className="text-sm font-bold tabular-nums" style={{ color: 'var(--accent-dark)' }}>{formatCurrency(Math.round(result.maxEmi))}</p>
                  </div>
                </div>

                <p className="text-[11px]" style={{ color: 'var(--text3)' }}>
                  Band {band.label} · FOIR {(band.foir * 100).toFixed(0)}% · rate range {band.rateMin}–{band.rateMax}%
                </p>
              </div>
            )}
          </div>

          {/* ── Note ── */}
          <div className="mx-6 mb-4 mt-2 flex items-start gap-2 rounded-xl px-4 py-2.5 text-[11px]"
            style={{ background: '#fff8ed', border: '1px solid #fcd34d', color: '#92400e' }}>
            <Info size={14} className="flex-shrink-0 mt-0.5" strokeWidth={2.25} />
            <span><span className="font-bold">Note: </span>
            Upon evaluation of your credit data, the final loan amount is subject to adjustment. This offer is indicative and based on the information provided.</span>
          </div>

          {/* ── Action buttons ── */}
          <div className="px-6 pb-5 flex gap-3">
            <button
              type="button"
              onClick={() => runCalculation()}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-token py-2.5 text-sm font-semibold transition-all hover:bg-surface2 hover:-translate-y-0.5"
              style={{ color: 'var(--text2)', background: 'var(--surface)' }}
            >
              <RefreshCw size={14} />
              Re-Calculate
            </button>
            <button
              type="button"
              onClick={() => onApply({
                amount: String(Math.round(amount)),
                tenure: String(tenure),
                loanRate: result.midRate.toFixed(2),
              })}
              className="flex-[2] flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg"
              style={{ background: 'linear-gradient(135deg, var(--accent-light) 0%, var(--accent-dark) 100%)', boxShadow: '0 6px 20px -6px var(--accent)' }}
            >
              <Star size={14} fill="currentColor" />
              Apply to Application
              <span className="text-[10px] font-normal text-white/70 ml-0.5">Confirm offer &amp; proceed</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
