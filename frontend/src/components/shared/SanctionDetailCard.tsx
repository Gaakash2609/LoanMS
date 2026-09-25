import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Lock, Pencil, Check } from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/Card'
import { InlineLoader } from '@/components/ui/LoadingSpinner'
import { loansApi } from '@/api/loansApi'
import { offerWorkflowApi } from '@/api/offerWorkflowApi'
import { workflowKey } from '@/components/shared/OffersTab'
import { useAuthStore } from '@/store/authStore'
import { formatCurrency } from '@/utils/format'
import { computeBundledAmount, flatRateFromReducing } from '@/utils/emi'
import type { Loan, LoanStatus, UserRole } from '@/types'
import { LOAN_KEYS } from '@/hooks/useLoans'
import { NumberInput } from '@/components/ui/NumberInput'

// ── EMI Date — recurring day-of-month, NOT a calendar date ─────────────────
// Legacy source of truth (efin-app.js `sanctionEMIDate`, synced via
// approvalFieldSave's fieldMap -> `emiDate`) is a fixed 10-option day-of-month
// select — 1,2,3,4,5,7,10,15,20,25 — defaulting to the 3rd. It is never a full
// calendar date. The backend column (LoanSanctionDetail.EmiDate) is a
// `DateTime?`, so the day is carried inside a throwaway YYYY-MM-DD string
// (fixed dummy month, only the day is meaningful); both directions use plain
// string slicing, never `new Date(...)`, so there is no timezone day shift.
const EMI_DATE_DAYS = [1, 2, 3, 4, 5, 7, 10, 15, 20, 25]
const EMI_DATE_ANCHOR_MONTH = '2000-01'
const emiDateOptionLabel = (d: number) => `${d === 1 ? '1st' : d === 2 ? '2nd' : d === 3 ? '3rd' : d + 'th'} of every Month`
const emiDayFromIso = (iso?: string | null) => (iso ? String(parseInt(iso.slice(8, 10), 10)) : '3')
const emiDayToIso = (day: string) => `${EMI_DATE_ANCHOR_MONTH}-${day.padStart(2, '0')}`

// ── Approval Details / CAM — full Vanilla parity ───────────────────────────
// Editor mirrors legacy renderDetailApproval (efin-app.js:7332) field-for-field
// (order, labels, input types, toggles) and reproduces legacy's EXACT
// recalculation TRIGGERS:
//   • dvAutoRecalc  → Bundled Loan Amount, recomputed whenever Loan Amount,
//     Processing Fee %, Insurance, GST, or a bundle toggle changes.
//   • dvAutoFlatRate → Flat Reducing Rate, recomputed ONLY when ROI changes
//     (using the current tenure), unless the user has typed a manual override.
//   • EMI has NO auto-recalc in legacy (there is no dvAutoEmi) — it is the
//     sanctioned EMI captured at approval, shown editable but never
//     recomputed by the CAM. It is seeded once from the persisted value (or a
//     one-time reducing-balance calc) and thereafter only changes when typed.
// Money math is the shared utils/emi (computeBundledAmount for the bundled
// amount, flatRateFromReducing for the ROI→flat conversion) — byte-identical to
// legacy dvAutoRecalc / dvAutoFlatRate. EMI is NOT computed here (see below).
//
// The sanctioned Loan Amount / Tenure / ROI / EMI persist on the
// LoanSanctionDetail row (SanctionLoanAmt/SanctionTenureMonths/SanctionRoi/
// SanctionEmi) — legacy kept these in browser memory only (they reset on
// reload); here they survive a refresh. They fall back to the loan's
// Approved amount, TenureMonths and InterestRate when unset. This card is only
// mounted once the loan has reached the Approved/Sanction stage (see
// utils/loanStage + LoanDetailPage), so it never seeds from the requested amount.
//
// Save is legacy's per-edit debounce (approvalFieldSave, ~900ms) with no Save
// button. Legacy debounced a single field per edit (and dropped earlier edits
// in the same window); this sends the whole current payload each debounce, so
// no rapid multi-field edit is ever lost — a superset of legacy's behaviour.

// ── Edit permission (offer-workflow business decision, 2026-09-25) ────────
// Sanction paperwork may be changed only by the 4 sanction authorities —
// Chief Administrator, Zonal Manager, Credit Evaluation Manager, Credit
// Evaluation Officer — only after credit approval (Approved / Acceptance), and
// never while an immutable Sanction is active (a correction is then a sanction
// Amendment in the Offers tab). This supersedes the earlier Vanilla-parity CAM
// rule; PUT /sanction-detail enforces exactly the same thing (403 / 409).
const SANCTION_AUTHORITY_ROLES: ReadonlyArray<UserRole> = ['Admin', 'LocationHead', 'OperationManager', 'LoginTeam']
const SANCTION_EDIT_STATUSES: ReadonlyArray<LoanStatus> = ['Approved', 'Acceptance']

const num = (s: string) => parseFloat(s) || 0
// Read-only formatters mirror legacy's fmt/pct (efin-app.js:7365-7366): a
// falsy/unset value renders as an em-dash, never "₹0" or "0%".
const pct = (n: number) => (n ? `${n}%` : '—')
const fmt = (n: number) => (n ? formatCurrency(n) : '—')

export default function SanctionDetailCard({ loan }: { loan: Loan }) {
  const qc = useQueryClient()
  const sd = loan.sanctionDetail

  // ── Permission gate — mirrors LoansController.UpdateSanctionDetail ───────
  const user = useAuthStore(s => s.user)
  const role = user?.role
  const isAuthority = !!role && SANCTION_AUTHORITY_ROLES.includes(role)
  const stageOk = SANCTION_EDIT_STATUSES.includes(loan.status)
  const { data: workflow } = useQuery({
    queryKey: workflowKey(loan.id),
    queryFn: () => offerWorkflowApi.get(loan.id).then(r => r.data.data ?? null),
    enabled: isAuthority && stageOk,
  })
  const sanctionActive = !!workflow?.sanctions.some(x => x.status === 'Active')
  const canEdit = isAuthority && stageOk && !!workflow && !sanctionActive

  // ── Seeds ─────────────────────────────────────────────────────────────────
  // Legacy's CAM seeds every field from `app.sanction* || ''` (empty when the
  // approval modal hasn't set it). Legacy also copies the sanctioned terms into
  // app.sanction* at approval time; React does NOT snapshot them, so the loan's
  // own approved/requested figures ARE the sanctioned terms until overridden.
  // Loan Amount / Tenure / ROI therefore fall back to the loan's stored values;
  // EMI falls back to the loan's stored MonthlyEmi (a stored value, never a live
  // recompute); Flat has no loan counterpart, so it is empty until ROI is
  // touched — matching legacy where the flat field is blank until dvAutoFlatRate
  // runs. Nothing here is calculated on mount (legacy calculates neither flat
  // nor EMI at render — only on ROI change / at approval).
  const seedLoanAmt = sd?.sanctionLoanAmt ?? loan.approvedAmount ?? 0
  const seedTenure = sd?.sanctionTenureMonths ?? loan.tenureMonths ?? 0
  const seedRoi = sd?.sanctionRoi ?? loan.interestRate ?? 0
  const seedPfIn = !!sd?.pfInBundled
  const seedInsIn = !!sd?.insuranceInBundled

  // ── Editable state (strings for inputs) ──────────────────────────────────
  const [loanAmt, setLoanAmt] = useState(seedLoanAmt ? String(seedLoanAmt) : '')
  const [tenureMo, setTenureMo] = useState(seedTenure ? String(seedTenure) : '')
  const [roiPct, setRoiPct] = useState(seedRoi ? String(seedRoi) : '')
  // Flat: legacy `app.sanctionFlatRate || ''` + `data-manual` on presence.
  const [flatStr, setFlatStr] = useState(sd?.flatRate != null ? String(sd.flatRate) : '')
  const [flatManual, setFlatManual] = useState(sd?.flatRate != null)
  const [pfPercent, setPfPercent] = useState(sd?.pfPercent != null ? String(sd.pfPercent) : '')
  // EMI: legacy `app.sanctionEMI || ''` (never computed in the CAM). Falls back
  // to the loan's stored MonthlyEmi (a value, not a recompute) when no sanctioned
  // EMI has been saved.
  const [emiStr, setEmiStr] = useState(
    sd?.sanctionEmi != null ? String(sd.sanctionEmi)
      : loan.monthlyEmi != null ? String(Math.round(loan.monthlyEmi)) : '',
  )
  const [emiDay, setEmiDay] = useState(emiDayFromIso(sd?.emiDate))
  const [insurance, setInsurance] = useState(sd?.insurance != null ? String(sd.insurance) : '')
  const [insInBundled, setInsInBundled] = useState(seedInsIn)
  const [pfInBundled, setPfInBundled] = useState(seedPfIn)
  const [isBt, setIsBt] = useState(!!sd?.isBt)
  // Legacy GST default is `app.sanctionGST || 18` (a 0 falls back to 18).
  const [gst, setGst] = useState(sd?.gst ? String(sd.gst) : '18')
  const [stampDuty, setStampDuty] = useState(sd?.stampDuty ?? 'As per government applicable')

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState('')

  // ── Derived: Bundled (legacy dvAutoRecalc — reactive to LoanAmt/PF/GST/
  // Insurance/toggles ONLY, exactly like legacy). Flat & EMI are NOT derived —
  // they live in state and are re-filled only by their legacy trigger. ───────
  const loanAmtNum = num(loanAmt)
  const tenureNum = parseInt(tenureMo, 10) || 0
  const roiNum = num(roiPct)
  const pfNum = num(pfPercent)
  const gstNum = gst === '' ? 18 : num(gst)
  const insNum = num(insurance)
  const { bundled } = computeBundledAmount({
    amount: loanAmtNum, pfPercent: pfNum, gstPercent: gstNum, insurance: insNum,
    pfInBundled, insuranceInBundled: insInBundled,
  })
  const flatNum = num(flatStr)
  const emiNum = num(emiStr)

  // ── ROI change → re-fill Flat Rate from ROI (legacy dvAutoFlatRate), unless
  // the user has overridden it. This is the ONLY auto-trigger for flat — a
  // tenure-only change does not move it, matching legacy exactly. ────────────
  const onRoiChange = (v: string) => {
    setRoiPct(v)
    if (!flatManual) setFlatStr(String(flatRateFromReducing(num(v), tenureNum)))
  }

  // ── Per-field auto-save (legacy approvalFieldSave: debounced, no button) ──
  const payloadRef = useRef<Parameters<typeof loansApi.updateSanctionDetail>[1]>({})
  payloadRef.current = {
    sanctionLoanAmt: loanAmtNum || null,
    sanctionTenureMonths: tenureNum || null,
    sanctionRoi: roiNum || null,
    sanctionEmi: emiStr.trim() ? emiNum : null,
    pfPercent: pfNum,
    gst: gstNum,
    insurance: insNum,
    pfInBundled,
    insuranceInBundled: insInBundled,
    isBundled: pfInBundled || insInBundled,
    isBt,
    flatRate: flatStr.trim() ? flatNum : null,
    emiDate: emiDayToIso(emiDay),
    stampDuty: stampDuty.trim() || null,
  }

  const save = useCallback(async () => {
    try {
      setSaveState('saving'); setError('')
      await loansApi.updateSanctionDetail(loan.id, payloadRef.current)
      setSaveState('saved')
      qc.invalidateQueries({ queryKey: LOAN_KEYS.detail(loan.id) })
      qc.invalidateQueries({ queryKey: ['loans'] })
    } catch (e: unknown) {
      setSaveState('error')
      const d = (e as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      setError(d?.message || d?.errors?.join(' ') || 'Sanction details could not be saved.')
    }
  }, [loan.id, qc])

  const firstRun = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const sig = JSON.stringify([
    loanAmt, tenureMo, roiPct, flatStr, pfPercent, emiStr,
    emiDay, insurance, insInBundled, pfInBundled, isBt, gst, stampDuty,
  ])
  useEffect(() => {
    if (!canEdit) return
    if (firstRun.current) { firstRun.current = false; return }
    setSaveState('saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { void save() }, 900)
    return () => clearTimeout(timer.current)
  }, [sig, canEdit, save])

  // ── UI helpers ────────────────────────────────────────────────────────────
  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500'
  const labelCls = 'text-xs font-medium text-gray-600 block mb-1'

  const PillToggle = ({ on, onLabel, offLabel, onClick }: { on: boolean; onLabel: string; offLabel: string; onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] font-bold whitespace-nowrap transition-colors"
      style={{
        background: on ? 'rgba(10,88,154,.11)' : 'rgba(122,138,170,.10)',
        borderColor: on ? 'rgba(10,88,154,.35)' : 'rgba(122,138,170,.3)',
        color: on ? 'var(--accent)' : 'var(--text3, #7a8aaa)',
      }}
    >
      <span className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: on ? 'var(--accent)' : 'var(--text3, #7a8aaa)' }} />
      {on ? onLabel : offLabel}
    </button>
  )

  const Tile = ({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) => (
    <div className="rounded-xl border border-gray-100 bg-white px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-lg font-semibold" style={accent ? { color: accent } : undefined}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )

  return (
    <Card>
      <CardHeader
        title={<><span className="section-icon-badge"><FileText size={15} /></span> Sanction Details</>}
        subtitle="Sanctioned terms, fees & the bundled loan amount the EMI is charged on"
      />

      {/* Lock-state hint — legacy approval-section-lock-label (efin-app.js:7357). */}
      <div className="mb-3 flex items-center justify-between gap-2 text-xs">
        {canEdit ? (
          <span className="inline-flex items-center gap-1 font-medium" style={{ color: 'var(--success)' }}>
            <Pencil size={12} /> Editable by your role — changes are saved automatically
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-gray-500">
            <Lock size={12} />
            {sanctionActive
              ? 'View-only — the sanction is generated and immutable; use Amendment in the Offers tab to correct it'
              : !isAuthority
                ? 'View-only — only the Chief Administrator, Zonal Manager and Credit Evaluation Manager / Officer edit sanction terms'
                : `View-only — sanction terms are recorded after credit approval (application is ${loan.status})`}
          </span>
        )}
        {canEdit && (
          <span className="inline-flex items-center gap-1 text-[11px]">
            {saveState === 'saving' && <><InlineLoader size={12} className="text-gray-400" /><span className="text-gray-400">Saving…</span></>}
            {saveState === 'saved' && <><Check size={12} style={{ color: 'var(--success)' }} /><span style={{ color: 'var(--success)' }}>Saved</span></>}
            {saveState === 'error' && <span className="text-red-600">Save failed</span>}
          </span>
        )}
      </div>

      {canEdit ? (
        /* ── Editable inline grid — legacy renderDetailApproval editable form ── */
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3">
          <div>
            <label className={labelCls}>Loan Amount (₹)</label>
            <NumberInput min="0" step="1" value={loanAmt} onChange={e => setLoanAmt(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Tenure (Months)</label>
            <NumberInput min="1" step="1" value={tenureMo} onChange={e => setTenureMo(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Rate of Interest — Annual (%)</label>
            <NumberInput min="0" step="0.01" value={roiPct} onChange={e => onRoiChange(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Flat Reducing Rate (%)</label>
            <NumberInput min="0" step="0.01" value={flatStr}
              onChange={e => { const v = e.target.value; setFlatManual(v.trim() !== ''); setFlatStr(v) }}
              className={inputCls}
            />
            <p className="mt-0.5 text-[10px] italic text-gray-400">
              {flatManual ? 'Saved value — edit to override' : 'Auto from ROI'}
            </p>
          </div>
          <div>
            <label className={labelCls}>Processing Fee (%)</label>
            <NumberInput min="0" step="0.01" value={pfPercent} onChange={e => setPfPercent(e.target.value)} className={inputCls} placeholder="e.g. 1.5" />
          </div>
          <div>
            <label className={labelCls}>EMI (Calculated — Rounded) ₹</label>
            <NumberInput min="0" step="1" value={emiStr} onChange={e => setEmiStr(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>EMI Date</label>
            <select value={emiDay} onChange={e => setEmiDay(e.target.value)} className={inputCls}>
              {EMI_DATE_DAYS.map(d => <option key={d} value={String(d)}>{emiDateOptionLabel(d)}</option>)}
            </select>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between gap-1">
              <label className="text-xs font-medium text-gray-600">Insurance Amount (₹)</label>
              <PillToggle on={insInBundled} onLabel="+ Insurance: ON" offLabel="+ Insurance: OFF" onClick={() => setInsInBundled(v => !v)} />
            </div>
            <NumberInput min="0" step="1" value={insurance} onChange={e => setInsurance(e.target.value)} className={inputCls} placeholder="0" />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between gap-1">
              <label className="text-xs font-medium text-gray-600">Bundled Loan Amount (₹)</label>
              <PillToggle on={pfInBundled} onLabel="+ Proc. Fee: ON" offLabel="+ Proc. Fee: OFF" onClick={() => setPfInBundled(v => !v)} />
            </div>
            {/* Read-only computed — legacy dvAutoRecalc overwrites this field on
                any source change and never persists a manual value (only the
                bundle flag persists), so it is always the computed amount. */}
            <NumberInput value={bundled || ''} readOnly disabled className={inputCls} />
            <p className="mt-0.5 text-[10px] italic text-gray-400">
              {bundled > loanAmtNum ? `+${formatCurrency(bundled - loanAmtNum)} financed` : 'Auto — no add-ons financed'}
            </p>
          </div>
          <div>
            <label className={labelCls}>BT (Balance Transfer)</label>
            <select value={isBt ? 'YES' : 'NO'} onChange={e => setIsBt(e.target.value === 'YES')} className={inputCls}>
              <option value="NO">NO</option>
              <option value="YES">YES</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>GST Applicable (%)</label>
            <NumberInput min="0" step="0.01" value={gst} onChange={e => setGst(e.target.value)} className={inputCls} placeholder="18" />
          </div>
          <div>
            <label className={labelCls}>Stamp Duty</label>
            <input type="text" value={stampDuty} onChange={e => setStampDuty(e.target.value)} className={inputCls} placeholder="As per government applicable" />
          </div>
        </div>
      ) : (
        /* ── Read-only grid — legacy renderDetailApproval read-only fieldGrid
             (efin-app.js:7472-7488): same rows, labels and formats. ── */
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Tile label="Loan Amount" value={fmt(loanAmtNum)} sub={sd?.sanctionLoanAmt != null ? 'Sanctioned' : loan.approvedAmount != null ? 'Approved' : undefined} accent="var(--accent)" />
          <Tile label="Tenure (Years)" value={tenureNum ? `${+(tenureNum / 12).toFixed(1)} yrs` : '—'} accent="var(--text2)" />
          <Tile label="Tenure (Months)" value={tenureNum ? `${tenureNum} months` : '—'} accent="var(--text2)" />
          <Tile label="Rate of Interest (Annual)" value={pct(roiNum)} accent="var(--text2)" />
          <Tile label="Flat Reducing Rate" value={pct(flatNum)} accent="var(--text2)" />
          <Tile label="Processing Fee" value={pct(pfNum)} accent="var(--warn)" />
          <Tile label="EMI (Calculated)" value={fmt(emiNum)} accent="var(--accent3)" />
          <Tile label="EMI Date" value={sd?.emiDate ? emiDateOptionLabel(parseInt(emiDay, 10) || 3) : '—'} accent="var(--text2)" />
          <Tile label="Insurance" value={fmt(insNum)} accent="#a159ff" />
          <Tile label="Bundled Loan Amount" value={fmt(bundled)} sub={bundled > loanAmtNum ? `+${formatCurrency(bundled - loanAmtNum)} financed` : undefined} accent="var(--success)" />
          <Tile label="Proc. Fee in Bundled" value={pfInBundled ? '✅ Included' : '— Excluded'} accent="var(--text2)" />
          <Tile label="Insurance in Bundled" value={insInBundled ? '✅ Included' : '— Excluded'} accent="var(--text2)" />
          <Tile label="BT (Balance Transfer)" value={isBt ? 'YES' : 'NO'} accent="var(--text2)" />
          <Tile label="GST Applicable" value={pct(gstNum)} accent="var(--text2)" />
          <Tile label="Stamp Duty" value={stampDuty || '—'} accent="var(--text2)" />
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Card>
  )
}
