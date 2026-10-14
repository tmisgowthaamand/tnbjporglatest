// Run against Vite on port 3100. Set PLAYWRIGHT_MODULE to an installed playwright package.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const output = process.env.TEST_OUTPUT || path.join(__dirname, 'results')
fs.mkdirSync(output, { recursive: true })

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const errors = []
  let passed = 0
  for (const lang of ['en', 'ta']) for (const width of [360, 1440]) for (const count of [0, 1, 6, 7, 23]) {
    const page = await browser.newPage({ viewport: { width, height: 950 } })
    page.on('pageerror', e => errors.push(e.message))
    page.on('console', m => { if (m.type() === 'error') console.log('Browser:', m.text()) })
    await page.addInitScript(lang => localStorage.setItem('bjp_lang', lang), lang)
    const titles = Array.from({ length: count }, (_, i) => lang === 'ta'
      ? `${i + 1}. பிரதம மந்திரி சிறு உணவு பதப்படுத்தும் நிறுவனங்களை முறைப்படுத்தும் நலத்திட்டம்`
      : `${i + 1}. PM Formalisation of Micro Food Processing Enterprises Welfare Scheme`)
    await page.route('**/api/schemes/**', route => route.fulfill({ headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:3100', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*' }, json: route.request().url().includes('my-requests')
      ? { applications: titles.map((schemeName, i) => ({ schemeId: 1000 + i, schemeName })) }
      : { schemes: [] } }))
    await page.goto('http://127.0.0.1:3100/tests/welfare-card.html?longIdentity', { waitUntil: 'networkidle' })
    if (errors.length) throw new Error(errors.join('\n'))
    if (count) {
      await page.waitForSelector('[data-welfare-visible]', { state: 'attached' })
      const result = await page.evaluate(() => {
        const host = document.querySelector('[data-welfare-schemes]')
        const visible = document.querySelector('[data-welfare-visible]')
        const more = document.querySelector('[data-welfare-more]')
        const bounds = host.getBoundingClientRect()
        return { shown: visible.children.length, more: more?.textContent,
          overflow: [...visible.children, ...(more ? [more] : [])].some(el => {
            const r = el.getBoundingClientRect()
            return r.bottom > bounds.bottom + 1 || r.right > bounds.right + 1
          }) }
      })
      assert(result.shown <= 6 && result.shown <= count)
      assert(!result.overflow, JSON.stringify({ lang, width, count, result }))
      assert(result.shown > 0)
      if (count > result.shown) assert(result.more.includes(String(count - result.shown)))
      else assert(!result.more)
      // Capture the actual download handler, not a substitute screenshot export.
      if (count === 23 && width === 360) {
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          page.getByRole('button', { name: 'Download Card' }).click()
        ])
        await download.saveAs(path.join(output, `card-${lang}.png`))
        await page.screenshot({ path: path.join(output, `screen-${lang}.png`) })
        await page.getByRole('button', { name: 'Test ' + (lang === 'en' ? 'Tamil' : 'English'), exact: true }).click()
        await page.waitForTimeout(100)
        assert(await page.locator('[data-welfare-more]').isVisible())
        await page.getByRole('button', { name: 'Test ' + (lang === 'en' ? 'English' : 'Tamil'), exact: true }).click()
      }
      if (lang === 'en') {
        await page.evaluate(() => { window.open = url => { window.testSharedUrl = url } })
        await page.getByRole('button', { name: 'Share on WhatsApp' }).click()
        const shared = await page.evaluate(() => decodeURIComponent(window.testSharedUrl))
        assert(titles.every(title => shared.includes(title)), 'Text sharing must include every application')
        await page.getByRole('button', { name: 'View your complete list in My Schemes' }).click()
        assert(await page.evaluate(() => window.viewedMySchemes))
      }
    } else {
      assert.equal(await page.locator('[data-welfare-schemes]').count(), 0)
    }
    passed++
    console.log(`PASS ${lang} ${width}px ${count} schemes`)
    await page.close()
  }
  assert.deepEqual(errors, [])
  console.log(`PASS: ${passed} card scenarios; downloads, language switching, navigation, and no browser errors.`)
  await browser.close()
})().catch(error => { console.error(error); process.exit(1) })
