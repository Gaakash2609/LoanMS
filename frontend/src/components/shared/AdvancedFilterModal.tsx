import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bookmark, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { filterPresetsApi, type FilterPreset } from '@/api/filterPresetsApi'
import {
  DATE_MODES, CIBIL_BANDS, EMPTY_ADV_FILTER, activeFilterCount,
  type AdvFilter, type DateMode,
} from '@/constants/advFilter'
import type { LoanStatus } from '@/types'
import { NumberInput } from '@/components/ui/NumberInput'

// ── Advanced Filter modal ───────────────────────────────────────────────
// Ports legacy's #modal-adv-filter (openAdvFilter / applyAdvFilter /
// resetAdvFilter / setAdvDate / afSetCibilBand / afSavePreset / afLoadPreset /
// afDeletePreset, efin-app.js:35196-35520).
//
// Kept from legacy: the draft-then-Apply model (edits here do nothing to the
// table until Apply is pressed), the date chip row with a custom range that
// only appears on "Custom", the four CIBIL quick-band buttons that fill the
// min/max pair, the live count of active filters, and preset chips that load
// on click and delete on the ✕.
//
// Every legacy filter field is offered except `leadsrc`, which has no backing
// column anywhere — see AdvFilter's comment in constants/advFilter.ts.

/**
 * A dropdown whose options come from the loaded rows. When the data carries
 * no values for that field the control is disabled and says so, rather than
 * presenting an empty select that looks broken.
 */
function Picker({ label, value, opts, onChange }: {
  label: string; value: string; opts: string[]; onChange: (v: string) => void
}) {
  const empty = opts.length === 0
  return (
    <div>
      <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</label>
      <select
        value={value}
        disabled={empty}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-50 disabled:text-gray-400 focus:outline-none focus:ring-2 focus:ring-efin-blue">
        <option value="">{empty ? 'No values in this data' : 'Any'}</option>
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

const STATUSES: LoanStatus[] = [
  'Draft', 'Submitted', 'UnderReview', 'Offer', 'Decision', 'Approved', 'Acceptance', 'OnHold', 'Rejected', 'Disbursed', 'Closed',
] as LoanStatus[]

// Filter VALUES must be the backend LoanType enum names (the filter is sent
// to the API and bound to LoanType?), not the display-label map's keys —
// LOAN_TYPE_LABELS carries NewCar/UsedCar/AgainstProperty aliases that don't
// exist as enum values and never matched a row. This is the real, valid set.
const LOAN_TYPE_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'Personal',  label: 'Personal Loan' },
  { value: 'Business',  label: 'Business Loan' },
  { value: 'Home',      label: 'Home Loan' },
  { value: 'Car',       label: 'Car Loan' },
  { value: 'Education', label: 'Education Loan' },
  { value: 'LAP',       label: 'Loan Against Property' },
  { value: 'Overdraft', label: 'Overdraft / CC' },
]

/** Distinct values across every loan the user can see (GET /api/loans/filter-options), so every option is real. */
export interface FilterOptions {
  salesPeople: string[]
  locations: string[]
  channels: string[]
  banks: string[]
  purposes: string[]
  empTypes: string[]
  cities: string[]
  states: string[]
  genders: string[]
  dsaNames: string[]
  partners: string[]
  companies: string[]
}

export default function AdvancedFilterModal({
  current, options, onApply, onClose,
}: {
  current: AdvFilter
  options: FilterOptions
  onApply: (f: AdvFilter) => void
  onClose: () => void
}) {
  const qc = useQueryClient()
  // Draft copy — legacy also only commits on Apply.
  const [draft, setDraft] = useState<AdvFilter>(current)
  const [error, setError] = useState('')
  const [presetName, setPresetName] = useState('')
  const [naming, setNaming] = useState(false)

  useEffect(() => { setDraft(current) }, [current])

  const set = <K extends keyof AdvFilter>(k: K, v: AdvFilter[K]) =>
    setDraft(d => ({ ...d, [k]: v }))

  const { data: presets } = useQuery({
    queryKey: ['filter-presets'],
    queryFn: () => filterPresetsApi.getAll(),
    staleTime: 60_000,
  })
  const list = presets ?? []

  const writePresets = useMutation({
    mutationFn: (next: FilterPreset[]) => filterPresetsApi.saveAll(next),
    onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: ['filter-presets'] }) },
    onError: () => setError('Could not save presets. Please try again.'),
  })

  function savePreset() {
    const name = presetName.trim()
    if (!name) { setError('Give the preset a name.'); return }
    if (activeFilterCount(draft) === 0) { setError('No active filters to save as a preset.'); return }
    setError('')
    // Legacy replaces a same-named preset rather than duplicating it.
    writePresets.mutate([...list.filter(p => p.name !== name), { name, filters: draft }])
    setPresetName(''); setNaming(false)
  }

  // Legacy setAdvDate: picking a chip also toggles the custom-range row, and
  // leaving Custom clears the two dates so a stale range can't linger.
  function pickDate(mode: DateMode) {
    setDraft(d => ({
      ...d,
      dateMode: d.dateMode === mode ? '' : mode,
      ...(mode === 'custom' ? {} : { dateFrom: '', dateTo: '' }),
    }))
  }

  const count = activeFilterCount(draft)
  const cibilBandActive = (b: { min: number; max: number }) =>
    draft.cibilMin === String(b.min) && draft.cibilMax === String(b.max)

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue'
  const labelCls = 'block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1'

  return (
    <Modal
      open
      onClose={onClose}
      title="Advanced Filters"
      subtitle={count ? `${count} filter${count > 1 ? 's' : ''} active` : 'No filters applied'}
      size="xl"
      className="sm:max-w-3xl"
      footer={<>
        <Button size="sm" onClick={() => onApply(draft)}>
          Apply Filters{count ? ` (${count})` : ''}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setDraft(EMPTY_ADV_FILTER)}>
          <RotateCcw size={13} className="mr-1" />Reset
        </Button>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
      </>}
    >
      <div className="space-y-5">
            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

            {/* ── Saved presets ── */}
            <div>
              <p className={labelCls}>Saved Presets</p>
              <div className="flex flex-wrap items-center gap-2">
                {list.length === 0 && (
                  <span className="text-[11.5px] italic text-gray-400">No saved presets yet</span>
                )}
                {list.map(p => (
                  <span key={p.name}
                    className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold"
                    style={{ background: 'var(--accent-subtle)', borderColor: 'rgba(10,88,154,.2)', color: 'var(--accent)' }}>
                    <button onClick={() => setDraft({ ...EMPTY_ADV_FILTER, ...p.filters })} title="Load preset">
                      {p.name}
                    </button>
                    <button
                      onClick={() => writePresets.mutate(list.filter(x => x.name !== p.name))}
                      title="Delete preset"
                      className="opacity-50 hover:opacity-100 text-[10px]">✕</button>
                  </span>
                ))}

                {naming ? (
                  <span className="inline-flex items-center gap-1.5">
                    <input autoFocus value={presetName} onChange={e => setPresetName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') savePreset() }}
                      placeholder="Preset name" className="border border-gray-200 rounded-lg px-2 py-1 text-xs w-36" />
                    <Button size="sm" onClick={savePreset} loading={writePresets.isPending}>Save</Button>
                    <button className="text-xs text-gray-400 hover:text-gray-600"
                      onClick={() => { setNaming(false); setPresetName(''); setError('') }}>Cancel</button>
                  </span>
                ) : (
                  <button onClick={() => setNaming(true)}
                    className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-efin-blue hover:underline">
                    <Bookmark size={12} />Save current as preset
                  </button>
                )}
              </div>
            </div>

            {/* ── Date ── */}
            <div>
              <p className={labelCls}>Date</p>
              <div className="flex flex-wrap gap-1.5">
                {DATE_MODES.map(d => (
                  <button key={d.mode} onClick={() => pickDate(d.mode)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      draft.dateMode === d.mode
                        ? 'bg-efin-blue text-white border-efin-blue'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}>
                    {d.label}
                  </button>
                ))}
              </div>
              {draft.dateMode === 'custom' && (
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className={labelCls}>From</label>
                    <input type="date" className={inputCls} value={draft.dateFrom}
                      onChange={e => set('dateFrom', e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>To</label>
                    <input type="date" className={inputCls} value={draft.dateTo}
                      onChange={e => set('dateTo', e.target.value)} />
                  </div>
                </div>
              )}
            </div>

            {/* ── Core fields ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Status</label>
                <select className={inputCls} value={draft.status} onChange={e => set('status', e.target.value)}>
                  <option value="">All statuses</option>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Loan Type</label>
                <select className={inputCls} value={draft.loanType} onChange={e => set('loanType', e.target.value)}>
                  <option value="">All types</option>
                  {LOAN_TYPE_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Sales Person</label>
                <select className={inputCls} value={draft.salesPerson} onChange={e => set('salesPerson', e.target.value)}>
                  <option value="">Anyone</option>
                  {options.salesPeople.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Min Amount (₹)</label>
                  <NumberInput min="0" className={inputCls} value={draft.amountMin}
                    onChange={e => set('amountMin', e.target.value)} placeholder="0" />
                </div>
                <div>
                  <label className={labelCls}>Max Amount (₹)</label>
                  <NumberInput min="0" className={inputCls} value={draft.amountMax}
                    onChange={e => set('amountMax', e.target.value)} placeholder="Any" />
                </div>
              </div>
            </div>

            {/* ── CIBIL ── */}
            <div>
              <p className={labelCls}>CIBIL Score</p>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {CIBIL_BANDS.map(b => (
                  <button key={b.label}
                    onClick={() => setDraft(d => cibilBandActive(b)
                      ? { ...d, cibilMin: '', cibilMax: '' }
                      : { ...d, cibilMin: String(b.min), cibilMax: String(b.max) })}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      cibilBandActive(b)
                        ? 'bg-efin-blue text-white border-efin-blue font-extrabold'
                        : 'bg-white text-gray-600 border-gray-200 font-semibold opacity-70 hover:opacity-100'
                    }`}>
                    {b.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>CIBIL Min</label>
                  <NumberInput min="300" max="900" className={inputCls} value={draft.cibilMin}
                    onChange={e => set('cibilMin', e.target.value)} placeholder="300" />
                </div>
                <div>
                  <label className={labelCls}>CIBIL Max</label>
                  <NumberInput min="300" max="900" className={inputCls} value={draft.cibilMax}
                    onChange={e => set('cibilMax', e.target.value)} placeholder="900" />
                </div>
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">
                Applications whose customer has no bureau score on file are excluded when a CIBIL filter is set.
              </p>
            </div>

            {/* ── Applicant ── */}
            <div>
              <p className={labelCls}>Applicant</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Picker label="Employment" value={draft.empType} opts={options.empTypes} onChange={v => set('empType', v)} />
                <Picker label="Gender" value={draft.gender} opts={options.genders} onChange={v => set('gender', v)} />
                <Picker label="Company" value={draft.companyName} opts={options.companies} onChange={v => set('companyName', v)} />
                <Picker label="City" value={draft.city} opts={options.cities} onChange={v => set('city', v)} />
                <Picker label="State" value={draft.state} opts={options.states} onChange={v => set('state', v)} />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Salary ≥</label>
                    <NumberInput min="0" className={inputCls} value={draft.salaryMin}
                      onChange={e => set('salaryMin', e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <label className={labelCls}>Salary ≤</label>
                    <NumberInput min="0" className={inputCls} value={draft.salaryMax}
                      onChange={e => set('salaryMax', e.target.value)} placeholder="Any" />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Sourcing ── */}
            <div>
              <p className={labelCls}>Sourcing</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Picker label="Location" value={draft.location} opts={options.locations} onChange={v => set('location', v)} />
                <Picker label="Channel" value={draft.channel} opts={options.channels} onChange={v => set('channel', v)} />
                <Picker label="Bank / Lender" value={draft.bank} opts={options.banks} onChange={v => set('bank', v)} />
                <Picker label="DSA" value={draft.dsaName} opts={options.dsaNames} onChange={v => set('dsaName', v)} />
                <Picker label="Linked Partner" value={draft.linkedPartner} opts={options.partners} onChange={v => set('linkedPartner', v)} />
                <Picker label="Purpose" value={draft.purpose} opts={options.purposes} onChange={v => set('purpose', v)} />
              </div>
            </div>
      </div>
    </Modal>
  )
}
