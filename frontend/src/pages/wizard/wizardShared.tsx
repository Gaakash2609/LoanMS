// Shared wizard UI extracted verbatim from NewApplicationPage.tsx
// (code-quality refactor, no behaviour change).
import { LOAN_PRODUCT_META } from '@/components/shared/LoanProductSelectorModal'

// Read-only "selected product" context chip. The loan product is chosen ONCE
// at the start of the wizard (LoanProductSelectorModal, matching Vanilla's
// #loan-product-overlay) and is never re-selected inside a step — Steps 5, 6
// and 9 show it as fixed context instead of a duplicate dropdown, exactly as
// Vanilla does (its steps 5/6 have no product dropdown; its Step-9 filter is
// hidden and auto-driven). Sourced from LOAN_PRODUCT_META (same list the
// picker uses) so label/emoji never drift.
export function ProductContextBanner({ loanType, note }: { loanType: string; note?: string }) {
  const meta = LOAN_PRODUCT_META.find(p => p.value === loanType)
  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg border border-efin-blue/15 bg-efin-blue/5 px-3.5 py-2.5">
      <span className="text-xl leading-none shrink-0" aria-hidden>{meta?.emoji ?? '📄'}</span>
      <div className="min-w-0">
        <div className="text-[10.5px] font-semibold uppercase tracking-wide text-efin-blue/70">Selected Loan Product</div>
        <div className="text-sm font-semibold text-gray-900 truncate">{meta?.label ?? (loanType || '—')}</div>
      </div>
      {meta?.desc && <span className="ml-auto hidden sm:block text-[11px] text-gray-400 truncate">{meta.desc}</span>}
      {note && <span className="ml-auto text-[11px] text-gray-400">{note}</span>}
    </div>
  )
}


// ── Wizard State ──────────────────────────────────────────────────────────────
