import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, X, Check, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import {
  banksApi, parseJsonList, normalizeLoanType, assignedToProduct, LOAN_PRODUCTS,
  type BankConfig, type ProductKey,
} from '@/api/banksApi'
import { AddBankModal } from '@/components/shared/AddBankModal'
import { AddLineModal } from '@/components/shared/LineModals'
import { NumberInput } from '@/components/ui/NumberInput'
import { apiErrorMessage } from '@/utils/apiError'

// ── Assigned Banks (per product) ─────────────────────────────────────────────
// Legacy #lc-product-banks section (efin-app.js lcRenderProductBanks /
// lcAddBankFromAssignment / lcConfirmAddBankAssignment / lcEditBankInline /
// lcConfirmEditBank / lcUnassignBankFromProduct / lcSaveProductBanks). Sits
// ABOVE the General/Multi configuration for the selected product. A bank is
// assigned iff Banks.LoanTypesJson explicitly contains this product key, so
// each loan product keeps its OWN bank list — assigning to Business never
// leaks into Home. Add Bank CREATES a bank (POST /api/banks) and assigns it;
// Remove unassigns (PUT loanTypes minus this product); Edit does a quick
// name/flags/rules PUT. Everything persists to the DB immediately; Save
// Assignment re-affirms the whole set (parity with legacy's explicit save).

type EditDraft = { id: number; name: string; isIncred: boolean; isElite: boolean; maxLoanAmt: string; foirLimit: string; minCibil: string; minExpMonths: string; offerValidityDays: string }
const num = (s: string): number | null => (s.trim() === '' ? null : Number(s))

export function AssignedBanksSection({ canEdit, productKey }: { canEdit: boolean; productKey: ProductKey }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editModal, setEditModal] = useState<EditDraft | null>(null)
  const [lineBank, setLineBank] = useState<{ id: number; name: string } | null>(null)

  const { data: banks, isLoading } = useQuery({
    queryKey: ['banksConfig'],
    queryFn: () => banksApi.getAll().then(r => r.data.data ?? []),
  })
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['banksConfig'] }); qc.invalidateQueries({ queryKey: ['banks'] }) }

  const product = LOAN_PRODUCTS.find(p => p.key === productKey) ?? LOAN_PRODUCTS[0]
  const allBanks = useMemo(() => banks ?? [], [banks])
  const assigned = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allBanks.filter(b => assignedToProduct(b, productKey) && (!q || b.bankName.toLowerCase().includes(q)))
  }, [allBanks, productKey, search])
  const assignedCount = allBanks.filter(b => assignedToProduct(b, productKey)).length

  const editBank = useMutation({
    mutationFn: (d: EditDraft) => banksApi.update(d.id, {
      bankName: d.name.trim(), isIncred: d.isIncred, isElite: d.isElite,
      maxLoanAmt: num(d.maxLoanAmt), foirLimit: num(d.foirLimit), minCibil: num(d.minCibil), minExpMonths: num(d.minExpMonths),
      offerValidityDays: num(d.offerValidityDays) ?? 0,
    }),
    onSuccess: () => { invalidate(); setEditModal(null) },
  })

  // Unassign: drop this product from loanTypes. If it was the empty (all)
  // case, materialise "all except this" so it stops being offered here only.
  const unassign = useMutation({
    mutationFn: (b: BankConfig) => {
      const lt = parseJsonList(b.loanTypesJson)
      const norm = normalizeLoanType(productKey)
      const next = lt.length === 0
        ? LOAN_PRODUCTS.map(p => p.key as string).filter(k => normalizeLoanType(k) !== norm)
        : lt.filter(k => normalizeLoanType(k) !== norm)
      return banksApi.update(b.id, { bankName: b.bankName, loanTypes: next })
    },
    onSuccess: invalidate,
  })

  // Save Assignment — re-affirm every assigned bank's loanTypes (parity with
  // legacy lcSaveProductBanks; actions already persist, this confirms the set).
  const saveAssignment = useMutation({
    mutationFn: async () => {
      for (const b of assigned) {
        const lt = parseJsonList(b.loanTypesJson)
        if (!lt.map(normalizeLoanType).includes(normalizeLoanType(productKey))) {
          await banksApi.update(b.id, { bankName: b.bankName, loanTypes: [...lt, productKey] })
        }
      }
    },
    onSuccess: invalidate,
  })

  return (
    <div className="rounded-2xl border border-gray-200 bg-white mb-4">
      {/* SELECTED PRODUCT bar */}
      <div className="flex items-center justify-between px-4 py-3 rounded-t-2xl" style={{ background: 'var(--accent-subtle, rgba(77,124,255,.06))' }}>
        <div className="flex items-center gap-2.5">
          <span className="text-xl">{product.icon}</span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Selected Product</p>
            <p className="text-sm font-bold text-gray-900">{product.name}</p>
          </div>
        </div>
        <span className="text-xs font-semibold text-gray-500">{assignedCount} bank{assignedCount !== 1 ? 's' : ''} assigned</span>
      </div>

      {/* Assigned Banks toolbar */}
      <div className="px-4 pt-3 flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900">Assigned Banks</p>
          <p className="text-[11px] text-gray-500">Banks assigned to this product · ✏ to edit · ✕ to remove from this product</p>
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search banks…" className="border border-gray-300 rounded-lg pl-7 pr-3 py-1.5 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-efin-blue" />
        </div>
        {canEdit && <Button size="sm" variant="secondary" onClick={() => setShowAdd(true)}><Plus size={14} className="mr-1" />Add Bank</Button>}
        {canEdit && <Button size="sm" disabled={saveAssignment.isPending} onClick={() => saveAssignment.mutate()}><Check size={14} className="mr-1" />Save Assignment</Button>}
      </div>

      <div className="p-4">
        {isLoading ? <LoadingSpinner /> : assigned.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">
            {search ? 'No banks match your search.' : 'No banks assigned yet — click ＋ Add Bank to add a bank to this product.'}
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {assigned.map(b => (
              <div key={b.id} className="border border-gray-200 rounded-xl p-3 flex flex-col items-center text-center">
                <div className="w-9 h-9 rounded-[10px] flex items-center justify-center font-extrabold text-sm mb-1.5" style={{ background: b.isIncred ? 'rgba(245,158,11,.15)' : 'rgba(77,124,255,.12)', color: b.isIncred ? '#d97706' : 'var(--accent)' }}>{b.bankName.slice(0, 1).toUpperCase()}</div>
                <p className="font-bold text-[13px] text-gray-900 truncate w-full">{b.bankName}</p>
                <div className="flex gap-1 flex-wrap justify-center mt-1 min-h-[16px]">
                  {b.isIncred && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,.15)', color: '#d97706' }}>InCred</span>}
                  {b.isElite && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(10,88,154,.12)', color: 'var(--accent)' }}>Elite</span>}
                </div>
                {canEdit && (
                  <div className="flex gap-1.5 mt-2 pt-2 border-t border-gray-100 w-full">
                    {productKey === 'personal' && (
                      <button className="flex-1 text-[11px] font-semibold text-[color:var(--success)] hover:underline flex items-center justify-center gap-0.5"
                        onClick={() => setLineBank({ id: b.id, name: b.bankName })} title="Add company line"><Plus size={11} />Line</button>
                    )}
                    <button className="flex-1 text-[11px] font-semibold text-gray-600 hover:text-efin-blue flex items-center justify-center gap-0.5"
                      onClick={() => setEditModal({ id: b.id, name: b.bankName, isIncred: !!b.isIncred, isElite: !!b.isElite, maxLoanAmt: b.maxLoanAmt == null ? '' : String(b.maxLoanAmt), foirLimit: b.foirLimit == null ? '' : String(b.foirLimit), minCibil: b.minCibil == null ? '' : String(b.minCibil), minExpMonths: b.minExpMonths == null ? '' : String(b.minExpMonths), offerValidityDays: b.offerValidityDays == null ? '' : String(b.offerValidityDays) })}>
                      <Pencil size={11} />Edit
                    </button>
                    <button className="flex-1 text-[11px] font-semibold text-[color:var(--danger)] hover:underline flex items-center justify-center gap-0.5"
                      onClick={() => unassign.mutate(b)}><X size={11} />Remove</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Bank modal (shared) — creates + assigns to this product */}
      {showAdd && <AddBankModal assignToProduct={productKey} onClose={() => setShowAdd(false)} />}

      {/* + Line (personal only) — legacy lcAddLineToBank */}
      {lineBank && <AddLineModal bankId={lineBank.id} bankName={lineBank.name} onClose={() => setLineBank(null)} />}

      {/* Edit Bank modal */}
      {editModal && (
        <div className="fixed inset-0 z-[800] flex items-center justify-center p-4" style={{ background: 'rgba(12,23,51,.45)' }} onClick={() => setEditModal(null)}>
          <div className="bg-white rounded-2xl w-[min(440px,94vw)] p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <p className="text-[15px] font-extrabold mb-3">✏ Edit Bank</p>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Bank Name *</label>
            <input autoFocus value={editModal.name} onChange={e => setEditModal({ ...editModal, name: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-efin-blue" />
            <div className="flex gap-5 mb-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={editModal.isIncred} onChange={e => setEditModal({ ...editModal, isIncred: e.target.checked })} />InCred Bank</label>
              <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={editModal.isElite} onChange={e => setEditModal({ ...editModal, isElite: e.target.checked })} />Mudrahub (Elite)</label>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 mb-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-2">Quick Rules</p>
              <div className="grid grid-cols-2 gap-2.5">
                {([['Max Loan (₹)', 'maxLoanAmt'], ['FOIR Limit (%)', 'foirLimit'], ['Min CIBIL', 'minCibil'], ['Min Exp (mo)', 'minExpMonths'], ['Offer validity (days)', 'offerValidityDays']] as [string, keyof EditDraft][]).map(([lbl, key]) => (
                  <div key={key}>
                    <p className="text-[10.5px] text-gray-500 mb-1">{lbl}</p>
                    <NumberInput value={editModal[key] as string} onChange={e => setEditModal({ ...editModal, [key]: e.target.value })}
                      className="w-full border border-gray-200 rounded-md px-2 py-1 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-efin-blue" />
                  </div>
                ))}
              </div>
            </div>
            <p className="-mt-2 mb-3 text-[10.5px] text-gray-500">Offer validity pre-fills “Valid until” on new offers of this lender (1–365 days; blank = none).</p>
            {editBank.isError && <p className="text-xs text-[color:var(--danger)] mb-2">{apiErrorMessage(editBank.error)}</p>}
            <div className="flex gap-2">
              <Button className="flex-1" disabled={!editModal.name.trim() || editBank.isPending} onClick={() => editBank.mutate(editModal)}>✓ Save</Button>
              <Button variant="secondary" onClick={() => setEditModal(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
