import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'

// MSG-004 screens at 1440 and 390: the owner's waitlist policy and the desk
// roster with an expired offer and an open one, and the member's claim screen.
export async function waitlistBrowser(h, entry, member) {
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
      const cookie = value => { const at = value.indexOf('='); return { name: value.slice(0, at), value: value.slice(at + 1), url: h.origin } }
      await context.addCookies([cookie(h.owner)])
      const page = await context.newPage()
      await page.goto(h.origin + '/app/studio#waitlist')
      assert.ok(await page.getByText(/who has 1 min to claim it/).isVisible())
      await page.locator('#waitlist').screenshot({ path: join(process.env.STRAP_PROOF_DIR, `MSG-004-policy-${width}.png`) })
      await page.goto(h.origin + `/app?day=${day}&class=${entry.id}#roster`)
      assert.ok(await page.getByText('Offer expired').first().isVisible())
      assert.ok(await page.getByText(/Email accepted by resend; delivery not confirmed/).first().isVisible())
      await page.locator('#roster').screenshot({ path: join(process.env.STRAP_PROOF_DIR, `MSG-004-roster-${width}.png`) })
      await context.clearCookies(); await context.addCookies([cookie(member.cookie)])
      await page.goto(h.origin + '/app')
      assert.ok(await page.getByRole('button', { name: 'Claim spot' }).isVisible())
      await page.screenshot({ path: join(process.env.STRAP_PROOF_DIR, `MSG-004-member-offer-${width}.png`), fullPage: true })
      await context.close()
    }
  } finally { await browser.close() }
}
