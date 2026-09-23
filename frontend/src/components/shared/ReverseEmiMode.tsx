import { useState } from 'react'
import { formatCurrency as fmtINR } from '@/utils/format'
import type { reverseEmi as ReverseEmi, ReverseMethod } from '@/utils/emi'
import { NumberInput } from '@/components/ui/NumberInput'

// Reverse EMI — legacy's calcReverse(). Given an affordable EMI, work back to
// the maximum loan amount, with a Reducing/Flat interest-method toggle
// (revSetType), a FOIR check and a tenure-sensitivity what-if table. Pure
// client-side. The migration had dropped the Flat method entirely and added an
// obligations input the legacy Reverse tab never had.
export default function ReverseEmiMode({ reverseEmi }: { reverseEmi: typeof ReverseEmi }) {
  const [method, setMethod] = useState<ReverseMethod>('reducing')
  const [targetEmi, setTargetEmi] = useState(15000)
  const [rate, setRate] = useState(12)
  const [years, setYears] = useState(3)
  const [months, setMonths] = useState(0)
  const [salary, setSalary] = useState(0)

  const tenure = years * 12 + months
  const r = reverseEmi(targetEmi, rate, tenure, method)
  const intPct = r.total > 0 ? Math.round((r.totalInt / r.total) * 100) : 0
  const prinPct = 100 - intPct
  // Donut geometry — faithful port of legacy's rev-donut (index.html:4330-4338,
  // efin-app.js:11671-11679); r=38, arcs are fractions of that circumference.
  const DONUT_CIRC = 2 * Math.PI * 38
  const intArc = (DONUT_CIRC * intPct) / 100
  const prinArc = (DONUT_CIRC * prinPct) / 100

  // FOIR — legacy Reverse uses EMI/salary only (NO obligations), verdict labels
  // Conservative/Standard/Moderate/High — Risk of rejection, >65 = --danger
  // (efin-app.js:11685-11694). The coloured legend swatch is separate (--accent2).
  const foirPct = salary > 0 ? (targetEmi / salary) * 100 : 0
  const foirZone = foirPct <= 40 ? { label: 'Conservative — Healthy', color: 'var(--success)' }
    : foirPct <= 50 ? { label: 'Standard — Acceptable', color: 'var(--accent)' }
    : foirPct <= 65 ? { label: 'Moderate — Watch out', color: 'var(--warn)' }
    : { label: 'High — Risk of rejection', color: 'var(--danger)' }

  const costRatio = r.principal > 0 ? (r.total / r.principal).toFixed(2) : '—'

  // Tenure sensitivity — legacy table (efin-app.js:11700-11707): Tenure / Max
  // Loan Amt / Total Interest (3 cols, no Δ), steps [-24,-12,0,12,24,36],
  // floored at 6 months.
  const tenureSensitivity = [-24, -12, 0, 12, 24, 36].map(d => {
    const t2 = Math.max(tenure + d, 6)
    const res = reverseEmi(targetEmi, rate, t2, method)
    return { delta: d, tenure: t2, principal: res.principal, totalInt: res.totalInt }
  })

  return (
    <div>
      <div className="calc-card p-5 mb-5">
        {/* Interest Method toggle — legacy revSetType (index.html:4257-4260) */}
        <div className="flex gap-1.5 mb-4">
          {(['reducing', 'flat'] as const).map(m => (
            <button key={m} onClick={() => setMethod(m)}
              className={`flex-1 calc-toggle-btn ${method === m ? 'active' : ''}`}>
              {m === 'reducing' ? 'Reducing Balance' : 'Flat Rate'}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-[color:var(--text3)] uppercase tracking-wide block mb-1">Monthly EMI You Can Pay (₹)</label>
            <NumberInput value={targetEmi} onChange={e => setTargetEmi(Number(e.target.value))}
              className="w-full efin-input" />
          </div>
          <div>
            <label className="text-xs font-semibold text-[color:var(--text3)] uppercase tracking-wide block mb-1">Interest Rate (% p.a.)</label>
            <NumberInput step={0.1} value={rate} onChange={e => setRate(Number(e.target.value))}
              className="w-full efin-input" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-semibold text-[color:var(--text3)] uppercase tracking-wide block mb-1">Years</label>
              <NumberInput value={years} onChange={e => setYears(Number(e.target.value))}
                className="w-full efin-input" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[color:var(--text3)] uppercase tracking-wide block mb-1">Months</label>
              <NumberInput value={months} onChange={e => setMonths(Number(e.target.value))}
                className="w-full efin-input" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-[color:var(--text3)] uppercase tracking-wide block mb-1">Monthly Salary (₹)</label>
            <NumberInput value={salary || ''} onChange={e => setSalary(Number(e.target.value))}
              placeholder="Optional — for FOIR"
              className="w-full efin-input" />
          </div>
        </div>
      </div>

      {r.principal > 0 && (
        <>
          <div className="calc-card p-5 mb-5">
            {/* Hero — Max Loan Amount + interest-method note (index.html:4306-4311) */}
            <div className="text-center mb-4">
              <p className="text-[11px] uppercase font-semibold" style={{ letterSpacing: '1px', color: 'var(--text3)' }}>Max Loan Amount</p>
              <p className="mt-1 font-black" style={{ fontFamily: 'var(--font-head)', fontSize: 34, color: 'var(--accent)' }}>{fmtINR(r.principal)}</p>
              <p className="text-[11px] mt-1" style={{ color: 'var(--text3)' }}>{method === 'flat' ? 'Flat rate method' : 'Reducing balance method'}</p>
            </div>

            {/* Breakdown — Total Interest / Total Payable / Cost Ratio
                (index.html:4314-4326): Interest --accent2, Payable --accent,
                Cost Ratio neutral. */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="calc-stat text-center">
                <p className="text-[11px] uppercase font-semibold mb-1" style={{ color: 'var(--text3)' }}>Total Interest</p>
                <p className="text-[17px] font-black" style={{ fontFamily: 'var(--font-head)', color: 'var(--accent2)' }}>{fmtINR(r.totalInt)}</p>
              </div>
              <div className="calc-stat text-center">
                <p className="text-[11px] uppercase font-semibold mb-1" style={{ color: 'var(--text3)' }}>Total Payable</p>
                <p className="text-[17px] font-black" style={{ fontFamily: 'var(--font-head)', color: 'var(--accent)' }}>{fmtINR(r.total)}</p>
              </div>
              <div className="calc-stat text-center">
                <p className="text-[11px] uppercase font-semibold mb-1" style={{ color: 'var(--text3)' }}>Cost Ratio</p>
                <p className="text-[17px] font-black" style={{ fontFamily: 'var(--font-head)', color: 'var(--text)' }}>{costRatio}×</p>
              </div>
            </div>

            {/* Principal/Interest donut — legacy's rev-donut. */}
            <div className="flex items-center gap-5">
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
              </div>
            </div>

            {salary > 0 && (
              <div className="mt-4 pt-4 border-t border-[color:var(--border)]">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold text-[color:var(--text3)] uppercase">FOIR (Fixed Obligation to Income Ratio)</span>
                  <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>{foirPct.toFixed(1)}%</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden mb-1" style={{ background: 'var(--surface3)' }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(foirPct, 100)}%`, background: foirZone.color }} />
                </div>
                {/* 4-zone legend — index.html:4363-4367 */}
                <div className="flex justify-between text-[11px] mb-1.5">
                  <span style={{ color: 'var(--success)' }}>Safe ≤40%</span>
                  <span style={{ color: 'var(--accent)' }}>OK ≤50%</span>
                  <span style={{ color: 'var(--warn)' }}>High ≤65%</span>
                  <span style={{ color: 'var(--accent2)' }}>Risk &gt;65%</span>
                </div>
                <p className="text-xs font-semibold" style={{ color: foirZone.color }}>{foirZone.label}</p>
              </div>
            )}
          </div>

          {/* Tenure sensitivity — legacy has no per-cell colour; base row
              highlighted, Total Interest uses --accent2 for page consistency. */}
          <div className="calc-card p-4">
            <p className="text-xs font-semibold text-[color:var(--text3)] uppercase mb-3">Tenure Sensitivity — Loan Amount vs Tenure</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[color:var(--text3)] border-b border-[color:var(--border)]">
                    {['Tenure', 'Max Loan Amt', 'Total Interest'].map((h, i) => (
                      <th key={h} className={`pb-2 pr-3 font-medium ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tenureSensitivity.map(t => (
                    <tr key={t.delta} className="border-b border-[color:var(--border)]"
                      style={t.delta === 0 ? { background: 'var(--accent-subtle)', color: 'var(--accent)', fontWeight: 700 } : undefined}>
                      <td className="py-1.5 pr-3 text-left">{t.tenure} mo{t.delta === 0 ? ' ★' : ''}</td>
                      <td className="py-1.5 pr-3 text-right" style={{ fontFamily: 'var(--font-head)' }}>{fmtINR(t.principal)}</td>
                      <td className="py-1.5 text-right text-[color:var(--text2)]" style={{ fontFamily: 'var(--font-head)' }}>{fmtINR(t.totalInt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
