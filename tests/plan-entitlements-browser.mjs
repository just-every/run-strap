import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'

// PLAN-002 screens at 1440 and 390: the owner sells an off-peak plan through the
// pack form, the member reads its terms and the refusal of an evening class, and
// a monthly member reads visits by period with rollover.
export async function planEntitlementsBrowser(h, { member, monthly, evening }) {
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  await mkdir(process.env.STRAP_PROOF_DIR, { recursive: true })
  try {
    for (const width of [1440, 390]) {
      const contexts = []
      try {
        const pageFor = async cookie => {
          const context = await browser.newContext({ viewport: { width, height: 1000 } }); contexts.push(context)
          await context.route(h.origin + '/**', async route => {
            const path = new URL(route.request().url()).pathname
            if (!path.includes('..') && /\.(css|svg|woff2|png|ico)$/.test(path)) return route.fulfill({ body: await readFile(join(process.cwd(), 'public', path)), contentType: { '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon' }[extname(path)] })
            return route.continue()
          })
          const index = cookie.indexOf('='); await context.addCookies([{ name: cookie.slice(0, index), value: cookie.slice(index + 1), url: h.origin }])
          return context.newPage()
        }
        const shot = async (page, name) => {
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
          await page.screenshot({ path: join(process.env.STRAP_PROOF_DIR, `PLAN-002-${name}-${width}.png`), fullPage: true })
        }
        const name = `Evening-free ${width}`
        const owner = await pageFor(h.owner)
        await owner.goto(h.origin + '/app/packs')
        const prepare = owner.locator('form[action*="name=pack.prepare"]')
        await prepare.locator('select[name="personId"]').selectOption(member.id)
        await prepare.locator('select[name="kind"]').selectOption('unlimited')
        await prepare.getByLabel('Price', { exact: true }).fill('149.00')
        await prepare.getByText('Plan terms (visits, days and hours, booking limit)').click()
        await prepare.getByLabel('Plan name (a booking rule can target it)', { exact: true }).fill(name)
        for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) await prepare.getByLabel(day, { exact: true }).check()
        await prepare.getByLabel('Class starts from (blank = any time)', { exact: true }).fill('10:00')
        await prepare.getByLabel('Class starts before', { exact: true }).fill('16:00')
        await prepare.getByLabel('Upcoming bookings at once (blank = no limit)', { exact: true }).fill('2')
        await shot(owner, 'owner-form')
        await prepare.getByRole('button', { name: 'Prepare pack', exact: true }).click()
        const draft = (await h.state()).drafts.find(d => d.type === 'pack' && d.entitlement?.name === name)
        assert.deepEqual(draft.entitlement, { kind: 'unlimited', name, visits: null, period: null, rollover: 0, days: [1, 2, 3, 4, 5], from: '10:00', to: '16:00', maxUpcoming: 2 })
        assert.equal(draft.credits, 0)
        await owner.locator(`form[action*="name=pack.approve"]:has(input[value="${draft.id}"]) button`).click()
        assert.ok((await h.state()).packs.some(p => p.draftId === draft.id))
        await owner.goto(h.origin + '/app/packs#pack-' + (await h.state()).packs.find(p => p.draftId === draft.id).id)
        await shot(owner, 'owner-packs')

        const home = await pageFor(member.cookie)
        await home.goto(h.origin + '/app')
        await home.getByText(`${name}: Unlimited visits · Mon–Fri 10:00 am–4:00 pm starts · up to 2 upcoming bookings at once`).first().waitFor()
        const row = home.locator('tr', { hasText: evening })
        await row.getByText('Outside your plan’s days and hours').first().waitFor()
        await shot(home, 'member-home')

        const visits = await pageFor(monthly.cookie)
        await visits.goto(h.origin + '/app/packs')
        await visits.getByText('Monthly four · Visit history').click()
        const history = visits.locator('details', { hasText: 'Monthly four · Visit history' }).first()
        await history.locator('table').first().waitFor()
        assert.match(await history.innerText(), /5 of 5[\s\S]*0 so far/)
        await history.scrollIntoViewIfNeeded()
        await shot(visits, 'member-visits')
      } finally { for (const context of contexts) await context.close() }
    }
  } finally { await browser.close() }
}
