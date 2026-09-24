import { useState, useEffect } from 'react'
import { SkeletonText } from '@/components/ui/Skeleton'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, RotateCcw, Save } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { settingsApi } from '@/api/settingsApi'
import {
  CAM_MATRIX_DEFAULT, CAM_MATRIX_SETTING_KEY, CAM_MATRIX_SETTING_CATEGORY,
  camAutoLabel, type CamBand,
} from '@/constants/cam'
import { NumberInput } from '@/components/ui/NumberInput'
import { apiErrorMessage as errorMessage } from '@/utils/apiError'

// ── CAM Matrix admin editor ─────────────────────────────────────────────
// Ports legacy's #admin-cam-matrix-panel (index.html:4979) and its handlers
// camAdminRender / camAdminAddRow / camAdminDeleteRow / camAdminSave /
// camAdminReset (efin-app.js:17118-17362).
//
// Persistence is legacy's own choice and is kept: the matrix is global config,
// so it rides the generic Admin-only POST /api/settings upsert under the key
// `efin_cam_matrix` rather than a dedicated table. settingsApi.update() must
// be passed the category back, or the upsert nulls it — see its doc comment.
//
// Legacy regenerates every label from its salary range on save so a label can
// never drift from the numbers it describes; that is reproduced here.


const BLANK: CamBand = {
  label: '', salaryMin: 0, salaryMax: 0, rateMin: 0, rateMax: 0,
  tenureMin: 12, tenureMax: 12, foir: 0.4,
}

type NumField = Exclude<keyof CamBand, 'label'>

const COLUMNS: { field: NumField; head: string; step?: string }[] = [
  { field: 'salaryMin', head: 'Salary Min' },
  { field: 'salaryMax', head: 'Salary Max' },
  { field: 'rateMin',   head: 'Rate Min %', step: '0.01' },
  { field: 'rateMax',   head: 'Rate Max %', step: '0.01' },
  { field: 'tenureMin', head: 'Tenure Min' },
  { field: 'tenureMax', head: 'Tenure Max' },
  { field: 'foir',      head: 'FOIR',       step: '0.01' },
]

export default function CamMatrixCard() {
  const qc = useQueryClient()
  const [rows, setRows] = useState<CamBand[] | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const { data: setting, isLoading } = useQuery({
    queryKey: ['cam-matrix'],
    queryFn: () => settingsApi.getByKey(CAM_MATRIX_SETTING_KEY).then(r => r.data.data),
    retry: false,
  })

  // Seed the editable copy once the stored value arrives. A corrupt or absent
  // setting falls back to defaults rather than rendering an empty table.
  useEffect(() => {
    if (rows !== null) return
    if (isLoading) return
    if (!setting?.value) { setRows(CAM_MATRIX_DEFAULT.map(r => ({ ...r }))); return }
    try {
      const parsed = JSON.parse(setting.value)
      setRows(Array.isArray(parsed) && parsed.length ? parsed : CAM_MATRIX_DEFAULT.map(r => ({ ...r })))
    } catch {
      setRows(CAM_MATRIX_DEFAULT.map(r => ({ ...r })))
      setError('The stored matrix could not be read, so defaults are shown. Saving will replace it.')
    }
  }, [setting, isLoading, rows])

  const save = useMutation({
    mutationFn: (next: CamBand[]) =>
      settingsApi.update(CAM_MATRIX_SETTING_KEY, JSON.stringify(next), CAM_MATRIX_SETTING_CATEGORY),
    onSuccess: () => {
      setError(''); setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      qc.invalidateQueries({ queryKey: ['cam-matrix'] })
    },
    onError: (err: unknown) => setError(errorMessage(err, 'Could not save the CAM matrix.')),
  })

  if (rows === null) {
    return (
      <Card>
        <SkeletonText lines={3} className="py-2" />
      </Card>
    )
  }

  const setField = (i: number, field: NumField, raw: string) => {
    const n = Number(raw)
    setRows(rs => (rs ?? []).map((r, idx) => idx === i ? { ...r, [field]: Number.isFinite(n) ? n : 0 } : r))
  }

  const handleSave = () => {
    // Legacy: regenerate labels, then sort ascending by salaryMin.
    const normalised = rows
      .map(r => ({ ...r, label: camAutoLabel(r.salaryMin, r.salaryMax) }))
      .sort((a, b) => a.salaryMin - b.salaryMin)
    setRows(normalised)
    save.mutate(normalised)
  }

  const inputCls = 'w-full rounded-md border border-token bg-surface2 px-2 py-1 text-xs tabular-nums'

  return (
    <Card>
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <h3 className="text-base font-semibold" style={{ color: 'var(--text)' }}>CAM Matrix</h3>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text3)' }}>
            Salary bands that decide each applicant's eligible amount, rate and tenure in the wizard.
          </p>
        </div>
      </div>

      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {saved && <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">CAM Matrix saved.</div>}

      <div className="overflow-x-auto mt-4">
        <table className="w-full text-xs" style={{ minWidth: 640 }}>
          <thead>
            <tr className="text-left" style={{ color: 'var(--text3)' }}>
              <th className="pb-2 pr-2 font-bold uppercase tracking-wide">Band</th>
              {COLUMNS.map(c => <th key={c.field} className="pb-2 pr-2 font-bold uppercase tracking-wide">{c.head}</th>)}
              <th className="pb-2 w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? 'var(--surface2)' : 'transparent' }}>
                <td className="py-1.5 pr-2 font-semibold whitespace-nowrap" style={{ color: 'var(--text)' }}>
                  {r.label || camAutoLabel(r.salaryMin, r.salaryMax)}
                </td>
                {COLUMNS.map(c => (
                  <td key={c.field} className="py-1.5 pr-2">
                    <NumberInput min="0" step={c.step} className={inputCls}
                      value={r[c.field]} onChange={e => setField(i, c.field, e.target.value)} />
                  </td>
                ))}
                <td className="py-1.5">
                  <button title="Remove band"
                    onClick={() => setRows(rs => (rs ?? []).filter((_, idx) => idx !== i))}
                    className="p-1 rounded text-gray-400 hover:text-red-600">
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        <Button size="sm" loading={save.isPending} disabled={save.isPending} onClick={handleSave}>
          <Save size={14} className="mr-1" />Save Matrix
        </Button>
        <Button size="sm" variant="secondary"
          onClick={() => setRows(rs => [...(rs ?? []), { ...BLANK }])}>
          <Plus size={14} className="mr-1" />Add Band
        </Button>
        <Button size="sm" variant="secondary"
          onClick={() => {
            if (window.confirm('Reset the CAM Matrix to its default bands? You still need to Save to store this.')) {
              setRows(CAM_MATRIX_DEFAULT.map(r => ({ ...r })))
            }
          }}>
          <RotateCcw size={14} className="mr-1" />Reset to defaults
        </Button>
      </div>

      <p className="text-[11px] mt-3" style={{ color: 'var(--text3)' }}>
        Band labels are regenerated from the salary range when you save. Reset only changes what you see here — nothing is stored until you press Save.
      </p>
    </Card>
  )
}
