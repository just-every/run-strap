import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'

// SCHED-008 screens at 1440 and 390: the owner's applied closure with each
// member's notice and email outcome, and a member's cancellation notice.
export async function closuresBrowser(h, member) {
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  await mkdir(process.env.STRAP_PROOF_DIR, { recursive: true })
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } })
      await context.route(h.origin + '/**', async route => {
        const path = new URL(route.request().url()).pathname
        if (!path.includes('..') && /\.(css|svg|woff2|png|ico)$/.test(path)) return route.fulfill({ body: await readFile(join(process.cwd(), 'public', path)), contentType: { '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon' }[extname(path)] })
        return route.continue()
      })
      const cookie = value => { const at = value.indexOf('='); return { name: value.slice(0, at), value: value.slice(at + 1), url: h.origin } }
      const page = await context.newPage(), shot = label => page.screenshot({ path: join(process.env.STRAP_PROOF_DIR, `SCHED-008-${label}-${width}.png`), fullPage: true })
      await context.addCookies([cookie(h.owner)])
      await page.goto(h.origin + '/app/classes#closures')
      await page.locator('#closures summary').first().click()
      assert.ok(await page.getByText(/Email accepted by resend; delivery not confirmed/).first().isVisible())
      assert.ok(await page.getByText(/Email refused by resend/).first().isVisible())
      await page.locator('#closures').screenshot({ path: join(process.env.STRAP_PROOF_DIR, `SCHED-008-owner-outcomes-${width}.png`) })
      await context.clearCookies(); await context.addCookies([cookie(member.cookie)])
      await page.goto(h.origin + '/app')
      assert.ok(await page.getByText(/Reason: Burst pipe/).first().isVisible())
      await shot('member-notice')
      await context.close()
    }
  } finally { await browser.close() }
}
