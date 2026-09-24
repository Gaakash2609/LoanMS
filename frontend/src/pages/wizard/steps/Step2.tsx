// Step2 — extracted verbatim from NewApplicationPage.tsx (code-quality
// refactor, no behaviour change).

import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { AlertTriangle, Check, FileCheck, FileImage, IdCard, ListChecks, Pencil, ScanLine, ShieldCheck, Upload, X } from 'lucide-react'
import { kycApi } from '@/api/kycApi'
import { extractPanData, extractAadhaarData } from '@/utils/kycExtraction'
import { downloadBlob } from '@/utils/reportExport'
import { InlineLoader, OverlayLoader } from '@/components/ui/LoadingSpinner'
import { AADHAR_RE, PAN_RE } from '@/pages/wizard/wizardConstants'
import { FormGroup, TextInput, SelectInput } from '@/pages/wizard/WizardFields'
import type { WizardData } from '@/pages/wizard/wizardTypes'

export function Step2({ data, onChange, errors, touch, touched }: {
  data: WizardData; onChange: (f: Partial<WizardData>) => void; errors: Record<string, string>
  touch: (field: string) => void; touched: Record<string, boolean>
}) {
  const [panImages, setPanImages] = useState<File[]>([])
  // Aadhaar front + back — Vanilla uploads them as two separate files
  // (kyc-aadhar-file / kyc-aadhar-back-file); both are sent for extraction.
  const [aadhaarImages, setAadhaarImages] = useState<File[]>([])       // front
  const [aadhaarBackImages, setAadhaarBackImages] = useState<File[]>([]) // back
  const [showKycReport, setShowKycReport] = useState(false)
  // Live thumbnail for the PAN card tile — mirrors the uploaded file so the
  // person can see what was actually captured, matching the redesigned
  // "PAN Card" tile which shows the scan itself rather than a generic icon.
  // PDFs aren't previewed here (isPdf below) — they fall back to a file icon.
  const [panPreviewUrl, setPanPreviewUrl] = useState<string | null>(null)
  useEffect(() => {
    const f = panImages[0]
    if (f && f.type.startsWith('image/')) {
      const url = URL.createObjectURL(f)
      setPanPreviewUrl(url)
      return () => URL.revokeObjectURL(url)
    }
    setPanPreviewUrl(null)
  }, [panImages])
  // Extra fields used only for Cross-Validate (kycCrossValidate in legacy
  // kyc.js) — not part of WizardData/submission, same as extractionStatus
  // above: purely local, derived from the AI response text.
  const [panNumberExtracted, setPanNumberExtracted] = useState('')
  const [aadhaarFullNameExtracted, setAadhaarFullNameExtracted] = useState('')
  const [extractionStatus, setExtractionStatus] = useState<{
    pan?: { status: 'idle' | 'loading' | 'success' | 'error'; message?: string }
    aadhaar?: { status: 'idle' | 'loading' | 'success' | 'error'; message?: string }
  }>({})

  // Check if KYC vision is available
  const { data: kycStatus } = useQuery({
    queryKey: ['kyc-vision-status'],
    queryFn: () => kycApi.status().then(r => r.data),
    staleTime: 300_000,
  })

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1] || '')
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  // Convert an uploaded file to a vision-API image payload. The backend accepts
  // only image mime types, so a PDF (which Vanilla supports via pdf.js) is
  // rendered to a PNG first — same net behaviour as legacy's KYC upload.
  const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
  const fileToImage = async (f: File): Promise<{ mediaType: string; data: string }> => {
    if (isPdf(f)) {
      // Lazy-load pdfjs only when a PDF is actually processed — keeps the
      // heavy worker out of the initial bundle (and out of the test env's
      // module graph, which can't resolve the Vite `?url` worker import).
      const { renderPdfPageToPngBase64 } = await import('@/utils/perfios/pdf')
      return { mediaType: 'image/png', data: await renderPdfPageToPngBase64(f) }
    }
    return { mediaType: f.type, data: await fileToBase64(f) }
  }

  const extractPan = useMutation({
    mutationFn: async () => {
      if (!panImages.length) throw new Error('No PAN images selected')
      setExtractionStatus(s => ({ ...s, pan: { status: 'loading' } }))

      try {
        const response = await kycApi.extractFromImages({
          documentType: 'PAN',
          images: await Promise.all(panImages.map(fileToImage)),
          prompt: `Extract PAN card information. Return ONLY the following fields in this exact format:
FIRST NAME: <first name>
MIDDLE NAME: <middle name if any, else leave blank>
LAST NAME: <last name>
FATHER'S NAME: <father's name>
PAN NUMBER: <10-character PAN, 5 letters+4 digits+1 letter>

Extract exactly what is on the card. Be accurate.`,
        })

        if (!response.data.success) {
          throw new Error(response.data.error || 'Extraction failed')
        }

        // Parse extracted text
        const panData = extractPanData(response.data.text || '')
        setPanNumberExtracted(panData.panNumber)
        // 🟠 KYC Auto-fill improvement (item #6): only fill a field the user
        // hasn't already deliberately edited themselves (Step2's `touched`
        // prop — set by each field's own onBlur, same mechanism every other
        // field in this wizard already uses for validation timing). kycFirstName/
        // kycLastName/kycFather ("what KYC extracted", shown for reference) are
        // always updated; firstName/lastName/father (the actual submitted
        // values) are only overwritten if not already touched.
        onChange({
          kycFirstName: panData.firstName,
          kycLastName: panData.lastName,
          kycFather: panData.fatherName,
          ...(!touched.firstName ? { firstName: panData.firstName } : {}),
          // Middle name — Vanilla extracts kyc-out-mname from the PAN and fills
          // the Personal step's middle name. Only fill if not user-edited and
          // the model actually returned one (blank must not wipe a typed value).
          ...(!touched.middleName && panData.middleName ? { middleName: panData.middleName } : {}),
          ...(!touched.lastName ? { lastName: panData.lastName } : {}),
          ...(!touched.father ? { father: panData.fatherName } : {}),
        })

        setExtractionStatus(s => ({
          ...s,
          pan: { status: 'success', message: 'PAN data extracted successfully' },
        }))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Extraction failed'
        setExtractionStatus(s => ({
          ...s,
          pan: { status: 'error', message },
        }))
        throw err
      }
    },
  })

  const extractAadhaar = useMutation({
    mutationFn: async () => {
      const aadhaarFiles = [...aadhaarImages, ...aadhaarBackImages]
      if (!aadhaarFiles.length) throw new Error('No Aadhaar images selected')
      setExtractionStatus(s => ({ ...s, aadhaar: { status: 'loading' } }))

      try {
        const response = await kycApi.extractFromImages({
          documentType: 'AADHAAR',
          images: await Promise.all(aadhaarFiles.map(fileToImage)),
          prompt: `Extract Aadhaar card information. Return ONLY the following fields in this exact format:
FULL NAME: <full name as printed>
AADHAAR NUMBER: <12 digit number>
DATE OF BIRTH: <DD/MM/YYYY>
GENDER: <Male/Female/Other>
HOUSE/FLAT NO: <house / flat / building / door number>
STREET/LOCALITY: <street, road, area, locality, nagar>
CITY: <city/district>
STATE: <state>
PIN CODE: <6 digit pin>
FULL ADDRESS: <complete address>

Extract exactly what is on the card. Be accurate.`,
        })

        if (!response.data.success) {
          throw new Error(response.data.error || 'Extraction failed')
        }

        // Parse extracted text
        const aadhaarData = extractAadhaarData(response.data.text || '')
        setAadhaarFullNameExtracted(aadhaarData.fullName)
        // extractAadhaarData produces a capitalized word ("Male"/"Female"),
        // matching legacy's own OCR stage (efin-app.js:29616) exactly -- but
        // legacy has a SECOND stage, kycSyncGender (efin-app.js:30409), that
        // narrows that down to the single-letter code ('M'/'F'/'O') the
        // gender select and the backend (Customers.Gender is varchar(1))
        // actually store, before it ever reaches the form field. React had
        // ported the first stage but not the second, so an Aadhaar-extracted
        // gender that the user didn't touch afterward still carried the full
        // word into submission.
        const genderCode = aadhaarData.gender
          ? (aadhaarData.gender.charAt(0).toUpperCase() === 'M' ? 'M'
             : aadhaarData.gender.charAt(0).toUpperCase() === 'F' ? 'F'
             : 'O')
          : ''
        // Same touched-field precedence as extractPan above.
        onChange({
          kycAadhar: aadhaarData.aadhaarNumber,
          kycDob: aadhaarData.dateOfBirth,
          kycGender: genderCode,
          kycStreet1: aadhaarData.street1,
          kycCity: aadhaarData.city,
          kycState: aadhaarData.state,
          kycPin: aadhaarData.pinCode,
          ...(!touched.aadhar ? { aadhar: aadhaarData.aadhaarNumber } : {}),
          ...(!touched.dob ? { dob: aadhaarData.dateOfBirth } : {}),
          ...(!touched.gender ? { gender: genderCode } : {}),
          // Street address lines — Vanilla splits the Aadhaar address into
          // House/Flat (street1) + Street/Locality (street2) and auto-fills the
          // wizard's Address step (kycSyncAddr). Only fill if not user-edited
          // and the model returned a value (blank must not wipe a typed value).
          ...(!touched.street1 && aadhaarData.street1 ? { street1: aadhaarData.street1 } : {}),
          ...(!touched.street2 && aadhaarData.street2 ? { street2: aadhaarData.street2 } : {}),
          ...(!touched.city ? { city: aadhaarData.city } : {}),
          ...(!touched.state ? { state: aadhaarData.state } : {}),
          ...(!touched.zip ? { zip: aadhaarData.pinCode } : {}),
          // PERMANENT address too — Vanilla kycSyncAddr maps each Aadhaar field
          // onto BOTH the current AND permanent inputs (street1:['w-street1',
          // 'w-pstreet1'], etc. — efin-app.js:1285-1286,1475), so the permanent
          // address auto-fills from the Aadhaar as well. Same touched-guard.
          ...(!touched.pStreet1 && aadhaarData.street1 ? { pStreet1: aadhaarData.street1 } : {}),
          ...(!touched.pStreet2 && aadhaarData.street2 ? { pStreet2: aadhaarData.street2 } : {}),
          ...(!touched.pCity && aadhaarData.city ? { pCity: aadhaarData.city } : {}),
          ...(!touched.pState && aadhaarData.state ? { pState: aadhaarData.state } : {}),
          ...(!touched.pZip && aadhaarData.pinCode ? { pZip: aadhaarData.pinCode } : {}),
        })

        setExtractionStatus(s => ({
          ...s,
          aadhaar: { status: 'success', message: 'Aadhaar data extracted successfully' },
        }))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Extraction failed'
        setExtractionStatus(s => ({
          ...s,
          aadhaar: { status: 'error', message },
        }))
        throw err
      }
    },
  })

  const handlePanFilesSelect = (files: FileList | null) => {
    if (!files) return
    setPanImages(Array.from(files))
    setExtractionStatus(s => ({ ...s, pan: { status: 'idle' } }))
  }

  const handleAadhaarFilesSelect = (files: FileList | null) => {
    if (!files) return
    setAadhaarImages(Array.from(files))
    setExtractionStatus(s => ({ ...s, aadhaar: { status: 'idle' } }))
  }

  const handleAadhaarBackFilesSelect = (files: FileList | null) => {
    if (!files) return
    setAadhaarBackImages(Array.from(files))
    setExtractionStatus(s => ({ ...s, aadhaar: { status: 'idle' } }))
  }

  // Vanilla has ONE "Extract & Auto-Fill Details" button (kycExtractAll) that
  // reads BOTH documents at once. Runs whichever docs have been uploaded; each
  // mutation records its own success/error, so one failing doesn't abort the
  // other.
  const extracting = extractPan.isPending || extractAadhaar.isPending
  const canExtract = (panImages.length > 0 || aadhaarImages.length > 0 || aadhaarBackImages.length > 0) && !!kycStatus?.configured
  const extractAll = async () => {
    const tasks: Promise<unknown>[] = []
    if (panImages.length) tasks.push(extractPan.mutateAsync().catch(() => undefined))
    if (aadhaarImages.length || aadhaarBackImages.length) tasks.push(extractAadhaar.mutateAsync().catch(() => undefined))
    if (tasks.length) await Promise.all(tasks)
  }

  // "Auto" affordance — Vanilla's kycFocusField: clicking it focuses the
  // extracted field so the user can correct it. (React fields are already
  // plain editable inputs; this just adds the same visible shortcut, styled
  // as the small blue pill used throughout the KYC step's extracted grids.)
  const fixBtn = (fieldId: string) => (
    <button type="button" tabIndex={-1} onClick={() => document.getElementById(fieldId)?.focus()}
      className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-[1px] rounded-full normal-case shrink-0"
      style={{ background: 'rgba(10,88,154,.08)', color: 'var(--accent)', border: '1px solid rgba(10,88,154,.22)' }}>
      <Check size={9} /> Auto
    </button>
  )
  // Green "validated" tint applied to a field once it holds a value that
  // came from document extraction — matches the pastel-green inputs in the
  // "Extracted Information" grids of the target design.
  const filledStyle = (ok: boolean): React.CSSProperties | undefined => ok
    ? { borderColor: 'rgba(26,115,64,.35)', background: 'rgba(26,115,64,.05)' }
    : undefined

  // ── Cross-Validate — matches legacy kycCrossValidate exactly: (1) PAN name
  // (composed from the already-extracted first/last name) vs Aadhaar full
  // name, word-subset match either direction; (2) wizard-entered PAN number
  // vs PAN-extracted PAN number, exact match. Runs once both PAN and
  // Aadhaar have been extracted (legacy: `if (panData && aadharData)
  // kycCrossValidate(...)`).
  const crossValidateChecks: { label: string; ok: boolean }[] = []
  if (extractionStatus.pan?.status === 'success' && extractionStatus.aadhaar?.status === 'success') {
    const panName = `${data.kycFirstName} ${data.kycLastName}`.toUpperCase().replace(/\s+/g, ' ').trim()
    const aadhaarName = aadhaarFullNameExtracted.toUpperCase().replace(/\s+/g, ' ').trim()
    if (panName && aadhaarName) {
      const panWords = panName.split(' ')
      const aadhaarWords = aadhaarName.split(' ')
      const nameOk = panWords.every(w => aadhaarName.includes(w)) || aadhaarWords.every(w => panName.includes(w))
      crossValidateChecks.push({ label: `Name ${nameOk ? 'matches' : 'differs'} — PAN: ${panName} | Aadhaar: ${aadhaarName}`, ok: nameOk })
    }
    const wizardPan = (data.pan || '').trim().toUpperCase()
    const extractedPan = panNumberExtracted.replace(/\s/g, '').toUpperCase()
    if (wizardPan && extractedPan) {
      const panOk = wizardPan === extractedPan
      crossValidateChecks.push({ label: `PAN ${panOk ? 'matches' : 'mismatch'} Step 1 entry — entered: ${wizardPan} | extracted: ${extractedPan}`, ok: panOk })
    }
  }
  const crossValidatePassed = crossValidateChecks.length > 0 && crossValidateChecks.every(c => c.ok)

  // ── KYC Report — matches legacy kycBuildReport's row set (upload status +
  // extracted fields), built from data already held in wizard state.
  const kycReportRows: { label: string; value: string; ok: boolean }[] = [
    { label: 'PAN Card Upload', value: panImages[0]?.name || 'Not uploaded', ok: panImages.length > 0 },
    { label: 'Aadhaar Upload', value: aadhaarImages[0]?.name || 'Not uploaded', ok: aadhaarImages.length > 0 },
    { label: 'First Name', value: data.kycFirstName || '—', ok: !!data.kycFirstName },
    { label: 'Last Name', value: data.kycLastName || '—', ok: !!data.kycLastName },
    { label: "Father's Name", value: data.kycFather || '—', ok: !!data.kycFather },
    { label: 'Aadhaar Number', value: data.kycAadhar || '—', ok: !!data.kycAadhar },
    { label: 'Date of Birth', value: data.kycDob || '—', ok: !!data.kycDob },
    { label: 'Gender', value: data.kycGender === 'M' ? 'Male' : data.kycGender === 'F' ? 'Female' : data.kycGender === 'O' ? 'Other' : (data.kycGender || '—'), ok: !!data.kycGender },
    { label: 'City / District', value: data.kycCity || '—', ok: !!data.kycCity },
    { label: 'State', value: data.kycState || '—', ok: !!data.kycState },
    { label: 'PIN Code', value: data.kycPin || '—', ok: !!data.kycPin },
  ]

  function downloadKycReport() {
    const ts = new Date()
    const lines = [
      `KYC Report | Generated: ${ts.toLocaleString('en-IN')}`,
      '---',
      ...kycReportRows.map(r => `${r.label}: ${r.value}`),
    ]
    downloadBlob(lines.join('\n'), `KYC_Report_${ts.toISOString().slice(0, 10)}.txt`, 'text/plain')
  }

  // Redesigned dropzone tile — replaces the old plain dashed upload row with
  // a card-style tile: icon + label, drag-and-drop support, and a compact
  // file chip (with a "×" to clear and re-pick) once something is uploaded.
  // Same onSelect(FileList|null) contract as before, so nothing downstream
  // (extraction, readiness, KYC report) needs to change.
  const docTile = (opts: {
    heading: string; sub: string; files: File[]
    onSelect: (f: FileList | null) => void; onClear: () => void
    accent: string; accentSoft: string
  }) => {
    const { heading, sub, files, onSelect, onClear, accent, accentSoft } = opts
    const uploaded = files.length > 0
    const file = files[0]
    const sizeKb = file ? Math.max(1, Math.round(file.size / 1024)) : 0
    return (
      <div
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); if (e.dataTransfer.files?.length) onSelect(e.dataTransfer.files) }}
      >
        {uploaded ? (
          <div className="flex items-center gap-2.5 rounded-[10px] px-3.5 py-3" style={{ border: `1.5px solid ${accent}`, background: accentSoft }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: accent }}>
              <FileCheck size={16} color="#fff" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-semibold truncate" style={{ color: 'var(--text)' }}>{file.name}</div>
              <div className="text-[10.5px]" style={{ color: 'var(--text3)' }}>{sizeKb} KB{files.length > 1 ? ` · +${files.length - 1} more` : ''}</div>
            </div>
            <button type="button" onClick={onClear} className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 hover:bg-black/5" title="Remove">
              <X size={14} style={{ color: 'var(--text3)' }} />
            </button>
          </div>
        ) : (
          <label className="block cursor-pointer">
            <div className="flex flex-col items-center justify-center gap-1.5 rounded-[10px] px-3 py-4 text-center transition-colors"
              style={{ border: '1.5px dashed var(--border2)', background: 'var(--surface2)' }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: accentSoft }}>
                <Upload size={15} style={{ color: accent }} />
              </div>
              <span className="text-[12px] font-semibold" style={{ color: 'var(--text2)' }}>{heading}</span>
              <span className="text-[10.5px]" style={{ color: 'var(--text3)' }}>{sub}</span>
            </div>
            <input type="file" multiple accept="image/*,application/pdf" onChange={e => onSelect(e.target.files)} className="hidden" />
          </label>
        )}
      </div>
    )
  }

  const extractedOk = extractionStatus.pan?.status === 'success' || extractionStatus.aadhaar?.status === 'success'
  const aadhaarBothSides = aadhaarImages.length > 0 && aadhaarBackImages.length > 0
  const aadhaarReadyLabel = aadhaarBothSides ? 'Both sides ready' : aadhaarImages.length > 0 ? 'Front side ready' : aadhaarBackImages.length > 0 ? 'Back side ready' : null
  const aadhaarValid = AADHAR_RE.test((data.kycAadhar || '').trim())
  const panValid = PAN_RE.test((panNumberExtracted || '').replace(/\s/g, '').toUpperCase())

  // "Required before proceeding" checklist — Father's Name is called out as
  // optional (matches legacy: it's never a hard KYC-step blocker), so it's
  // excluded from the all-checks-passed gate below even though it still
  // shows its own pill.
  const checklist: { label: string; ok: boolean; optional?: boolean }[] = [
    { label: 'PAN uploaded', ok: panImages.length > 0 },
    { label: 'Aadhaar front uploaded', ok: aadhaarImages.length > 0 },
    { label: 'Aadhaar back uploaded', ok: aadhaarBackImages.length > 0 },
    { label: 'PAN number extracted', ok: !!panNumberExtracted },
    { label: 'Aadhaar number (12 digits)', ok: aadhaarValid },
    { label: 'Name extracted', ok: !!data.kycFirstName },
    { label: 'Date of Birth', ok: !!data.kycDob },
    { label: "Father's Name (optional)", ok: !!data.kycFather, optional: true },
  ]
  const allChecksPassed = checklist.filter(c => !c.optional).every(c => c.ok)

  const fmtKb = (f?: File) => f ? `${Math.max(1, Math.round(f.size / 1024))} KB` : ''

  return (
    <div className="relative">
      {/* Scan overlay during extraction — previously Vanilla's kyc-loading-overlay
          ID-card scan animation; now the shared loanms-loader badge, same
          overlay chrome (position/backdrop/rounded corners) and same
          `extracting` trigger condition. */}
      {extracting && (
        <OverlayLoader title="Processing document" subtitle="AI-powered identity verification" />
      )}

      {/* Intro copy */}
      <p className="text-[13px] leading-relaxed mb-4" style={{ color: 'var(--text3)' }}>
        Upload Aadhaar and PAN card. Details will be automatically extracted and pre-filled into the application. All extracted fields remain editable.
      </p>

      {/* Document cards — PAN on the left, Aadhaar (front + back) on the right */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* PAN Card */}
        <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: `1.5px solid ${panImages.length > 0 ? 'var(--success)' : 'var(--border2)'}` }}>
          <div className="flex items-start gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(227,30,37,.08)' }}>
              <IdCard size={18} style={{ color: 'var(--accent2)' }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>PAN Card</span>
                <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: 'rgba(227,30,37,.08)', color: 'var(--accent2)' }}>Required</span>
              </div>
              <div className="text-[10.5px] leading-snug" style={{ color: 'var(--text3)' }}>Permanent Account Number · JPG / PNG / PDF</div>
            </div>
            {panImages.length > 0 && (
              <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full" style={{ background: 'rgba(26,115,64,.08)', color: 'var(--success)' }}>
                <Check size={10} /> Ready
              </span>
            )}
          </div>

          {panImages.length > 0 ? (
            <>
              <div className="rounded-xl overflow-hidden mb-3 h-[130px] flex items-center justify-center" style={{ background: '#0b1220' }}>
                {panPreviewUrl
                  ? <img src={panPreviewUrl} alt="PAN card preview" className="w-full h-full object-contain" />
                  : <FileImage size={28} style={{ color: '#64748b' }} />}
              </div>
              <label className="block cursor-pointer">
                <div className="flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-[12px] font-semibold transition-colors hover:brightness-95"
                  style={{ border: '1.5px solid var(--success)', color: 'var(--success)', background: 'rgba(26,115,64,.04)' }}>
                  <Upload size={13} /> Change PAN
                </div>
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => handlePanFilesSelect(e.target.files)} />
              </label>
              <div className="text-[10.5px] mt-1.5 truncate" style={{ color: 'var(--text3)' }}>✓ {panImages[0].name}</div>
            </>
          ) : (
            docTile({ heading: 'Upload PAN card', sub: 'JPG, PNG or PDF', files: panImages, onSelect: handlePanFilesSelect, onClear: () => { setPanImages([]); setExtractionStatus(s => ({ ...s, pan: undefined })) }, accent: 'var(--accent2)', accentSoft: 'rgba(227,30,37,.06)' })
          )}
        </div>

        {/* Aadhaar Card — front + back */}
        <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: `1.5px solid ${aadhaarBothSides ? 'var(--success)' : 'var(--border2)'}` }}>
          <div className="flex items-start gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(10,88,154,.08)' }}>
              <ShieldCheck size={18} style={{ color: 'var(--accent)' }} />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>Aadhaar Card</span>
              <div className="text-[10.5px] leading-snug" style={{ color: 'var(--text3)' }}>UIDAI Identity Document · Front &amp; Back required</div>
            </div>
            {aadhaarReadyLabel && (
              <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full" style={{ background: 'rgba(26,115,64,.08)', color: 'var(--success)' }}>
                <Check size={10} /> {aadhaarReadyLabel}
              </span>
            )}
          </div>

          {/* Front side */}
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text3)' }}>
            <span style={{ width: 10, height: 2, borderRadius: 1, background: 'var(--accent)' }} />
            Front Side <span style={{ color: 'var(--accent2)' }}>*</span>
          </div>
          {aadhaarImages.length > 0 ? (
            <>
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 mb-2 text-[11.5px]" style={{ background: 'var(--surface2)', color: 'var(--text2)' }}>
                <FileCheck size={13} style={{ color: 'var(--success)' }} />
                <span className="truncate flex-1">{aadhaarImages[0].name}</span>
                <span style={{ color: 'var(--text3)' }}>({fmtKb(aadhaarImages[0])})</span>
              </div>
              <label className="block cursor-pointer">
                <div className="flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-[12px] font-semibold transition-colors hover:brightness-95"
                  style={{ border: '1.5px solid var(--success)', color: 'var(--success)', background: 'rgba(26,115,64,.04)' }}>
                  <Upload size={13} /> Change Aadhaar
                </div>
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => handleAadhaarFilesSelect(e.target.files)} />
              </label>
              <div className="text-[10.5px] mt-1.5 mb-3 truncate" style={{ color: 'var(--text3)' }}>✓ {aadhaarImages[0].name}</div>
            </>
          ) : (
            <div className="mb-3">
              {docTile({ heading: 'Upload front side', sub: 'JPG, PNG or PDF', files: aadhaarImages, onSelect: handleAadhaarFilesSelect, onClear: () => { setAadhaarImages([]); setExtractionStatus(s => ({ ...s, aadhaar: undefined })) }, accent: 'var(--accent)', accentSoft: 'rgba(10,88,154,.06)' })}
            </div>
          )}

          <div className="h-px my-1" style={{ background: 'var(--border)' }} />

          {/* Back side */}
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide mb-1.5 mt-2" style={{ color: 'var(--text3)' }}>
            <span style={{ width: 10, height: 2, borderRadius: 1, background: 'var(--accent)' }} />
            Back Side <span style={{ color: 'var(--accent2)' }}>*</span>
          </div>
          {aadhaarBackImages.length > 0 ? (
            <>
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 mb-2 text-[11.5px]" style={{ background: 'var(--surface2)', color: 'var(--text2)' }}>
                <FileCheck size={13} style={{ color: 'var(--success)' }} />
                <span className="truncate flex-1">{aadhaarBackImages[0].name}</span>
                <span style={{ color: 'var(--text3)' }}>({fmtKb(aadhaarBackImages[0])})</span>
              </div>
              <label className="block cursor-pointer">
                <div className="flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-[12px] font-semibold transition-colors hover:brightness-95"
                  style={{ border: '1.5px solid var(--success)', color: 'var(--success)', background: 'rgba(26,115,64,.04)' }}>
                  <Upload size={13} /> Change Back Side
                </div>
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => handleAadhaarBackFilesSelect(e.target.files)} />
              </label>
              <div className="text-[10.5px] mt-1.5 truncate" style={{ color: 'var(--text3)' }}>✓ {aadhaarBackImages[0].name}</div>
            </>
          ) : (
            docTile({ heading: 'Upload back side', sub: 'JPG, PNG or PDF', files: aadhaarBackImages, onSelect: handleAadhaarBackFilesSelect, onClear: () => { setAadhaarBackImages([]); setExtractionStatus(s => ({ ...s, aadhaar: undefined })) }, accent: 'var(--accent)', accentSoft: 'rgba(10,88,154,.06)' })
          )}
        </div>
      </div>

      {/* Extract / Re-Extract button */}
      <div className="text-center mt-5">
        <button type="button" onClick={() => void extractAll()} disabled={!canExtract || extracting}
          className="px-8 py-2.5 text-white text-sm font-semibold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 transition-colors hover:brightness-110"
          style={{ background: 'var(--accent)' }}>
          {extracting
            ? (<><InlineLoader size={15} /> Extracting…</>)
            : extractedOk
              ? (<><ScanLine size={15} /> Re-Extract</>)
              : (<><ScanLine size={15} /> Extract &amp; Auto-Fill Details</>)}
        </button>
        <div className="mt-2 text-[11px]" style={{ color: 'var(--text3)' }}>AI-powered OCR · works with images &amp; PDFs</div>
        {!kycStatus?.configured && (
          <div className="mt-2.5 text-[11px] px-3.5 py-2 rounded-lg text-center inline-block" style={{ border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e' }}>
            ⚠️ AI Vision not configured for this workspace — extraction will use basic OCR mode.
          </div>
        )}
      </div>

      {extractionStatus.pan?.message && (
        <div className="mt-4 px-3 py-2 rounded-lg text-xs font-semibold"
          style={extractionStatus.pan.status === 'success' ? { background: 'rgba(26,115,64,.1)', color: 'var(--success)' } : extractionStatus.pan.status === 'error' ? { background: 'rgba(227,30,37,.1)', color: 'var(--danger)' } : { background: 'rgba(10,88,154,.1)', color: 'var(--accent)' }}>
          PAN: {extractionStatus.pan.message}
        </div>
      )}
      {extractionStatus.aadhaar?.message && (
        <div className="mt-2 px-3 py-2 rounded-lg text-xs font-semibold"
          style={extractionStatus.aadhaar.status === 'success' ? { background: 'rgba(26,115,64,.1)', color: 'var(--success)' } : extractionStatus.aadhaar.status === 'error' ? { background: 'rgba(227,30,37,.1)', color: 'var(--danger)' } : { background: 'rgba(10,88,154,.1)', color: 'var(--accent)' }}>
          Aadhaar: {extractionStatus.aadhaar.message}
        </div>
      )}

      {/* Required-before-proceeding checklist */}
      <div className="mt-5 rounded-2xl p-3.5" style={{ background: 'var(--surface2)', border: '1px solid var(--border2)' }}>
        <div className="flex items-center gap-1.5 text-[11.5px] font-bold mb-2.5" style={{ color: 'var(--text2)' }}>
          <ListChecks size={14} style={{ color: 'var(--accent2)' }} /> Required before proceeding to Next step
        </div>
        <div className="flex flex-wrap gap-2">
          {checklist.map(c => (
            <span key={c.label} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
              style={c.ok ? { background: 'rgba(26,115,64,.08)', color: 'var(--success)', border: '1px solid rgba(26,115,64,.2)' } : { background: 'var(--surface)', color: 'var(--text3)', border: '1px solid var(--border2)' }}>
              {c.ok ? <Check size={11} /> : '○'} {c.label}
            </span>
          ))}
        </div>
      </div>

      {/* Extracted Information */}
      {(panImages.length > 0 || aadhaarImages.length > 0 || extractedOk) && (
        <div className="mt-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5 text-[13px] font-bold" style={{ color: 'var(--text)' }}>
              <div className="w-4 h-4 rounded flex items-center justify-center" style={{ background: 'var(--success)' }}>
                <Check size={11} color="#fff" />
              </div>
              Extracted Information
            </div>
            {allChecksPassed && (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-1 rounded-full" style={{ background: 'rgba(26,115,64,.08)', color: 'var(--success)' }}>
                <Check size={11} /> All checks passed
              </span>
            )}
          </div>

          {/* PAN CARD — EXTRACTED DATA */}
          <div className="flex items-center gap-2 mb-2">
            <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--accent)' }} />
            <span className="text-[10.5px] font-bold uppercase tracking-wide" style={{ color: 'var(--text2)' }}>PAN Card — Extracted Data</span>
            {panValid && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(26,115,64,.08)', color: 'var(--success)' }}>
                <Check size={10} /> Valid PAN
              </span>
            )}
          </div>
          <div className="rounded-2xl p-4 mb-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <p className="flex items-center gap-1.5 text-[11px] mb-3.5" style={{ color: 'var(--text3)' }}>
              <Pencil size={11} /> All fields are editable — click any field to correct. Changes sync instantly to the application form.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-3">
              <FormGroup label="First Name (from PAN)" action={fixBtn('kyc-out-fname')}>
                <TextInput id="kyc-out-fname" value={data.kycFirstName} onChange={v => onChange({ kycFirstName: v, firstName: v })}
                  onBlur={() => touch('kycFirstName')} placeholder="—" style={filledStyle(!!data.kycFirstName)} />
              </FormGroup>
              <FormGroup label="Middle Name (from PAN)" action={fixBtn('kyc-out-mname')}>
                <TextInput id="kyc-out-mname" value={data.middleName} onChange={v => onChange({ middleName: v })}
                  onBlur={() => touch('middleName')} placeholder="—" style={filledStyle(!!data.middleName)} />
              </FormGroup>
              <FormGroup label="Last Name (from PAN)" action={fixBtn('kyc-out-lname')}>
                <TextInput id="kyc-out-lname" value={data.kycLastName} onChange={v => onChange({ kycLastName: v, lastName: v })}
                  placeholder="—" style={filledStyle(!!data.kycLastName)} />
              </FormGroup>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-3">
              <FormGroup label="PAN Number">
                <TextInput value={data.pan} onChange={v => onChange({ pan: v })} placeholder="—" className="font-mono" style={filledStyle(!!panNumberExtracted)} />
              </FormGroup>
              <FormGroup label="Date of Birth" action={fixBtn('kyc-out-dob')}>
                <TextInput id="kyc-out-dob" value={data.kycDob} onChange={v => onChange({ kycDob: v, dob: v })} type="date" style={filledStyle(!!data.kycDob)} />
              </FormGroup>
              <FormGroup label="Father's Name" action={fixBtn('kyc-out-father')}>
                <TextInput id="kyc-out-father" value={data.kycFather} onChange={v => onChange({ kycFather: v, father: v })}
                  placeholder="—" style={filledStyle(!!data.kycFather)} />
              </FormGroup>
            </div>
          </div>

          {/* AADHAAR CARD — EXTRACTED DATA */}
          <div className="flex items-center gap-2 mb-2">
            <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--accent)' }} />
            <span className="text-[10.5px] font-bold uppercase tracking-wide" style={{ color: 'var(--text2)' }}>Aadhaar Card — Extracted Data</span>
            {aadhaarValid && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(26,115,64,.08)', color: 'var(--success)' }}>
                <Check size={10} /> Valid Aadhaar
              </span>
            )}
          </div>
          <div className="rounded-2xl p-4 mb-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <p className="flex items-center gap-1.5 text-[11px] mb-3.5" style={{ color: 'var(--text3)' }}>
              <Pencil size={11} /> All fields are editable — click any field or ✎ to correct. Changes sync instantly.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-3">
              <FormGroup label="Aadhaar Number" required error={errors.kycAadhar} action={fixBtn('kyc-out-aadhar')}>
                <TextInput id="kyc-out-aadhar" value={data.kycAadhar} onChange={v => onChange({ kycAadhar: v, aadhar: v })}
                  onBlur={() => touch('kycAadhar')} placeholder="XXXXXXXXXXXX" maxLength={12} minLength={12}
                  inputMode="numeric" pattern="\d{12}" digitsOnly className="font-mono" style={filledStyle(aadhaarValid)} />
              </FormGroup>
              <FormGroup label="Name on Aadhaar" action={fixBtn('kyc-out-aname')}>
                <TextInput id="kyc-out-aname" value={aadhaarFullNameExtracted} onChange={setAadhaarFullNameExtracted} placeholder="—" style={filledStyle(!!aadhaarFullNameExtracted)} />
              </FormGroup>
              <FormGroup label="Gender" action={fixBtn('kyc-out-gender')}>
                <SelectInput id="kyc-out-gender" value={data.kycGender} onChange={v => onChange({ kycGender: v, gender: v })}
                  options={[{ value: 'M', label: 'Male' }, { value: 'F', label: 'Female' }, { value: 'O', label: 'Other' }]} placeholder="—" style={filledStyle(!!data.kycGender)} />
              </FormGroup>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-3">
              <FormGroup label="House / Flat No." action={fixBtn('kyc-out-street1')}>
                <TextInput id="kyc-out-street1" value={data.street1} onChange={v => onChange({ street1: v, kycStreet1: v })}
                  onBlur={() => touch('street1')} placeholder="—" style={filledStyle(!!data.street1)} />
              </FormGroup>
              <FormGroup label="Street & Locality" action={fixBtn('kyc-out-street2')}>
                <TextInput id="kyc-out-street2" value={data.street2} onChange={v => onChange({ street2: v })}
                  onBlur={() => touch('street2')} placeholder="—" style={filledStyle(!!data.street2)} />
              </FormGroup>
              <FormGroup label="City / District" action={fixBtn('kyc-out-city')}>
                <TextInput id="kyc-out-city" value={data.kycCity} onChange={v => onChange({ kycCity: v, city: v })}
                  placeholder="—" style={filledStyle(!!data.kycCity)} />
              </FormGroup>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-3">
              <FormGroup label="Pin Code" error={errors.kycPin} action={fixBtn('kyc-out-pin')}>
                <TextInput id="kyc-out-pin" value={data.kycPin} onChange={v => onChange({ kycPin: v, zip: v })}
                  onBlur={() => touch('kycPin')} placeholder="6-digit" maxLength={6} minLength={6} inputMode="numeric" pattern="\d{6}" digitsOnly style={filledStyle(!!data.kycPin)} />
              </FormGroup>
              <FormGroup label="State" action={fixBtn('kyc-out-state')}>
                <TextInput id="kyc-out-state" value={data.kycState} onChange={v => onChange({ kycState: v, state: v })}
                  placeholder="—" style={filledStyle(!!data.kycState)} />
              </FormGroup>
            </div>
            <FormGroup label="Full Address (as on Aadhaar)" action={fixBtn('kyc-out-address')}>
              <TextInput id="kyc-out-address" value={[data.street1, data.street2, data.kycCity, data.kycState, data.kycPin].filter(Boolean).join(', ')}
                onChange={() => {}} readOnly placeholder="—" style={filledStyle(!!(data.street1 || data.kycCity))} />
            </FormGroup>
          </div>
        </div>
      )}

      {/* Cross-validation — matches legacy kycCrossValidate; shown once both
          documents are extracted. */}
      {crossValidateChecks.length > 0 && (
        <div className="mt-1 p-3.5 rounded-[14px] text-xs flex items-start gap-2.5"
          style={crossValidatePassed
            ? { background: 'rgba(26,115,64,.06)', border: '1px solid rgba(26,115,64,.2)' }
            : { background: 'rgba(230,126,0,.06)', border: '1px solid rgba(230,126,0,.25)' }}>
          {crossValidatePassed
            ? <ShieldCheck size={16} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 1 }} />
            : <AlertTriangle size={16} style={{ color: 'var(--warn)', flexShrink: 0, marginTop: 1 }} />}
          <div>
            <p className="font-semibold mb-1" style={{ color: crossValidatePassed ? 'var(--success)' : 'var(--warn)' }}>
              {crossValidatePassed ? 'Cross-Validation Passed' : 'Review required'}
            </p>
            <div className="space-y-1">
              {crossValidateChecks.map((c, i) => (
                <p key={i} style={{ color: c.ok ? 'var(--success)' : '#92610b' }}>{c.ok ? '✓' : '⚠'} {c.label}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* KYC Report / Download — reproduces legacy kyc.js's kycBuildReport/
          kycDownloadReport: a plain-text summary, downloaded as .txt. */}
      <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
        <button type="button" onClick={() => setShowKycReport(v => !v)}
          className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>
          {showKycReport ? 'Hide' : 'Show'} KYC Report
        </button>
        {showKycReport && (
          <div className="mt-3 p-4 rounded-[14px]" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
            <div className="text-[11px] mb-3" style={{ color: 'var(--text3)' }}>Generated: {new Date().toLocaleString('en-IN')}</div>
            <div className="space-y-1.5 text-xs">
              {kycReportRows.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-3 py-1" style={{ borderBottom: i < kycReportRows.length - 1 ? '1px solid var(--border)' : undefined }}>
                  <span style={{ color: 'var(--text3)' }}>{r.label}</span>
                  <span style={{ color: r.ok ? 'var(--success)' : 'var(--text3)', fontWeight: r.ok ? 600 : 400 }}>{r.value}</span>
                </div>
              ))}
            </div>
            <button type="button" onClick={downloadKycReport}
              className="mt-3 text-xs font-semibold rounded-lg px-3 py-1.5"
              style={{ color: 'var(--accent)', border: '1px solid var(--border2)' }}>
              Download Report
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

