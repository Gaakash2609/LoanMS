import { useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Upload, Loader2, Lock, AlertTriangle, CheckCircle2, Eye, EyeOff, X } from 'lucide-react'
import { usePerfiosUpload, type PerfiosUploadResult } from '@/hooks/usePerfiosUpload'

// ── Perfios bank-statement upload ────────────────────────────────────────
// Reproduces legacy perfios/index.html + perfios-core.js's upload/password
// flow (file select, drag/drop, multi-file sequential processing, silent
// password auto-try chain, password modal with bank hint + apply-to-all,
// skip, retry) using the Phase 1 ported engine for all parsing/calculation.
// No results tables here — this component's only job is to get from "PDF
// file(s)" to a validated PerfiosUploadResult and hand it to the caller via
// onComplete. No backend save, no postMessage, no iframe.
export default function PerfiosUpload({ onComplete }: { onComplete?: (result: PerfiosUploadResult) => void }) {
  const {
    status, errorMessage, passwordPrompt, progress, result,
    addFiles, submitPassword, skipFile, setBulkPassword, clearBulkPassword, reset,
  } = usePerfiosUpload()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [pwdInput, setPwdInput] = useState('')
  const [pwdVisible, setPwdVisible] = useState(false)
  const [applyAll, setApplyAll] = useState(false)
  const [bulkPwdInput, setBulkPwdInput] = useState('')
  const [bulkPwdSaved, setBulkPwdSaved] = useState(false)

  function handleFilesPicked(files: FileList | null) {
    if (!files || !files.length) return
    void addFiles(Array.from(files))
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    handleFilesPicked(e.dataTransfer.files)
  }

  function handleSubmitPassword() {
    if (!pwdInput.trim()) return
    submitPassword(pwdInput.trim(), applyAll)
    setPwdInput(''); setApplyAll(false); setPwdVisible(false)
  }

  function handleSaveBulkPassword() {
    const val = bulkPwdInput.trim()
    if (!val) { setBulkPwdSaved(false); return }
    setBulkPassword(val); setBulkPwdSaved(true)
  }
  function handleClearBulkPassword() {
    clearBulkPassword(); setBulkPwdInput(''); setBulkPwdSaved(false)
  }

  function handleReset() {
    reset(); setPwdInput(''); setApplyAll(false); setBulkPwdInput(''); setBulkPwdSaved(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Fires onComplete exactly once per finished run (guarded against
  // StrictMode double-invoke / re-renders via the result-identity ref).
  const notifiedResultRef = useRef<PerfiosUploadResult | null>(null)
  useEffect(() => {
    if (status === 'complete' && result && onComplete && notifiedResultRef.current !== result) {
      notifiedResultRef.current = result
      onComplete(result)
    }
  }, [status, result, onComplete])

  return (
    <Card>
      {/* ── idle / drag-drop zone ── */}
      {(status === 'idle' || status === 'error') && (
        <div>
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl py-10 px-4 cursor-pointer transition-colors ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}`}
          >
            <Upload size={28} className="text-gray-400" />
            <p className="text-sm font-semibold text-gray-700">Click or drag bank statement PDF(s) here</p>
            <p className="text-xs text-gray-400 text-center">Supports 45+ banks · password-protected &amp; plain PDFs · multiple files<br />90-day span check · staleness check · salary, bounce &amp; overdraft detection</p>
          </div>
          <input ref={fileInputRef} type="file" accept=".pdf" multiple className="hidden"
            onChange={e => handleFilesPicked(e.target.files)} />

          {status === 'error' && errorMessage && (
            <div className="mt-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{errorMessage}</p>
            </div>
          )}
        </div>
      )}

      {/* ── processing ── */}
      {(status === 'processing' || status === 'password-required') && progress && (
        <div className="flex items-center gap-3 py-6">
          <Loader2 size={18} className="animate-spin text-blue-600" />
          <p className="text-sm text-gray-700">
            Processing file {progress.current} of {progress.total}: <span className="font-medium">{progress.fileName}</span>
          </p>
        </div>
      )}

      {/* ── password modal ── */}
      {status === 'password-required' && passwordPrompt && (
        <div className="mt-2 p-5 border border-gray-200 rounded-xl bg-gray-50">
          <div className="flex items-center gap-2 mb-3">
            <Lock size={16} className="text-gray-500" />
            <p className="text-sm font-semibold text-gray-800">Password required — {passwordPrompt.fileName}</p>
          </div>

          {passwordPrompt.bankHint && (
            <div className="mb-3 p-2.5 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-800">
              <p className="font-medium mb-1">💡 {passwordPrompt.bankHint.bank} Hint</p>
              <p className="mb-1.5">{passwordPrompt.bankHint.hint}</p>
              <div className="flex flex-wrap gap-1.5">
                {passwordPrompt.bankHint.examples.map(ex => (
                  <button key={ex} onClick={() => setPwdInput(ex)}
                    className="px-2 py-0.5 bg-white border border-blue-200 rounded text-blue-700 text-[11px]">{ex}</button>
                ))}
              </div>
            </div>
          )}

          <div className="relative mb-2">
            <input
              type={pwdVisible ? 'text' : 'password'}
              value={pwdInput}
              onChange={e => setPwdInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmitPassword()}
              placeholder="Enter PDF password"
              autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-9 text-sm"
            />
            <button onClick={() => setPwdVisible(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400">
              {pwdVisible ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>

          {passwordPrompt.errorMessage && (
            <p className="text-xs text-red-600 mb-2">❌ {passwordPrompt.errorMessage}</p>
          )}
          {passwordPrompt.attempts > 0 && (
            <p className="text-xs text-gray-500 mb-2">{passwordPrompt.attempts} failed attempt{passwordPrompt.attempts > 1 ? 's' : ''} — you can skip this file if needed.</p>
          )}

          {passwordPrompt.showApplyAll && (
            <label className="flex items-center gap-2 text-xs text-gray-600 mb-3 cursor-pointer">
              <input type="checkbox" checked={applyAll} onChange={e => setApplyAll(e.target.checked)} />
              Apply this password to remaining files in this batch
            </label>
          )}

          <div className="flex gap-2">
            <Button size="sm" onClick={handleSubmitPassword} disabled={!pwdInput.trim()}>🔓 Unlock &amp; Process</Button>
            <Button size="sm" variant="secondary" onClick={skipFile}>Skip File</Button>
          </div>

          <div className="mt-4 pt-3 border-t border-gray-200">
            <p className="text-xs text-gray-500 mb-1.5">Or pre-set a password for the whole batch:</p>
            <div className="flex gap-2">
              <input value={bulkPwdInput} onChange={e => setBulkPwdInput(e.target.value)}
                placeholder="Bulk password" className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              {!bulkPwdSaved ? (
                <Button size="sm" variant="secondary" onClick={handleSaveBulkPassword}>Save</Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={handleClearBulkPassword}><X size={13} className="mr-1" />Clear</Button>
              )}
            </div>
            {bulkPwdSaved && <p className="text-[11px] text-green-600 mt-1">✓ Will be tried automatically on remaining protected files.</p>}
          </div>
        </div>
      )}

      {/* ── complete ── */}
      {status === 'complete' && result && (
        <div>
          <div className={`flex items-start gap-2 p-3 rounded-lg border ${result.valid ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
            <CheckCircle2 size={16} className={result.valid ? 'text-green-600 shrink-0 mt-0.5' : 'text-yellow-600 shrink-0 mt-0.5'} />
            <div>
              <p className={`text-sm font-semibold ${result.valid ? 'text-green-700' : 'text-yellow-700'}`}>
                {result.valid ? 'Statement validated' : 'Processed — needs review'}
              </p>
              <p className="text-xs text-gray-600 mt-0.5">
                {result.totalTxns} txns · Span {result.span}d · Last txn {result.staledays}d ago
                {result.hasSalary ? ' · 💰 Salary found' : ' · ⚠ No salary'}
                {result.manualReviewRequired ? ' · Manual review required' : ''}
              </p>
            </div>
          </div>
          <div className="mt-3 text-xs text-gray-500">
            {result.perFileData.map(f => (
              <div key={f.fileName} className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
                <span>{f.fileName}{f.isProtected ? ' 🔒' : ''}</span>
                <span>{f.txnCount} txns</span>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <Button size="sm" variant="secondary" onClick={handleReset}>Upload Different Statement(s)</Button>
          </div>
        </div>
      )}

    </Card>
  )
}
