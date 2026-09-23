import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

// ── Loan Product Selector ────────────────────────────────────────────────
// Ports legacy's #loan-product-overlay (efin-app.js:27824-27913): a premium
// card-grid "front door" shown before the New Application wizard, instead
// of making the user find a plain dropdown after the form has already
// loaded. Selecting a card pre-fills the wizard's own `loanType` field.
//
// All 9 of legacy's product types, including Overdraft. Overdraft's backend
// path is now complete: LoanType.Overdraft exists and WizardController's
// _loanTypeMap maps "over_draft" onto it (previously it silently fell back
// to Personal, which is why an earlier version of this modal deliberately
// omitted the card).
// Emoji + labels + descriptions copied verbatim from Vanilla's LC_PRODUCTS
// (efin-app.js:15825). Vanilla uses EMOJI icons here, not line-art icons.
// The `value`s are unchanged — they still feed the wizard's loanType.
// Exported so the wizard can render a read-only "selected product" context
// chip (Steps 5/6/9) from the SAME single source of truth used by the picker —
// the product is chosen once here and only displayed afterwards, never
// re-selected inside the wizard (Vanilla picks it in this modal too and shows
// no product dropdown in steps 5/6; its Step-9 filter is hidden/auto-driven).
export const LOAN_PRODUCT_META: { value: string; label: string; desc: string; emoji: string }[] = [
  { value: 'personal_loan', label: 'Personal Loan',           desc: 'Unsecured · Quick disbursal',    emoji: '💰' },
  { value: 'business_loan', label: 'Business Loan',           desc: 'Self-employed · MSME',           emoji: '🏦' },
  { value: 'lap',           label: 'LAP',                     desc: 'Loan Against Property',          emoji: '🏠' },
  { value: 'home_loan',     label: 'Home Loan',               desc: 'Purchase · Construction',        emoji: '🏡' },
  { value: 'education',     label: 'Education Loan',          desc: 'Domestic · Abroad study',        emoji: '🎓' },
  { value: 'new_car',       label: 'New Car Loan',            desc: 'New vehicle finance',            emoji: '🚗' },
  { value: 'used_car',      label: 'Used Car Loan',           desc: 'Pre-owned vehicle',              emoji: '🚙' },
  { value: 'over_draft',    label: 'Overdraft / Cash Credit', desc: 'Business cash credit · OD / CC', emoji: '💳' },
  { value: 'insurance',     label: 'Insurance',               desc: 'Life · General · Health',        emoji: '🛡️' },
]

export default function LoanProductSelectorModal({ onSelect, onClose }: {
  onSelect: (loanType: string) => void
  onClose: () => void
}) {
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <Modal
      open
      onClose={onClose}
      title="Select Loan Product"
      subtitle="Choose the loan type to begin your application"
      size="lg"
      className="sm:max-w-2xl"
      // Footer order mirrors Vanilla's #loan-product-overlay .lp-actions
      // (index.html:6196-6199): Cancel (ghost) on the LEFT, the primary
      // Continue → on the RIGHT. React had these reversed.
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => selected && onSelect(selected)} disabled={!selected}>
          Continue →
        </Button>
      </>}
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {LOAN_PRODUCT_META.map((p) => {
          const isSelected = selected === p.value
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => setSelected(p.value)}
              className={`lp-card ${isSelected ? 'selected' : ''}`}
            >
              {isSelected && <span className="lp-check">✓</span>}
              <span className="lp-card-icon" style={{ fontSize: 22 }}>{p.emoji}</span>
              <div className="lp-card-name">{p.label}</div>
              <div className="lp-card-desc">{p.desc}</div>
            </button>
          )
        })}
      </div>
    </Modal>
  )
}
