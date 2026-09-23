// Step6 — extracted verbatim from NewApplicationPage.tsx (code-quality
// refactor, no behaviour change).

import CamOfferPanel from '@/components/shared/CamOfferPanel'
import { RELATIONS } from '@/pages/wizard/wizardConstants'
import { FormGroup, TextInput, SelectInput } from '@/pages/wizard/WizardFields'
import { ProductContextBanner } from '@/pages/wizard/wizardShared'
import type { WizardData } from '@/pages/wizard/wizardTypes'

export function Step6({ data, onChange, errors, touch }: {
  data: WizardData; onChange: (f: Partial<WizardData>) => void; errors: Record<string, string>
  touch: (field: string) => void
}) {
  // Insurance is not a loan — legacy swaps the entire loan-offer field set
  // for a policy field set when this product is chosen. Reproduced here.
  if (data.loanType === 'insurance') {
    return (
      <div>
        <ProductContextBanner loanType={data.loanType} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
          <FormGroup label="Insurance Type" required error={errors.insType}>
            <SelectInput value={data.insType} onChange={v => onChange({ insType: v })} onBlur={() => touch('insType')}
              options={['Term Life', 'Whole Life', 'Endowment', 'ULIP', 'Health', 'Motor', 'Home', 'Travel', 'Personal Accident']}
              placeholder="— Select —" />
          </FormGroup>
          <FormGroup label="Sum Assured (₹)" required error={errors.insSumAssured}>
            <TextInput value={data.insSumAssured} onChange={v => onChange({ insSumAssured: v })}
              onBlur={() => touch('insSumAssured')} inputMode="decimal" decimalOnly placeholder="e.g. 5000000" />
          </FormGroup>
          <FormGroup label="Policy Term (years)" required error={errors.insPolicyTerm}>
            <TextInput value={data.insPolicyTerm} onChange={v => onChange({ insPolicyTerm: v })}
              onBlur={() => touch('insPolicyTerm')} inputMode="numeric" digitsOnly maxLength={2} placeholder="e.g. 20" />
          </FormGroup>
          <FormGroup label="Premium Frequency" required error={errors.insPremiumFreq}>
            <SelectInput value={data.insPremiumFreq} onChange={v => onChange({ insPremiumFreq: v })}
              onBlur={() => touch('insPremiumFreq')}
              options={['Yearly', 'Half-Yearly', 'Quarterly', 'Monthly', 'Single Premium']} />
          </FormGroup>
          <FormGroup label="Estimated Premium (₹)" required error={errors.insPremium}>
            <TextInput value={data.insPremium} onChange={v => onChange({ insPremium: v })}
              onBlur={() => touch('insPremium')} inputMode="decimal" decimalOnly placeholder="e.g. 24000" />
          </FormGroup>
          <FormGroup label="Preferred Insurer" required error={errors.insInsurer}>
            <TextInput value={data.insInsurer} onChange={v => onChange({ insInsurer: v })}
              onBlur={() => touch('insInsurer')} placeholder="e.g. HDFC Life" />
          </FormGroup>
        </div>

        <p className="wiz-section-head">Nominee Details</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
          <FormGroup label="Nominee Name" required error={errors.insNomineeName}>
            <TextInput value={data.insNomineeName} onChange={v => onChange({ insNomineeName: v })}
              onBlur={() => touch('insNomineeName')} placeholder="Full name" />
          </FormGroup>
          <FormGroup label="Relationship" required error={errors.insNomineeRelation}>
            <SelectInput value={data.insNomineeRelation} onChange={v => onChange({ insNomineeRelation: v })}
              onBlur={() => touch('insNomineeRelation')} options={RELATIONS} placeholder="— Select —" />
          </FormGroup>
          <FormGroup label="Nominee Date of Birth" required error={errors.insNomineeDob}>
            <TextInput value={data.insNomineeDob} onChange={v => onChange({ insNomineeDob: v })}
              onBlur={() => touch('insNomineeDob')} type="date" />
          </FormGroup>
          <FormGroup label="Nominee ID (Aadhaar / PAN)" required error={errors.insNomineeId}>
            <TextInput value={data.insNomineeId} onChange={v => onChange({ insNomineeId: v.toUpperCase() })}
              onBlur={() => touch('insNomineeId')} placeholder="Aadhaar or PAN" />
          </FormGroup>
        </div>

        <p className="wiz-section-head">Existing Policy</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
          <FormGroup label="Has an existing policy?">
            <SelectInput value={data.insExistingPolicy} onChange={v => onChange({ insExistingPolicy: v })}
              options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} />
          </FormGroup>
          {data.insExistingPolicy === 'yes' && (
            <>
              <FormGroup label="Existing Insurer">
                <TextInput value={data.insExistingInsurer} onChange={v => onChange({ insExistingInsurer: v })}
                  placeholder="Insurer name" />
              </FormGroup>
              <FormGroup label="Existing Cover (₹)" required error={errors.insExistingCover}>
                <TextInput value={data.insExistingCover} onChange={v => onChange({ insExistingCover: v })}
                  onBlur={() => touch('insExistingCover')} inputMode="decimal" decimalOnly placeholder="e.g. 2000000" />
              </FormGroup>
              <FormGroup label="Existing Policy Number" required error={errors.insExistingPolicyNumber}>
                <TextInput value={data.insExistingPolicyNumber} onChange={v => onChange({ insExistingPolicyNumber: v.toUpperCase() })}
                  onBlur={() => touch('insExistingPolicyNumber')} placeholder="Policy number" />
              </FormGroup>
            </>
          )}
        </div>

        <p className="wiz-section-head">Health Declaration</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
          <FormGroup label="Tobacco / Smoker Status" required error={errors.insTobaccoStatus}>
            <SelectInput value={data.insTobaccoStatus} onChange={v => onChange({ insTobaccoStatus: v })}
              onBlur={() => touch('insTobaccoStatus')}
              options={['Non-Smoker / Non-Tobacco User', 'Smoker', 'Tobacco User (non-smoking)', 'Ex-Smoker (quit > 1 year ago)']}
              placeholder="— Select —" />
          </FormGroup>
          <FormGroup label="Occupation Hazard" required error={errors.insOccupationHazard}>
            <SelectInput value={data.insOccupationHazard} onChange={v => onChange({ insOccupationHazard: v })}
              onBlur={() => touch('insOccupationHazard')}
              options={['Low Risk (Office / Professional)', 'Medium Risk (Field Work / Semi-manual)', 'High Risk (Manual / Industrial / Mining)']}
              placeholder="— Select —" />
          </FormGroup>
          <FormGroup label="Height (cm)" required error={errors.insHeight}>
            <TextInput value={data.insHeight} onChange={v => onChange({ insHeight: v })}
              onBlur={() => touch('insHeight')} inputMode="numeric" digitsOnly maxLength={3} placeholder="e.g. 172" />
          </FormGroup>
          <FormGroup label="Weight (kg)" required error={errors.insWeight}>
            <TextInput value={data.insWeight} onChange={v => onChange({ insWeight: v })}
              onBlur={() => touch('insWeight')} inputMode="numeric" digitsOnly maxLength={3} placeholder="e.g. 70" />
          </FormGroup>
          <FormGroup label="Any existing medical condition?">
            <SelectInput value={data.insHealthDeclared} onChange={v => onChange({ insHealthDeclared: v })}
              options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} />
          </FormGroup>
          {data.insHealthDeclared === 'yes' && (
            <FormGroup label="Details" required error={errors.insHealthNotes}>
              <TextInput value={data.insHealthNotes} onChange={v => onChange({ insHealthNotes: v })}
                onBlur={() => touch('insHealthNotes')} placeholder="Condition / treatment details" />
            </FormGroup>
          )}
        </div>

        <div className="mt-5 p-3 bg-efin-blue/10 border border-efin-blue/12 rounded-lg text-xs text-efin-blue">
          Insurance is a policy application, not a loan — EMI, interest rate and tenure do not apply.
        </div>
      </div>
    )
  }

  return (
    <div>
      <ProductContextBanner loanType={data.loanType} />
      {/* CAM eligibility offer — legacy renders this panel at the top of
          Step 6 (#wstep6-cam-panel) so the offer is worked out before the
          loan fields are filled. Applying it writes into the same three
          fields below, exactly like camApplyToWizard(). */}
      <CamOfferPanel
        salary={data.salary}
        obligations={data.obligations}
        companyName={data.compName}
        applicantName={[data.firstName, data.lastName].filter(Boolean).join(' ')}
        onApply={offer => onChange({
          ...offer,
          // Legacy defaults the product to personal_loan when the offer is
          // applied and nothing has been chosen yet (efin-app.js:17614).
          loanType: data.loanType || 'personal_loan',
        })}
      />

      {/* CIBIL Score / Loan Amount / Interest Rate / Tenure / Purpose fields,
          the standalone EMI Calculator block, and the live lender-eligibility
          preview were removed from this step at the user's request — they
          duplicated what CamOfferPanel above already covers (amount, rate,
          tenure and EMI are set via its own slider + Apply to Application).
          `amount` and `tenure` (the only two fields validateStep(6) actually
          requires for a loan) are still populated by CamOfferPanel's onApply,
          so Continue keeps working the same way. */}
    </div>
  )
}

