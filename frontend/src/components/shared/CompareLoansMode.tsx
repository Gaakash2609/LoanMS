import { useState } from 'react'
import { emiReducing } from '@/utils/emi'
import { formatCurrency as fmtINR } from '@/utils/format'
import { NumberInput } from '@/components/ui/NumberInput'

// Compare Loans — legacy's calcCompare(). Two side-by-side loan scenarios with
// a difference summary. Pure client-side, no API. Legacy starts with BLANK
// inputs (placeholders only) and computes on reducing balance; the migration
// had pre-filled sample values and shown a different B−A table.
interface Side { amount: number; rate: number; years: number; months: number }
const BLANK: Side = { amount: 0, rate: 0, years: 0, months: 0 }

function SideInputs({ title, accent, v, onChange, ratePlaceholder }: {
  title: string; accent: string; v: Side; onChange: (s: Side) => void; ratePlaceholder: string
}) {
  const num = (x: number) => (x ? String(x) : '')
  return (
    <div className="calc-card p-5">
      <p className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: 'var(--text)' }}>
        <span className="w-[22px] h-[22px] rounded-full text-white text-[11px] inline-flex items-center justify-center" style={{ background: accent }}>{title.slice(-1)}</span>
        {title}
      </p>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-semibold text-[color:var(--text3)] uppercase block mb-1">Amount (₹)</label>
          <NumberInput value={num(v.amount)} placeholder="e.g. 500000"
            onChange={e => onChange({ ...v, amount: Number(e.target.value) })} className="w-full efin-input" />
        </div>
        <div>
          <label className="text-xs font-semibold text-[color:var(--text3)] uppercase block mb-1">Rate (% p.a.)</label>
          <NumberInput step={0.1} value={num(v.rate)} placeholder={ratePlaceholder}
            onChange={e => onChange({ ...v, rate: Number(e.target.value) })} className="w-full efin-input" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-semibold text-[color:var(--text3)] uppercase block mb-1">Years</label>
            <NumberInput value={num(v.years)} placeholder="e.g. 5"
              onChange={e => onChange({ ...v, years: Number(e.target.value) })} className="w-full efin-input" />
          </div>
          <div>
            <label className="text-xs font-semibold text-[color:var(--text3)] uppercase block mb-1">Months</label>
            <NumberInput value={num(v.months)} placeholder="e.g. 60"
              onChange={e => onChange({ ...v, months: Number(e.target.value) })} className="w-full efin-input" />
          </div>
        </div>
      </div>
    </div>
  )
}

function SideResult({ accent, emi, totalInt, total }: { accent: string; emi: number; totalInt: number; total: number }) {
  return (
    <div className="mt-4 rounded-xl p-4" style={{ background: 'var(--surface2)' }}>
      <div className="font-black" style={{ fontFamily: 'var(--font-head)', fontSize: 28, color: accent }}>{fmtINR(emi)}</div>
      <div className="text-[11px] text-[color:var(--text3)] mt-0.5">Monthly EMI</div>
      <div className="grid grid-cols-2 gap-2.5 mt-3">
        <div>
          <div className="text-[13px] font-bold text-[color:var(--text)]">{fmtINR(totalInt)}</div>
          <div className="text-[10.5px] text-[color:var(--text3)]">Total Interest</div>
        </div>
        <div>
          <div className="text-[13px] font-bold text-[color:var(--text)]">{fmtINR(total)}</div>
          <div className="text-[10.5px] text-[color:var(--text3)]">Total Payable</div>
        </div>
      </div>
    </div>
  )
}

export default function CompareLoansMode() {
  const [a, setA] = useState<Side>(BLANK)
  const [b, setB] = useState<Side>(BLANK)

  const tenureA = a.years * 12 + a.months
  const tenureB = b.years * 12 + b.months
  const validA = a.amount > 0 && a.rate > 0 && tenureA > 0
  const validB = b.amount > 0 && b.rate > 0 && tenureB > 0
  const resA = emiReducing(a.amount, a.rate, tenureA)
  const resB = emiReducing(b.amount, b.rate, tenureB)

  // Difference summary — legacy calcCompare (efin-app.js:11491-11500): only
  // shown when BOTH loans are valid.
  const winner = resA.emi <= resB.emi ? 'A' : 'B'
  const diffEmi = Math.abs(resA.emi - resB.emi)
  const diffInt = Math.abs(resA.totalInt - resB.totalInt)
  const betterInt = resA.totalInt <= resB.totalInt ? 'A' : 'B'

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <div>
          <SideInputs title="Loan A" accent="var(--accent)" v={a} onChange={setA} ratePlaceholder="e.g. 12" />
          {validA && <SideResult accent="var(--accent)" emi={resA.emi} totalInt={resA.totalInt} total={resA.total} />}
        </div>
        <div>
          <SideInputs title="Loan B" accent="var(--accent2)" v={b} onChange={setB} ratePlaceholder="e.g. 14" />
          {validB && <SideResult accent="var(--accent2)" emi={resB.emi} totalInt={resB.totalInt} total={resB.total} />}
        </div>
      </div>

      {validA && validB && (
        <div className="calc-card p-5">
          <p className="text-sm font-bold mb-3" style={{ color: 'var(--text)' }}>Comparison Summary</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between items-center gap-3 border-b border-[color:var(--border)] pb-2">
              <span className="text-[color:var(--text3)]">Lower Monthly EMI</span>
              <span className="font-semibold text-[color:var(--success)]">Loan {winner} saves {fmtINR(diffEmi)}/mo</span>
            </div>
            <div className="flex justify-between items-center gap-3 border-b border-[color:var(--border)] pb-2">
              <span className="text-[color:var(--text3)]">Total Interest</span>
              <span className="text-[color:var(--text)]">A: {fmtINR(resA.totalInt)} &nbsp;|&nbsp; B: {fmtINR(resB.totalInt)}</span>
            </div>
            <div className="flex justify-between items-center gap-3 border-b border-[color:var(--border)] pb-2">
              <span className="text-[color:var(--text3)]">Interest Saved</span>
              <span className="font-semibold text-[color:var(--success)]">{fmtINR(diffInt)} (Loan {betterInt} is better)</span>
            </div>
            <div className="flex justify-between items-center gap-3">
              <span className="text-[color:var(--text3)]">Total Payable</span>
              <span className="text-[color:var(--text)]">A: {fmtINR(resA.total)} &nbsp;|&nbsp; B: {fmtINR(resB.total)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
