import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

// STUDIO-001/002 at 1440 and 390: the owner's Studio, class-week, plan and report screens, the member's receipt,
// and a manager's report pages, each fitting the width and read through real controls.
async function session(h, cookie, width, browser) {
  const context = await browser.newContext({ viewport: { width, height: 1000 } })
  await context.route(h.origin + '/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (!path.includes('..') && /\.(css|svg|woff2|png|ico)$/.test(path)) return route.fulfill({ body: await readFile(join(process.cwd(), 'public', path)), contentType: { '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon' }[path.slice(path.lastIndexOf('.'))] })
    return route.continue()
  })
  const at = cookie.indexOf('=')
  await context.addCookies([{ name: cookie.slice(0, at), value: cookie.slice(at + 1), url: h.origin }])
  return { context, page: await context.newPage() }
}
const shot = async (page, width, name, heading) => {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} fits ${width}`)
  if (process.env.STRAP_PROOF_DIR) await page.locator('section').filter({ has: page.getByRole('heading', { name: heading, exact: true }) }).first().screenshot({ path: join(process.env.STRAP_PROOF_DIR, `STUDIO-002-${name}-${width}.png`) })
}

export async function locationsBrowser(h, { la, ana }) {
  if (process.env.STRAP_PROOF_DIR) await mkdir(process.env.STRAP_PROOF_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  try {
    for (const width of [1440, 390]) {
      const owner = await session(h, h.owner, width, browser)
      try {
        const page = owner.page, name = `Phoenix ${width}`
        await page.goto(h.origin + '/app/studio')
        const locations = page.locator('#locations')
        for (const text of ['Brooklyn', 'Los Angeles', '(310) 555-0111', '1 Ocean Avenue, Suite 4, Santa Monica, CA 90401', 'Pacific time']) assert.ok((await locations.innerText()).includes(text), text)
        await shot(page, width, 'locations', 'Locations')
        await locations.locator('summary', { hasText: 'Add a location' }).click()
        const form = locations.locator('form').filter({ has: page.getByRole('button', { name: 'Add location', exact: true }) })
        await form.locator('[name="name"]').fill(name)
        await form.locator('select[name="timeZone"]').selectOption('America/Phoenix')
        await form.locator('[name="phone"]').fill('(602) 555-0123')
        await form.locator('[name="line1"]').fill('1 Camelback Road')
        await form.locator('[name="city"]').fill('Phoenix')
        await form.locator('[name="region"]').fill('AZ')
        await form.locator('[name="postalCode"]').fill('85016')
        await Promise.all([page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes('name=location.save')), form.getByRole('button', { name: 'Add location', exact: true }).click()])
        await page.waitForURL(h.origin + '/app/studio')
        const saved = (await h.state()).locations.find(l => l.name === name)
        assert.deepEqual([saved.timeZone, saved.phone, saved.address.city], ['America/Phoenix', '6025550123', 'Phoenix'])
        await page.reload()
        assert.ok((await page.locator('#locations').innerText()).includes('(602) 555-0123'))
        await shot(page, width, 'location-added', 'Locations')

        // The class week carries a location per row, entered on that location's clock.
        await page.goto(h.origin + '/app/classes')
        const editor = page.locator('#prepare-week')
        assert.ok((await editor.locator('select[name="c0_locationId"] option').allInnerTexts()).includes('Los Angeles'))
        await editor.locator('select[name="c0_locationId"]').selectOption(la.id)
        await shot(page, width, 'class-week', 'Prepare a class week')

        // Plans: where each is valid, and the receipt a staff member reads.
        await page.goto(h.origin + '/app/packs')
        await shot(page, width, 'plan-locations', 'Where plans are valid')
        assert.ok((await page.locator('#receipts').innerText()).includes('Larkhill Movement LLC'))
        await shot(page, width, 'staff-receipts', 'Purchase receipts')
        for (const path of ['/app/revenue', '/app/reports']) {
          await page.goto(h.origin + path)
          assert.ok(await page.locator(path === '/app/revenue' ? '#revenue-locations' : '#report-locations').isVisible(), `${path} lists each location`)
          await shot(page, width, path.slice(5) + '-by-location', 'By location')
        }
      } finally { await owner.context.close() }
      const member = await session(h, ana.cookie, width, browser)
      try {
        await member.page.goto(h.origin + '/app/packs')
        const receipt = member.page.locator('#receipts article').first()
        assert.ok((await receipt.innerText()).includes('Larkhill Movement LLC'))
        await shot(member.page, width, 'member-receipt', 'Purchase receipts')
      } finally { await member.context.close() }
    }
  } finally { await browser.close() }
}

/** A manager's report pages: only their location, at both widths. */
export async function managerBrowser(h, cookie, { name, other }) {
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  try {
    for (const width of [1440, 390]) {
      const manager = await session(h, cookie, width, browser)
      try {
        for (const [path, heading] of [['/app/revenue', 'Revenue filters'], ['/app/reports', 'Report filters']]) {
          await manager.page.goto(h.origin + path)
          const text = await manager.page.locator('main').innerText()
          assert.ok(text.includes(name) && !text.includes(other), `${path} names ${name} only`)
          await shot(manager.page, width, `manager${path.slice(4)}`, heading)
        }
        assert.equal((await manager.page.goto(h.origin + '/app/people')).status(), 403)
      } finally { await manager.context.close() }
    }
  } finally { await browser.close() }
}
