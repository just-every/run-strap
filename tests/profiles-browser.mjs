import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'

// APP-003 screens at 1440 and 390: the member edits their profile, books and
// cancels; the owner reads the same profile and booking on the person card and
// edits the emergency contact for them; another member sees only their own page.
export async function profilesBrowser(h, { ana, ben, entry }) {
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
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${name} fits ${width}`)
          await page.screenshot({ path: join(process.env.STRAP_PROOF_DIR, `APP-003-${name}-${width}.png`), fullPage: true })
        }
        // The member's own door.
        const member = await pageFor(ana.cookie)
        await member.goto(h.origin + '/app/profile')
        const mine = member.locator('#profile')
        await mine.getByLabel('Mobile phone').fill(`(615) 555-01${width === 390 ? 39 : 44}`)
        await mine.getByLabel('Contact name').fill(`Marta Lopez ${width}`)
        await mine.getByLabel('Contact phone').fill('615-555-0166')
        await mine.getByLabel('Relationship').fill('Mother')
        await mine.getByRole('button', { name: 'Save my profile', exact: true }).click()
        let row = (await h.state(ana.cookie)).people.find(p => p.id === ana.id)
        assert.deepEqual(row.emergencyContact, { name: `Marta Lopez ${width}`, phone: '6155550166', relationship: 'Mother' }, await member.locator('main').innerText())
        await member.getByText(`Emergency contact: Marta Lopez ${width} (Mother) · (615) 555-0166`).waitFor()
        await shot(member, 'member-profile')
        await member.goto(h.origin + '/app')
        const line = member.locator('tr').filter({ hasText: entry.title }).first()
        await line.getByRole('button', { name: 'Book', exact: true }).click()
        const seat = (await h.state(ana.cookie)).bookings.find(b => b.classId === entry.id && b.status === 'booked')
        assert.ok(seat, await member.locator('main').innerText())
        // The owner sees the same profile and booking on the person card, then edits for the member.
        const staff = await pageFor(h.owner)
        await staff.goto(h.origin + `/app/people?person=${ana.id}#person`)
        const card = staff.locator('#person')
        await card.getByText(`Emergency contact: Marta Lopez ${width} (Mother) · (615) 555-0166`).waitFor()
        await card.locator('span.pill', { hasText: /^Booked$/ }).first().waitFor()
        await card.locator('summary').filter({ hasText: /^Edit profile$/ }).click()
        const editor = card.locator('form[action*="name=profile.save.staff"]')
        await editor.getByLabel('Request channel').selectOption('phone')
        await editor.getByLabel('Contact phone').fill('(615) 555-0155')
        await editor.getByRole('button', { name: 'Save profile for member', exact: true }).click()
        const action = (await h.state()).staffActions[0]
        assert.deepEqual([action.command, action.channel, action.after.emergencyContact.phone], ['profile.save.staff', 'phone', '6155550155'])
        await staff.locator('#person summary').filter({ hasText: /^Profile changes$/ }).click()
        await shot(staff, 'staff-profile')
        // The member cancels and reads the staff change; the owner sees the cancellation.
        await member.goto(h.origin + '/app')
        await member.locator('tr').filter({ hasText: entry.title }).first().getByRole('button', { name: 'Cancel', exact: true }).click()
        assert.equal((await h.state()).bookings.find(b => b.id === seat.id).status, 'cancelled')
        await member.goto(h.origin + '/app/profile')
        await member.getByText(`Emergency contact: Marta Lopez ${width} (Mother) · (615) 555-0155`).waitFor()
        await member.getByText(/Studio staff · phone · changed emergency contact/).first().waitFor()
        await shot(member, 'member-history')
        // Another member opens only their own profile.
        const other = await pageFor(ben.cookie)
        await other.goto(h.origin + '/app/profile')
        const text = await other.locator('main').innerText()
        assert.ok(!text.includes('Marta Lopez') && !text.includes(ana.email), 'another member sees none of it')
        await shot(other, 'other-member')
        row = (await h.state()).people.find(p => p.id === ana.id)
        assert.equal(row.emergencyContact.phone, '6155550155')
      } finally { for (const context of contexts) await context.close() }
    }
  } finally { await browser.close() }
}
