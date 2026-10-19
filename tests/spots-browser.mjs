import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'

// SCHED-007 screens at 1440 and 390: a member picks a reformer from the spot
// list, front desk moves them from the roster, and the instructor sees the spots.
export async function spotsBrowser(h, entry, member, coach) {
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  await mkdir(process.env.STRAP_PROOF_DIR, { recursive: true })
  const roster = h.origin + `/app?day=${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(entry.start))}&class=${entry.id}#roster`
  try {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } })
      await context.route(h.origin + '/**', async route => {
        const path = new URL(route.request().url()).pathname
        if (!path.includes('..') && /\.(css|svg|woff2|png|ico)$/.test(path)) return route.fulfill({ body: await readFile(join(process.cwd(), 'public', path)), contentType: { '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon' }[extname(path)] })
        return route.continue()
      })
      const page = await context.newPage(), shot = label => page.screenshot({ path: join(process.env.STRAP_PROOF_DIR, `SCHED-007-${label}-${width}.png`), fullPage: true })
      const as = async value => { const split = value.indexOf('='); await context.clearCookies(); await context.addCookies([{ name: value.slice(0, split), value: value.slice(split + 1), url: h.origin }]) }
      await as(member.cookie)
      await page.goto(h.origin + '/app')
      const row = page.getByRole('row').filter({ hasText: 'Reformer Later' })
      if (width === 390) {
        await row.getByLabel('Spot').selectOption('Reformer 3')
        await shot('member-pick')
        await row.getByRole('button', { name: 'Book' }).click()
        await page.waitForURL(/\/app/)
      }
      assert.ok(await page.getByRole('row').filter({ hasText: 'Reformer Later' }).getByText('Reformer 3', { exact: true }).isVisible())
      await shot('member-booked')
      await as(h.owner)
      await page.goto(roster)
      if (width === 1440) {
        await page.getByText('Move spot for Ana', { exact: true }).click()
        const move = page.getByRole('row').filter({ hasText: 'Move spot for Ana' })
        await move.getByLabel('New spot').selectOption('Reformer 1')
        await shot('desk-move')
        await move.getByRole('button', { name: 'Move spot' }).click()
        await page.waitForURL(/class=/)
        await as(member.cookie)
        await page.goto(h.origin + '/app')
        assert.ok(await page.getByRole('row').filter({ hasText: 'Reformer Later' }).getByText('Reformer 1', { exact: true }).isVisible())
      }
      await as(coach.cookie)
      await page.goto(roster)
      assert.ok(await page.getByText(/Spots: Reformer 1 (free|Ana) · Reformer 2 free · Reformer 3 (Ana|free)/).isVisible())
      await shot('instructor-roster')
      await context.close()
    }
    const b = (await h.state()).bookings.find(x => x.classId === entry.id && x.personId === member.id)
    assert.deepEqual([b.spot, b.spotHistory.length, b.spotHistory[0].staffMade], ['Reformer 1', 1, true])
  } finally { await browser.close() }
}
