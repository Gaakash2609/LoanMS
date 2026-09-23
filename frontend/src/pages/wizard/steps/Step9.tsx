// Step9 — extracted verbatim from NewApplicationPage.tsx (code-quality
// refactor, no behaviour change).

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import BankEligibilityMatch, { type SelectedBank } from '@/components/shared/BankEligibilityMatch'
import { toEmploymentCode } from '@/utils/employmentType'
import { lenderConfigApi } from '@/api/lenderConfigApi'
import type { WizardData } from '@/pages/wizard/wizardTypes'

export function Step9({ data, selectedBanks, onBanksChange }: {
  data: WizardData
  selectedBanks: SelectedBank[]
  onBanksChange: (banks: SelectedBank[]) => void
}) {
  // Resolve the applicant's employer (free-text compName captured in Step 5) to
  // a lender-master companyId so the matcher can evaluate employer-list (Path A)
  // banks. Vanilla did the same via the searchable company picker's hidden id;
  // here we match compName against the same master list (exact, case-insensitive
  // — a non-match is a custom employer, companyId omitted). Reuses the shared
  // ['lender-companies'] cache; survives draft-resume because compName persists.
  const { data: companies = [] } = useQuery({
    queryKey: ['lender-companies'],
    queryFn: () => lenderConfigApi.getCompanies().then(r => r.data.data ?? []),
    staleTime: 60_000,
  })
  const companyId = companies.find(
    c => c.name.trim().toLowerCase() === data.compName.trim().toLowerCase(),
  )?.id

  const P   = parseFloat(data.amount) || 0
  // Rate the applicant chose in Step 6, or undefined if left blank — passed
  // through so each card uses it when present, else falls back to that bank's
  // own min-CIBIL-derived rate (Vanilla's `wizRate || heuristic`).
  const enteredRate = parseFloat(data.loanRate) || undefined
  const n   = parseInt(data.tenure) || 24

  // ✅ Fallback UI if critical data missing. For Insurance the "amount"
  // field doesn't apply — Sum Assured is that product's headline figure —
  // so requiring `amount` here would have wrongly blocked every insurance
  // application at the final step.
  const isInsurance = data.loanType === 'insurance'
  const amountMissing = isInsurance ? !data.insSumAssured : !data.amount
  if (!data.mobile || !data.pan || !data.firstName || amountMissing) {
    return (
      <div className="space-y-4 p-6 bg-amber-50 border border-amber-200 rounded-lg">
        <p className="text-sm font-semibold text-amber-900 flex items-center gap-1.5"><AlertTriangle size={15} /> Incomplete Application</p>
        <p className="text-xs text-amber-800">Some required fields are missing. Please go back and complete all steps:</p>
        <ul className="text-xs text-amber-800 list-disc list-inside space-y-1">
          {!data.mobile && <li>Step 1: Contact information (Mobile, PAN)</li>}
          {!data.firstName && <li>Step 3: Personal Details (Name)</li>}
          {amountMissing && <li>Step 6: {isInsurance ? 'Insurance (Sum Assured)' : 'Loan Offer (Amount)'}</li>}
        </ul>
      </div>
    )
  }

  const maxBanks = data.loanType === 'personal_loan' ? 2 : 3
  return (
    <div className="space-y-5">
      {/* Step 9 is Vanilla's "Loan Analytics" — an ELIGIBILITY page only (no
          separate Review & Submit step, no product banner, no loan-figure
          tiles, no review notice). The step heading is rendered by the wizard
          body; here we show the sub-line and the eligible-lender match, which
          auto-runs on entering the step (Vanilla laLoadEligibility). */}
      <p className="text-[13px] text-gray-500 -mt-2">
        Based on the applicant's profile, the system identifies eligible lending banks.
        Select up to {maxBanks} bank{maxBanks > 1 ? 's' : ''} for this application.
      </p>

      <BankEligibilityMatch
        request={{
          loanType: data.loanType,
          salary: parseFloat(data.salary) || 0,
          obligations: parseFloat(data.obligations) || 0,
          empType: data.empType ? toEmploymentCode(data.empType) : undefined,
          compType: data.compType || undefined,
          companyId,
          cibil: data.cibil ? Number(data.cibil) : undefined,
          loanAmount: P > 0 ? P : undefined,
          tenure: n > 0 ? n : undefined,
          pinCode: data.zip || undefined,
          age: data.dob ? Math.floor((Date.now() - new Date(data.dob).getTime()) / 31557600000) : undefined,
        }}
        selected={selectedBanks}
        onSelectionChange={onBanksChange}
        interestRate={enteredRate}
      />
    </div>
  )
}

// ── Main Wizard Page ──────────────────────────────────────────────────────────
