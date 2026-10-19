import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'

// SCHED-006 screens at 1440 and 390: the member's rule and cancel effect, the
// owner's rules editor, and the desk's late-or-early choice on the roster.
async function browse(h, journey) {
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
      const page = await context.newPage()
      const as = async value => { const split = value.indexOf('='); await context.clearCookies(); await context.addCookies([{ name: value.slice(0, split), value: value.slice(split + 1), url: h.origin }]) }
      const shot = name => page.screenshot({ path: join(process.env.STRAP_PROOF_DIR, `SCHED-006-${name}-${width}.png`), fullPage: true })
      await journey({ page, as, shot, width })
      await context.close()
    }
  } finally { await browser.close() }
}

export const memberRulesBrowser = (h, member) => browse(h, async ({ page, as, shot }) => {
  await as(h.owner)
  await page.goto(h.origin + '/app/studio#booking-rules')
  assert.ok(await page.getByText('Credit kept · $20.00 fee').first().isVisible())
  await shot('rules-editor')
  await as(member.cookie)
  await page.goto(h.origin + '/app')
  assert.ok(await page.getByText('Booking closed').first().isVisible())
  assert.ok(await page.getByText(/The cancel cutoff has passed: the credit is kept and a \$20\.00 late fee is added/).first().isVisible())
  await shot('member-rules')
})

export const deskCancelBrowser = (h, entry, booking) => browse(h, async ({ page, as, shot, width }) => {
  await as(h.owner)
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(entry.start))
  await page.goto(h.origin + `/app?day=${day}&class=${entry.id}#roster`)
  if (width === 1440) {
    await page.getByText('Cancel for Ana', { exact: true }).click()
    const row = page.getByRole('row').filter({ hasText: 'Cancel for Ana' })
    assert.ok(await row.getByText(/Late cancel: credit kept, \$15\.00 fee added\./).isVisible())
    await shot('desk-preview')
    await row.getByRole('button', { name: 'Late cancel', exact: true }).click()
  } else await page.goto(h.origin + `/app?day=${day}&class=${entry.id}#roster`)
  assert.ok(await page.getByRole('row').filter({ hasText: 'Ana' }).getByText(/Credit kept · \$15\.00 fee/).isVisible())
  assert.equal((await h.state()).bookings.find(b => b.id === booking.id).feeCents, 1500)
  await shot('desk-late-cancelled')
})
