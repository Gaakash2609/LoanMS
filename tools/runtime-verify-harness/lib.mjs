import { CREDENTIALS } from './pages.config.mjs'

/**
 * Attach console + network + pageerror capture to a page.
 * Returns { getErrors, getNetworkLog, reset } - call reset() before each
 * action you want isolated results for.
 */
export function attachCapture(page) {
  let consoleErrors = []
  let pageErrors = []
  let network = []

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text())
    }
  })
  page.on('pageerror', (err) => {
    pageErrors.push(err.message)
  })
  page.on('request', (req) => {
    if (['xhr', 'fetch'].includes(req.resourceType())) {
      network.push({ phase: 'request', method: req.method(), url: req.url(), ts: Date.now() })
    }
  })
  page.on('response', async (res) => {
    const req = res.request()
    if (['xhr', 'fetch'].includes(req.resourceType())) {
      network.push({ phase: 'response', method: req.method(), url: res.url(), status: res.status(), ts: Date.now() })
    }
  })

  return {
    getErrors: () => ({ consoleErrors: [...consoleErrors], pageErrors: [...pageErrors] }),
    getNetworkLog: () => [...network],
    reset: () => { consoleErrors = []; pageErrors = []; network = [] },
  }
}

/** Log in via the visible login form (works for both React and Vanilla if
 *  vanilla uses standard email/password/submit inputs - adjust selectors
 *  below if vanilla's login markup differs). */
export async function login(page, baseUrl) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  const emailInput = page.locator('input[type="email"]').first()
  if (await emailInput.count() === 0) {
    // Already logged in (persisted session) or no login gate on this URL.
    return
  }
  await emailInput.fill(CREDENTIALS.email)
  await page.locator('input[type="password"]').first().fill(CREDENTIALS.password)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForLoadState('networkidle')
}

/** Toast detection - tries several common toast library markup patterns.
 *  EDIT the selector list if your toast lib renders something else -
 *  grep your frontend for the toast component to confirm. */
const TOAST_SELECTORS = [
  '[role="status"]', '[role="alert"]',
  '.toast', '.Toastify__toast', '[data-sonner-toast]', '.notification',
]
export async function waitForToast(page, timeoutMs = 3000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    for (const sel of TOAST_SELECTORS) {
      const el = page.locator(sel).first()
      if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
        const text = await el.innerText().catch(() => '')
        return { found: true, selector: sel, text }
      }
    }
    await page.waitForTimeout(150)
  }
  return { found: false }
}

/** Generic "click every safe interactive element on this page, one at a
 *  time, from a fresh navigation" crawler. Returns an array of result rows
 *  matching the requested report table shape. */
export async function crawlPage(page, { pageName, url, skipPatterns, capture }) {
  await page.goto(url, { waitUntil: 'networkidle' })
  const handles = await page.locator('button, [role="button"], a[href]:not([href^="http"])').all()

  // Build a stable list of (index, text) up front - the DOM will change
  // after each click, so we re-navigate fresh for every single click.
  const targets = []
  for (let i = 0; i < handles.length; i++) {
    const text = (await handles[i].innerText().catch(() => '')).trim().slice(0, 60) || `(unlabeled #${i})`
    const isVisible = await handles[i].isVisible().catch(() => false)
    if (!isVisible) continue
    if (skipPatterns.some((re) => re.test(text))) continue
    targets.push({ index: i, text })
  }

  const rows = []
  for (const t of targets) {
    capture.reset()
    await page.goto(url, { waitUntil: 'networkidle' })
    const els = await page.locator('button, [role="button"], a[href]:not([href^="http"])').all()
    const el = els[t.index]
    if (!el) continue

    let clicked = true
    try {
      await el.click({ timeout: 5000 })
    } catch (e) {
      clicked = false
      rows.push({
        page: pageName, action: t.text, expected: 'Handler fires on click',
        actual: `Click failed: ${e.message.split('\n')[0]}`, status: 'BROKEN',
        consoleError: '', rootCause: 'Element not clickable (covered/disabled/detached)',
      })
      continue
    }

    await page.waitForTimeout(600) // let async handlers/toasts/nav settle
    const { consoleErrors, pageErrors } = capture.getErrors()
    const net = capture.getNetworkLog()
    const toast = await waitForToast(page, 1500)
    const newUrl = page.url()

    const hadNetwork = net.length > 0
    const hadJsError = consoleErrors.length > 0 || pageErrors.length > 0
    const navigated = newUrl !== url

    let status = 'WORKS'
    if (hadJsError) status = 'BROKEN'
    else if (!hadNetwork && !navigated && !toast.found) status = 'DIFFERENT' // silent no-op, needs human eyes

    rows.push({
      page: pageName,
      action: t.text,
      expected: '(fill in from vanilla behavior)',
      actual: [
        navigated ? `navigated -> ${newUrl}` : null,
        hadNetwork ? `${net.filter(n => n.phase === 'request').length} API call(s): ${[...new Set(net.map(n => n.url.replace(url.split('/').slice(0,3).join('/'),'')))].slice(0,3).join(', ')}` : 'no network call',
        toast.found ? `toast: "${toast.text.slice(0,80)}"` : 'no toast seen',
      ].filter(Boolean).join(' | '),
      status,
      consoleError: [...consoleErrors, ...pageErrors].join(' || ').slice(0, 300),
      rootCause: hadJsError ? '(inspect stack in devtools / rerun with --headed)' : '',
    })
  }
  return rows
}

export function toMarkdownTable(rows) {
  const header = '| Page | Button/Action | Expected (Vanilla) | Actual (React runtime) | Status | Console error | Root cause |\n' +
                 '|---|---|---|---|---|---|---|\n'
  const body = rows.map(r =>
    `| ${r.page} | ${esc(r.action)} | ${esc(r.expected)} | ${esc(r.actual)} | ${r.status} | ${esc(r.consoleError)} | ${esc(r.rootCause)} |`
  ).join('\n')
  return header + body + '\n'
}
function esc(s) { return String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ') }
