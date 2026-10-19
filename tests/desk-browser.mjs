import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'

// SCHED-010 screens at 1440 and 390: the desk roster with a chosen-pack phone
// booking, a desk drop-in, a settled unpaid walk-in and an override, and the desk form.
export async function deskBrowser(h, entry) {
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  await mkdir(process.env.STRAP_PROOF_DIR, { recursive: true })
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(entry.start))
  try {
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
      await page.goto(h.origin + `/app?day=${day}&class=${entry.id}#roster`)
      assert.ok(await page.getByText(/Override: Regular; fits at the back/).first().isVisible())
      assert.ok(await page.getByText('Pays with').first().isVisible())
      await page.locator('#roster').screenshot({ path: join(process.env.STRAP_PROOF_DIR, `SCHED-010-desk-${width}.png`) })
      await context.close()
    }
  } finally { await browser.close() }
}
