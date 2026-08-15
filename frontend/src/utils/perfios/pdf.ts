// ── PDF text extraction ──────────────────────────────────────────────────
// Ported from perfios-core.js lines 1-46 (_getDocumentWithTimeout) and
// 711-783 (extractText). Algorithm unchanged — only the PDF.js import
// mechanism differs: legacy loads pdf.js from a CDN <script> tag; this uses
// the npm `pdfjs-dist` package (approved dependency for this migration)
// with its worker configured via Vite's `?url` import instead of a CDN
// fetch, so no network dependency on cdnjs.cloudflare.com remains.

import * as pdfjsLib from 'pdfjs-dist'
// eslint-disable-next-line import/no-unresolved
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export type PDFDocumentProxy = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>

// Re-exported so callers can detect a wrong-password attempt exactly like
// legacy's `err.name === 'PasswordException'` check.
export const PasswordResponses = pdfjsLib.PasswordResponses
export const PasswordException = pdfjsLib.PasswordException

/**
 * Wrapper: getDocument with a 30-second timeout to prevent an infinite hang
 * on a corrupted file or slow network — ported unchanged from
 * _getDocumentWithTimeout (perfios-core.js:30-46).
 */
export function getDocumentWithTimeout(
  params: { data: ArrayBuffer; password?: string },
  timeoutMs = 30000,
): Promise<PDFDocumentProxy> {
  return new Promise((resolve, reject) => {
    const task = pdfjsLib.getDocument(params)
    const timer = setTimeout(() => {
      try { task.destroy() } catch { /* ignore */ }
      reject(new Error(`PDF loading timed out after ${timeoutMs / 1000}s. The file may be corrupted or network is slow.`))
    }, timeoutMs)
    task.promise.then(
      (pdf) => { clearTimeout(timer); resolve(pdf) },
      (err) => { clearTimeout(timer); reject(err) },
    )
  })
}

interface PositionedItem { str: string; x: number; y: number }

/**
 * Extracts a PDF's text layer into a single string, one line per detected
 * row, preserving column spacing — ported unchanged from extractText
 * (perfios-core.js:711-783). Same Y-clustering + X-sort + gap-based
 * spacing heuristic, same median-gap row-tolerance calculation.
 */
export async function extractText(pdf: PDFDocumentProxy): Promise<string> {
  let full = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const items = content.items as Array<{ str?: string; transform?: number[] }>
    if (!items.length) continue

    // Step 1: collect all text items with their Y positions
    const positioned: PositionedItem[] = []
    for (const item of items) {
      if (!item.str) continue
      const y = item.transform ? item.transform[5] : 0
      const x = item.transform ? item.transform[4] : 0
      positioned.push({ str: item.str, x, y })
    }

    // Step 2: cluster by Y into rows (tolerance = font-size aware, min 4px)
    positioned.sort((a, b) => b.y - a.y)

    const rows: PositionedItem[][] = []
    let curRow: PositionedItem[] | null = null
    let curY: number | null = null
    const ys = [...new Set(positioned.map(p => Math.round(p.y)))].sort((a, b) => b - a)
    const gaps: number[] = []
    for (let k = 1; k < ys.length; k++) gaps.push(Math.abs(ys[k - 1] - ys[k]))
    gaps.sort((a, b) => a - b)
    const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 10
    const rowTol = Math.max(4, Math.min(medianGap * 0.6, 14))

    for (const p of positioned) {
      if (curY === null || Math.abs(p.y - curY) > rowTol) {
        curRow = []
        rows.push(curRow)
        curY = p.y
      }
      curRow!.push(p)
    }

    // Step 3: within each row sort by X (left to right)
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x)
      let line = ''
      let prevX: number | null = null
      let prevLen = 0
      for (const p of row) {
        if (prevX !== null) {
          const gap = p.x - prevX - prevLen
          if (gap > 12) {
            line += '  '
          } else if (gap > 3 && !line.endsWith(' ') && !p.str.startsWith(' ')) {
            line += ' '
          }
        }
        line += p.str
        prevX = p.x
        prevLen = p.str.length * 5
      }
      line = line.trim()
      if (line) full += line + '\n'
    }

    full += '\n'
  }
  return full
}
