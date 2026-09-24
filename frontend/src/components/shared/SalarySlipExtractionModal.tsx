import { useMemo, useState } from 'react'
import { X, Lock, Eye, EyeOff, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { InlineLoader } from '@/components/ui/LoadingSpinner'
import { kycApi } from '@/api/kycApi'
import { parseSalarySlip, SALARY_SLIP_VISION_PROMPT } from '@/utils/salarySlipExtraction'
import { PasswordException } from '@/utils/perfios/pdf'
import { NumberInput } from '@/components/ui/NumberInput'
import { formatCurrency as fmtINR } from '@/utils/format'

// Salary Slip Extraction — Auto Income Check.
// Faithful React port of legacy's PSE modal (index.html #pse-overlay + efin-app.js
// pseProcessFile/pseRunAnalysis/pseConfirmAndAttach): a 3-step
// (Upload Slips → Verify Data → Confirm & Attach) modal that reads Net Pay + Month
// from up to 3 months' payslips, lets the user verify/edit the figures, then
// hands the attached files + average net pay back to the caller (which attaches
// them as the loan document and flows the income into the wizard). PDF text is
// extracted locally; image slips go through the same /api/kyc/vision relay the
// KYC step uses; password-protected PDFs are unlocked with one shared password.

type SlipStatus = 'empty' | 'reading' | 'done' | 'locked' | 'error'
interface Slip {
  file: File | null
  netPay: number | null   // editable
  month: string | null
  status: SlipStatus
  error?: string
}
const EMPTY: Slip = { file: null, netPay: null, month: null, status: 'empty' }

async function readImageBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(new Error('read-failed'))
    r.readAsDataURL(file)
  })
}

export default function SalarySlipExtractionModal({ onClose, onConfirm }: {
  onClose: () => void
  onConfirm: (files: File[], avgNetPay: number) => void
}) {
  const [slips, setSlips] = useState<Slip[]>([{ ...EMPTY }, { ...EMPTY }, { ...EMPTY }])
  const [analyzed, setAnalyzed] = useState(false)
  const [password, setPassword] = useState('')
  const [pwVisible, setPwVisible] = useState(false)
  const [busy, setBusy] = useState(false)

  const uploadedCount = slips.filter(s => s.file).length
  const anyLocked = slips.some(s => s.status === 'locked')
  const netPays = slips.map(s => s.netPay).filter((n): n is number => n != null && n > 0)
  const avgNet = netPays.length ? Math.round(netPays.reduce((a, b) => a + b, 0) / netPays.length) : 0
  // Consistency: max deviation from the average, like legacy's variance note.
  const consistency = useMemo(() => {
    if (netPays.length < 2) return null
    const maxDev = Math.max(...netPays.map(n => Math.abs(n - avgNet)))
    const pct = avgNet > 0 ? Math.round((maxDev / avgNet) * 100) : 0
    return { pct, ok: pct <= 15 }
  }, [netPays, avgNet])

  function setSlip(i: number, patch: Partial<Slip>) {
    setSlips(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s))
  }

  // Extract Net Pay + Month from one slip (PDF → local text, image → vision).
  async function extractSlip(i: number, file: File, pw?: string): Promise<void> {
    setAnalyzed(false)
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    const isImage = file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)
    setSlip(i, { file, status: 'reading', error: undefined })
    try {
      let text = ''
      if (ext === 'pdf' || file.type === 'application/pdf') {
        const { getDocumentWithTimeout, extractText } = await import('@/utils/perfios/pdf')
        try {
          const pdf = await getDocumentWithTimeout({ data: await file.arrayBuffer(), password: pw })
          text = await extractText(pdf)
        } catch (err) {
          const e = err as { name?: string; code?: number; message?: string }
          if (err instanceof PasswordException || e?.name === 'PasswordException' || e?.code === 1 || e?.code === 2
            || (e?.message || '').toLowerCase().includes('password')) {
            setSlip(i, { file, status: 'locked', error: 'Password-protected — enter the PDF password below.' })
            return
          }
          throw err
        }
      } else if (isImage) {
        const data = await readImageBase64(file)
        const resp = await kycApi.extractFromImages({
          documentType: 'SALARY_SLIP',
          images: [{ mediaType: file.type || 'image/jpeg', data }],
          prompt: SALARY_SLIP_VISION_PROMPT,
        })
        if (!resp.data.success) throw new Error(resp.data.error || 'vision-failed')
        text = resp.data.text || ''
      } else {
        // XLSX/CSV/TXT — read as text (best effort; legacy also accepts these).
        text = await file.text()
      }
      const parsed = parseSalarySlip(text)
      setSlip(i, { file, status: 'done', netPay: parsed.netPay, month: parsed.month, error: parsed.netPay == null ? 'Net Pay not detected — enter it manually.' : undefined })
    } catch {
      setSlip(i, { file, status: 'error', error: 'Could not read this slip — enter Net Pay manually.' })
    }
  }

  async function unlockAll() {
    if (!password.trim()) return
    setBusy(true)
    for (let i = 0; i < slips.length; i++) {
      if (slips[i].status === 'locked' && slips[i].file) await extractSlip(i, slips[i].file!, password.trim())
    }
    setBusy(false)
  }

  function runAnalysis() { setAnalyzed(true) }

  const canAnalyze = uploadedCount > 0 && !slips.some(s => s.status === 'reading') && !anyLocked
  const canConfirm = analyzed && netPays.length > 0

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[var(--z-modal)] p-4">
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-start gap-3 p-5 rounded-t-2xl" style={{ background: 'var(--accent)', color: '#fff' }}>
          <div className="text-2xl">📋</div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-black">Salary Slip Extraction — Auto Income Check</p>
            <p className="text-xs mt-0.5" style={{ opacity: .9 }}>Upload 3 months' payslips · auto-extracts Net Pay · flows to income</p>
          </div>
          <button onClick={onClose} className="text-white/90 hover:text-white"><X size={18} /></button>
        </div>

        {/* Stepper */}
        <div className="flex items-center justify-center gap-3 py-4 border-b border-gray-100">
          {[['1', 'Upload Slips'], ['2', 'Verify Data'], ['3', 'Confirm & Attach']].map(([n, label], idx) => {
            const active = (idx === 0 && !analyzed) || (idx === 1 && analyzed && !canConfirm) || (idx === 2 && canConfirm)
            const done = (idx === 0 && analyzed) || (idx === 1 && canConfirm)
            return (
              <div key={n} className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full inline-flex items-center justify-center text-xs font-bold"
                  style={{ background: done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--surface3)', color: done || active ? '#fff' : 'var(--text3)' }}>
                  {done ? '✓' : n}
                </span>
                <span className="text-xs font-semibold" style={{ color: active || done ? 'var(--text)' : 'var(--text3)' }}>{label}</span>
                {idx < 2 && <span className="text-gray-300 ml-1">›</span>}
              </div>
            )
          })}
        </div>

        <div className="p-5 space-y-4">
          <div className="text-xs p-3 rounded-lg" style={{ background: 'var(--accent-subtle)', color: 'var(--text2)' }}>
            💡 Upload the last 3 months' salary slips — <strong>PDF</strong>, <strong>JPG/PNG</strong>, <strong>Excel</strong> or <strong>CSV</strong>. Net Pay is auto-extracted; password-protected PDFs are supported. You can also edit values manually.
          </div>

          {/* Upload slots */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {slips.map((s, i) => (
              <label key={i} className="relative border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors hover:border-efin-blue/50"
                style={{ borderColor: s.status === 'done' ? 'var(--success)' : s.status === 'locked' || s.status === 'error' ? 'var(--warn)' : 'var(--border)' }}>
                <span className="absolute top-2 left-2 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--surface2)', color: 'var(--text3)' }}>Slip {i + 1}</span>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.bmp,.xlsx,.xls,.csv,.txt" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void extractSlip(i, f) }} />
                <div className="text-2xl mt-2">📋</div>
                <div className="text-sm font-bold mt-1" style={{ color: 'var(--text)' }}>Month {i + 1}</div>
                {s.status === 'empty' && <div className="text-[10.5px] text-[color:var(--text3)]">PDF · Image · Excel · CSV</div>}
                {s.status === 'reading' && <div className="text-[11px] mt-1 flex items-center justify-center gap-1 text-[color:var(--text3)]"><InlineLoader size={11} /> reading…</div>}
                {s.status === 'locked' && <div className="text-[11px] mt-1 flex items-center justify-center gap-1" style={{ color: 'var(--warn)' }}><Lock size={11} /> locked</div>}
                {s.status === 'done' && <div className="text-[11px] mt-1" style={{ color: 'var(--success)' }}>✓ {s.month ?? 'read'}{s.netPay != null ? ` · ${fmtINR(s.netPay)}` : ''}</div>}
                {s.status === 'error' && <div className="text-[11px] mt-1" style={{ color: 'var(--warn)' }}>⚠ manual entry</div>}
                {s.file && <div className="text-[10px] text-[color:var(--text3)] truncate mt-1">{s.file.name}</div>}
              </label>
            ))}
          </div>

          {/* Unified password row */}
          {anyLocked && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: 'var(--surface2)' }}>
              <Lock size={14} className="text-gray-500 shrink-0" />
              <div className="relative flex-1">
                <input type={pwVisible ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && unlockAll()} placeholder="Enter PDF password for all locked slips…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 pr-9 text-sm" />
                <button onClick={() => setPwVisible(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">{pwVisible ? <EyeOff size={14} /> : <Eye size={14} />}</button>
              </div>
              <Button size="sm" variant="secondary" loading={busy} onClick={unlockAll} disabled={!password.trim()}>🔓 Unlock All</Button>
            </div>
          )}

          {/* Manual / auto-extracted values table */}
          <div className="border border-gray-100 rounded-xl p-3">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: 'var(--warn)' }} /> Manual / Auto-Extracted Values — edit if needed
            </p>
            <div className="grid grid-cols-[1fr_1.4fr] gap-2 text-[11px] font-semibold text-gray-500 px-1 mb-1">
              <span>Month</span><span>Net Pay (₹) ✱</span>
            </div>
            {slips.map((s, i) => (
              <div key={i} className="grid grid-cols-[1fr_1.4fr] gap-2 items-center mb-1.5">
                <span className="text-xs text-gray-600 px-2 py-1.5 rounded bg-gray-50">{s.month ?? `Month ${i + 1}`}</span>
                <NumberInput value={s.netPay ?? ''} placeholder="—"
                  onChange={e => { setSlip(i, { netPay: e.target.value ? Number(e.target.value) : null }); setAnalyzed(false) }}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
              </div>
            ))}
            <p className="text-[10px] text-gray-400 mt-1">✱ Net Pay = take-home figure from the slip</p>
          </div>

          {/* Result bar */}
          {analyzed && netPays.length > 0 && (
            <div className="rounded-xl p-3.5" style={{ background: 'rgba(26,115,64,.08)', border: '1px solid rgba(26,115,64,.25)' }}>
              <p className="text-[11px] font-extrabold uppercase tracking-wide mb-2 flex items-center gap-1.5" style={{ color: 'var(--success)' }}><CheckCircle2 size={13} /> Extraction Complete — review before confirming</p>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">Avg Net Monthly Pay</span>
                <span className="text-lg font-black" style={{ fontFamily: 'var(--font-head)', color: 'var(--success)' }}>{fmtINR(avgNet)} <span className="text-[10.5px] font-normal text-gray-500">({netPays.length} slip{netPays.length !== 1 ? 's' : ''})</span></span>
              </div>
              {consistency && (
                <p className="text-xs mt-2 pt-2 border-t flex items-center gap-1.5" style={{ borderColor: 'var(--border)', color: consistency.ok ? 'var(--success)' : 'var(--warn)' }}>
                  {consistency.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />} Month-to-month variance {consistency.pct}% — {consistency.ok ? 'consistent income' : 'review the figures'}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 p-4 border-t border-gray-100 flex-wrap">
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <div className="flex items-center gap-2 ml-auto">
            <div className="flex gap-1">
              {slips.map((s, i) => <span key={i} className="w-2 h-2 rounded-full" style={{ background: s.file ? 'var(--success)' : 'var(--surface3)' }} />)}
            </div>
            <span className="text-[11px] text-gray-500">{uploadedCount} / 3 slips uploaded</span>
          </div>
          {!canConfirm ? (
            <Button size="sm" onClick={runAnalysis} disabled={!canAnalyze}>🔍 Extract &amp; Verify Salary Data</Button>
          ) : (
            <Button size="sm" onClick={() => onConfirm(slips.filter(s => s.file).map(s => s.file!), avgNet)}>✅ Confirm &amp; Attach to Documents</Button>
          )}
        </div>
      </div>
    </div>
  )
}
