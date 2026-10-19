import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'

export async function capacityBrowser(h, members, classes) {
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  const dir = process.env.STRAP_PROOF_DIR
  await mkdir(dir, { recursive: true })
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } })
      await context.route(h.origin + '/**', async route => {
        const path = new URL(route.request().url()).pathname
        if (!path.includes('..') && /\.(css|svg|woff2|png|ico)$/.test(path)) {
          const contentType = { '.css':'text/css', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.png':'image/png', '.ico':'image/x-icon' }[extname(path)]
          return route.fulfill({ body: await readFile(join(process.cwd(), 'public', path)), contentType })
        }
        return route.continue()
      })
      const page = await context.newPage()
      const cookie = async value => { const split = value.indexOf('='); await context.clearCookies(); await context.addCookies([{ name: value.slice(0,split), value: value.slice(split+1), url: h.origin }]) }
      const shot = name => page.screenshot({ path: join(dir, `SCHED-011-${name}-${width}.png`), fullPage: true })
      await cookie(h.owner)
      await page.goto(h.origin + '/app/classes')
      assert.ok(await page.getByText('10 / 10 online · 2 / 2 desk-held').first().isVisible())
      await shot('capacity-report')
      const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Prepare class week', exact: true }) })
      await form.locator('[name=c0_title]').fill(`Evening Restore ${width}`)
      await form.locator('[name=c0_time]').fill(width === 1440 ? '16:00' : '17:30')
      await form.locator('[name=c0_onlineCapacity]').fill('8')
      await form.locator('[name=week]').selectOption(classes[0].week ?? classes[0].localDate)
      await shot('class-editor')
      await form.getByRole('button', { name: 'Prepare class week', exact: true }).click()
      assert.ok(await page.getByText('12 total · 8 online · 4 desk-held').isVisible())
      await shot('draft-review')
      await page.getByRole('button', { name: 'Approve and publish this exact week', exact: true }).click()
      assert.ok(await page.getByText(`Evening Restore ${width}`, { exact: true }).isVisible())
      await shot('published-capacity')
      const entry = classes[1], day = entry.start.slice(0,10)
      await page.goto(h.origin + `/app?day=${day}&class=${entry.id}`)
      const desk = page.locator('form').filter({ has: page.getByRole('button', { name:'Book at desk', exact:true }) })
      await desk.locator('[name=personId]').selectOption(members[width === 1440 ? 13 : 14].id)
      await desk.locator('[name=channel]').selectOption('phone')
      await desk.getByRole('button', { name: 'Book at desk', exact:true }).click()
      assert.ok(await page.getByText('Desk-held spot · phone', { exact:true }).first().isVisible())
      await shot('desk-booked')
      await cookie(members[width === 1440 ? 0 : 12].cookie)
      await page.goto(h.origin + '/app')
      const row = page.getByRole('row').filter({ hasText: 'Mat Basics' })
      assert.ok(await row.getByText('Full', { exact:true }).isVisible())
      assert.ok(await row.getByRole('button', { name:'Join waitlist', exact:true }).isVisible())
      await shot('member-online-full')
      const evening = page.getByRole('row').filter({ hasText: 'Evening Mat' })
      await evening.getByRole('button', { name:'Book', exact:true }).click()
      assert.ok(await page.getByRole('row').filter({ hasText:'Evening Mat' }).getByText('Booked', { exact:true }).isVisible())
      await shot('member-booked')
      assert.ok((await h.state()).bookings.some(b => b.personId === members[width === 1440 ? 0 : 12].id && b.classId === entry.id && b.capacityPool === 'online'))
      await context.close()
    }
  } finally { await browser.close() }
}
