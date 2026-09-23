import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { buildCsv, downloadCsv } from '@/utils/loanExport'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Button } from '@/components/ui/Button'
import {
  banksApi, parseJsonList, offersProduct, EMP_TYPES, COMPANY_TYPES, HOME_TYPES,
  type BankConfig, type BankSaveRequest, type ProductRuleSaveRequest, type ProductKey,
} from '@/api/banksApi'
import { NumberInput } from '@/components/ui/NumberInput'

// ── Bulk-edit-all-banks grids ────────────────────────────────────────────────
// Ports legacy's per-dimension bulk grids — one row per bank so a field can be
// edited across every bank at once. Two data scopes, chosen by `productKey`:
//
//  • Personal (or no productKey): the General-Config tabs (lcRenderBankRules /
//    lcRenderCibilRules / lcRenderPinsConfig / lcRenderEmpTypes) — writes the
//    bank's BASE columns via PUT /api/banks/{id} (banksApi.update).
//  • A non-personal product: the multi-config tabs (efin-app.js lcBl* —
//    lcBlRenderBankRules / lcBlRenderCibil / lcBlRenderEmpTypes /
//    lcBlRenderHomeTypes) — writes that bank's BankProductRule for the
//    productKey via PUT /api/banks/{id}/product-rules/{key}
//    (banksApi.upsertProductRule), and shows only banks ASSIGNED to the product
//    (legacy _prBanks). Serviceable PINs stay bank-level for every product
//    (no per-product PIN column — legacy's per-product PINs were local-only).

// Effective rule view for a bank+product (personal/no-product = base columns).
// The Bank-Rules extras (minVintage/minTurnover) and Banking/Credit-Score
// fields exist ONLY on the per-product BankProductRule (no base column), so
// they are null for the personal/base view.
function ruleView(b: BankConfig, productKey?: ProductKey) {
  if (!productKey || productKey === 'personal') {
    return {
      minCibil: b.minCibil, acceptNtc: b.acceptNtc, maxLoanAmt: b.maxLoanAmt,
      minTenure: b.minTenure, maxTenure: b.maxTenure, foirLimit: b.foirLimit,
      pfRequired: b.pfRequired, minAge: b.minAge, maxAge: b.maxAge, minExpMonths: b.minExpMonths,
      empTypesJson: b.empTypesJson, compTypesJson: b.compTypesJson, homeTypesJson: b.homeTypesJson,
      minVintage: null, minTurnover: null,
      minAcctVintage: null, minAvgBalance: null, minCreditScore: null, bankStmtMonths: null, bounceTolerance: null,
    }
  }
  const r = (b.productRules ?? []).find(x => x.productKey === productKey)
  return {
    minCibil: r?.minCibil, acceptNtc: r?.acceptNtc, maxLoanAmt: r?.maxLoanAmt,
    minTenure: r?.minTenure, maxTenure: r?.maxTenure, foirLimit: r?.foirLimit,
    pfRequired: r?.pfRequired, minAge: r?.minAge, maxAge: r?.maxAge, minExpMonths: r?.minExpMonths,
    empTypesJson: r?.empTypesJson, compTypesJson: r?.compTypesJson, homeTypesJson: r?.homeTypesJson,
    minVintage: r?.minVintage, minTurnover: r?.minTurnover,
    minAcctVintage: r?.minAcctVintage, minAvgBalance: r?.minAvgBalance, minCreditScore: r?.minCreditScore,
    bankStmtMonths: r?.bankStmtMonths, bounceTolerance: r?.bounceTolerance,
  }
}

function useBankGrid(productKey?: ProductKey) {
  const qc = useQueryClient()
  const isProduct = !!productKey && productKey !== 'personal'
  const { data, isLoading } = useQuery({
    queryKey: ['banksConfig'],
    queryFn: () => banksApi.getAll().then(r => r.data.data ?? []),
  })
  const done = () => qc.invalidateQueries({ queryKey: ['banksConfig'] })
  const updateBank = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: BankSaveRequest }) => banksApi.update(id, patch),
    onSuccess: done,
  })
  const updateRule = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: ProductRuleSaveRequest }) =>
      banksApi.upsertProductRule(id, productKey as string, patch),
    onSuccess: done,
  })
  // Product-scoped fields (CIBIL/rules/emp/home) route to the product rule;
  // bank-level fields (serviceablePins) always go to the bank row.
  const save = (b: BankConfig, patch: Partial<ProductRuleSaveRequest>) =>
    isProduct
      ? updateRule.mutate({ id: b.id, patch })
      : updateBank.mutate({ id: b.id, patch: { bankName: b.bankName, ...patch } })
  const saveBank = (b: BankConfig, patch: Partial<BankSaveRequest>) =>
    updateBank.mutate({ id: b.id, patch: { bankName: b.bankName, ...patch } })
  const allBanks = data ?? []
  const banks = isProduct ? allBanks.filter(b => offersProduct(b, productKey as string)) : allBanks
  return { banks, isLoading, save, saveBank, isProduct, productKey }
}

const numOrNull = (v: string): number | null => (v.trim() === '' ? null : Number(v))
const cellInput = 'w-full border border-gray-200 rounded-md px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-efin-blue disabled:bg-gray-50'
const th = 'px-2.5 py-2 text-left font-semibold whitespace-nowrap'

function GridShell({ headers, isLoading, empty, isProduct, children }: {
  headers: string[]; isLoading: boolean; empty: boolean; isProduct?: boolean; children: React.ReactNode
}) {
  if (isLoading) return <LoadingSpinner />
  if (empty) return (
    <p className="text-sm text-gray-400 py-8 text-center">
      {isProduct
        ? 'No banks assigned to this product yet — assign banks in the 🏛 Analytic Banks tab.'
        : 'No banks configured yet.'}
    </p>
  )
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 text-gray-600"><tr>{headers.map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

// ── 📋 Bank Rules ─────────────────────────────────────────────────────────
// Legacy column sets differ by scope: personal (lcRenderBankRules) shows
// Min Exp Months + PF; non-personal (lcBlRenderBankRules) shows Min Vintage +
// Min Turnover instead. Both share loan-amount/tenure/FOIR/age.
export function BankRulesGrid({ canEdit, productKey }: { canEdit: boolean; productKey?: ProductKey }) {
  const { banks, isLoading, save, isProduct } = useBankGrid(productKey)
  const headers = isProduct
    ? ['Bank', 'Max Loan (₹)', 'Min Tenure', 'Max Tenure', 'FOIR %', 'Min Age', 'Max Age', 'Min Vintage (mo)', 'Min Turnover (₹)']
    : ['Bank', 'Max Loan (₹)', 'Min Tenure', 'Max Tenure', 'FOIR %', 'Min Age', 'Max Age', 'Min Exp (mo)', 'PF Req.']
  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">Edit each bank's loan-amount, tenure, FOIR, age{isProduct ? ', vintage and turnover' : ', experience and PF'} rules{isProduct ? ' for this product' : ''}. Changes save on blur.</p>
      <GridShell headers={headers} isLoading={isLoading} empty={banks.length === 0} isProduct={isProduct}>
        {banks.map(b => {
          const rv = ruleView(b, productKey)
          return (
            <tr key={`${productKey ?? 'base'}-${b.id}`} className="border-t border-gray-100">
              <td className="px-2.5 py-1.5 font-semibold text-gray-900 whitespace-nowrap">{b.bankName}</td>
              <td className="px-2.5 py-1.5"><NumberInput disabled={!canEdit} defaultValue={rv.maxLoanAmt ?? ''} className={`${cellInput} w-28`} onBlur={e => save(b, { maxLoanAmt: numOrNull(e.target.value) })} /></td>
              <td className="px-2.5 py-1.5"><NumberInput disabled={!canEdit} defaultValue={rv.minTenure ?? ''} className={`${cellInput} w-16`} onBlur={e => save(b, { minTenure: numOrNull(e.target.value) })} /></td>
              <td className="px-2.5 py-1.5"><NumberInput disabled={!canEdit} defaultValue={rv.maxTenure ?? ''} className={`${cellInput} w-16`} onBlur={e => save(b, { maxTenure: numOrNull(e.target.value) })} /></td>
              <td className="px-2.5 py-1.5"><NumberInput disabled={!canEdit} defaultValue={rv.foirLimit ?? ''} className={`${cellInput} w-16`} onBlur={e => save(b, { foirLimit: numOrNull(e.target.value) })} /></td>
              <td className="px-2.5 py-1.5"><NumberInput disabled={!canEdit} defaultValue={rv.minAge ?? ''} className={`${cellInput} w-14`} onBlur={e => save(b, { minAge: numOrNull(e.target.value) })} /></td>
              <td className="px-2.5 py-1.5"><NumberInput disabled={!canEdit} defaultValue={rv.maxAge ?? ''} className={`${cellInput} w-14`} onBlur={e => save(b, { maxAge: numOrNull(e.target.value) })} /></td>
              {isProduct ? (
                <>
                  <td className="px-2.5 py-1.5"><NumberInput disabled={!canEdit} defaultValue={rv.minVintage ?? ''} className={`${cellInput} w-16`} onBlur={e => save(b, { minVintage: numOrNull(e.target.value) })} /></td>
                  <td className="px-2.5 py-1.5"><NumberInput disabled={!canEdit} defaultValue={rv.minTurnover ?? ''} className={`${cellInput} w-28`} onBlur={e => save(b, { minTurnover: numOrNull(e.target.value) })} /></td>
                </>
              ) : (
                <>
                  <td className="px-2.5 py-1.5"><NumberInput disabled={!canEdit} defaultValue={rv.minExpMonths ?? ''} className={`${cellInput} w-16`} onBlur={e => save(b, { minExpMonths: numOrNull(e.target.value) })} /></td>
                  <td className="px-2.5 py-1.5 text-center"><input type="checkbox" disabled={!canEdit} defaultChecked={!!rv.pfRequired} onChange={e => save(b, { pfRequired: e.target.checked })} /></td>
                </>
              )}
            </tr>
          )
        })}
      </GridShell>
    </div>
  )
}

// ── 💳 CIBIL Rules ────────────────────────────────────────────────────────
export function CibilRulesGrid({ canEdit, productKey }: { canEdit: boolean; productKey?: ProductKey }) {
  const { banks, isLoading, save, isProduct } = useBankGrid(productKey)
  const band = (s?: number | null) => s == null ? '—' : s >= 750 ? 'Prime only' : s >= 700 ? 'Near-prime & above' : 'Sub-prime & above'
  const color = (s?: number | null) => s == null ? 'var(--text3)' : s >= 720 ? 'var(--success)' : s >= 680 ? 'var(--warn)' : 'var(--accent2)'
  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">Minimum CIBIL score and New-To-Credit acceptance per bank{isProduct ? ' for this product' : ''}. Changes save on blur.</p>
      <GridShell headers={['Bank', 'Min CIBIL', 'Accept NTC', 'Risk Band']} isLoading={isLoading} empty={banks.length === 0} isProduct={isProduct}>
        {banks.map(b => {
          const rv = ruleView(b, productKey)
          return (
            <tr key={`${productKey ?? 'base'}-${b.id}`} className="border-t border-gray-100">
              <td className="px-2.5 py-1.5 font-semibold text-gray-900 whitespace-nowrap">{b.bankName}</td>
              <td className="px-2.5 py-1.5"><NumberInput min={300} max={900} disabled={!canEdit} defaultValue={rv.minCibil ?? ''} className={`${cellInput} w-20 font-bold`} style={{ color: color(rv.minCibil) }} onBlur={e => save(b, { minCibil: numOrNull(e.target.value) })} /></td>
              <td className="px-2.5 py-1.5 text-center"><input type="checkbox" disabled={!canEdit} defaultChecked={!!rv.acceptNtc} onChange={e => save(b, { acceptNtc: e.target.checked })} /></td>
              <td className="px-2.5 py-1.5 text-gray-500">{band(rv.minCibil)}</td>
            </tr>
          )
        })}
      </GridShell>
    </div>
  )
}

// ── 👔 Employment Types ───────────────────────────────────────────────────
export function EmpTypesGrid({ canEdit, productKey }: { canEdit: boolean; productKey?: ProductKey }) {
  const { banks, isLoading, save, isProduct } = useBankGrid(productKey)
  const EMP_LABEL: Record<string, string> = { SALARIED: 'Salaried', SELFEMP: 'SEP', SENP: 'SENP' }
  const toggle = (b: BankConfig, list: string[], v: string) =>
    save(b, { empTypes: list.includes(v) ? list.filter(x => x !== v) : [...list, v] })
  const toggleComp = (b: BankConfig, list: string[], v: string) =>
    save(b, { compTypes: list.includes(v) ? list.filter(x => x !== v) : [...list, v] })
  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">Employment types each bank accepts, plus preferred company types{isProduct ? ' for this product' : ''}. Click to toggle.</p>
      <GridShell headers={['Bank', ...EMP_TYPES.map(e => EMP_LABEL[e] ?? e), 'Preferred Company Types']} isLoading={isLoading} empty={banks.length === 0} isProduct={isProduct}>
        {banks.map(b => {
          const rv = ruleView(b, productKey)
          const emps = parseJsonList(rv.empTypesJson)
          const comps = parseJsonList(rv.compTypesJson)
          return (
            <tr key={`${productKey ?? 'base'}-${b.id}`} className="border-t border-gray-100 align-top">
              <td className="px-2.5 py-2 font-semibold text-gray-900 whitespace-nowrap">{b.bankName}</td>
              {EMP_TYPES.map(e => (
                <td key={e} className="px-2.5 py-2 text-center"><input type="checkbox" disabled={!canEdit} checked={emps.includes(e)} onChange={() => toggle(b, emps, e)} /></td>
              ))}
              <td className="px-2.5 py-2">
                <div className="flex flex-wrap gap-1">
                  {COMPANY_TYPES.map(c => {
                    const on = comps.includes(c)
                    return (
                      <button key={c} type="button" disabled={!canEdit} onClick={() => toggleComp(b, comps, c)}
                        className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${on ? 'bg-efin-blue text-white border-efin-blue' : 'bg-white text-gray-500 border-gray-200'}`}>
                        {c}
                      </button>
                    )
                  })}
                </div>
              </td>
            </tr>
          )
        })}
      </GridShell>
    </div>
  )
}

// ── 🏠 Home Types ─────────────────────────────────────────────────────────
// Legacy lcBlRenderHomeTypes (multi-config only) — per-product residence-type
// acceptance, persisted to BankProductRule.HomeTypesJson. For Personal it maps
// to the bank's base HomeTypesJson (banksApi.update).
export function HomeTypesGrid({ canEdit, productKey }: { canEdit: boolean; productKey?: ProductKey }) {
  const { banks, isLoading, save, isProduct } = useBankGrid(productKey)
  const toggle = (b: BankConfig, list: string[], v: string) =>
    save(b, { homeTypes: list.includes(v) ? list.filter(x => x !== v) : [...list, v] })
  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">Residence / home-ownership types each bank accepts{isProduct ? ' for this product' : ''}. Empty = all accepted. Click to toggle.</p>
      <GridShell headers={['Bank', ...HOME_TYPES]} isLoading={isLoading} empty={banks.length === 0} isProduct={isProduct}>
        {banks.map(b => {
          const rv = ruleView(b, productKey)
          const homes = parseJsonList(rv.homeTypesJson)
          return (
            <tr key={`${productKey ?? 'base'}-${b.id}`} className="border-t border-gray-100">
              <td className="px-2.5 py-2 font-semibold text-gray-900 whitespace-nowrap">{b.bankName}</td>
              {HOME_TYPES.map(h => (
                <td key={h} className="px-2.5 py-2 text-center"><input type="checkbox" disabled={!canEdit} checked={homes.includes(h)} onChange={() => toggle(b, homes, h)} /></td>
              ))}
            </tr>
          )
        })}
      </GridShell>
    </div>
  )
}

// ── 📍 Serviceable PINs ───────────────────────────────────────────────────
// Bank-level for every product (no per-product PIN column — legacy's
// per-product PINs were local-only). Product scope only narrows the visible
// rows to the assigned banks; the save always writes the bank row.
// ── Banking / Credit Score ───────────────────────────────────────────────
// Legacy lcBlRenderCreditScores (multi-config only) — per-product banking &
// credit-score requirements, persisted to BankProductRule. Non-personal only.
export function CreditScoreGrid({ canEdit, productKey }: { canEdit: boolean; productKey?: ProductKey }) {
  const { banks, isLoading, save, isProduct } = useBankGrid(productKey)
  const scoreColor = (s?: number | null) => s == null ? 'var(--text)' : s >= 720 ? 'var(--success)' : s >= 680 ? 'var(--warn)' : 'var(--accent2)'
  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">Banking &amp; credit-score requirements per bank for this product. Changes save on blur.</p>
      <GridShell headers={['Bank', 'Acct Vintage (mo)', 'Avg Balance (₹)', 'Min Credit Score', 'Bank Stmt (mo)', 'Bounce Tolerance']} isLoading={isLoading} empty={banks.length === 0} isProduct={isProduct}>
        {banks.map(b => {
          const rv = ruleView(b, productKey)
          return (
            <tr key={`${productKey ?? 'base'}-${b.id}`} className="border-t border-gray-100">
              <td className="px-2.5 py-1.5 font-semibold text-gray-900 whitespace-nowrap">{b.bankName}</td>
              <td className="px-2.5 py-1.5"><NumberInput disabled={!canEdit} defaultValue={rv.minAcctVintage ?? ''} className={`${cellInput} w-16`} onBlur={e => save(b, { minAcctVintage: numOrNull(e.target.value) })} /></td>
              <td className="px-2.5 py-1.5"><NumberInput disabled={!canEdit} defaultValue={rv.minAvgBalance ?? ''} className={`${cellInput} w-24`} onBlur={e => save(b, { minAvgBalance: numOrNull(e.target.value) })} /></td>
              <td className="px-2.5 py-1.5"><NumberInput min={300} max={900} disabled={!canEdit} defaultValue={rv.minCreditScore ?? ''} className={`${cellInput} w-20 font-bold`} style={{ color: scoreColor(rv.minCreditScore) }} onBlur={e => save(b, { minCreditScore: numOrNull(e.target.value) })} /></td>
              <td className="px-2.5 py-1.5"><NumberInput disabled={!canEdit} defaultValue={rv.bankStmtMonths ?? ''} className={`${cellInput} w-16`} onBlur={e => save(b, { bankStmtMonths: numOrNull(e.target.value) })} /></td>
              <td className="px-2.5 py-1.5"><NumberInput min={0} disabled={!canEdit} defaultValue={rv.bounceTolerance ?? ''} className={`${cellInput} w-16`} onBlur={e => save(b, { bounceTolerance: numOrNull(e.target.value) })} /></td>
            </tr>
          )
        })}
      </GridShell>
    </div>
  )
}

function PinsRow({ b, canEdit, save }: { b: BankConfig; canEdit: boolean; save: (b: BankConfig, patch: Partial<BankSaveRequest>) => void }) {
  const existing = parseJsonList(b.serviceablePinsJson)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(existing.join('\n'))
  const pins = text.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
  const bad = pins.filter(p => !/^\d{6}$/.test(p))
  return (
    <>
      <tr className="border-t border-gray-100">
        <td className="px-2.5 py-1.5 font-semibold text-gray-900 whitespace-nowrap">{b.bankName}</td>
        <td className="px-2.5 py-1.5">{existing.length ? <><span className="font-bold" style={{ color: 'var(--success)' }}>{existing.length}</span> <span className="text-gray-400">pins</span></> : <span className="text-gray-400">All locations</span>}</td>
        <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
          <button className="text-[11px] font-semibold text-efin-blue hover:underline" onClick={() => setOpen(o => !o)}>{open ? 'Close' : '✏ Edit'}</button>
          {existing.length > 0 && <>
            <span className="text-gray-300 mx-1">·</span>
            <button className="text-[11px] font-semibold text-efin-blue hover:underline" onClick={() => downloadCsv(buildCsv(['Bank', 'Pin Code'], existing.map(p => [b.bankName, p])), `${b.bankName.replace(/\s+/g, '-').toLowerCase()}-pins.csv`)}>Export</button>
          </>}
        </td>
      </tr>
      {open && (
        <tr className="border-t border-gray-100 bg-gray-50">
          <td colSpan={3} className="px-2.5 py-2">
            <textarea value={text} disabled={!canEdit} onChange={e => setText(e.target.value)} rows={3}
              placeholder={'400001, 110001 — leave empty = serves all locations'}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-efin-blue" />
            <div className="flex items-center gap-3 mt-1.5">
              <span className="text-[11px] text-gray-500">{pins.length} PIN(s)</span>
              {bad.length > 0 && <span className="text-[11px] text-[color:var(--danger)]">{bad.length} invalid (6 digits)</span>}
              {canEdit && <Button size="sm" disabled={bad.length > 0} onClick={() => { save(b, { serviceablePins: pins }); setOpen(false) }}>Save PINs</Button>}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
export function PinsGrid({ canEdit, productKey }: { canEdit: boolean; productKey?: ProductKey }) {
  const { banks, isLoading, saveBank, isProduct } = useBankGrid(productKey)
  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">
        6-digit serviceable PIN codes per bank. Empty = no geographic restriction (serves all locations).
        {isProduct && ' PINs are bank-wide (shared across all products).'}
      </p>
      <GridShell headers={['Bank', 'Serviceable PINs', '']} isLoading={isLoading} empty={banks.length === 0} isProduct={isProduct}>
        {banks.map(b => <PinsRow key={b.id} b={b} canEdit={canEdit} save={saveBank} />)}
      </GridShell>
    </div>
  )
}
