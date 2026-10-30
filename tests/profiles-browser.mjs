import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'
import { auditPage, keyboardFields } from './accessibility-browser.mjs'

// APP-003 screens at 1440 and 390: the member edits their profile, books and
// cancels; the owner reads the same profile and booking on the person card and
// edits the emergency contact for them; another member sees only their own page.
export async function profilesBrowser(h, { ana, ben, entry, inactive }) {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.STRAP_CHROMIUM_PATH, args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
  await mkdir(process.env.STRAP_PROOF_DIR, { recursive: true })
  try {
    for (const width of [1440, 390]) {
      const contexts = []
      try {
        const pageFor = async cookie => {
          const context = await browser.newContext({ viewport: { width, height: 1000 } }); contexts.push(context)
          await context.route(h.origin + '/**', async route => {
            const path = new URL(route.request().url()).pathname
            if (!path.includes('..') && /\.(css|svg|woff2|png|ico|js)$/.test(path)) return route.fulfill({ body: await readFile(join(process.cwd(), 'public', path)), contentType: { '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.js': 'text/javascript' }[extname(path)] })
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
        if (width === 1440) {
          await member.keyboard.press('Tab')
          assert.equal(await member.locator('.skip').evaluate(el => el === document.activeElement), true, 'skip link is first')
          await member.keyboard.press('Enter')
          assert.equal(await member.locator('main').evaluate(el => el === document.activeElement), true, 'skip link reaches main')
          await keyboardFields(member, mine, ['Full name', 'Mobile phone', 'Contact name', 'Contact phone', 'Relationship'])
          await auditPage(member, 'populated member profile')
          // A rejected input leaves all choices available and announces the error.
          await mine.getByLabel('Mobile phone').fill('123')
          await mine.getByRole('button', { name: 'Save my profile', exact: true }).click()
          await mine.getByRole('alert').filter({ hasText: 'complete US mobile' }).waitFor()
          assert.equal(await mine.getByLabel('Mobile phone').inputValue(), '123')
          assert.equal(await mine.getByRole('alert').evaluate(el => el === document.activeElement), true)
          await auditPage(member, 'member profile validation error')
          for (const proofWidth of [1440, 390]) {
            await member.setViewportSize({ width: proofWidth, height: 1000 })
            await member.screenshot({ path: join(process.env.STRAP_PROOF_DIR, `APP-005-profile-error-${proofWidth}.png`), fullPage: true })
          }
          await member.setViewportSize({ width, height: 1000 })
          await mine.getByLabel('Mobile phone').fill('6155550144')
          const saveUrl = '**/app/action?name=profile.save&*'
          const before = (await h.state()).profileChanges.filter(c => c.personId === ana.id).length
          await member.route(saveUrl, route => route.abort('failed'))
          await mine.getByRole('button', { name: 'Save my profile', exact: true }).click()
          await mine.getByRole('alert').filter({ hasText: 'Save not confirmed' }).waitFor()
          assert.equal((await h.state()).profileChanges.filter(c => c.personId === ana.id).length, before, 'interruption before commit saves nothing')
          assert.equal(await mine.getByLabel('Mobile phone').inputValue(), '6155550144')
          assert.equal(await mine.getByRole('alert').evaluate(el => el === document.activeElement), true)
          await auditPage(member, 'interrupted member save')
          await member.unroute(saveUrl)
          // Lose the retry response after the real server commits. The receipt read
          // must recover success without submitting another effect.
          await member.route(saveUrl, async route => { await route.fetch(); await route.abort('failed') })
          await mine.getByRole('button', { name: 'Retry same save', exact: true }).click()
          await member.getByRole('status').filter({ hasText: 'Verified against the current studio record' }).waitFor()
          assert.equal((await h.state()).profileChanges.filter(c => c.personId === ana.id).length, before + 1)
          assert.equal(await mine.getByLabel('Mobile phone').inputValue(), '(615) 555-0144')
          await member.unroute(saveUrl)
          // An unavailable verification read must not turn even a committed POST
          // into success. A deliberate retry carries the original request identity.
          await mine.getByLabel('Mobile phone').fill('6155550146')
          await member.route(saveUrl, async route => { await route.fetch(); await route.abort('failed') })
          await member.route('**/api/strap/profile-save?*', route => route.abort('failed'))
          await mine.getByRole('button', { name: 'Save my profile', exact: true }).click()
          await mine.getByRole('alert').filter({ hasText: 'Save not confirmed' }).waitFor()
          assert.equal((await h.state()).profileChanges.filter(c => c.personId === ana.id).length, before + 2)
          assert.equal(await mine.getByLabel('Mobile phone').inputValue(), '6155550146')
          assert.equal(await member.getByRole('status').filter({ hasText: 'Verified against' }).count(), 0, 'an unreadable final state is never success')
          await member.unroute('**/api/strap/profile-save?*')
          await mine.getByRole('button', { name: 'Retry same save', exact: true }).click()
          await member.getByRole('status').filter({ hasText: 'Verified against the current studio record' }).waitFor()
          assert.equal((await h.state()).profileChanges.filter(c => c.personId === ana.id).length, before + 2, 'retry after a lost receipt cannot duplicate the change')
          await member.unroute(saveUrl)
          // A receipt for this request is not confirmation of a later profile.
          await mine.getByLabel('Mobile phone').fill('6155550147')
          await member.route('**/api/strap/profile-save?*', async route => {
            await h.cmd('profile.save.staff', { personId: ana.id, phone: '6155550148', channel: 'phone', requestId: 'synthetic-strap-newer-profile' })
            await route.continue()
          })
          await mine.getByRole('button', { name: 'Save my profile', exact: true }).click()
          await mine.getByRole('alert').filter({ hasText: 'profile changed after this save' }).waitFor()
          assert.equal(await mine.getByLabel('Mobile phone').inputValue(), '6155550147', 'the interrupted choice is still visible')
          assert.equal((await h.state(ana.cookie)).people.find(p => p.id === ana.id).phone, '6155550148', 'the studio current state wins')
          assert.equal(await member.getByRole('status').filter({ hasText: 'Verified against' }).count(), 0)
          await auditPage(member, 'changed authoritative profile after save')
          await member.unroute('**/api/strap/profile-save?*')
          await member.goto(h.origin + '/app/profile')
          console.log('PROBE APP-005 interrupted save: before commit, after commit, failed verification read and changed final state -> retained choices, no false success, once-only retry')
        }
        await mine.getByLabel('Mobile phone').fill(`(615) 555-01${width === 390 ? 39 : 44}`)
        await mine.getByLabel('Contact name').fill(`Marta Lopez ${width}`)
        await mine.getByLabel('Contact phone').fill('615-555-0166')
        await mine.getByLabel('Relationship').fill('Mother')
        await mine.getByRole('button', { name: 'Save my profile', exact: true }).click()
        await member.getByRole('status').filter({ hasText: 'Verified against the current studio record' }).waitFor()
        let row = (await h.state(ana.cookie)).people.find(p => p.id === ana.id)
        assert.deepEqual(row.emergencyContact, { name: `Marta Lopez ${width}`, phone: '6155550166', relationship: 'Mother' }, await member.locator('main').innerText())
        await member.getByText(`Emergency contact: Marta Lopez ${width} (Mother) · (615) 555-0166`).waitFor()
        await shot(member, 'member-profile')
        await member.goto(h.origin + '/app')
        if (width === 1440) {
          const waiver = await h.cmd('waiver.publish', { text: 'Synthetic accessible studio waiver.', requiresSignature: true })
          await member.reload()
          await auditPage(member, 'unsigned waiver and populated class booking')
          await member.locator('tr').filter({ hasText: entry.title }).getByRole('button', { name: 'Book', exact: true }).focus()
          await member.keyboard.press('Enter')
          await member.getByRole('alert').filter({ hasText: 'waiver acknowledgement required' }).waitFor()
          assert.equal((await h.state(ana.cookie)).bookings.some(b => b.classId === entry.id && b.status === 'booked'), false, 'a refused booking spends no seat')
          assert.equal(await member.getByRole('alert').evaluate(el => el === document.activeElement), true, 'booking refusal is announced and focused')
          await auditPage(member, 'booking refusal before personal waiver')
          const sign = member.locator('#waiver form')
          await sign.getByLabel('Your full name').focus()
          await member.keyboard.press('Tab')
          assert.equal(await sign.getByRole('checkbox').evaluate(el => el === document.activeElement), true)
          await member.keyboard.press('Space')
          await member.keyboard.press('Tab')
          assert.equal(await sign.getByRole('button', { name: 'Sign this document' }).evaluate(el => el === document.activeElement), true)
          await member.keyboard.press('Enter')
          await member.locator('#waiver [role=status]').waitFor()
          assert.equal((await h.state(ana.cookie)).acknowledgements.some(a => a.waiverId === waiver.id), true)
          await auditPage(member, 'signed waiver and class booking')
          console.log('PROBE APP-005 keyboard waiver: member Classes -> personal signature completed with keyboard, current completion readable')
        }
        const line = member.locator('tr').filter({ hasText: entry.title }).first()
        if (width === 1440) {
          await line.getByRole('button', { name: 'Book', exact: true }).focus()
          await member.keyboard.press('Enter')
          await member.locator('tr').filter({ hasText: entry.title }).getByRole('status').waitFor()
          await auditPage(member, 'booked member class')
          await shot(member, 'member-classes')
          console.log('PROBE APP-005 keyboard booking: populated Classes, Enter on Book -> Booked status and retained booking')
        } else await line.getByRole('button', { name: 'Book', exact: true }).click()
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
        if (width === 1440) {
          await keyboardFields(staff, editor, ['Request channel', 'Full name', 'Mobile phone', 'Contact name', 'Contact phone', 'Relationship'])
          await auditPage(staff, 'populated owner People profile editor')
        }
        await editor.getByLabel('Request channel').selectOption('phone')
        await editor.getByLabel('Contact phone').fill('(615) 555-0155')
        await editor.getByRole('button', { name: 'Save profile for member', exact: true }).click()
        await staff.getByRole('status').filter({ hasText: 'Verified against the current studio record' }).waitFor()
        const action = (await h.state()).staffActions[0]
        assert.deepEqual([action.command, action.channel, action.after.emergencyContact.phone], ['profile.save.staff', 'phone', '6155550155'])
        await staff.locator('#person summary').filter({ hasText: /^Profile changes$/ }).click()
        await shot(staff, 'staff-profile')
        // Inactive records remain editable by the owner without restoring sign-in.
        await staff.goto(h.origin + `/app/people?person=${inactive.id}#person`)
        await staff.locator('#person summary').filter({ hasText: /^Edit profile$/ }).click()
        const inactiveEditor = staff.locator('form[data-profile-save]')
        if (width === 1440) {
          const inactivePhone = '6155550181'
          const inactiveBefore = (await h.state()).profileChanges.filter(c => c.personId === inactive.id).length
          const inactiveRequest = await inactiveEditor.locator('[name=requestId]').inputValue()
          await inactiveEditor.getByLabel('Mobile phone').fill(inactivePhone)
          const saveUrl = '**/app/action?name=profile.save.staff&*'
          await staff.route(saveUrl, async route => { await route.fetch(); await route.abort('failed') })
          await staff.route('**/api/strap/profile-save?*', route => route.abort('failed'))
          await inactiveEditor.getByRole('button', { name: 'Save profile for member', exact: true }).click()
          await inactiveEditor.getByRole('alert').filter({ hasText: 'Save not confirmed' }).waitFor()
          assert.equal(await inactiveEditor.getByLabel('Mobile phone').inputValue(), inactivePhone)
          assert.equal((await h.state()).profileChanges.filter(c => c.personId === inactive.id).length, inactiveBefore + 1)
          await staff.unroute('**/api/strap/profile-save?*')
          await inactiveEditor.getByRole('button', { name: 'Retry same save', exact: true }).click()
          await staff.getByRole('status').filter({ hasText: 'Verified against the current studio record' }).waitFor({ timeout: 10000 })
          await staff.unroute(saveUrl)
          const inactiveState = await h.state(), inactiveRow = inactiveState.people.find(p => p.id === inactive.id)
          assert.equal(inactiveRow.phone, inactivePhone)
          assert.equal(inactiveRow.active, false, 'editing an inactive profile never restores sign-in')
          assert.equal(inactiveState.profileChanges.filter(c => c.personId === inactive.id).length, inactiveBefore + 1, 'retrying the inactive save keeps one change')
          const receipt = await staff.request.get(h.origin + '/api/strap/profile-save?' + new URLSearchParams({ command: 'profile.save.staff', personId: inactive.id, requestId: inactiveRequest }))
          assert.equal(receipt.status(), 200)
          assert.equal((await receipt.json()).status, 'saved')
          await staff.locator('#person summary').filter({ hasText: /^Edit profile$/ }).click()
          assert.equal(await inactiveEditor.getByLabel('Mobile phone').isEnabled(), true, 'a verified inactive save restores the editor')
          assert.equal((await staff.request.get(staff.url())).status(), 200, 'the final People confirmation page is readable')
        }
        await shot(staff, 'inactive-profile')
        if (width === 1440) console.log('PROBE APP-005 A: owner saves an inactive People profile, loses the committed response and receipt, retries -> verified current profile, enabled editor, inactive access and exactly one change')
        // The member cancels and reads the staff change; the owner sees the cancellation.
        await member.goto(h.origin + '/app')
        if (width === 390) await shot(member, 'member-classes')
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
