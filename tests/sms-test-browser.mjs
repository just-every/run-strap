import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { chromium } from '@playwright/test'

/** Exercise the studio's actual forms and end states at both release widths. */
export async function smsTestBrowser(h, stage = 'outcomes') {
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  try {
    await mkdir(process.env.STRAP_PROOF_DIR, { recursive: true })
    const views = []
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } })
      await context.route(h.origin + '/**', async route => {
        const path = new URL(route.request().url()).pathname
        if (!path.includes('..') && /\.(css|svg|woff2|png|ico)$/.test(path)) return route.fulfill({ body: await readFile(join(process.cwd(), 'public', path)), contentType: { '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon' }[extname(path)] })
        return route.continue()
      })
      const at = h.owner.indexOf('=')
      await context.addCookies([{ name: h.owner.slice(0, at), value: h.owner.slice(at + 1), url: h.origin }])
      const page = await context.newPage()
      await page.goto(h.origin + '/app/studio')
      await page.getByRole('heading', { name: 'Twilio SMS test', exact: true }).waitFor()
      views.push({ page, context, width })
    }
    const capture = async ({ page, width }, name) => {
      await page.evaluate(() => document.fonts.ready)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'studio fits viewport')
      // Every visible icon-only control must use the seed's existing delayed tooltip.
      assert.deepEqual(await page.locator('a,button,summary').evaluateAll(elements => elements.filter(el => {
        const box = el.getBoundingClientRect()
        return box.width > 0 && box.height > 0 && el.querySelector('svg') && !el.textContent.trim() && !el.querySelector('.control-tooltip')
      }).map(el => el.outerHTML)), [])
      await page.locator('#sms-test').screenshot({ path: join(process.env.STRAP_PROOF_DIR, `MSG-005-${name}-${width}.png`) })
      if (name === 'submitted') {
        await page.locator('#sms-test').scrollIntoViewIfNeeded()
        await page.screenshot({ path: join(process.env.STRAP_PROOF_DIR, `MSG-005-studio-context-${width}.png`) })
      }
    }
    if (stage === 'unconfigured') {
      for (const view of views) {
        assert.equal(await view.page.locator('#sms-test form').count(), 0)
        await capture(view, 'unconfigured')
      }
    } else if (stage === 'connect') {
      for (const view of views) await capture(view, 'connection-review')
      await views[1].page.getByRole('button', { name: 'Review and connect TEST account', exact: true }).click()
      assert.equal((await h.state()).smsTest.connected, true)
      for (const view of views) {
        await view.page.reload()
        await view.page.getByLabel('Test message', { exact: true }).waitFor()
        await capture(view, 'connected')
      }
    } else {
      for (const view of views) {
        const { page, width } = view
        await page.getByText('Callback checks', { exact: true }).click()
        await page.locator('#sms-test').getByText('Reply callback', { exact: false }).waitFor()
        await capture(view, 'callback-and-failure-outcomes')
        await page.getByLabel('Test message', { exact: true }).fill('Browser connection check ' + width)
        await page.getByRole('button', { name: 'Submit test message', exact: true }).click()
        await page.locator('#sms-test').getByText('Browser connection check ' + width, { exact: true }).waitFor()
        assert.ok((await h.state()).smsTest.submissions.some(row => row.body === 'Browser connection check ' + width && row.status === 'submitted'))
        await capture(view, 'submitted')
      }
    }
    for (const view of views) await view.context.close()
  } finally { await browser.close() }
}
