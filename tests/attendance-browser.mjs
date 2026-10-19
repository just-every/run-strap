import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'

// ATT-003 screens at 1440 and 390: the roster's no-show state and the owner's
// correction form, then the corrected row with its kept history.
export async function correctionBrowser(h, entry, booking) {
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  await mkdir(process.env.STRAP_PROOF_DIR, { recursive: true })
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date((await h.state()).classes.find(c => c.id === entry.id).start))
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } })
      await context.route(h.origin + '/**', async route => {
        const path = new URL(route.request().url()).pathname
        if (!path.includes('..') && /\.(css|svg|woff2|png|ico)$/.test(path)) return route.fulfill({ body: await readFile(join(process.cwd(), 'public', path)), contentType: { '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon' }[extname(path)] })
        return route.continue()
      })
      const [name, value] = [h.owner.slice(0, h.owner.indexOf('=')), h.owner.slice(h.owner.indexOf('=') + 1)]
      await context.addCookies([{ name, value, url: h.origin }])
      const page = await context.newPage(), shot = label => page.screenshot({ path: join(process.env.STRAP_PROOF_DIR, `ATT-003-${label}-${width}.png`), fullPage: true })
      await page.goto(h.origin + `/app?day=${day}&class=${entry.id}#roster`)
      if (width === 1440) {
        await page.getByText('Correct no-show for Dee', { exact: true }).click()
        const row = page.getByRole('row').filter({ hasText: 'Correct no-show for Dee' })
        assert.ok(await row.getByText(/The \$20\.00 fee is reversed\./).isVisible())
        await row.getByLabel('Correct to').selectOption('attended')
        await row.getByLabel('Reason').fill('Signed in on paper')
        await shot('correction-form')
        await row.getByRole('button', { name: 'Save correction' }).click()
        await page.waitForURL(/class=/)
      }
      assert.ok(await page.getByText(/Corrected from no-show: Signed in on paper · \$20\.00 fee reversed/).first().isVisible())
      assert.ok(await page.getByText('Excused', { exact: true }).first().isVisible())
      assert.equal((await h.state()).bookings.find(b => b.id === booking.id).attendance, 'attended')
      await shot('corrected-roster')
      await context.close()
    }
  } finally { await browser.close() }
}
