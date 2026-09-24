// Step1 — extracted verbatim from NewApplicationPage.tsx (code-quality
// refactor, no behaviour change).

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { wizardApi } from '@/api/wizardApi'
import { loansApi } from '@/api/loansApi'
import { CHANNELS, LEAD_SOURCES } from '@/pages/wizard/wizardConstants'
import { FormGroup, TextInput, SelectInput } from '@/pages/wizard/WizardFields'
import type { WizardData } from '@/pages/wizard/wizardTypes'
import { roleTitle } from '@/pages/users/userConstants'

export function Step1({ data, onChange, errors, touch }: {
  data: WizardData
  onChange: (f: Partial<WizardData>) => void
  errors: Record<string, string>
  touch: (field: string) => void
}) {
  const { data: locations } = useQuery({
    queryKey: ['wizard-locations'],
    queryFn: () => wizardApi.getLocations().then(r => r.data.data ?? []),
    staleTime: 300_000,
  })
  const { data: usersResp } = useQuery({
    queryKey: ['wizard-users'],
    queryFn: () => wizardApi.getUsers().then(r => r.data.data ?? []),
    staleTime: 300_000,
  })
  const { data: dsaPartnerList } = useQuery({
    queryKey: ['wizard-dsa'],
    queryFn: () => wizardApi.getDsaPartners().then(r => r.data.data ?? []),
    staleTime: 300_000,
    enabled: data.channel === 'dsa' || data.channel === 'agent',
  })
  const dsaList     = (dsaPartnerList ?? []).filter(d => d.partnerType === 'Dsa')
  const partnerList = (dsaPartnerList ?? []).filter(d => d.partnerType === 'Partner')

  // ── Live PAN duplicate check ────────────────────────────────────────────
  // Ports legacy wPanCheck() (efin-app.js:7155), wired in index.html:1491 on
  // the PAN field's oninput. Legacy checked its own local APPLICATIONS cache
  // first and fell back to the server; there is no such client-side cache
  // here, so it goes straight to the authoritative endpoint — which legacy's
  // own comment calls the reliable one. Warning-only: it must never block
  // submission, exactly like legacy.
  //
  // The query key carries the PAN, so a result for a PAN the user has since
  // typed past can never render — that is legacy's `stillPan !== pan` guard,
  // handled structurally instead of with a manual re-read.
  const panForCheck = (data.pan || '').trim().toUpperCase()
  const { data: panDuplicate } = useQuery({
    queryKey: ['loan-duplicate-check', panForCheck],
    queryFn: () => loansApi.duplicateCheck(panForCheck).then(r => r.data.data),
    enabled: panForCheck.length === 10,
    staleTime: 60_000,
    retry: false,
  })

  // Vanilla parity (wLocationChange, efin-app.js:6937-6962): the Sales Person
  // dropdown lists only users at the SELECTED location whose role is a sales
  // role — Vanilla's 'Sales Person' / 'Team Leader', which map to React's
  // UserRole.Sales / UserRole.TeamLeader. Before a location is chosen the list
  // is empty (Vanilla only populates it on location change). Location match is
  // by LocationId FK (more robust than Vanilla's by-name compare).
  const salesRoleOk = (r: string) => r === 'Sales' || r === 'TeamLeader'
  const salesUsers = data.location
    ? (usersResp ?? []).filter(u => salesRoleOk(u.role) && u.locationId != null && String(u.locationId) === data.location)
    : []
  const noSalesForLocation = !!data.location && salesUsers.length === 0

  return (
    <div className="space-y-6">
      {/* UX grouping only: applicant/lead information is kept visually separate
          from the internal assignment fields. Vanilla mixes all of these in one
          grid — the grouping is a React clarity improvement; no field, option
          or validation rule is changed. */}
      <section>
        <p className="wiz-section-head">Customer &amp; Lead Details</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6">
      <FormGroup label="Mobile Number" required error={errors.mobile}>
        <TextInput value={data.mobile} onChange={v => onChange({ mobile: v })} onBlur={() => touch('mobile')}
          placeholder="10-digit mobile" maxLength={10} minLength={10}
          type="tel" inputMode="numeric" pattern="\d{10}" digitsOnly />
      </FormGroup>

      <FormGroup label="PAN Card Number" required error={errors.pan}>
        {/* Vanilla only uppercases (CSS) + maxlength 10 — no character stripping,
            no format pattern (validateStep(1) checks length === 10 only). */}
        <TextInput value={data.pan} onChange={v => onChange({ pan: v.toUpperCase() })}
          onBlur={() => touch('pan')}
          placeholder="ABCDE1234F" maxLength={10} minLength={10}
          className="uppercase font-mono" />
        {/* Same amber warning-strip legacy shows in #w-pan-dup-alert. Advisory
            only — nothing here disables Next or fails validation. */}
        {panDuplicate?.hasDuplicate && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
            <span>
              Customer has a recent <strong>{panDuplicate.status}</strong> application
              {panDuplicate.loanNumber ? <> (<span className="font-mono">{panDuplicate.loanNumber}</span>
              {panDuplicate.customerName ? ` — ${panDuplicate.customerName}` : ''})</> : null}
              {panDuplicate.daysAgo != null ? `. Created ${panDuplicate.daysAgo} days ago.` : '.'}
            </span>
          </div>
        )}
      </FormGroup>

      <FormGroup label="Channel">
        <SelectInput value={data.channel}
          onChange={v => onChange({ channel: v, dsaName: '', dsaId: '', partnerId: '', dsaLinkedPartner: '', leadsrc: '' })}
          options={CHANNELS} placeholder="— Select Channel —" />
      </FormGroup>

      {data.channel === 'dsa' && (
        <FormGroup label="DSA Name" required error={errors.dsaId}>
          <SelectInput
            value={data.dsaId}
            onChange={v => {
              const selected = dsaList.find(d => String(d.id) === v)
              onChange({ dsaId: v, dsaName: selected?.name ?? '' })
            }}
            onBlur={() => touch('dsaId')}
            options={dsaList.map(d => ({ value: String(d.id), label: `${d.name} (${d.code})` }))}
            placeholder="— Select DSA —"
          />
        </FormGroup>
      )}

      {/* Linked Partner (optional) — Vanilla's #w-dsa-partner-group, shown with
          the DSA Name field for the DSA channel (index.html:1538-1542). Optional;
          value persisted via productData (no dedicated backend column). */}
      {data.channel === 'dsa' && (
        <FormGroup label="Linked Partner (optional)">
          <SelectInput
            value={data.dsaLinkedPartner}
            onChange={v => onChange({ dsaLinkedPartner: v })}
            options={partnerList.map(p => ({ value: String(p.id), label: `${p.name} (${p.code})` }))}
            placeholder="— Select Linked Partner —"
          />
        </FormGroup>
      )}

      {data.channel === 'agent' && (
        <FormGroup label="Partner / Agent Name" required error={errors.partnerId}>
          <SelectInput
            value={data.partnerId}
            onChange={v => onChange({ partnerId: v })}
            onBlur={() => touch('partnerId')}
            options={partnerList.map(p => ({ value: String(p.id), label: `${p.name} (${p.code})` }))}
            placeholder="— Select Partner —"
          />
        </FormGroup>
      )}

      {/* Direct channel — Vanilla shows a read-only confirmation chip of the
          selected Sales Person (#w-direct-sales-group, efin-app.js:6837-6844). */}
      {data.channel === 'direct' && (
        <FormGroup label="Sales Person">
          <div className="flex items-center gap-2.5 rounded-lg border border-efin-blue/20 bg-efin-blue/5 px-3.5 py-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-efin-blue to-[#1a72b8] text-[13px] font-bold text-white">
              {data.salesPerson ? data.salesPerson.charAt(0).toUpperCase() : '—'}
            </span>
            <div>
              <div className="text-[13px] font-semibold text-gray-900">{data.salesPerson || '— Select Sales Person above —'}</div>
              <div className="text-[11px] text-gray-400">Direct Channel</div>
            </div>
            <span className="ml-auto rounded-full bg-efin-blue/10 px-2.5 py-0.5 text-[10.5px] font-semibold text-efin-blue">Direct</span>
          </div>
        </FormGroup>
      )}

      {/* Lead Source — Vanilla shows this ONLY for the Online channel
          (wChannelChange: leadsrcGrp shown only when val==='online', and
          cleared on any other channel — efin-app.js:6835-6836, 6863-6865).
          React previously showed it for every channel. Options copied verbatim;
          persisted via the productData bag (no backend column). */}
      {data.channel === 'online' && (
        <FormGroup label="Lead Source">
          <SelectInput value={data.leadsrc}
            onChange={v => onChange({ leadsrc: v })}
            options={LEAD_SOURCES} placeholder="Select" />
        </FormGroup>
      )}
        </div>
      </section>

      <section>
        <p className="wiz-section-head">Internal Assignment</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6">
          <FormGroup label="Location" required error={errors.location}>
            <SelectInput
              value={data.location}
              onChange={v => onChange({ location: v, salesPerson: '' })}
              onBlur={() => touch('location')}
              options={(locations ?? []).map(l => ({ value: String(l.id), label: `${l.name} — ${l.city}` }))}
              placeholder="— Select Location —"
            />
          </FormGroup>
          <FormGroup label="Sales Person" required error={errors.salesPerson}>
            <SelectInput
              value={data.salesPerson}
              onChange={v => onChange({ salesPerson: v })}
              onBlur={() => touch('salesPerson')}
              options={salesUsers.map(u => ({ value: u.fullName, label: `${u.fullName} (${roleTitle(u.role)})` }))}
              placeholder={data.location ? '— Select Sales Person —' : '— Select a Location first —'}
            />
            {/* Vanilla hint (efin-app.js:6960) when a location has no sales staff. */}
            {noSalesForLocation && (
              <div className="mt-1 text-[11px] text-gray-400">
                No Sales Person or Team Leader found for this location yet — add one under Users, or pick a different location.
              </div>
            )}
          </FormGroup>
        </div>
      </section>
    </div>
  )
}

