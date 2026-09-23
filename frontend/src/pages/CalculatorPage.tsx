import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { emiReducing, emiFlat, buildAmortSchedule, buildFlatAmortSchedule, toYearlySchedule, calcPrepayment, reverseEmi } from '@/utils/emi'
import { formatCurrency as fmtINR } from '@/utils/format'
import { loansApi } from '@/api/loansApi'
import { useToast } from '@/store/toastStore'
import { InlineLoader } from '@/components/ui/LoadingSpinner'
import CompareLoansMode from '@/components/shared/CompareLoansMode'
import PrepaymentMode from '@/components/shared/PrepaymentMode'
import ReverseEmiMode from '@/components/shared/ReverseEmiMode'
import { NumberInput } from '@/components/ui/NumberInput'

type CalcType = 'reducing' | 'flat'
// Legacy's four calculator modes (calcSwitchMode). Only Standard existed here.
type Mode = 'standard' | 'compare' | 'prepay' | 'reverse'
const MODES: { key: Mode; label: string }[] = [
  { key: 'standard', label: 'Standard' },
  { key: 'compare',  label: 'Compare Loans' },
  { key: 'prepay',   label: 'Prepayment' },
  { key: 'reverse',  label: '🔁 Reverse EMI' },
]

export default function CalculatorPage() {
  const [mode,    setMode]    = useState<Mode>('standard')
  // Legacy's calculator loads empty (₹0 / 0% / placeholder inputs, slider at
  // min) and computes only once values are entered — not pre-filled defaults.
  const [amount,  setAmount]  = useState(0)
  const [rate,    setRate]    = useState(0)
  const [tenure,  setTenure]  = useState(0)
  const [salary,  setSalary]  = useState(0)
  const [obligations, setObligations] = useState(0)
  const [calcType, setCalcType] = useState<CalcType>('reducing')
  const [showAmort, setShowAmort] = useState(false)
  const [amortView, setAmortView] = useState<'monthly' | 'yearly'>('monthly')

  const calc   = calcType === 'reducing' ? emiReducing : emiFlat
  const result = calc(amount, rate, tenure)
  const { emi, total, totalInt } = result
  const intPct  = total > 0 ? Math.round((totalInt / total) * 100) : 0
  const prinPct = 100 - intPct

  // Donut geometry — faithful port of legacy's principal/interest ring
  // (index.html:4069-4092, efin-app.js:11246-11255): r=38, so the arc
  // lengths are fractions of the r=38 circumference.
  const DONUT_CIRC = 2 * Math.PI * 38
  const intArc  = (DONUT_CIRC * intPct) / 100
  const prinArc = (DONUT_CIRC * prinPct) / 100

  // Flat mode uses a DIFFERENT amortisation schedule (equal principal), not the
  // reducing-balance one — legacy calcEmi (efin-app.js:11338-11349). The
  // migration used the reducing schedule for both, so the Flat-mode
  // Principal/Interest split was wrong.
  const amortRows = showAmort
    ? (calcType === 'flat' ? buildFlatAmortSchedule(amount, rate, tenure) : buildAmortSchedule(amount, rate, tenure))
    : []
  const amortYears = showAmort && amortView === 'yearly' ? toYearlySchedule(amortRows) : []

  // FOIR zones — verbatim from legacy calcEmi (efin-app.js:11304-11307):
  // labels Conservative/Standard/Moderate/High — Risk of rejection, and the
  // >65 verdict is --danger (the coloured legend swatch below is a separate
  // --accent2, matching index.html:4104-4108). The migration had renamed the
  // labels (Safe/OK/High/Risk) and recoloured the >65 verdict to --accent2.
  const foirPct = salary > 0 ? ((emi + obligations) / salary) * 100 : 0
  const foirZone = foirPct <= 40 ? { label: 'Conservative — Healthy', color: 'var(--success)' }
    : foirPct <= 50 ? { label: 'Standard — Acceptable', color: 'var(--accent)' }
    : foirPct <= 65 ? { label: 'Moderate — Watch out', color: 'var(--warn)' }
    : { label: 'High — Risk of rejection', color: 'var(--danger)' }

  // Legacy shows a max eligible EMI (salary×0.5 − obligations), NOT a loan
  // principal — efin-app.js:11312-11315.
  const maxEmi = salary > 0 ? salary * 0.5 - obligations : 0

  // Rate sensitivity — legacy calcEmi (efin-app.js:11322-11334): offsets
  // [-2,-1,0,1,2], ALWAYS reducing balance (even in Flat mode), only
  // Rate/EMI/Interest columns. The migration had added ±0.5 rows, a Δ EMI
  // column, and made it calc-type-aware — none of which legacy has.
  const rateSensitivity = [-2, -1, 0, 1, 2].map(d => {
    const r2 = Math.max(rate + d, 0.1)
    const res = emiReducing(amount, r2, tenure)
    return { delta: d, rate: r2, emi: res.emi, totalInt: res.totalInt }
  })

  return (
    <div className="mx-auto" style={{ maxWidth: 1100 }}>
      {/* Vanilla .calc-wrap (app.css:8769) is max-width:1100px, not the
          narrower 768px (max-w-3xl) this page used before — at 768px the
          two-column .calc-layout grid below would be too cramped. */}
      {/* Vanilla .calc-header (app.css:8771) — plain left-aligned title +
          subtitle, no gradient hero / icon tile. */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 26, fontWeight: 800, marginBottom: 2, color: 'var(--text)' }}>EMI Calculator</h1>
        <p style={{ fontSize: 13, color: 'var(--text3)' }}>Advanced loan EMI calculator with amortisation, prepayment simulation, and scenario comparison.</p>
      </div>

      {/* Mode tabs — legacy's calcSwitchMode (calc-mode-tabs, a segmented
          pill control, not underline tabs) */}
      <div className="calc-mode-tabs mb-6">
        {MODES.map(m => (
          <button key={m.key} onClick={() => setMode(m.key)}
            className={`calc-mode-tab ${mode === m.key ? 'active' : ''}`}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Always-mounted sub-modes (Vanilla's display:none/block toggle
          pattern) — keeps each mode's internal state alive across tab
          switches instead of remounting it from scratch every time. */}
      <div style={{ display: mode === 'compare' ? 'block' : 'none' }}>
        <CompareLoansMode />
      </div>
      <div style={{ display: mode === 'prepay' ? 'block' : 'none' }}>
        <PrepaymentMode calcPrepayment={calcPrepayment} />
      </div>
      <div style={{ display: mode === 'reverse' ? 'block' : 'none' }}>
        <ReverseEmiMode reverseEmi={reverseEmi} />
      </div>

      {mode === 'standard' && <>
      {/* Two-column shell — legacy's .calc-layout (index.html:3956): inputs
          on the left, results (hero/donut/FOIR/what-if) stacked on the
          right, collapsing to one column below 860px. The amortisation
          table sits OUTSIDE this grid, full width, below both columns
          (index.html:4124-4127) — it is not part of the right column. */}
      <div className="calc-layout mb-5">
      {/* LEFT COLUMN: inputs */}
      <div>
      {/* Calc type toggle — legacy's calc-loan-type: subtle-tint toggle,
          not a solid-fill pill. Legacy labels it "Interest Method"
          (index.html:3961). */}
      <div className="text-[11px] font-bold uppercase mb-2" style={{ color: 'var(--text3)', letterSpacing: '.6px' }}>Interest Method</div>
      <div className="flex gap-1.5 mb-[18px]">
        <button onClick={() => setCalcType('reducing')}
          className={`flex-1 calc-toggle-btn ${calcType === 'reducing' ? 'active' : ''}`}>
          Reducing Balance
        </button>
        <button onClick={() => setCalcType('flat')}
          className={`flex-1 calc-toggle-btn ${calcType === 'flat' ? 'active' : ''}`}>
          Flat Rate
        </button>
      </div>

      <div className="calc-card p-6">
        {/* Amount */}
        <div className="mb-[22px]">
          <div className="flex justify-between mb-2">
            <label className="text-xs font-semibold text-[color:var(--text3)] uppercase tracking-wide">Loan Amount</label>
            <span className="text-[15px] font-extrabold text-[color:var(--accent)]" style={{ fontFamily: 'var(--font-head)' }}>{fmtINR(amount)}</span>
          </div>
          <NumberInput value={amount || ''} placeholder="e.g. 500000" onChange={e => setAmount(Number(e.target.value))}
            className="w-full efin-input mb-2" />
          <input type="range" min={50000} max={10000000} step={10000} value={amount}
            onChange={e => setAmount(Number(e.target.value))}
            className="efin-range" />
          <div className="calc-range-labels"><span>₹50K</span><span>₹1Cr</span></div>
        </div>

        {/* Rate */}
        <div className="mb-[22px]">
          <div className="flex justify-between mb-2">
            <label className="text-xs font-semibold text-[color:var(--text3)] uppercase tracking-wide">Annual Interest Rate</label>
            <span className="text-[15px] font-extrabold text-[color:var(--accent)]" style={{ fontFamily: 'var(--font-head)' }}>{rate}%</span>
          </div>
          <NumberInput value={rate || ''} step={0.1} placeholder="e.g. 12.5" onChange={e => setRate(Number(e.target.value))}
            className="w-full efin-input mb-2" />
          <input type="range" min={5} max={30} step={0.1} value={rate}
            onChange={e => setRate(Number(e.target.value))}
            className="efin-range" />
          <div className="calc-range-labels"><span>5%</span><span>36%</span></div>
        </div>

        {/* Tenure */}
        <div className="mb-[22px]">
          <div className="flex justify-between mb-2">
            <label className="text-xs font-semibold text-[color:var(--text3)] uppercase tracking-wide">Loan Tenure</label>
            <span className="text-[15px] font-extrabold text-[color:var(--accent)]" style={{ fontFamily: 'var(--font-head)' }}>{tenure} months ({(tenure / 12).toFixed(1)} yrs)</span>
          </div>
          <div className="flex gap-2 mb-2">
            <NumberInput value={tenure || ''} onChange={e => setTenure(Number(e.target.value))}
              placeholder="Months"
              className="flex-1 efin-input" />
            <NumberInput value={tenure ? (tenure / 12).toFixed(1) : ''}
              onChange={e => setTenure(Math.round(Number(e.target.value) * 12))}
              placeholder="Years"
              className="flex-1 efin-input" />
          </div>
          <input type="range" min={6} max={360} step={6} value={tenure}
            onChange={e => setTenure(Number(e.target.value))}
            className="efin-range" />
          <div className="calc-range-labels"><span>6 mo</span><span>30 yr</span></div>
        </div>

        {/* FOIR inputs */}
        <div className="grid grid-cols-2 gap-4 pt-3 border-t border-[color:var(--border)]">
          <div>
            <label className="text-xs font-semibold text-[color:var(--text3)] uppercase tracking-wide block mb-1">Monthly Salary (₹)</label>
            <NumberInput value={salary || ''} onChange={e => setSalary(Number(e.target.value))}
              placeholder="Optional — for FOIR"
              className="w-full efin-input" />
          </div>
          <div>
            <label className="text-xs font-semibold text-[color:var(--text3)] uppercase tracking-wide block mb-1">Existing EMI Obligations (₹)</label>
            <NumberInput value={obligations || ''} onChange={e => setObligations(Number(e.target.value))}
              placeholder="0 if none"
              className="w-full efin-input" />
          </div>
        </div>
      </div>
      </div>{/* /LEFT COLUMN */}

      {/* RIGHT COLUMN: results — value colors match legacy's
          calc-emi-big/calc-bk-val (index.html:3999-4041): EMI hero +
          Interest use --accent2, Total Payable uses --accent, Principal
          stays neutral. */}
      <div>
      {emi > 0 ? (
        <>
        {/* Result card — legacy .calc-result-card (index.html:4016): one bordered
            card with a light-gradient EMI hero (red 48px EMI, not a blue banner)
            over a value-above-label breakdown grid with column dividers. */}
        <div className="calc-result-card mb-5">
          <div className="calc-result-top">
            <div className="text-[11px] uppercase" style={{ letterSpacing: '1.2px', color: 'var(--text3)', marginBottom: 8 }}>Monthly EMI</div>
            <div className="calc-emi-big">{fmtINR(emi)}</div>
            <div className="text-[11px] mt-1.5" style={{ color: 'var(--text3)' }}>
              {calcType === 'flat' ? 'Flat rate' : 'Reducing balance'} · {fmtINR(amount)} over {tenure} months @ {rate}% p.a.
            </div>
          </div>
          <div className="calc-breakdown-grid">
            <div className="calc-bk-item">
              <div className="calc-bk-val">{fmtINR(amount)}</div>
              <div className="calc-bk-lbl">Principal</div>
            </div>
            <div className="calc-bk-item">
              <div className="calc-bk-val" style={{ color: 'var(--accent2)' }}>{fmtINR(totalInt)}</div>
              <div className="calc-bk-lbl">Total Interest</div>
            </div>
            <div className="calc-bk-item" style={{ borderRight: 'none' }}>
              <div className="calc-bk-val" style={{ color: 'var(--accent)' }}>{fmtINR(total)}</div>
              <div className="calc-bk-lbl">Total Payable</div>
            </div>
          </div>
        </div>

        {/* Save/Load to Application — legacy calcSaveToApplication /
            calcLoadFromApplication (efin-app.js:11360-11462). Sits directly
            under the result card in the right column, above the donut
            (index.html:4040-4067) — not tacked on at the very bottom of
            the page. */}
        <SaveToApplicationCard
          amount={amount} rate={rate} tenure={tenure}
          onLoad={(a, r, t) => { setAmount(a); setRate(r); setTenure(t) }}
        />

        <div className="calc-card p-6 mb-5">
          {/* Visual breakdown — legacy's animated principal/interest donut
              (index.html:4069-4092, efin-app.js:11246-11255). The React
              migration had replaced this SVG ring with a flat 2-colour bar;
              restored to the real donut: interest ring (--accent2) drawn
              first from the top, principal ring (--accent) offset behind it,
              both animating their arc length. */}
          <div className="flex items-center gap-5 mb-4">
            <svg width="104" height="104" viewBox="0 0 100 100" className="shrink-0" role="img"
              aria-label={`Principal ${prinPct}%, interest ${intPct}%`}>
              <circle cx="50" cy="50" r="38" fill="none" stroke="var(--surface3)" strokeWidth="14" />
              <circle cx="50" cy="50" r="38" fill="none" stroke="var(--accent2)" strokeWidth="14" strokeLinecap="round"
                strokeDasharray={`${intArc} ${DONUT_CIRC - intArc}`} strokeDashoffset={0}
                transform="rotate(-90 50 50)" style={{ transition: 'stroke-dasharray .5s cubic-bezier(.4,0,.2,1)' }} />
              <circle cx="50" cy="50" r="38" fill="none" stroke="var(--accent)" strokeWidth="14" strokeLinecap="round"
                strokeDasharray={`${prinArc} ${DONUT_CIRC - prinArc}`} strokeDashoffset={-intArc}
                transform="rotate(-90 50 50)" style={{ transition: 'stroke-dasharray .5s cubic-bezier(.4,0,.2,1), stroke-dashoffset .5s' }} />
              <text x="50" y="47" textAnchor="middle" style={{ fontSize: 12, fontWeight: 800, fill: 'var(--text)', fontFamily: 'var(--font-head)' }}>{prinPct}%</text>
              <text x="50" y="61" textAnchor="middle" style={{ fontSize: 8, fill: 'var(--text3)', letterSpacing: '.5px' }}>PRIN</text>
            </svg>
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="flex items-center gap-2 text-xs">
                <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ background: 'var(--accent)' }} />
                <span className="text-[color:var(--text3)]">Principal</span>
                <span className="ml-auto font-bold text-[color:var(--text)]">{prinPct}%</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ background: 'var(--accent2)' }} />
                <span className="text-[color:var(--text3)]">Interest</span>
                <span className="ml-auto font-bold text-[color:var(--text)]">{intPct}%</span>
              </div>
              <p className="text-[11px] text-[color:var(--text3)] pt-1 leading-snug">Cost of credit: {amount > 0 ? (total / amount).toFixed(2) : '—'}× principal</p>
            </div>
          </div>

          {/* FOIR */}
          {salary > 0 && (
            <div className="mt-4 pt-4 border-t border-[color:var(--border)]">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-semibold text-[color:var(--text3)] uppercase">FOIR (Fixed Obligation to Income Ratio)</span>
                <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>{foirPct.toFixed(1)}%{obligations > 0 ? ' (incl. other EMIs)' : ''}</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden mb-1" style={{ background: 'var(--surface3)' }}>
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(foirPct, 100)}%`, background: foirZone.color }} />
              </div>
              {/* 4-zone legend strip — index.html:4104-4108 (Risk swatch is --accent2) */}
              <div className="flex justify-between text-[11px] mb-1.5">
                <span style={{ color: 'var(--success)' }}>Safe ≤40%</span>
                <span style={{ color: 'var(--accent)' }}>OK ≤50%</span>
                <span style={{ color: 'var(--warn)' }}>High ≤65%</span>
                <span style={{ color: 'var(--accent2)' }}>Risk &gt;65%</span>
              </div>
              <p className="text-xs font-semibold" style={{ color: foirZone.color }}>{foirZone.label}</p>
              <p className="text-xs text-[color:var(--text3)] mt-1">
                {maxEmi > 0
                  ? <>Max eligible EMI at 50% FOIR: <span className="font-semibold text-[color:var(--accent)]">{fmtINR(maxEmi)}</span></>
                  : 'Existing obligations exceed 50% FOIR limit'}
              </p>
            </div>
          )}
        </div>

        {/* Rate sensitivity — legacy's Standard-mode what-if table
            (index.html:4115-4121, calcEmi 11322-11334): Rate / Monthly EMI /
            Total Interest only, base row marked with ★, values plain (no
            per-column colour). Lives in the same right column, directly
            under the donut/FOIR card. */}
        <div className="calc-card p-4">
          <p className="text-xs font-semibold text-[color:var(--text3)] uppercase mb-3">Rate Sensitivity</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[color:var(--text3)] border-b border-[color:var(--border)]">
                  {['Rate', 'Monthly EMI', 'Total Interest'].map((h, i) => (
                    <th key={h} className={`pb-2 pr-3 font-medium ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rateSensitivity.map(r => (
                  <tr key={r.delta} className="border-b border-[color:var(--border)]"
                    style={r.delta === 0 ? { background: 'var(--accent-subtle)', color: 'var(--accent)', fontWeight: 700 } : undefined}>
                    <td className="py-1.5 pr-3 text-left">{r.rate.toFixed(1)}%{r.delta === 0 ? ' ★' : ''}</td>
                    <td className="py-1.5 pr-3 text-right" style={{ fontFamily: 'var(--font-head)' }}>{fmtINR(r.emi)}</td>
                    <td className="py-1.5 text-right text-[color:var(--text2)]" style={{ fontFamily: 'var(--font-head)' }}>{fmtINR(r.totalInt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </>
      ) : (
        /* Empty state — legacy hides #calc-result-card-wrap entirely
           (display:none) until amount/rate/tenure are filled in
           (index.html:4015). A short placeholder keeps the right column
           from collapsing to nothing before that. */
        <div className="calc-card p-6 text-center text-sm" style={{ color: 'var(--text3)', minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          Enter a loan amount, rate and tenure to see your EMI
        </div>
      )}
      </div>{/* /RIGHT COLUMN */}
      </div>{/* /calc-layout */}

      {/* Amortization — legacy's .calc-amort-section/.calc-amort-toggle
          (app.css:8835-8840). Legacy's amort table renders Principal/
          Interest as plain --text2, not accent-colored — only the "Paid %"
          progress bar uses --accent — so those columns are neutral here. */}
      {emi > 0 && (
        <div className="calc-card p-4">
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => setShowAmort(!showAmort)}
              className="text-sm font-medium text-[color:var(--accent)] hover:underline">
              {showAmort ? '▲ Hide' : '▼ Show'} Amortization Schedule ({tenure} months)
            </button>
            {/* Monthly / Yearly toggle — legacy's calcAmortView */}
            {showAmort && (
              <div className="flex gap-1.5">
                {(['monthly', 'yearly'] as const).map(v => (
                  <button key={v} onClick={() => setAmortView(v)}
                    className={`calc-toggle-btn capitalize ${amortView === v ? 'active' : ''}`}
                    style={{ padding: '5px 12px', fontSize: '11.5px' }}>{v}</button>
                ))}
              </div>
            )}
          </div>
          {showAmort && (
            <div className="overflow-x-auto rounded-xl border border-[color:var(--border)]">
              <table className="w-full text-xs table-premium">
                <thead>
                  <tr className="text-[color:var(--text3)]">
                    {[amortView === 'yearly' ? 'Year' : 'Month', 'EMI', 'Principal', 'Interest', 'Balance', 'Paid %'].map(h => (
                      <th key={h} className="py-2.5 px-3 text-right font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {amortView === 'yearly' ? amortYears.map(row => (
                    <tr key={row.year} className="border-b border-[color:var(--border)] hover:bg-[color:var(--surface2)]">
                      <td className="py-1.5 pr-3 text-right text-[color:var(--text2)]">Year {row.year}</td>
                      <td className="py-1.5 pr-3 text-right text-[color:var(--text2)]">{fmtINR(row.emi)}</td>
                      <td className="py-1.5 pr-3 text-right text-[color:var(--text2)]">{fmtINR(row.prin)}</td>
                      <td className="py-1.5 pr-3 text-right text-[color:var(--text2)]">{fmtINR(row.int)}</td>
                      <td className="py-1.5 pr-3 text-right text-[color:var(--text2)]">{fmtINR(row.balance)}</td>
                      {/* Legacy renders "—" in the Paid% cell of yearly rows */}
                      <td className="py-1.5 text-right text-[color:var(--text2)]">—</td>
                    </tr>
                  )) : amortRows.map(row => {
                    const paid = amount > 0 ? ((amount - row.balance) / amount) * 100 : 0
                    return (
                    <tr key={row.m} className="border-b border-[color:var(--border)] hover:bg-[color:var(--surface2)]">
                      <td className="py-1.5 pr-3 text-right text-[color:var(--text2)]">{row.m}</td>
                      <td className="py-1.5 pr-3 text-right text-[color:var(--text2)]">{fmtINR(row.emi)}</td>
                      <td className="py-1.5 pr-3 text-right text-[color:var(--text2)]">{fmtINR(row.prin)}</td>
                      <td className="py-1.5 pr-3 text-right text-[color:var(--text2)]">{fmtINR(row.int)}</td>
                      <td className="py-1.5 pr-3 text-right text-[color:var(--text2)]">{fmtINR(row.balance)}</td>
                      {/* Paid % progress bar — legacy renderAmortTable (efin-app.js:11213-11218) */}
                      <td className="py-1.5">
                        <div className="flex items-center gap-1.5 justify-end">
                          <div className="w-10 h-1 rounded-full overflow-hidden" style={{ background: 'var(--surface3)' }}>
                            <div className="h-full rounded-full" style={{ width: `${Math.min(100, paid)}%`, background: 'var(--accent)' }} />
                          </div>
                          <span className="text-[11px] text-[color:var(--text2)]">{paid.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      </>}
    </div>
  )
}

// EMI Calculator ↔ Application bridge (M11). Populates a dropdown of the
// caller's editable (Draft/Submitted) loans, then saves the calculator's
// figures onto one via PUT /api/loans/{id} (re-reading first so untouched
// fields survive) or loads that loan's saved Amount/Rate/Tenure back in.
function SaveToApplicationCard({ amount, rate, tenure, onLoad }: {
  amount: number; rate: number; tenure: number
  onLoad: (a: number, r: number, t: number) => void
}) {
  const toast = useToast()
  const [selectedId, setSelectedId] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)

  const { data: editable = [] } = useQuery({
    queryKey: ['calc', 'editable-loans'],
    queryFn: async () => {
      const res = await loansApi.getAll({ page: 1, pageSize: 200 })
      const items = res.data.data?.items ?? []
      // Draft/Submitted only — mirrors LoanService.UpdateAsync's own gate.
      return items.filter(l => l.status === 'Draft' || l.status === 'Submitted')
    },
  })

  async function handleSave() {
    if (!selectedId) { toast.warn('Select an application first'); return }
    if (!amount || !rate || !tenure) { toast.warn('Enter Amount, Rate and Tenure before saving'); return }
    setSaving(true)
    try {
      const cur = (await loansApi.getById(Number(selectedId))).data.data
      if (!cur) throw new Error('Could not load application details.')
      await loansApi.updateCoreFigures(Number(selectedId), {
        loanType: cur.loanType,
        requestedAmount: amount,
        interestRate: rate,
        tenureMonths: tenure,
        purpose: cur.purpose ?? '',
        remarks: cur.remarks ?? '',
        assignedToUserId: cur.assignedTo?.id ?? null,
        loginUserId: cur.loginUser?.id ?? null,
      })
      toast.success('EMI saved to application ✓')
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } }; message?: string })
      toast.error('⚠ ' + (msg?.response?.data?.message || msg?.message || 'Could not save to application'))
    } finally { setSaving(false) }
  }

  async function handleLoad() {
    if (!selectedId) { toast.warn('Select an application first'); return }
    setLoading(true)
    try {
      const d = (await loansApi.getById(Number(selectedId))).data.data
      if (!d) throw new Error('Could not load application.')
      onLoad(d.requestedAmount || 0, d.interestRate || 0, d.tenureMonths || 0)
      toast.success('Loaded numbers from ' + d.loanNumber + ' ✓')
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } }; message?: string })
      toast.error('⚠ ' + (msg?.response?.data?.message || msg?.message || 'Could not load application'))
    } finally { setLoading(false) }
  }

  // Legacy .calc-save-to-app (index.html:4045-4067): select + full-width
  // save button, stacked under a border-top divider inside the result
  // card, with a separate ghost "Load" button below — not a card of its
  // own with a horizontal select+buttons row.
  return (
    <div className="px-6 pb-5" style={{ paddingTop: 16, marginTop: -4, borderTop: '1px solid var(--border)' }}>
      <p className="text-xs font-semibold text-[color:var(--text3)] uppercase mb-2">Save to Application</p>
      <select value={selectedId} onChange={e => setSelectedId(e.target.value)} className="w-full efin-input mb-2">
        <option value="">{editable.length ? '— Select an application —' : 'No editable applications (Draft/Submitted only)'}</option>
        {editable.map(l => (
          <option key={l.id} value={l.id}>{l.loanNumber} — {l.customerName || 'Unnamed'} ({fmtINR(l.requestedAmount || 0)})</option>
        ))}
      </select>
      <button onClick={handleSave} disabled={saving || !selectedId}
        className="calc-toggle-btn active w-full mb-2" style={{ padding: '9px 14px' }}>
        {saving ? <><InlineLoader size={13} /> Saving…</> : '💾 Save EMI to Application'}
      </button>
      <button onClick={handleLoad} disabled={loading || !selectedId}
        className="calc-toggle-btn w-full" style={{ padding: '8px 14px' }}>
        {loading ? <><InlineLoader size={13} /> Loading…</> : '📥 Load Numbers From an Application'}
      </button>
    </div>
  )
}
