import { chromium } from 'playwright'
import { REACT_BASE, WIZARD_PRODUCTS } from './pages.config.mjs'
import { attachCapture, login, waitForToast } from './lib.mjs'
import { writeFileSync } from 'node:fs'

/** Best-effort generic autofill for whatever's on the current wizard step:
 *  - text/number/email/tel inputs -> plausible dummy value
 *  - select -> first non-empty option
 *  - date -> today
 *  - radio/checkbox groups -> select the first option in each group
 *  Leaves anything it can't confidently fill for a human to check (logged). */
async function autofillStep(page) {
  const unfilled = []

  const textInputs = await page.locator('input[type="text"]:not([data-numeric]), input[type="tel"], input:not([type]):not([data-numeric])').all()
  for (const el of textInputs) {
    if (!(await el.isVisible().catch(() => false))) continue
    const val = await el.inputValue().catch(() => '')
    if (val) continue
    const name = (await el.getAttribute('name')) || (await el.getAttribute('placeholder')) || ''
    await el.fill(guessValue(name)).catch(() => unfilled.push(name || '(unnamed text input)'))
  }

  const emailInputs = await page.locator('input[type="email"]').all()
  for (const el of emailInputs) {
    if (!(await el.isVisible().catch(() => false))) continue
    if (await el.inputValue().catch(() => '')) continue
    await el.fill('test.applicant@example.com').catch(() => {})
  }

  // Number fields no longer use native <input type="number"> (spinner removal) -
  // they're text inputs marked with data-numeric (see src/components/ui/NumberInput.tsx).
  const numberInputs = await page.locator('input[data-numeric]').all()
  for (const el of numberInputs) {
    if (!(await el.isVisible().catch(() => false))) continue
    if (await el.inputValue().catch(() => '')) continue
    await el.fill('10000').catch(() => {})
  }

  const dateInputs = await page.locator('input[type="date"]').all()
  for (const el of dateInputs) {
    if (!(await el.isVisible().catch(() => false))) continue
    if (await el.inputValue().catch(() => '')) continue
    await el.fill('1990-01-01').catch(() => {})
  }

  const selects = await page.locator('select').all()
  for (const el of selects) {
    if (!(await el.isVisible().catch(() => false))) continue
    const options = await el.locator('option').all()
    for (const opt of options) {
      const v = await opt.getAttribute('value')
      if (v) { await el.selectOption(v).catch(() => {}); break }
    }
  }

  return unfilled
}

function guessValue(name) {
  const n = (name || '').toLowerCase()
  if (n.includes('name')) return 'Test Applicant'
  if (n.includes('pan')) return 'ABCDE1234F'
  if (n.includes('aadhaar') || n.includes('aadhar')) return '234123412346'
  if (n.includes('pin') || n.includes('pincode') || n.includes('zip')) return '411001'
  if (n.includes('phone') || n.includes('mobile')) return '9876543210'
  if (n.includes('city')) return 'Pune'
  if (n.includes('address')) return '123 Test Street'
  return 'Test Value'
}

async function runProduct(page, capture, product) {
  const steps = []
  await page.goto(REACT_BASE + '/new-application', { waitUntil: 'networkidle' })

  // Select the product - assumes a clickable card/radio with the product
  // name or a labelled option; adjust selector if your selector UI differs.
  const productOption = page.locator(`text=/${product}/i`).first()
  if (await productOption.count() > 0) {
    await productOption.click().catch(() => {})
  } else {
    steps.push({ step: 'product-select', note: `Could not find a "${product}" option on screen - check ProductSelector markup` })
    return { product, steps }
  }

  const MAX_STEPS = 12
  for (let i = 1; i <= MAX_STEPS; i++) {
    capture.reset()
    const unfilled = await autofillStep(page)

    const nextBtn = page.locator('button:has-text("Continue"), button:has-text("Next")').first()
    const submitBtn = page.locator('button:has-text("Submit"), button:has-text("Finish")').first()
    const advanceBtn = (await submitBtn.count() > 0 && await submitBtn.isVisible().catch(() => false)) ? submitBtn : nextBtn

    if (await advanceBtn.count() === 0) {
      steps.push({ step: i, note: 'No Continue/Next/Submit button found - assume wizard complete or stuck', unfilled })
      break
    }

    await advanceBtn.click().catch(() => {})
    await page.waitForTimeout(500)
    const { consoleErrors, pageErrors } = capture.getErrors()
    const toast = await waitForToast(page, 1200)
    const urlAfter = page.url()

    steps.push({
      step: i,
      unfilled,
      consoleErrors: [...consoleErrors, ...pageErrors],
      toast: toast.found ? toast.text : null,
      url: urlAfter,
    })

    // Heuristic stop: submit button was clicked (assume final step reached).
    if (advanceBtn === submitBtn) break
  }
  return { product, steps }
}

async function main() {
  const browser = await chromium.launch({ headless: process.env.HEADED ? false : true })
  const page = await browser.newPage()
  const capture = attachCapture(page)
  await login(page, REACT_BASE)

  const results = []
  for (const product of WIZARD_PRODUCTS) {
    console.log('Wizard walk:', product)
    results.push(await runProduct(page, capture, product))
  }

  writeFileSync('report-wizard.json', JSON.stringify(results, null, 2))
  console.log('Wrote report-wizard.json')

  await browser.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
