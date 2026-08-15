// Phase 3 verification: runs a real PDF through the actual pdfjs-dist +
// Phase 1 parser pipeline (same test-harness note as perfios-upload-check.ts
// — the Vite-only `?url` worker import in pdf.ts can't run under plain
// Node/tsx, so this script re-implements the same two functions verbatim
// against pdfjs-dist's Node-compatible legacy build; the real app always
// goes through pdf.ts itself, already proven working via `npm run build`),
// then reproduces Phase 2's finalize() logic inline (same functions, same
// order) and feeds the result through Phase 3's buildFullAnalysis to check
// every dataset it's supposed to produce.
import { readFileSync } from 'fs'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { parseTransactions, extractAccountInfo } from '../src/utils/perfios/parser'
import { isACHTxn, isBounceTxn, isChequeTxn, isECSTxn, isNEFTTxn, isSalaryTxn, isUPITxn } from '../src/utils/perfios/categorizer'
import { applyTargetDateFilter, buildABBFromTargetRows, computeOverallAbb } from '../src/utils/perfios/calculations'
import { buildValidationChecks } from '../src/utils/perfios/analysis'
import { buildFullAnalysis } from '../src/utils/perfios/orchestrate'
import type { PerfiosUploadResult } from '../src/hooks/usePerfiosUpload'

async function getDocumentWithTimeout(params: { data: ArrayBuffer }, timeoutMs = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    const task = (pdfjsLib as any).getDocument(params)
    const timer = setTimeout(() => { try { task.destroy() } catch { /* ignore */ }; reject(new Error('timeout')) }, timeoutMs)
    task.promise.then((pdf: any) => { clearTimeout(timer); resolve(pdf) }, (err: any) => { clearTimeout(timer); reject(err) })
  })
}
async function extractText(pdf: any): Promise<string> {
  let full = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const items = content.items as Array<{ str?: string; transform?: number[] }>
    if (!items.length) continue
    const positioned: { str: string; x: number; y: number }[] = []
    for (const item of items) {
      if (!item.str) continue
      positioned.push({ str: item.str, x: item.transform ? item.transform[4] : 0, y: item.transform ? item.transform[5] : 0 })
    }
    positioned.sort((a, b) => b.y - a.y)
    const rows: typeof positioned[] = []
    let curRow: typeof positioned | null = null
    let curY: number | null = null
    const ys = [...new Set(positioned.map(p => Math.round(p.y)))].sort((a, b) => b - a)
    const gaps: number[] = []
    for (let k = 1; k < ys.length; k++) gaps.push(Math.abs(ys[k - 1] - ys[k]))
    gaps.sort((a, b) => a - b)
    const rowTol = Math.max(4, Math.min((gaps.length ? gaps[Math.floor(gaps.length / 2)] : 10) * 0.6, 14))
    for (const p of positioned) {
      if (curY === null || Math.abs(p.y - curY) > rowTol) { curRow = []; rows.push(curRow); curY = p.y }
      curRow!.push(p)
    }
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x)
      let line = ''; let prevX: number | null = null; let prevLen = 0
      for (const p of row) {
        if (prevX !== null) {
          const gap = p.x - prevX - prevLen
          if (gap > 12) line += '  '
          else if (gap > 3 && !line.endsWith(' ') && !p.str.startsWith(' ')) line += ' '
        }
        line += p.str; prevX = p.x; prevLen = p.str.length * 5
      }
      line = line.trim()
      if (line) full += line + '\n'
    }
    full += '\n'
  }
  return full
}

async function main() {
  const buf = readFileSync('/tmp/full_statement.pdf')
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const pdf = await getDocumentWithTimeout({ data: arrayBuffer })
  const text = await extractText(pdf)
  const allTxns = parseTransactions(text, 'full_statement.pdf')
  const accountInfo = extractAccountInfo(text, {})

  console.log(`Parsed ${allTxns.length} transactions (expected 7)`)

  // ── Reproduce Phase 2's finalize() exactly (same functions, same order) ──
  allTxns.sort((a, b) => a.date.getTime() - b.date.getTime())
  const firstDate = new Date(Math.min(...allTxns.map(t => t.date.getTime()))); firstDate.setHours(0, 0, 0, 0)
  const lastDate = new Date(Math.max(...allTxns.map(t => t.date.getTime()))); lastDate.setHours(0, 0, 0, 0)
  const daysDiff = Math.floor((lastDate.getTime() - firstDate.getTime()) / 86400000)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const staledays = Math.floor((today.getTime() - lastDate.getTime()) / 86400000)
  const cutoffDate = new Date(today); cutoffDate.setDate(today.getDate() - 7)
  const windowStart = new Date(lastDate); windowStart.setDate(windowStart.getDate() - 90)
  const filtered90 = allTxns.filter(t => t.date.getTime() >= windowStart.getTime())
  const salaryTxns = allTxns.filter(t => t.type === 'CR' && t.amount >= 3000 && isSalaryTxn(t.rawDesc || t.desc))
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
  const validChecks = buildValidationChecks({
    firstDate, lastDate, daysDiff, staledays, today, cutoffDate, salaryTxns,
    achTxns, ecsTxns, neftTxns, upiTxns, bounceTxns, overdraftTxns,
    allTxns, filtered90, uploadedFileNames: ['full_statement.pdf'],
  })

  const upload: PerfiosUploadResult = {
    valid: daysDiff >= 90 && staledays <= 7, span: daysDiff, staledays, firstDate, lastDate, abb,
    totalTxns: filtered90.length, allTxns, filtered90, salaryTxns, hasSalary: salaryTxns.length > 0,
    achTxns, ecsTxns, neftTxns, upiTxns, chequeTxns, bounceTxns, overdraftTxns, hasBounces: bounceTxns.length > 0,
    validChecks, accountInfo, openingBalance: allTxns[0].type === 'CR' ? allTxns[0].balance - allTxns[0].amount : allTxns[0].balance + allTxns[0].amount,
    abbData, monthOrder, perFileData: [{ fileName: 'full_statement.pdf', fileSize: buf.length, isProtected: false, txnCount: allTxns.length }],
    manualReviewRequired: false, staleAttempts: 0,
  }

  console.log(`\nSpan: ${daysDiff} days | Expected 106 | ${daysDiff === 106 ? 'PASS' : 'FAIL'}`)
  console.log(`Staleness: ${staledays} days | Expected 0 | ${staledays === 0 ? 'PASS' : 'FAIL'}`)
  console.log(`First txn: ${firstDate.toDateString()} | Last txn: ${lastDate.toDateString()}`)
  console.log(`ABB: ${abb.toFixed(2)}`)
  console.log(`Salary txns: ${salaryTxns.length} | Expected 3 | ${salaryTxns.length === 3 ? 'PASS' : 'FAIL'}`)
  console.log(`isValid: ${upload.valid} | Expected true | ${upload.valid ? 'PASS' : 'FAIL'}`)
  console.log(`manualReviewRequired: ${upload.manualReviewRequired} | Expected false | ${!upload.manualReviewRequired ? 'PASS' : 'FAIL'}`)
  console.log(`Validation checks produced: ${validChecks.length} | Expected 11 | ${validChecks.length === 11 ? 'PASS' : 'FAIL'}`)
  console.log(`Month keys: ${monthOrder.join(', ')} | Expected 4 months | ${monthOrder.length === 4 ? 'PASS' : 'FAIL'}`)

  // ── Phase 3 orchestration ──
  const full = buildFullAnalysis(upload)
  console.log(`\nFinOne rows: ${full.finOne.length} | Expected 5 (4 months + TOTAL) | ${full.finOne.length === 5 ? 'PASS' : 'FAIL'}`)
  console.log(`Analysis rows: ${full.analysis.length} | Expected 73 (verified against legacy's metricDefs count) | ${full.analysis.length === 73 ? 'PASS' : 'FAIL'}`)
  console.log(`Breakup income categories: ${full.breakup.income.length} | Expected 12 | ${full.breakup.income.length === 12 ? 'PASS' : 'FAIL'}`)
  console.log(`Breakup expense categories: ${full.breakup.expense.length} | Expected 13 | ${full.breakup.expense.length === 13 ? 'PASS' : 'FAIL'}`)
  console.log(`EOD grid day-keys: ${Object.keys(full.eod).length} | Expected 31 | ${Object.keys(full.eod).length === 31 ? 'PASS' : 'FAIL'}`)

  console.log('\n--- FinOne TOTAL row sanity ---')
  const totalRow = full.finOne.find(r => r.month === 'TOTAL')
  console.log(totalRow)
}

main()
