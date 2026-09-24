import { useState } from 'react'
import { X, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import PerfiosUpload from '@/components/shared/PerfiosUpload'
import type { PerfiosUploadResult } from '@/hooks/usePerfiosUpload'

// Perfios Banking System v9.0 — Bank Statement Analysis modal.
// Faithful React shell of legacy's pfv9 popup (perfios/index.html): the same
// 5-step stepper (Upload PDF → Parse & Validate → Detect Salary → Run Checks →
// Complete), wrapping the already-ported React Perfios engine (PerfiosUpload /
// usePerfiosUpload). On completion it shows the analysis summary + validation
// checks and a Confirm Attachment button; the finished report + raw file are
// handed back so the caller attaches the document and persists the report.
const fmtINR = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

const STEPS = ['Upload PDF', 'Parse & Validate', 'Detect Salary', 'Run Checks', 'Complete']

export default function PerfiosModal({ onClose, onConfirm }: {
  onClose: () => void
  onConfirm: (result: PerfiosUploadResult, file: File | null) => void
}) {
  const [result, setResult] = useState<PerfiosUploadResult | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<'upload' | 'processing' | 'complete'>('upload')

  // Which stepper node is "current". 1 Upload → 2/3/4 during processing → 5 Complete.
  const current = phase === 'upload' ? 0 : phase === 'processing' ? 1 : 4

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[var(--z-modal)] p-4">
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-start gap-3 p-5 rounded-t-2xl" style={{ background: 'var(--accent)', color: '#fff' }}>
          <div className="text-2xl">🏦</div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-black">Perfios Banking System v9.0 — Bank Statement Analysis</p>
            <p className="text-xs mt-0.5" style={{ opacity: .9 }}>Last 6 Month Bank Statement · 45+ banks · Password-protected PDF · 90-day validation · ABB computation · Salary / Bounce / ACH / ECS detection</p>
          </div>
          <button onClick={onClose} className="text-white/90 hover:text-white"><X size={18} /></button>
        </div>

        {/* 5-step stepper */}
        <div className="flex items-center justify-center gap-2 py-4 border-b border-gray-100 flex-wrap">
          {STEPS.map((label, idx) => {
            const done = idx < current || (phase === 'complete' && idx <= 4)
            const active = idx === current && phase !== 'complete'
            const on = done || active
            return (
              <div key={label} className="flex items-center gap-1.5">
                <span className="w-7 h-7 rounded-full inline-flex items-center justify-center text-[11px] font-bold"
                  style={{ background: done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--surface3)', color: on ? '#fff' : 'var(--text3)' }}>
                  {done ? '✓' : String(idx + 1).padStart(2, '0')}
                </span>
                <span className="text-[11px] font-semibold hidden sm:inline" style={{ color: on ? 'var(--text)' : 'var(--text3)' }}>{label}</span>
                {idx < STEPS.length - 1 && <span className="text-gray-300 mx-0.5">—</span>}
              </div>
            )
          })}
        </div>

        <div className="p-5">
          {!result ? (
            <PerfiosUpload
              onFilesSelected={files => { if (files[0]) { setFile(files[0]); setPhase('processing') } }}
              onComplete={r => { setResult(r); setPhase('complete') }}
            />
          ) : (
            <div className="space-y-4">
              {/* Summary */}
              <div className="rounded-xl p-4" style={{ background: result.valid ? 'rgba(26,115,64,.08)' : 'rgba(230,126,0,.08)', border: `1px solid ${result.valid ? 'rgba(26,115,64,.25)' : 'rgba(230,126,0,.25)'}` }}>
                <p className="text-sm font-bold flex items-center gap-1.5" style={{ color: result.valid ? 'var(--success)' : 'var(--warn)' }}>
                  {result.valid ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                  {result.valid ? 'Statement validated' : 'Processed — needs review'}{result.manualReviewRequired ? ' · Manual review required' : ''}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                  {[
                    ['Avg Bank Balance', fmtINR(Math.round(result.abb))],
                    ['Span', `${result.span} days`],
                    ['Transactions', String(result.totalTxns)],
                    ['Salary', result.hasSalary ? 'Detected' : 'None'],
                  ].map(([l, v]) => (
                    <div key={l}>
                      <p className="text-[10.5px] uppercase tracking-wide text-gray-500">{l}</p>
                      <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>{v}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Validation checks (Run Checks output) */}
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 px-3 py-2 border-b border-gray-100">Validation Checks</p>
                <div className="max-h-56 overflow-y-auto divide-y divide-gray-50">
                  {result.validChecks.map(c => (
                    <div key={c.id} className="flex items-start gap-2 px-3 py-2">
                      <span className="text-sm shrink-0">{c.icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-gray-800">{c.title}</p>
                        <p className="text-[11px] text-gray-500 leading-snug">{c.detail}</p>
                      </div>
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
                        style={{ background: c.status === 'pass' ? 'rgba(26,115,64,.12)' : c.status === 'warn' ? 'rgba(230,126,0,.12)' : 'rgba(227,30,37,.1)', color: c.status === 'pass' ? 'var(--success)' : c.status === 'warn' ? 'var(--warn)' : 'var(--danger)' }}>
                        {c.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 p-4 border-t border-gray-100">
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          {result && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[11px] text-gray-500">ABB {fmtINR(Math.round(result.abb))} · {result.span}d</span>
              <Button size="sm" onClick={() => onConfirm(result, file)}>✅ Confirm Attachment</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
