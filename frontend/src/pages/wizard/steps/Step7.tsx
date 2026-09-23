// Step7 — extracted verbatim from NewApplicationPage.tsx (code-quality
// refactor, no behaviour change).

import { AlertCircle } from 'lucide-react'
import { RELATIONS } from '@/pages/wizard/wizardConstants'
import { FormGroup, TextInput, SelectInput } from '@/pages/wizard/WizardFields'
import type { WizardData } from '@/pages/wizard/wizardTypes'

export function Step7({ data, onChange, errors, touch }: {
  data: WizardData; onChange: (f: Partial<WizardData>) => void; errors: Record<string, string>
  touch: (field: string) => void
}) {
  return (
    <div>
      {errors.references && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
          <AlertCircle size={16} />{errors.references}
        </div>
      )}
      <div className="mb-6">
        <p className="wiz-section-head">Reference 1</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4">
          <FormGroup label="Name" required error={errors.r1Name}>
            <TextInput value={data.r1Name} onChange={v => onChange({ r1Name: v })} onBlur={() => touch('r1Name')}
              placeholder="Full name" />
          </FormGroup>
          <FormGroup label="Mobile" required error={errors.r1Mobile}>
            <TextInput value={data.r1Mobile} onChange={v => onChange({ r1Mobile: v })} onBlur={() => touch('r1Mobile')}
              type="tel" inputMode="numeric" pattern="\d{10}" digitsOnly
              placeholder="10-digit mobile" maxLength={10} minLength={10} />
          </FormGroup>
          <FormGroup label="Relationship" required error={errors.r1Relation}>
            <SelectInput value={data.r1Relation} onChange={v => onChange({ r1Relation: v })}
              onBlur={() => touch('r1Relation')}
              options={RELATIONS} placeholder="— Select —" />
          </FormGroup>
        </div>
        {/* Reference address — Vanilla captures Address Line 1/2, City, PIN
            per reference (index.html wstep-7). */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 mt-1">
          <FormGroup label="Address Line 1">
            <TextInput value={data.r1Addr1} onChange={v => onChange({ r1Addr1: v })} placeholder="House / Flat, Street" />
          </FormGroup>
          <FormGroup label="Address Line 2">
            <TextInput value={data.r1Addr2} onChange={v => onChange({ r1Addr2: v })} placeholder="Locality / Landmark" />
          </FormGroup>
          <FormGroup label="City">
            <TextInput value={data.r1City} onChange={v => onChange({ r1City: v })} placeholder="City" />
          </FormGroup>
          <FormGroup label="PIN Code">
            <TextInput value={data.r1Pin} onChange={v => onChange({ r1Pin: v })}
              inputMode="numeric" pattern="\d{6}" digitsOnly placeholder="6-digit PIN" maxLength={6} />
          </FormGroup>
        </div>
      </div>
      <div>
        <p className="wiz-section-head">Reference 2</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4">
          <FormGroup label="Name" required error={errors.r2Name}>
            <TextInput value={data.r2Name} onChange={v => onChange({ r2Name: v })} onBlur={() => touch('r2Name')}
              placeholder="Full name" />
          </FormGroup>
          <FormGroup label="Mobile" required error={errors.r2Mobile}>
            <TextInput value={data.r2Mobile} onChange={v => onChange({ r2Mobile: v })} onBlur={() => touch('r2Mobile')}
              type="tel" inputMode="numeric" pattern="\d{10}" digitsOnly
              placeholder="10-digit mobile" maxLength={10} minLength={10} />
          </FormGroup>
          <FormGroup label="Relationship" required error={errors.r2Relation}>
            <SelectInput value={data.r2Relation} onChange={v => onChange({ r2Relation: v })}
              onBlur={() => touch('r2Relation')}
              options={RELATIONS} placeholder="— Select —" />
          </FormGroup>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 mt-1">
          <FormGroup label="Address Line 1">
            <TextInput value={data.r2Addr1} onChange={v => onChange({ r2Addr1: v })} placeholder="House / Flat, Street" />
          </FormGroup>
          <FormGroup label="Address Line 2">
            <TextInput value={data.r2Addr2} onChange={v => onChange({ r2Addr2: v })} placeholder="Locality / Landmark" />
          </FormGroup>
          <FormGroup label="City">
            <TextInput value={data.r2City} onChange={v => onChange({ r2City: v })} placeholder="City" />
          </FormGroup>
          <FormGroup label="PIN Code">
            <TextInput value={data.r2Pin} onChange={v => onChange({ r2Pin: v })}
              inputMode="numeric" pattern="\d{6}" digitsOnly placeholder="6-digit PIN" maxLength={6} />
          </FormGroup>
        </div>
      </div>
    </div>
  )
}

