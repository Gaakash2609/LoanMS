import { useState } from 'react'
import { formatCurrency as fmtINR } from '@/utils/format'
import type { calcPrepayment as CalcPrepayment } from '@/utils/emi'
import { NumberInput } from '@/components/ui/NumberInput'

// Prepayment — legacy's calcPrepay(). Shows how many months and how much
// interest an extra monthly payment saves. Pure client-side. Legacy inputs are
// blank (placeholders) with a single "Tenure (Months)" field, and the result
// is an Original-EMI hero + 3 tiles + Original/New interest cards
// (index.html:4198-4237).
export default function PrepaymentMode({ calcPrepayment }: { calcPrepayment: typeof CalcPrepayment }) {
  const [amount, setAmount] = useState(0)
  const [rate, setRate] = useState(0)
  const [tenure, setTenure] = useState(0)
  const [extra, setExtra] = useState(0)
  const [startMonth, setStartMonth] = useState(1)

  const num = (x: number) => (x ? String(x) : '')
  const r = calcPrepayment(amount, rate, tenure, extra, startMonth)

  return (
    <div>
      <div className="calc-card p-5 mb-5">
        <div className="text-[12px] font-bold uppercase mb-4" style={{ letterSpacing: '.6px', color: 'var(--text3)' }}>Original Loan</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-[color:var(--text3)] uppercase tracking-wide block mb-1">Loan Amount (₹)</label>
            <NumberInput value={num(amount)} placeholder="e.g. 1000000"
              onChange={e => setAmount(Number(e.target.value))} className="w-full efin-input" />
          </div>
          <div>
            <label className="text-xs font-semibold text-[color:var(--text3)] uppercase tracking-wide block mb-1">Annual Rate (% p.a.)</label>
            <NumberInput step={0.1} value={num(rate)} placeholder="e.g. 11"
              onChange={e => setRate(Number(e.target.value))} className="w-full efin-input" />
          </div>
          <div>
            <label className="text-xs font-semibold text-[color:var(--text3)] uppercase tracking-wide block mb-1">Tenure (Months)</label>
            <NumberInput value={num(tenure)} placeholder="e.g. 240"
              onChange={e => setTenure(Number(e.target.value))} className="w-full efin-input" />
          </div>
        </div>
        <div className="border-t border-[color:var(--border)] pt-4 mt-4">
          <div className="text-[12px] font-bold uppercase mb-4" style={{ letterSpacing: '.6px', color: 'var(--text3)' }}>Prepayment Details</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-[color:var(--text3)] uppercase tracking-wide block mb-1">Extra Monthly Payment (₹)</label>
              <NumberInput value={num(extra)} placeholder="e.g. 5000"
                onChange={e => setExtra(Number(e.target.value))} className="w-full efin-input" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[color:var(--text3)] uppercase tracking-wide block mb-1">Starting from Month</label>
              <NumberInput min={1} value={startMonth} placeholder="e.g. 1"
                onChange={e => setStartMonth(Math.max(1, Number(e.target.value)))} className="w-full efin-input" />
            </div>
          </div>
        </div>
      </div>

      {r.emi > 0 && (
        <div className="calc-card p-5">
          {/* Original EMI hero (index.html:4216-4219) */}
          <div className="text-center mb-4">
            <p className="text-[11px] uppercase font-semibold" style={{ letterSpacing: '1px', color: 'var(--text3)' }}>Original EMI</p>
            <p className="font-black mt-1" style={{ fontFamily: 'var(--font-head)', fontSize: 34, color: 'var(--text)' }}>{fmtINR(r.emi)}</p>
          </div>

          {/* Result tiles — legacy .prepay-result-val is all --success on a
              plain --surface2 tile (efin-app.js:11542-11545). */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="text-center p-3 rounded-xl" style={{ background: 'var(--surface2)' }}>
              <p className="text-xl font-bold text-[color:var(--success)]" style={{ fontFamily: 'var(--font-head)' }}>{r.monthsSaved > 0 ? `${r.monthsSaved} mo` : '0'}</p>
              <p className="text-xs text-[color:var(--text3)] mt-1">Months Saved</p>
            </div>
            <div className="text-center p-3 rounded-xl" style={{ background: 'var(--surface2)' }}>
              <p className="text-base font-bold text-[color:var(--success)]">{fmtINR(r.interestSaved)}</p>
              <p className="text-xs text-[color:var(--text3)] mt-1">Interest Saved</p>
            </div>
            <div className="text-center p-3 rounded-xl" style={{ background: 'var(--surface2)' }}>
              <p className="text-base font-bold text-[color:var(--success)]">{r.newMonths} mo</p>
              <p className="text-xs text-[color:var(--text3)] mt-1">New Tenure</p>
            </div>
          </div>

          {/* Original vs New interest cards (index.html:4226-4235) */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="text-center p-3 rounded-xl" style={{ background: 'var(--surface2)' }}>
              <p className="text-xs text-[color:var(--text3)] mb-1">Original Interest</p>
              <p className="text-base font-extrabold text-[color:var(--accent2)]" style={{ fontFamily: 'var(--font-head)' }}>{fmtINR(r.totalInt)}</p>
            </div>
            <div className="text-center p-3 rounded-xl" style={{ background: 'var(--surface2)' }}>
              <p className="text-xs text-[color:var(--text3)] mb-1">New Total Interest</p>
              <p className="text-base font-extrabold text-[color:var(--success)]" style={{ fontFamily: 'var(--font-head)' }}>{fmtINR(r.newTotalInt)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
