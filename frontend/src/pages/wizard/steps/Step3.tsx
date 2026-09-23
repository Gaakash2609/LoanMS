// Step3 — extracted verbatim from NewApplicationPage.tsx (code-quality
// refactor, no behaviour change).

import { FormGroup, TextInput, SelectInput } from '@/pages/wizard/WizardFields'
import type { WizardData } from '@/pages/wizard/wizardTypes'

export function Step3({ data, onChange, errors, touch }: {
  data: WizardData; onChange: (f: Partial<WizardData>) => void; errors: Record<string, string>
  touch: (field: string) => void
}) {
  return (
    <>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
      <FormGroup label="First Name" required error={errors.firstName}>
        <TextInput value={data.firstName} onChange={v => onChange({ firstName: v })}
          onBlur={() => touch('firstName')} placeholder="First name" />
      </FormGroup>
      <FormGroup label="Middle Name">
        <TextInput value={data.middleName} onChange={v => onChange({ middleName: v })} placeholder="Middle name" />
      </FormGroup>
      <FormGroup label="Last Name" required error={errors.lastName}>
        <TextInput value={data.lastName} onChange={v => onChange({ lastName: v })}
          onBlur={() => touch('lastName')} placeholder="Last name" />
      </FormGroup>
      <FormGroup label="Date of Birth" required error={errors.dob}>
        <TextInput value={data.dob} onChange={v => onChange({ dob: v })} onBlur={() => touch('dob')} type="date" />
      </FormGroup>
      <FormGroup label="Gender" required error={errors.gender}>
        <SelectInput value={data.gender} onChange={v => onChange({ gender: v })} onBlur={() => touch('gender')}
          options={[{ value: 'M', label: 'Male' }, { value: 'F', label: 'Female' }, { value: 'O', label: 'Other' }]} placeholder="— Select —" />
      </FormGroup>
      <FormGroup label="Aadhaar Number" required error={errors.aadhar}>
        <TextInput value={data.aadhar} onChange={v => onChange({ aadhar: v })} onBlur={() => touch('aadhar')}
          placeholder="12-digit Aadhaar" maxLength={12} minLength={12}
          inputMode="numeric" pattern="\d{12}" digitsOnly className="font-mono" />
      </FormGroup>
      <FormGroup label="Email Address" required error={errors.email}>
        <TextInput value={data.email} onChange={v => onChange({ email: v })} onBlur={() => touch('email')}
          type="email" inputMode="email" placeholder="email@example.com" />
      </FormGroup>
      <FormGroup label="Alternate Phone" error={errors.phone}>
        <TextInput value={data.phone} onChange={v => onChange({ phone: v })} onBlur={() => touch('phone')}
          type="tel" inputMode="numeric" pattern="\d{10}" digitsOnly
          placeholder="10-digit alternate number" maxLength={10} minLength={10} />
      </FormGroup>
      <FormGroup label="Father's Name" required error={errors.father}>
        <TextInput value={data.father} onChange={v => onChange({ father: v })}
          onBlur={() => touch('father')} placeholder="Father's name" />
      </FormGroup>
      {/* Mother's Name — Vanilla Step 3 (Personal Details) has this field
          right after Father's Name (index.html wstep-3); required there. */}
      <FormGroup label="Mother's Name" required error={errors.mother}>
        <TextInput value={data.mother} onChange={v => onChange({ mother: v })}
          onBlur={() => touch('mother')} placeholder="Mother's name" />
      </FormGroup>
    </div>
    <Step3CoApplicant data={data} onChange={onChange} errors={errors} touch={touch} />
    </>
  )
}

// Co-Applicant section on Step 3 — Vanilla's #wstep3-coapp-section
// (wToggleCoApplicantSection, efin-app.js:9298): Home Loan / LAP → shown &
// MANDATORY (Name/PAN/Aadhaar/Mobile); Business Loan → shown & optional; all
// other products → hidden. React previously captured a co-applicant only on
// Step 5 for Education, so Home/LAP/Business co-applicant was not captured at
// all. Reuses the existing coApp* WizardData fields (+ coAppAadhar).
const COAPP3_MANDATORY = ['home_loan', 'lap']
const COAPP3_OPTIONAL  = ['business_loan']
function Step3CoApplicant({ data, onChange, errors, touch }: {
  data: WizardData; onChange: (f: Partial<WizardData>) => void; errors: Record<string, string>
  touch: (field: string) => void
}) {
  const mandatory = COAPP3_MANDATORY.includes(data.loanType)
  const optional  = COAPP3_OPTIONAL.includes(data.loanType)
  if (!mandatory && !optional) return null
  return (
    <div className="mt-4">
      <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
        Co-Applicant Details {mandatory ? <span style={{ color: 'var(--danger)' }}>*</span> : <span style={{ color: 'var(--text3)' }}>(Optional)</span>}
      </div>
      {mandatory && (
        <p className="text-xs mt-0.5 mb-1" style={{ color: 'var(--danger)' }}>Co-Applicant is mandatory for this loan type.</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 mt-2">
        <FormGroup label="Full Name" required={mandatory} error={errors.coAppName}>
          <TextInput value={data.coAppName} onChange={v => onChange({ coAppName: v })}
            onBlur={() => touch('coAppName')} placeholder="Co-applicant full name" />
        </FormGroup>
        <FormGroup label="PAN Number" required={mandatory} error={errors.coAppPan}>
          <TextInput value={data.coAppPan} onChange={v => onChange({ coAppPan: v.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
            onBlur={() => touch('coAppPan')} placeholder="ABCDE1234F" maxLength={10} className="uppercase font-mono" />
        </FormGroup>
        <FormGroup label="Aadhaar Number" required={mandatory} error={errors.coAppAadhar}>
          <TextInput value={data.coAppAadhar} onChange={v => onChange({ coAppAadhar: v })}
            onBlur={() => touch('coAppAadhar')} placeholder="12-digit Aadhaar" maxLength={12}
            inputMode="numeric" digitsOnly className="font-mono" />
        </FormGroup>
        <FormGroup label="Mobile Number" required={mandatory} error={errors.coAppMobile}>
          <TextInput value={data.coAppMobile} onChange={v => onChange({ coAppMobile: v })}
            onBlur={() => touch('coAppMobile')} type="tel" inputMode="numeric" digitsOnly
            maxLength={10} placeholder="10-digit mobile" />
        </FormGroup>
      </div>
    </div>
  )
}

