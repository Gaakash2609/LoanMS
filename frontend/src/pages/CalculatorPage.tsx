import { useState } from 'react'

import { emiReducing, emiFlat, buildAmortSchedule } from '@/utils/emi'
import { formatCurrency as fmtINR } from '@/utils/format'

type CalcType = 'reducing' | 'flat'

export default function CalculatorPage() {
  const [amount,  setAmount]  = useState(500000)
  const [rate,    setRate]    = useState(12)
  const [tenure,  setTenure]  = useState(36)
  const [salary,  setSalary]  = useState(0)
  const [obligations, setObligations] = useState(0)
  const [calcType, setCalcType] = useState<CalcType>('reducing')
  const [showAmort, setShowAmort] = useState(false)

  const calc   = calcType === 'reducing' ? emiReducing : emiFlat
  const result = calc(amount, rate, tenure)
  const { emi, total, totalInt } = result
  const intPct  = total > 0 ? Math.round((totalInt / total) * 100) : 0
  const prinPct = 100 - intPct

  const amort  = showAmort ? buildAmortSchedule(amount, rate, tenure) : []

  // FOIR calculation (same as legacy)
  const foirPct = salary > 0 ? ((emi + obligations) / salary) * 100 : 0
  const foirZone = foirPct <= 40 ? { label: 'Conservative — Healthy', color: 'text-green-600 bg-green-50' }
    : foirPct <= 55 ? { label: 'Moderate — Acceptable', color: 'text-yellow-600 bg-yellow-50' }
    : { label: 'High — Caution', color: 'text-red-600 bg-red-50' }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">EMI Calculator</h1>
        <p className="text-sm text-gray-500 mt-0.5">Calculate loan EMI, total interest, and affordability</p>
      </div>

      {/* Calc type toggle — matches legacy UI */}
      <div className="flex gap-2 mb-5">
        <button onClick={() => setCalcType('reducing')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            calcType === 'reducing' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}>
          Reducing Balance
        </button>
        <button onClick={() => setCalcType('flat')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            calcType === 'flat' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}>
          Flat Rate
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-5">
        {/* Amount */}
        <div className="mb-5">
          <div className="flex justify-between mb-1">
            <label className="text-xs font-semibold text-gray-600 uppercase">Loan Amount</label>
            <span className="text-sm font-bold text-blue-700">{fmtINR(amount)}</span>
          </div>
          <input type="range" min={50000} max={10000000} step={10000} value={amount}
            onChange={e => setAmount(Number(e.target.value))}
            className="w-full accent-blue-600 mb-2" />
          <input type="number" value={amount} onChange={e => setAmount(Number(e.target.value))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        </div>

        {/* Rate */}
        <div className="mb-5">
          <div className="flex justify-between mb-1">
            <label className="text-xs font-semibold text-gray-600 uppercase">Interest Rate (% p.a.)</label>
            <span className="text-sm font-bold text-blue-700">{rate}%</span>
          </div>
          <input type="range" min={5} max={36} step={0.1} value={rate}
            onChange={e => setRate(Number(e.target.value))}
            className="w-full accent-blue-600 mb-2" />
          <input type="number" value={rate} step={0.1} onChange={e => setRate(Number(e.target.value))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        </div>

        {/* Tenure */}
        <div className="mb-5">
          <div className="flex justify-between mb-1">
            <label className="text-xs font-semibold text-gray-600 uppercase">Tenure</label>
            <span className="text-sm font-bold text-blue-700">{tenure} months ({(tenure / 12).toFixed(1)} yrs)</span>
          </div>
          <input type="range" min={6} max={360} step={6} value={tenure}
            onChange={e => setTenure(Number(e.target.value))}
            className="w-full accent-blue-600 mb-2" />
          <div className="flex gap-2">
            <input type="number" value={tenure} onChange={e => setTenure(Number(e.target.value))}
              placeholder="Months"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            <input type="number" value={(tenure / 12).toFixed(1)}
              onChange={e => setTenure(Math.round(Number(e.target.value) * 12))}
              placeholder="Years"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>

        {/* FOIR inputs */}
        <div className="grid grid-cols-2 gap-4 pt-3 border-t border-gray-100">
          <div>
            <label className="text-xs font-semibold text-gray-600 uppercase block mb-1">Monthly Salary (₹)</label>
            <input type="number" value={salary || ''} onChange={e => setSalary(Number(e.target.value))}
              placeholder="Optional — for FOIR"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 uppercase block mb-1">Existing EMI Obligations (₹)</label>
            <input type="number" value={obligations || ''} onChange={e => setObligations(Number(e.target.value))}
              placeholder="0 if none"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
      </div>

      {/* Results */}
      {emi > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
            <div className="text-center p-3 bg-blue-50 rounded-xl">
              <p className="text-xs text-gray-500 mb-1">Monthly EMI</p>
              <p className="text-xl font-bold text-blue-700">{fmtINR(emi)}</p>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-xl">
              <p className="text-xs text-gray-500 mb-1">Principal</p>
              <p className="text-base font-bold text-gray-800">{fmtINR(amount)}</p>
            </div>
            <div className="text-center p-3 bg-orange-50 rounded-xl">
              <p className="text-xs text-gray-500 mb-1">Total Interest</p>
              <p className="text-base font-bold text-orange-700">{fmtINR(totalInt)}</p>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-xl">
              <p className="text-xs text-gray-500 mb-1">Total Payable</p>
              <p className="text-base font-bold text-gray-800">{fmtINR(total)}</p>
            </div>
          </div>

          {/* Visual breakdown */}
          <div className="flex gap-3 mb-2">
            <div className="h-2.5 rounded-l-full bg-blue-500 transition-all" style={{ width: `${prinPct}%` }} />
            <div className="h-2.5 rounded-r-full bg-orange-400 transition-all" style={{ width: `${intPct}%` }} />
          </div>
          <div className="flex gap-4 text-xs text-gray-500 mb-4">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />Principal {prinPct}%</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-orange-400 inline-block" />Interest {intPct}%</span>
          </div>

          <p className="text-xs text-gray-500">Cost of credit: {(total / amount).toFixed(2)}× principal · {calcType === 'flat' ? 'Flat rate' : 'Reducing balance'} method</p>

          {/* FOIR */}
          {salary > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-semibold text-gray-600 uppercase">FOIR (Fixed Obligation to Income Ratio)</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${foirZone.color}`}>{foirPct.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-1">
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(foirPct, 100)}%`,
                    background: foirPct <= 40 ? '#22c55e' : foirPct <= 55 ? '#f59e0b' : '#ef4444' }} />
              </div>
              <p className="text-xs text-gray-500">{foirZone.label} · EMI {fmtINR(emi)} + obligations {fmtINR(obligations)} = {fmtINR(emi + obligations)} / income {fmtINR(salary)}</p>
            </div>
          )}
        </div>
      )}

      {/* Amortization */}
      {emi > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <button onClick={() => setShowAmort(!showAmort)}
            className="text-sm font-medium text-blue-600 hover:underline mb-3 block">
            {showAmort ? '▲ Hide' : '▼ Show'} Amortization Schedule ({tenure} months)
          </button>
          {showAmort && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-100">
                    {['Month', 'EMI', 'Principal', 'Interest', 'Balance'].map(h => (
                      <th key={h} className="pb-2 pr-3 text-right font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {amort.map(row => (
                    <tr key={row.m} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-1.5 pr-3 text-right text-gray-600">{row.m}</td>
                      <td className="py-1.5 pr-3 text-right">{fmtINR(row.emi)}</td>
                      <td className="py-1.5 pr-3 text-right text-blue-600">{fmtINR(row.prin)}</td>
                      <td className="py-1.5 pr-3 text-right text-orange-500">{fmtINR(row.int)}</td>
                      <td className="py-1.5 text-right text-gray-600">{fmtINR(row.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
