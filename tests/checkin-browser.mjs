import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'

// ATT-001 screens at 1440 and 390: the desk roster with its alerts, a member's
// own check-in code, and a paired kiosk's lookup.
export async function checkinBrowser(h, roll, member) {
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  await mkdir(process.env.STRAP_PROOF_DIR, { recursive: true })
  const kiosk = await h.cmd('kiosk.pair', { label: 'Proof tablet' })
  let device
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } })
      await context.route(h.origin + '/**', async route => {
        const path = new URL(route.request().url()).pathname
        if (!path.includes('..') && /\.(css|svg|woff2|png|ico)$/.test(path)) return route.fulfill({ body: await readFile(join(process.cwd(), 'public', path)), contentType: { '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon' }[extname(path)] })
        return route.continue()
      })
      const cookie = value => { const at = value.indexOf('='); return { name: value.slice(0, at), value: value.slice(at + 1), url: h.origin } }
      const page = await context.newPage(), shot = label => page.screenshot({ path: join(process.env.STRAP_PROOF_DIR, `ATT-001-${label}-${width}.png`), fullPage: true })
      await context.addCookies([cookie(h.owner)])
      await page.goto(h.origin + roll + '#roster')
      assert.ok(await page.getByText('Last credit').first().isVisible())
      await shot('desk-roster')
      await context.clearCookies(); await context.addCookies([cookie(member.cookie)])
      await page.goto(h.origin + '/app')
      assert.ok(await page.getByRole('img', { name: 'Your check-in code' }).isVisible())
      await page.getByRole('img', { name: 'Your check-in code' }).screenshot({ path: join(process.env.STRAP_PROOF_DIR, `ATT-001-qr-${width}.png`) })
      await shot('member-code')
      await context.clearCookies()
      if (!device) {
        await page.goto(kiosk.pairUrl)
        await page.getByRole('button', { name: 'Pair this device' }).click()
        await page.waitForURL(/\/kiosk$/)
        device = (await context.cookies()).find(c => c.name === 'strap_kiosk')
      } else await context.addCookies([device])
      await page.goto(h.origin + '/kiosk')
      await page.getByLabel('Your name or phone number').fill('an')
      await page.getByRole('button', { name: 'Find my class' }).click()
      assert.ok(await page.getByText('Ana L.').isVisible())
      assert.equal(await page.getByText(/Owes|Last credit|\$/).count(), 0)
      await shot('kiosk-lookup')
      await context.close()
    }
  } finally { await browser.close() }
}
