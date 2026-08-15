import { useCallback, useRef, useState } from 'react'
import type { AccountInfo, AbbData, Transaction, ValidationCheck } from '@/utils/perfios/types'
import { getDocumentWithTimeout, extractText, PasswordException, type PDFDocumentProxy } from '@/utils/perfios/pdf'
import { parseTransactions, extractAccountInfo } from '@/utils/perfios/parser'
import { isACHTxn, isBounceTxn, isChequeTxn, isECSTxn, isNEFTTxn, isSalaryTxn, isUPITxn } from '@/utils/perfios/categorizer'
import {
  applyTargetDateFilter, buildABBFromTargetRows, computeOverallAbb,
} from '@/utils/perfios/calculations'
import { buildValidationChecks } from '@/utils/perfios/analysis'

// ── Per-bank password hints — ported unchanged from perfios-core.js's
// BANK_PWD_HINTS/detectBankFromFileName (lines 456-504). Pure UX hint data,
// not a financial calculation, so it lives with the upload layer rather
// than in utils/perfios/ alongside the Phase 1 core engine.
const BANK_PWD_HINTS: Record<string, { bank: string; hint: string; examples: string[] }> = {
  hdfc: { bank: 'HDFC Bank', hint: 'Typically Date of Birth in DDMMYYYY format (e.g., 01011990)', examples: ['01011990', 'DDMMYYYY', 'DD-MM-YYYY'] },
  sbi: { bank: 'SBI', hint: 'Account number or Date of Birth (DDMMYYYY)', examples: ['DDMMYYYY', 'Account No.'] },
  icici: { bank: 'ICICI Bank', hint: 'Date of Birth in DDMMYYYY or customer ID', examples: ['DDMMYYYY', 'Customer ID'] },
  axis: { bank: 'Axis Bank', hint: 'Date of Birth in DDMMYYYY format', examples: ['DDMMYYYY', 'DD-MM-YYYY'] },
  kotak: { bank: 'Kotak Bank', hint: 'Date of Birth in DDMMYYYY or last 4 digits of account', examples: ['DDMMYYYY', 'Last 4 digits'] },
  yes: { bank: 'Yes Bank', hint: 'Date of Birth in DDMMYYYY', examples: ['DDMMYYYY'] },
  pnb: { bank: 'PNB', hint: 'Date of Birth in DDMMYYYY or account number', examples: ['DDMMYYYY', 'Account No.'] },
  idfc: { bank: 'IDFC FIRST', hint: 'Date of Birth in DDMMYYYY', examples: ['DDMMYYYY'] },
  indusind: { bank: 'IndusInd', hint: 'Date of Birth in DDMMYYYY', examples: ['DDMMYYYY'] },
  canara: { bank: 'Canara Bank', hint: 'Account number (last 6 digits)', examples: ['Last 6 of account'] },
  bob: { bank: 'Bank of Baroda', hint: 'Date of Birth in DDMMYYYY', examples: ['DDMMYYYY'] },
  union: { bank: 'Union Bank', hint: 'Date of Birth in DDMMYYYY', examples: ['DDMMYYYY'] },
  boi: { bank: 'Bank of India', hint: 'Date of Birth DDMMYYYY or account number', examples: ['DDMMYYYY'] },
  federal: { bank: 'Federal Bank', hint: 'Date of Birth in DDMMYYYY', examples: ['DDMMYYYY'] },
  rbl: { bank: 'RBL Bank', hint: 'Date of Birth in DDMMYYYY', examples: ['DDMMYYYY'] },
  dcb: { bank: 'DCB Bank', hint: 'Date of Birth in DDMMYYYY', examples: ['DDMMYYYY'] },
  bandhan: { bank: 'Bandhan Bank', hint: 'Date of Birth in DDMMYYYY', examples: ['DDMMYYYY'] },
  au: { bank: 'AU Small Finance', hint: 'Date of Birth DDMMYYYY or PAN', examples: ['DDMMYYYY', 'PAN'] },
  standard: { bank: 'Standard Chartered', hint: 'Last 4 digits of account or DOB DDMMYYYY', examples: ['DDMMYYYY', 'Last 4 digits'] },
  hsbc: { bank: 'HSBC India', hint: 'Date of Birth in DDMMYYYY', examples: ['DDMMYYYY'] },
  dbs: { bank: 'DBS India', hint: 'Date of Birth in DDMMYYYY', examples: ['DDMMYYYY'] },
}

function detectBankFromFileName(name: string): string | null {
  const n = name.toLowerCase()
  if (n.includes('hdfc')) return 'hdfc'
  if (n.includes('sbi') || n.includes('state bank')) return 'sbi'
  if (n.includes('icici')) return 'icici'
  if (n.includes('axis')) return 'axis'
  if (n.includes('kotak')) return 'kotak'
  if (n.includes('yes bank') || n.includes('yesbank')) return 'yes'
  if (n.includes('pnb') || n.includes('punjab national')) return 'pnb'
  if (n.includes('idfc')) return 'idfc'
  if (n.includes('indusind')) return 'indusind'
  if (n.includes('canara')) return 'canara'
  if (n.includes('baroda') || n.includes('bob')) return 'bob'
  if (n.includes('union')) return 'union'
  if (n.includes('boi') || n.includes('bank of india')) return 'boi'
  if (n.includes('federal')) return 'federal'
  if (n.includes('rbl')) return 'rbl'
  if (n.includes('dcb')) return 'dcb'
  if (n.includes('bandhan')) return 'bandhan'
  if (n.includes('au ') || n.includes('au_') || n.includes('ausf')) return 'au'
  if (n.includes('standard') || n.includes('sc ') || n.includes('scb')) return 'standard'
  if (n.includes('hsbc')) return 'hsbc'
  if (n.includes('dbs')) return 'dbs'
  return null
}

function isPasswordError(err: unknown): boolean {
  const e = err as { name?: string; code?: number; message?: string } | null
  return !!e && (
    e.name === 'PasswordException' || err instanceof PasswordException ||
    e.code === 1 || e.code === 2 ||
    (!!e.message && e.message.toLowerCase().includes('password'))
  )
}

export interface PerFileData {
  fileName: string
  fileSize: number
  isProtected: boolean
  txnCount: number
}

// ── Output handoff shape for Phase 3 — mirrors legacy's PERFIOS_COMPLETE
// postMessage payload (perfios-popup.js _postToParent), minus DOM-specific
// fields (fileObjUrl/fileDataUrl) since there is no iframe/postMessage
// boundary here; the File objects themselves are passed through directly.
export interface PerfiosUploadResult {
  valid: boolean
  span: number
  staledays: number
  firstDate: Date
  lastDate: Date
  abb: number
  totalTxns: number
  allTxns: Transaction[]
  filtered90: Transaction[]
  salaryTxns: Transaction[]
  hasSalary: boolean
  achTxns: Transaction[]
  ecsTxns: Transaction[]
  neftTxns: Transaction[]
  upiTxns: Transaction[]
  chequeTxns: Transaction[]
  bounceTxns: Transaction[]
  overdraftTxns: Transaction[]
  hasBounces: boolean
  validChecks: ValidationCheck[]
  accountInfo: AccountInfo
  openingBalance: number
  abbData: AbbData
  monthOrder: string[]
  perFileData: PerFileData[]
  manualReviewRequired: boolean
  staleAttempts: number
}

type Status = 'idle' | 'processing' | 'password-required' | 'error' | 'complete'

interface PasswordPromptState {
  fileName: string
  attempts: number
  errorMessage: string | null
  bankHint: { bank: string; hint: string; examples: string[] } | null
  showApplyAll: boolean
}

const STALE_ATTEMPTS_MAX = 3

export function usePerfiosUpload() {
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [passwordPrompt, setPasswordPrompt] = useState<PasswordPromptState | null>(null)
  const [progress, setProgress] = useState<{ current: number; total: number; fileName: string } | null>(null)
  const [result, setResult] = useState<PerfiosUploadResult | null>(null)

  // In-memory only — never localStorage/sessionStorage/backend. Cleared by
  // reset() and naturally garbage-collected when the component unmounts.
  const bulkPasswordRef = useRef('')
  const pwdHistoryRef = useRef<string[]>([])
  const applyAllPasswordRef = useRef('')
  const staleAttemptsRef = useRef(0)

  // Cross-file accumulation state for the run currently in progress.
  const allTxnsRef = useRef<Transaction[]>([])
  const accountInfoRef = useRef<AccountInfo>({})
  const perFileDataRef = useRef<PerFileData[]>([])
  const pendingFilesRef = useRef<File[]>([])
  const currentIdxRef = useRef(0)
  const pendingResolveRef = useRef<((pwd: string | null) => void) | null>(null)

  const setBulkPassword = useCallback((pwd: string) => { bulkPasswordRef.current = pwd }, [])
  const clearBulkPassword = useCallback(() => { bulkPasswordRef.current = '' }, [])

  const reset = useCallback(() => {
    setStatus('idle'); setErrorMessage(null); setPasswordPrompt(null); setProgress(null); setResult(null)
    bulkPasswordRef.current = ''; pwdHistoryRef.current = []; applyAllPasswordRef.current = ''
    staleAttemptsRef.current = 0
    allTxnsRef.current = []; accountInfoRef.current = {}; perFileDataRef.current = []
    pendingFilesRef.current = []; currentIdxRef.current = 0; pendingResolveRef.current = null
  }, [])

  function waitForPassword(fileName: string, attempts: number, errorMessage: string | null, showApplyAll: boolean): Promise<string | null> {
    const bankKey = detectBankFromFileName(fileName)
    const bankHint = bankKey ? BANK_PWD_HINTS[bankKey] : null
    setPasswordPrompt({ fileName, attempts, errorMessage, bankHint, showApplyAll })
    setStatus('password-required')
    return new Promise(resolve => { pendingResolveRef.current = resolve })
  }

  async function openWithPassword(buf: ArrayBuffer, password?: string): Promise<PDFDocumentProxy> {
    return getDocumentWithTimeout({ data: buf, password })
  }

  async function unlockFile(file: File, fileName: string): Promise<PDFDocumentProxy | null> {
    // Matches legacy's _freshBuf(): always read a fresh ArrayBuffer from the
    // File object for each attempt, since pdf.js may transfer/detach a
    // previously-used buffer.
    const freshBuf = () => file.arrayBuffer()
    if (applyAllPasswordRef.current) {
      try { return await openWithPassword(await freshBuf(), applyAllPasswordRef.current) } catch { /* fall through */ }
    }
    if (bulkPasswordRef.current) {
      try {
        const pdf = await openWithPassword(await freshBuf(), bulkPasswordRef.current)
        pwdHistoryRef.current = [bulkPasswordRef.current, ...pwdHistoryRef.current.filter(p => p !== bulkPasswordRef.current)].slice(0, 10)
        return pdf
      } catch { /* fall through */ }
    }
    for (const ph of pwdHistoryRef.current) {
      try { return await openWithPassword(await freshBuf(), ph) } catch { /* continue */ }
    }
    let attempts = 0
    let lastError: string | null = null
    for (;;) {
      const remaining = pendingFilesRef.current.length - currentIdxRef.current - 1
      const pwd = await waitForPassword(fileName, attempts, lastError, remaining > 0)
      if (pwd === null) return null
      try {
        const pdf = await openWithPassword(await freshBuf(), pwd)
        pwdHistoryRef.current = [pwd, ...pwdHistoryRef.current.filter(p => p !== pwd)].slice(0, 10)
        return pdf
      } catch (err) {
        attempts++
        lastError = isPasswordError(err)
          ? `Incorrect password (attempt ${attempts}). Please try again.`
          : `Error processing file: ${(err as Error)?.message ?? 'unknown error'}`
      }
    }
  }

  const submitPassword = useCallback((password: string, applyToAll: boolean) => {
    if (applyToAll) applyAllPasswordRef.current = password
    pendingResolveRef.current?.(password)
    pendingResolveRef.current = null
  }, [])

  const skipFile = useCallback(() => {
    pendingResolveRef.current?.(null)
    pendingResolveRef.current = null
  }, [])

  async function processOneFile(file: File): Promise<void> {
    let isProtected = false
    let pdf: PDFDocumentProxy | null
    try {
      pdf = await getDocumentWithTimeout({ data: await file.arrayBuffer() })
    } catch (err) {
      if (!isPasswordError(err)) throw err
      isProtected = true
      pdf = await unlockFile(file, file.name)
    }
    if (!pdf) return // skipped by the user

    const text = await extractText(pdf)
    const txns = parseTransactions(text, file.name)
    extractAccountInfo(text, accountInfoRef.current)
    txns.forEach(t => { t._fileIdx = currentIdxRef.current })
    allTxnsRef.current.push(...txns)
    perFileDataRef.current.push({ fileName: file.name, fileSize: file.size, isProtected, txnCount: txns.length })
  }

  function finalize(): PerfiosUploadResult | { error: string } {
    const allTxns = allTxnsRef.current
    if (!allTxns.length) {
      return { error: '🚫 No transactions could be extracted. Possible reasons: (1) PDF is image/scanned — no text layer. (2) Unsupported bank format. (3) PDF is corrupted or password-protected. Please upload a text-based bank statement PDF.' }
    }

    allTxns.sort((a, b) => a.date.getTime() - b.date.getTime())
    const allTimestamps = allTxns.map(t => t.date.getTime())
    const firstDate = new Date(Math.min(...allTimestamps)); firstDate.setHours(0, 0, 0, 0)
    const lastDate = new Date(Math.max(...allTimestamps)); lastDate.setHours(0, 0, 0, 0)
    const daysDiff = Math.floor((lastDate.getTime() - firstDate.getTime()) / 86400000)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const staledays = Math.floor((today.getTime() - lastDate.getTime()) / 86400000)
    const cutoffDate = new Date(today); cutoffDate.setDate(today.getDate() - 7)

    if (daysDiff < 90) {
      return { error: `🚫 PERFIOS RUN FAILED [Rule 3.1] — Statement span too short: ${daysDiff} days. The gap between the first and last transaction must be at least 90 days.` }
    }

    if (staledays > 7) {
      staleAttemptsRef.current += 1
      const exhausted = staleAttemptsRef.current >= STALE_ATTEMPTS_MAX
      if (!exhausted) {
        return { error: `🚫 PERFIOS RUN FAILED [Rule 3.2] — Statement is stale: last transaction was on ${lastDate.toLocaleDateString('en-IN')} (${staledays} days ago). Attempt ${staleAttemptsRef.current}/3 — please upload an additional/more recent bank statement.` }
      }
      // Exhausted — legacy still proceeds, flagged for manual review.
    }

    const windowStart = new Date(lastDate); windowStart.setDate(windowStart.getDate() - 90)
    const filtered90 = allTxns.filter(t => t.date.getTime() >= windowStart.getTime())

    const SALARY_MIN_AMOUNT = 3000
    const salaryTxns = allTxns.filter(t => t.type === 'CR' && t.amount >= SALARY_MIN_AMOUNT && isSalaryTxn(t.rawDesc || t.desc))
    const achTxns = allTxns.filter(t => isACHTxn(t.rawDesc || t.desc))
    const ecsTxns = allTxns.filter(t => isECSTxn(t.rawDesc || t.desc))
    const neftTxns = allTxns.filter(t => isNEFTTxn(t.rawDesc || t.desc))
    const upiTxns = allTxns.filter(t => isUPITxn(t.rawDesc || t.desc))
    const chequeTxns = allTxns.filter(t => isChequeTxn(t.rawDesc || t.desc))
    const bounceTxns = allTxns.filter(t => isBounceTxn(t.rawDesc || t.desc))
    const overdraftTxns = allTxns.filter(t => t.balance < 0)

    const targetRows = applyTargetDateFilter(allTxns)
    const { abbData, monthOrder } = buildABBFromTargetRows(targetRows, allTxns)
    const abb = computeOverallAbb(abbData, monthOrder)
    const openingBalance = allTxns.length
      ? (allTxns[0].type === 'CR' ? allTxns[0].balance - allTxns[0].amount : allTxns[0].balance + allTxns[0].amount)
      : 0

    const validChecks = buildValidationChecks({
      firstDate, lastDate, daysDiff, staledays, today, cutoffDate, salaryTxns,
      achTxns, ecsTxns, neftTxns, upiTxns, bounceTxns, overdraftTxns,
      allTxns, filtered90, uploadedFileNames: perFileDataRef.current.map(f => f.fileName),
    })

    const manualReviewRequired = staledays > 7 && staleAttemptsRef.current >= STALE_ATTEMPTS_MAX

    return {
      valid: daysDiff >= 90 && staledays <= 7,
      span: daysDiff, staledays, firstDate, lastDate, abb,
      totalTxns: filtered90.length, allTxns, filtered90,
      salaryTxns, hasSalary: salaryTxns.length > 0,
      achTxns, ecsTxns, neftTxns, upiTxns, chequeTxns,
      bounceTxns, overdraftTxns, hasBounces: bounceTxns.length > 0,
      validChecks, accountInfo: accountInfoRef.current, openingBalance,
      abbData, monthOrder, perFileData: perFileDataRef.current,
      manualReviewRequired, staleAttempts: staleAttemptsRef.current,
    }
  }

  const addFiles = useCallback(async (files: File[]) => {
    const pdfFiles = files.filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
    if (!pdfFiles.length) {
      setStatus('error'); setErrorMessage('Please select PDF bank statement file(s).')
      return
    }

    allTxnsRef.current = []; accountInfoRef.current = {}; perFileDataRef.current = []
    applyAllPasswordRef.current = ''
    pendingFilesRef.current = pdfFiles
    currentIdxRef.current = 0
    setErrorMessage(null); setResult(null)
    setStatus('processing')

    try {
      for (let i = 0; i < pdfFiles.length; i++) {
        currentIdxRef.current = i
        setProgress({ current: i + 1, total: pdfFiles.length, fileName: pdfFiles[i].name })
        try {
          await processOneFile(pdfFiles[i])
        } catch (err) {
          console.warn('[Perfios] Error processing file:', pdfFiles[i].name, err)
        }
      }
      setPasswordPrompt(null)
      const outcome = finalize()
      if ('error' in outcome) {
        setStatus('error'); setErrorMessage(outcome.error)
      } else {
        setResult(outcome); setStatus('complete')
      }
    } catch (err) {
      setStatus('error')
      setErrorMessage((err as Error)?.message || 'Perfios processing failed.')
    } finally {
      setProgress(null)
    }
  }, [])

  return {
    status, errorMessage, passwordPrompt, progress, result,
    addFiles, submitPassword, skipFile, setBulkPassword, clearBulkPassword, reset,
  }
}
