// Phase 2 verification: exercises the REAL pdfjs-dist pipeline against an
// actual PDF file (not a mock), then feeds the extracted text through the
// Phase 1 parser — a true end-to-end check of the upload layer's
// PDF-handling path, run outside the React component (which needs a
// browser DOM) via plain Node + tsx.
//
// NOTE ON TEST HARNESS vs REAL APP: src/utils/perfios/pdf.ts configures its
// PDF.js worker via `import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.
// min.mjs?url'` — Vite's `?url` asset-import syntax, which only Vite's
// bundler understands (confirmed working: `npm run build` succeeds and
// bundles it correctly). Plain Node/tsx cannot resolve that import outside
// Vite, so this script re-implements the same two functions
// (getDocumentWithTimeout/extractText, copied verbatim) against pdfjs-dist's
// Node-compatible legacy build purely so this standalone script can run;
// the actual app always goes through pdf.ts itself. This is a test-harness
// limitation, not a defect in pdf.ts.
import { readFileSync } from 'fs'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { parseTransactions } from '../src/utils/perfios/parser'

const PasswordException = (pdfjsLib as any).PasswordException

async function getDocumentWithTimeout(params: { data: ArrayBuffer; password?: string }, timeoutMs = 30000): Promise<any> {
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
      const y = item.transform ? item.transform[5] : 0
      const x = item.transform ? item.transform[4] : 0
      positioned.push({ str: item.str, x, y })
    }
    positioned.sort((a, b) => b.y - a.y)
    const rows: typeof positioned[] = []
    let curRow: typeof positioned | null = null
    let curY: number | null = null
    const ys = [...new Set(positioned.map(p => Math.round(p.y)))].sort((a, b) => b - a)
    const gaps: number[] = []
    for (let k = 1; k < ys.length; k++) gaps.push(Math.abs(ys[k - 1] - ys[k]))
    gaps.sort((a, b) => a - b)
    const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 10
    const rowTol = Math.max(4, Math.min(medianGap * 0.6, 14))
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

async function testNormalPdf() {
  console.log('\n=== TEST 1: normal PDF ===')
  const buf = readFileSync('/tmp/normal_statement.pdf')
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  try {
    const pdf = await getDocumentWithTimeout({ data: arrayBuffer })
    const text = await extractText(pdf)
    console.log('Extracted text:\n' + text)
    const txns = parseTransactions(text, 'normal_statement.pdf')
    console.log(`Parsed ${txns.length} transaction(s)`)
    for (const t of txns) console.log(` - ${t.date.toDateString()} ${t.type} ${t.amount} bal=${t.balance} cat=${t.category}`)
    console.log(txns.length === 4 ? 'RESULT: PASS' : `RESULT: FAIL (expected 4, got ${txns.length})`)
  } catch (err) {
    console.log('RESULT: FAIL — unexpected error:', err)
  }
}

async function testInvalidFile() {
  console.log('\n=== TEST 2: invalid/non-PDF file ===')
  const buf = readFileSync('/tmp/not_a_pdf.txt')
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  try {
    await getDocumentWithTimeout({ data: arrayBuffer }, 5000)
    console.log('RESULT: FAIL — expected an error, got a document')
  } catch (err) {
    console.log('Correctly rejected non-PDF data:', (err as Error).message || err)
    console.log('RESULT: PASS')
  }
}

async function testPasswordExceptionPath() {
  console.log('\n=== TEST 3: password-protected PDF detection ===')
  console.log('LIMITATION: no real password-protected PDF fixture was generated')
  console.log('(building an encrypted PDF by hand requires RC4/AES PDF encryption')
  console.log('machinery well beyond a minimal hand-built PDF, and no new')
  console.log('dependency was permitted to generate one). Verifying instead that')
  console.log('the exception-handling path itself is wired correctly: pdf.ts')
  console.log('re-exports pdfjs-dist\'s real PasswordException class, and')
  console.log('usePerfiosUpload.isPasswordError() checks `instanceof PasswordException`')
  console.log('/ `name === \'PasswordException\'` / `code === 1|2` / message-contains-')
  console.log('\'password\' — the same union of checks pdfjs-dist actually throws for')
  console.log('NeedPassword (code 1) and IncorrectPassword (code 2), confirmed by')
  console.log('reading pdfjs-dist\'s own type/source definitions in Phase 1.')
  console.log(`PasswordException is a real, imported class: ${typeof PasswordException === 'function' ? 'YES' : 'NO'}`)
  console.log('RESULT: PARTIAL (exception plumbing verified, not exercised with a real encrypted file)')
}

async function testMultiFileAggregation() {
  console.log('\n=== TEST 4: multiple-file sequential aggregation ===')
  const files = ['/tmp/normal_statement.pdf', '/tmp/second_statement.pdf']
  const allTxns: ReturnType<typeof parseTransactions> = []
  for (let i = 0; i < files.length; i++) {
    const buf = readFileSync(files[i])
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    const pdf = await getDocumentWithTimeout({ data: arrayBuffer })
    const text = await extractText(pdf)
    const txns = parseTransactions(text, files[i])
    txns.forEach(t => { (t as any)._fileIdx = i })
    allTxns.push(...txns)
    console.log(`File ${i + 1} (${files[i]}): ${txns.length} txn(s)`)
  }
  console.log(`Total aggregated: ${allTxns.length} (expected 6: 4 + 2)`)
  console.log(`_fileIdx tags present: ${allTxns.every(t => (t as any)._fileIdx !== undefined) ? 'YES' : 'NO'}`)
  console.log(allTxns.length === 6 ? 'RESULT: PASS' : 'RESULT: FAIL')
}

async function main() {
  await testNormalPdf()
  await testInvalidFile()
  await testPasswordExceptionPath()
  await testMultiFileAggregation()
}

main()
