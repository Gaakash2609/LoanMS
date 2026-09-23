import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { banksApi, LOAN_PRODUCTS, COMPANY_TYPES, type ProductKey } from '@/api/banksApi'

// Legacy lcConfirmAddBankAssignment seeds a new bank with SALARIED + the 5
// standard corporate company types (Vanilla codes plcc/plc/llp/govt/psu). React
// uses human-readable labels for company types EVERYWHERE the value is
// compared — the Match request (MatchTab), the bank's CompTypesJson
// (EmpTypesGrid pills) and the eligibility engine all use COMPANY_TYPES labels,
// case-insensitively — so the correct React equivalent of Vanilla's 5 codes is
// the first 5 COMPANY_TYPES labels (Pvt Ltd / Public Ltd / LLP / Government /
// PSU), which map 1:1 to plcc/plc/llp/govt/psu. Storing the raw Vanilla codes
// here would NOT match React's Match vocabulary and would break eligibility.
const DEFAULT_EMP_TYPES = ['SALARIED']
const DEFAULT_COMP_TYPES = COMPANY_TYPES.slice(0, 5)

// ── Shared Add-Bank modal ────────────────────────────────────────────────────
// Legacy lcAddBankFromAssignment / laOpenAddBankModal + laConfirmAddBank —
// creates a bank (POST /api/banks) and, when `assignToProduct` is given, also
// assigns it to that product (loanTypes=[product]) so per-product lists stay
// independent. One component, reused by the Assigned-Banks section AND the
// Analytic-Banks toolbar (no duplicate modal).
export function AddBankModal({ assignToProduct, onClose }: { assignToProduct?: ProductKey; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [isIncred, setIncred] = useState(false)
  const [isElite, setElite] = useState(false)
  const prodName = assignToProduct ? (LOAN_PRODUCTS.find(p => p.key === assignToProduct)?.name ?? assignToProduct) : null

  const addBank = useMutation({
    mutationFn: async () => {
      const res = await banksApi.create({
        bankName: name.trim(), isIncred, isElite,
        empTypes: DEFAULT_EMP_TYPES,
        compTypes: DEFAULT_COMP_TYPES,
      })
      const id = res.data.data?.id
      if (id && assignToProduct) await banksApi.update(id, { bankName: name.trim(), loanTypes: [assignToProduct] })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['banksConfig'] })
      qc.invalidateQueries({ queryKey: ['banks'] })
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 z-[800] flex items-center justify-center p-4" style={{ background: 'rgba(12,23,51,.45)' }} onClick={onClose}>
      <div className="bg-white rounded-2xl w-[min(420px,94vw)] p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <p className="text-[15px] font-extrabold mb-1">＋ Add Bank</p>
        <p className="text-xs text-gray-500 mb-4">{prodName ? <>Add a new bank to <strong>{prodName}</strong>.</> : 'Add a new bank.'}</p>
        <label className="block text-xs font-semibold text-gray-600 mb-1">Bank Name *</label>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Kotak Mahindra Bank"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-efin-blue" />
        <div className="flex gap-5 mb-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={isIncred} onChange={e => setIncred(e.target.checked)} />InCred Bank</label>
          <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={isElite} onChange={e => setElite(e.target.checked)} />Mudrahub (Elite)</label>
        </div>
        {prodName && <div className="text-xs text-gray-500 mb-4 px-3 py-2 rounded-lg bg-gray-50">🏦 Bank will be assigned to <strong>{prodName}</strong>.</div>}
        {addBank.isError && <p className="text-xs text-[color:var(--danger)] mb-2">Could not add the bank. Try again.</p>}
        <div className="flex gap-2">
          <Button className="flex-1" disabled={!name.trim() || addBank.isPending} onClick={() => addBank.mutate()}>✓ Add Bank</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}
