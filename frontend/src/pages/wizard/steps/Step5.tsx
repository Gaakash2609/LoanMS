// Step5 — extracted verbatim from NewApplicationPage.tsx (code-quality
// refactor, no behaviour change).

import { useQuery } from '@tanstack/react-query'
import { IdCard } from 'lucide-react'
import { lenderConfigApi } from '@/api/lenderConfigApi'
import { BIZ_TYPES, COMP_TYPES, COMP_TYPES_SELF, EMP_TYPES, RELATIONS } from '@/pages/wizard/wizardConstants'
import { FormGroup, TextInput, SelectInput } from '@/pages/wizard/WizardFields'
import { ProductContextBanner } from '@/pages/wizard/wizardShared'
import type { WizardData } from '@/pages/wizard/wizardTypes'

export function Step5({ data, onChange, errors, touch }: {
  data: WizardData; onChange: (f: Partial<WizardData>) => void; errors: Record<string, string>
  touch: (field: string) => void
}) {
  // Lender company master (Lender Config → Companies). Backing the employer
  // field with this list is what lets Step 9's matcher resolve the applicant's
  // employer to a bank's approved-company list (Path A). Reuses the same
  // ['lender-companies'] query the Lender Config screen uses — no new endpoint.
  const { data: companies = [] } = useQuery({
    queryKey: ['lender-companies'],
    queryFn: () => lenderConfigApi.getCompanies().then(r => r.data.data ?? []),
    staleTime: 60_000,
  })
  // Whether the typed employer name exactly matches a master company — mirrors
  // Vanilla's master-vs-custom distinction (a match feeds companyId to the
  // matcher; anything else is treated as a custom employer).
  const employerLinked = !!data.compName.trim() &&
    companies.some(c => c.name.trim().toLowerCase() === data.compName.trim().toLowerCase())
  return (
    <div>
      {/* Loan Product is fixed for the whole application — it is chosen once at
          the very start (LoanProductSelectorModal, Vanilla's #loan-product-
          overlay) and shown here read-only, never re-selected. It still drives
          the Property / Vehicle / Education sections below. */}
      <ProductContextBanner loanType={data.loanType} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
        <FormGroup label="Employment Type" required error={errors.empType}>
          <SelectInput value={data.empType} onChange={v => onChange({ empType: v })} onBlur={() => touch('empType')}
            options={EMP_TYPES} placeholder="— Select —" />
        </FormGroup>
        <FormGroup label="Net Monthly Take-Home Salary (₹)" error={errors.salary}>
          <TextInput value={data.salary} onChange={v => onChange({ salary: v })} onBlur={() => touch('salary')}
            inputMode="decimal" decimalOnly placeholder="e.g. 50000" />
        </FormGroup>
        <FormGroup label="Existing Monthly EMI Obligations (₹)" error={errors.obligations}>
          <TextInput value={data.obligations} onChange={v => onChange({ obligations: v })}
            onBlur={() => touch('obligations')}
            inputMode="decimal" decimalOnly placeholder="0 if none" />
        </FormGroup>
        <FormGroup label="Designation" required={data.empType !== 'self_employed'} error={errors.desig}>
          <TextInput value={data.desig} onChange={v => onChange({ desig: v })} onBlur={() => touch('desig')}
            placeholder="e.g. Manager" />
        </FormGroup>
      </div>

      {/* Progressive disclosure: until an Employment Type is picked, none of the
          type-specific field blocks below are shown, so the applicant never
          faces one huge form at once (Step-5 validation only requires those
          fields once empType is set, so hiding them creates no dead-end). */}
      {!data.empType && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3.5 py-3 text-[12.5px] text-gray-500">
          <IdCard size={15} className="shrink-0 text-gray-400" />
          Select an <span className="font-semibold text-gray-600">Employment Type</span> above to reveal the fields that apply to it.
        </div>
      )}

      {/* Company / firm block — shown for Salaried AND Professional. The Step 5
          validation requires compName / desig / officeEmail for every non-
          self-employed type, so this block must render for 'professional' too;
          otherwise a Professional applicant is blocked with required fields that
          have no input (a dead-end state). Label adapts to firm vs employer. */}
      {(data.empType === 'salaried' || data.empType === 'professional') && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 mt-2">
          <FormGroup label={data.empType === 'professional' ? 'Firm / Practice Name' : 'Employer / Company Name'} required error={errors.compName}>
            <TextInput value={data.compName} onChange={v => onChange({ compName: v })}
              onBlur={() => touch('compName')} list="wizard-company-master"
              placeholder={data.empType === 'professional' ? 'e.g. Sharma & Associates' : 'e.g. Tata Consultancy'} />
            {/* Native suggestions from the lender company master. Selecting one
                lets Step 9 evaluate employer-list (Path A) banks; free text is a
                custom employer, exactly like Vanilla's is-custom-company case. */}
            <datalist id="wizard-company-master">
              {companies.map(c => <option key={c.id} value={c.name} />)}
            </datalist>
            {employerLinked
              ? <p className="mt-1 text-[11px] font-medium text-green-600">✓ Linked to lender master — used for employer-list bank matching</p>
              : data.compName.trim() && companies.length > 0
                ? <p className="mt-1 text-[11px] text-gray-400">Custom employer — pick from the list to match employer-list banks</p>
                : null}
          </FormGroup>
          <FormGroup label="Company Type" required error={errors.compType}>
            <SelectInput value={data.compType} onChange={v => onChange({ compType: v })}
              onBlur={() => touch('compType')} options={COMP_TYPES} placeholder="— Select —" />
          </FormGroup>
          <FormGroup label="Official Email ID" required={data.empType === 'salaried'} error={errors.officeEmail}>
            <TextInput value={data.officeEmail} onChange={v => onChange({ officeEmail: v })}
              onBlur={() => touch('officeEmail')}
              type="email" inputMode="email" placeholder="e.g. name@company.com" />
          </FormGroup>
        </div>
      )}

      {data.empType === 'self_employed' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 mt-2">
          <FormGroup label="Business / Firm Name">
            <TextInput value={data.compName} onChange={v => onChange({ compName: v })}
              placeholder="e.g. Sharma Enterprises" />
          </FormGroup>
          <FormGroup label="Company / Business Type" required error={errors.compType}>
            <SelectInput value={data.compType} onChange={v => onChange({ compType: v })}
              onBlur={() => touch('compType')} options={COMP_TYPES_SELF} placeholder="— Select —" />
          </FormGroup>
          {/* Legacy's SEP/SENP field set — none of these existed here before. */}
          <FormGroup label="Business Vintage (years)" required error={errors.bizVintage}>
            <TextInput value={data.bizVintage} onChange={v => onChange({ bizVintage: v })}
              onBlur={() => touch('bizVintage')} inputMode="decimal" decimalOnly placeholder="e.g. 5" />
          </FormGroup>
          <FormGroup label="Annual Turnover (₹)" required error={errors.annualTurnover}>
            <TextInput value={data.annualTurnover} onChange={v => onChange({ annualTurnover: v })}
              onBlur={() => touch('annualTurnover')} inputMode="decimal" decimalOnly placeholder="e.g. 2500000" />
          </FormGroup>
          <FormGroup label="Net Profit (₹)" required error={errors.netProfit}>
            <TextInput value={data.netProfit} onChange={v => onChange({ netProfit: v })}
              onBlur={() => touch('netProfit')} inputMode="decimal" decimalOnly placeholder="e.g. 600000" />
          </FormGroup>
          <FormGroup label="GST Number">
            <TextInput value={data.gstNumber} onChange={v => onChange({ gstNumber: v.toUpperCase() })}
              placeholder="e.g. 27AAAAA0000A1Z5" />
          </FormGroup>
          <FormGroup label="ITR Filed" required error={errors.itrFiled}>
            <SelectInput value={data.itrFiled} onChange={v => onChange({ itrFiled: v })}
              onBlur={() => touch('itrFiled')} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} placeholder="— Select —" />
          </FormGroup>
          {/* Industry Business Type — Vanilla's #w-biz-type, separate from the
              legal Company/Business Type above. */}
          <FormGroup label="Business Type" required error={errors.bizType}>
            <SelectInput value={data.bizType} onChange={v => onChange({ bizType: v })}
              onBlur={() => touch('bizType')} options={BIZ_TYPES} placeholder="— Select —" />
          </FormGroup>
        </div>
      )}

      {/* Professional registration — legacy shows this for the Professional
          employment type (CA / Doctor / Lawyer). */}
      {data.empType === 'professional' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 mt-2">
          <FormGroup label="Professional Body / Registration" required error={errors.professionalBody}>
            <TextInput value={data.professionalBody} onChange={v => onChange({ professionalBody: v })}
              onBlur={() => touch('professionalBody')} placeholder="e.g. ICAI / MCI / Bar Council" />
          </FormGroup>
        </div>
      )}

      {/* Office / workplace address — Vanilla captures this as structured
          Line 1 / Line 2 / PIN (not one free-text field). Label adapts:
          "Office / Practice" for professional, "Business" for self-employed,
          "Office / Workplace" for salaried — matching Vanilla's wording. */}
      {data.empType && (() => {
        const addrPrefix = data.empType === 'professional' ? 'Office / Practice'
          : data.empType === 'self_employed' ? 'Business'
          : 'Office / Workplace'
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 mt-2">
            <FormGroup label={`${addrPrefix} Address Line 1`} required error={errors.officeAddr1}>
              <TextInput value={data.officeAddr1} onChange={v => onChange({ officeAddr1: v })}
                onBlur={() => touch('officeAddr1')} placeholder="Building / Floor / Street" />
            </FormGroup>
            <FormGroup label={`${addrPrefix} Address Line 2`} required error={errors.officeAddr2}>
              <TextInput value={data.officeAddr2} onChange={v => onChange({ officeAddr2: v })}
                onBlur={() => touch('officeAddr2')} placeholder="Area / Locality / Landmark" />
            </FormGroup>
            <FormGroup label={`${addrPrefix} Address PIN Code`} required error={errors.officePin}>
              <TextInput value={data.officePin} onChange={v => onChange({ officePin: v })}
                onBlur={() => touch('officePin')} inputMode="numeric" digitsOnly maxLength={6} placeholder="6-digit PIN" />
            </FormGroup>
          </div>
        )
      })()}

      {/* ── Product-specific sections (legacy shows these per loan type) ── */}
      {(data.loanType === 'home_loan' || data.loanType === 'lap') && (
        <div className="mt-5">
          <p className="wiz-section-head">Property Details</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            <FormGroup label="Property Type" required error={errors.propertyType}>
              <SelectInput value={data.propertyType} onChange={v => onChange({ propertyType: v })}
                onBlur={() => touch('propertyType')}
                options={['Apartment / Flat', 'Independent House', 'Plot / Land', 'Commercial', 'Under Construction']}
                placeholder="— Select —" />
            </FormGroup>
            <FormGroup label="Property Value (₹)">
              <TextInput value={data.propertyValue} onChange={v => onChange({ propertyValue: v })}
                inputMode="decimal" decimalOnly placeholder="e.g. 6500000" />
            </FormGroup>
            <FormGroup label="Property Address">
              <TextInput value={data.propertyAddress} onChange={v => onChange({ propertyAddress: v })}
                placeholder="Full property address" />
            </FormGroup>
            <FormGroup label="Property City">
              <TextInput value={data.propertyCity} onChange={v => onChange({ propertyCity: v })}
                placeholder="e.g. Pune" />
            </FormGroup>
            <FormGroup label="Ownership Type" required error={errors.propertyOwnership}>
              <SelectInput value={data.propertyOwnership} onChange={v => onChange({ propertyOwnership: v })}
                onBlur={() => touch('propertyOwnership')} options={['Owned', 'Rented', 'Self Owned']} placeholder="— Select —" />
            </FormGroup>
            <FormGroup label="Under Construction?" required error={errors.propertyUnderConstruction}>
              <SelectInput value={data.propertyUnderConstruction} onChange={v => onChange({ propertyUnderConstruction: v })}
                onBlur={() => touch('propertyUnderConstruction')} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} />
            </FormGroup>
            {(data.propertyUnderConstruction === 'yes' || data.propertyType === 'Under Construction' || data.propertyType === 'Apartment / Flat') && (
              <FormGroup label="Builder / Society Name">
                <TextInput value={data.builderSociety} onChange={v => onChange({ builderSociety: v })}
                  placeholder="e.g. Green Valley Developers" />
              </FormGroup>
            )}
          </div>
        </div>
      )}

      {(data.loanType === 'new_car' || data.loanType === 'used_car') && (
        <div className="mt-5">
          <p className="wiz-section-head">Vehicle Details</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            <FormGroup label="Make" required error={errors.vehicleMake}>
              <TextInput value={data.vehicleMake} onChange={v => onChange({ vehicleMake: v })}
                onBlur={() => touch('vehicleMake')} placeholder="e.g. Maruti Suzuki" />
            </FormGroup>
            <FormGroup label="Model" required error={errors.vehicleModel}>
              <TextInput value={data.vehicleModel} onChange={v => onChange({ vehicleModel: v })}
                onBlur={() => touch('vehicleModel')} placeholder="e.g. Baleno" />
            </FormGroup>
            <FormGroup label={data.loanType === 'used_car' ? 'Vehicle Value (₹)' : 'On-road Price (₹)'} required error={errors.vehiclePrice}>
              <TextInput value={data.vehiclePrice} onChange={v => onChange({ vehiclePrice: v })}
                onBlur={() => touch('vehiclePrice')} inputMode="decimal" decimalOnly placeholder="e.g. 900000" />
            </FormGroup>
            {data.loanType === 'new_car' && (
              <FormGroup label="Ex-Showroom Price (₹)">
                <TextInput value={data.vehicleExShowroom} onChange={v => onChange({ vehicleExShowroom: v })}
                  inputMode="decimal" decimalOnly placeholder="e.g. 820000" />
              </FormGroup>
            )}
            {data.loanType === 'used_car' && (
              <>
                <FormGroup label="Manufacture Year" required error={errors.vehicleMfgYear}>
                  <TextInput value={data.vehicleMfgYear} onChange={v => onChange({ vehicleMfgYear: v })}
                    onBlur={() => touch('vehicleMfgYear')} inputMode="numeric" digitsOnly maxLength={4} placeholder="e.g. 2019" />
                </FormGroup>
                <FormGroup label="Kilometres Driven" required error={errors.vehicleKms}>
                  <TextInput value={data.vehicleKms} onChange={v => onChange({ vehicleKms: v })}
                    onBlur={() => touch('vehicleKms')} inputMode="numeric" digitsOnly placeholder="e.g. 45000" />
                </FormGroup>
              </>
            )}
            <FormGroup label="Dealer Name" required error={errors.vehicleDealer}>
              <TextInput value={data.vehicleDealer} onChange={v => onChange({ vehicleDealer: v })}
                onBlur={() => touch('vehicleDealer')} placeholder="e.g. City Motors" />
            </FormGroup>
          </div>
        </div>
      )}

      {data.loanType === 'education' && (
        <div className="mt-5">
          <p className="wiz-section-head">Education Details</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            <FormGroup label="Course Name" required error={errors.courseName}>
              <TextInput value={data.courseName} onChange={v => onChange({ courseName: v })}
                onBlur={() => touch('courseName')} placeholder="e.g. MBA" />
            </FormGroup>
            <FormGroup label="Institute / University" required error={errors.instituteName}>
              <TextInput value={data.instituteName} onChange={v => onChange({ instituteName: v })}
                onBlur={() => touch('instituteName')} placeholder="e.g. IIM Bangalore" />
            </FormGroup>
            <FormGroup label="Course Duration (Years)" required error={errors.courseDuration}>
              {/* Vanilla's #w-course-duration is Years (min 1, max 10), not months
                  — efin-app.js index.html:2225. */}
              <TextInput value={data.courseDuration} onChange={v => onChange({ courseDuration: v })}
                onBlur={() => touch('courseDuration')} inputMode="numeric" digitsOnly maxLength={2} placeholder="e.g. 4" />
            </FormGroup>
            <FormGroup label="Study Location" required error={errors.studyLocation}>
              <SelectInput value={data.studyLocation} onChange={v => onChange({ studyLocation: v })}
                onBlur={() => touch('studyLocation')} options={['India', 'Abroad']} placeholder="— Select —" />
            </FormGroup>
            <FormGroup label="Admission Status" required error={errors.admissionStatus}>
              <SelectInput value={data.admissionStatus} onChange={v => onChange({ admissionStatus: v })}
                onBlur={() => touch('admissionStatus')} options={['Confirmed', 'Applied / Waiting', 'Pending']} placeholder="— Select —" />
            </FormGroup>
          </div>
        </div>
      )}

      {/* Co-applicant — legacy makes this mandatory for Home Loan / LAP and
          for Education (every field carries a `req` span in Vanilla's
          #w-edu-fields, index.html:2231-2249); optional for Business Loan. */}
      {['home_loan', 'lap', 'business_loan', 'education'].includes(data.loanType) && (() => {
        const mandatory = ['home_loan', 'lap', 'education'].includes(data.loanType)
        const isEducation = data.loanType === 'education'
        return (
          <div className="mt-5">
            <p className="wiz-section-head">
              {isEducation ? 'Co-Applicant (Parent / Guardian) Details' : 'Co-Applicant Details'}
              {mandatory
                ? <span className="text-red-500 ml-1">*</span>
                : <span className="text-gray-400 font-normal normal-case ml-1">(optional)</span>}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
              <FormGroup label="Co-Applicant Name" required={mandatory} error={errors.coAppName}>
                <TextInput value={data.coAppName} onChange={v => onChange({ coAppName: v })}
                  onBlur={() => touch('coAppName')} placeholder="Full name" />
              </FormGroup>
              <FormGroup label="Relationship" required={mandatory} error={errors.coAppRelation}>
                <SelectInput value={data.coAppRelation} onChange={v => onChange({ coAppRelation: v })}
                  onBlur={() => touch('coAppRelation')} options={RELATIONS} placeholder="— Select —" />
              </FormGroup>
              <FormGroup label="Co-Applicant PAN" required={mandatory} error={errors.coAppPan}>
                <TextInput value={data.coAppPan} onChange={v => onChange({ coAppPan: v.toUpperCase() })}
                  onBlur={() => touch('coAppPan')} maxLength={10} placeholder="ABCDE1234F" />
              </FormGroup>
              <FormGroup label="Co-Applicant Mobile" required={mandatory} error={errors.coAppMobile}>
                <TextInput value={data.coAppMobile} onChange={v => onChange({ coAppMobile: v })}
                  onBlur={() => touch('coAppMobile')} inputMode="numeric" maxLength={10} placeholder="10-digit mobile" />
              </FormGroup>
              {/* Co-Applicant Email — Education-only in Vanilla (#w-coapplicant-email,
                  index.html:2249). Not collected for Home/LAP/Business co-applicants. */}
              {isEducation && (
                <FormGroup label="Co-Applicant Email" required error={errors.coAppEmail}>
                  <TextInput value={data.coAppEmail} onChange={v => onChange({ coAppEmail: v })}
                    onBlur={() => touch('coAppEmail')} type="email" inputMode="email" placeholder="email@example.com" />
                </FormGroup>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

