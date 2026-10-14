const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')
;(async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    const response = await page.goto('https://tnbjp.org/', { waitUntil: 'networkidle' })
    assert.equal(response.status(), 200)
    assert(await page.locator('#root').innerText())
    assert.equal(await page.locator('script[src="/assets/index-Z81u-HO9-v2.js"]').count(), 1)
    const health = await (await page.request.get('https://tnbjp.org/api/health')).json()
    assert.equal(health.status, 'OK')
    assert.deepEqual(errors, [])
    console.log('PASS: live homepage renders tested bundle without JavaScript errors; both databases healthy.')
  } finally { await browser.close() }
})().catch(e => { console.error(e); process.exit(1) })
