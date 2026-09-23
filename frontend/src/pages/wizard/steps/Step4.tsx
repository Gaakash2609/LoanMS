// Step4 — extracted verbatim from NewApplicationPage.tsx (code-quality
// refactor, no behaviour change).

import { HOME_TYPES, STATES } from '@/pages/wizard/wizardConstants'
import { FormGroup, TextInput, SelectInput } from '@/pages/wizard/WizardFields'
import type { WizardData } from '@/pages/wizard/wizardTypes'

export function Step4({ data, onChange, errors, touch }: {
  data: WizardData; onChange: (f: Partial<WizardData>) => void; errors: Record<string, string>
  touch: (field: string) => void
}) {
  const handleSameAddr = (checked: boolean) => {
    if (checked) {
      onChange({
        sameAddr: true,
        pStreet1: data.street1, pStreet2: data.street2,
        pCity: data.city, pState: data.state, pZip: data.zip, pHomeType: data.homeType,
      })
    } else {
      onChange({ sameAddr: false })
    }
  }

  return (
    <div>
      <p className="wiz-section-head">Current Address</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
        <FormGroup label="House / Flat No." required error={errors.street1}>
          <TextInput value={data.street1} onChange={v => onChange({ street1: v })}
            onBlur={() => touch('street1')} placeholder="Flat no, Floor" />
        </FormGroup>
        <FormGroup label="Street & Locality" required error={errors.street2}>
          <TextInput value={data.street2} onChange={v => onChange({ street2: v })}
            onBlur={() => touch('street2')} placeholder="Road, Area, Colony" />
        </FormGroup>
        <FormGroup label="City" required error={errors.city}>
          <TextInput value={data.city} onChange={v => onChange({ city: v })}
            onBlur={() => touch('city')} placeholder="City" />
        </FormGroup>
        <FormGroup label="Pin Code" required error={errors.zip}>
          <TextInput value={data.zip} onChange={v => onChange({ zip: v })} onBlur={() => touch('zip')}
            placeholder="6-digit pin" maxLength={6} minLength={6}
            inputMode="numeric" pattern="\d{6}" digitsOnly />
        </FormGroup>
        <FormGroup label="State" required error={errors.state}>
          <SelectInput value={data.state} onChange={v => onChange({ state: v })} onBlur={() => touch('state')}
            options={STATES} placeholder="— Select State —" />
        </FormGroup>
        <FormGroup label="Home Type" required error={errors.homeType}>
          <SelectInput value={data.homeType} onChange={v => onChange({ homeType: v })} onBlur={() => touch('homeType')}
            options={HOME_TYPES} placeholder="— Select —" />
        </FormGroup>
      </div>

      {/* Permanent address block — Vanilla hides it entirely for over_draft
          (applyProductToWizard toggle w-permanent-addr-block), including the
          "Same as current" checkbox, since Step 4 there is the Business Address. */}
      {data.loanType !== 'over_draft' && (
        <>
          <div className="mt-5">
            <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-gray-600">
              <input type="checkbox" checked={data.sameAddr}
                onChange={e => handleSameAddr(e.target.checked)}
                className="w-4 h-4 accent-efin-blue" />
              Same as current address
            </label>
          </div>

          {!data.sameAddr && (
            <>
              <p className="wiz-section-head">Permanent Address</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                <FormGroup label="House / Flat No." required error={errors.pStreet1}>
                  <TextInput value={data.pStreet1} onChange={v => onChange({ pStreet1: v })}
                    onBlur={() => touch('pStreet1')} placeholder="Flat no, Floor" />
                </FormGroup>
                <FormGroup label="Street & Locality" required error={errors.pStreet2}>
                  <TextInput value={data.pStreet2} onChange={v => onChange({ pStreet2: v })}
                    onBlur={() => touch('pStreet2')} placeholder="Road, Area, Colony" />
                </FormGroup>
                <FormGroup label="City" required error={errors.pCity}>
                  <TextInput value={data.pCity} onChange={v => onChange({ pCity: v })}
                    onBlur={() => touch('pCity')} placeholder="City" />
                </FormGroup>
                <FormGroup label="Pin Code" required error={errors.pZip}>
                  <TextInput value={data.pZip} onChange={v => onChange({ pZip: v })} onBlur={() => touch('pZip')}
                    placeholder="6-digit pin" maxLength={6} minLength={6}
                    inputMode="numeric" pattern="\d{6}" digitsOnly />
                </FormGroup>
                <FormGroup label="State" required error={errors.pState}>
                  <SelectInput value={data.pState} onChange={v => onChange({ pState: v })}
                    onBlur={() => touch('pState')} options={STATES} placeholder="— Select State —" />
                </FormGroup>
                <FormGroup label="Home Type" required error={errors.pHomeType}>
                  <SelectInput value={data.pHomeType} onChange={v => onChange({ pHomeType: v })}
                    onBlur={() => touch('pHomeType')} options={HOME_TYPES} placeholder="— Select —" />
                </FormGroup>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

