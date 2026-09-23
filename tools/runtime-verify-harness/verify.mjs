import { chromium } from 'playwright'
import { PAGES, SKIP_TEXT_PATTERNS, REACT_BASE, VANILLA_BASE } from './pages.config.mjs'
import { attachCapture, login, crawlPage, toMarkdownTable } from './lib.mjs'
import { writeFileSync } from 'node:fs'

async function main() {
  const browser = await chromium.launch({ headless: process.env.HEADED ? false : true })
  const context = await browser.newContext()
  const page = await context.newPage()
  const capture = attachCapture(page)

  console.log('Logging into React app at', REACT_BASE)
  await login(page, REACT_BASE)

  const allRows = []
  for (const p of PAGES) {
    const url = REACT_BASE + p.reactPath
    console.log('Crawling', p.name, url)
    try {
      const rows = await crawlPage(page, { pageName: p.name, url, skipPatterns: SKIP_TEXT_PATTERNS, capture })
      allRows.push(...rows)
    } catch (e) {
      allRows.push({ page: p.name, action: '(page load)', expected: 'Page loads', actual: `Failed: ${e.message}`, status: 'BROKEN', consoleError: '', rootCause: 'Route/page crashed on load' })
    }
  }

  const reportMd = `# LoanMS React Runtime Verification\nGenerated: ${new Date().toISOString()}\n\n` + toMarkdownTable(allRows)
  writeFileSync('report-react.md', reportMd)
  console.log('Wrote report-react.md with', allRows.length, 'rows')

  // Optional: same crawl against vanilla for side-by-side (only pages that
  // have a vanilla equivalent hash - vanilla nav mechanism must match your
  // app; adjust login()/navigation in pages.config.mjs if it's not hash-based).
  if (process.env.SKIP_VANILLA !== '1') {
    console.log('Logging into Vanilla app at', VANILLA_BASE)
    await login(page, VANILLA_BASE)
    const vanillaRows = []
    for (const p of PAGES) {
      if (!p.vanillaHash) continue
      const url = VANILLA_BASE + p.vanillaHash
      console.log('Crawling (vanilla)', p.name, url)
      try {
        const rows = await crawlPage(page, { pageName: p.name, url, skipPatterns: SKIP_TEXT_PATTERNS, capture })
        vanillaRows.push(...rows)
      } catch (e) {
        vanillaRows.push({ page: p.name, action: '(page load)', expected: '-', actual: `Failed: ${e.message}`, status: 'BROKEN', consoleError: '', rootCause: 'Vanilla nav mechanism may differ from hash - edit pages.config.mjs' })
      }
    }
    writeFileSync('report-vanilla.md', `# LoanMS Vanilla Baseline\n\n` + toMarkdownTable(vanillaRows))
    console.log('Wrote report-vanilla.md with', vanillaRows.length, 'rows')
  }

  await browser.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
