import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'

// API-002 and API-003 screens at 1440 and 390: attendance starts unchecked, and a default
// roster key cannot read it. The owner explicitly creates a combined key, reads
// its resources and usage, then rotates and revokes it. Screenshots mask secrets.
export async function integrationsBrowser(h, { api, member }) {
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
          await page.screenshot({ path: join(process.env.STRAP_PROOF_DIR, `API-002-${name}-${width}.png`), fullPage: true, mask: [page.locator('p.token')] })
        }
        const label = `Lobby screen ${width}`, owner = await pageFor(h.owner)
        await owner.goto(h.origin + '/app/integrations')
        const create = owner.locator('form[action*="name=integration.create"]')
        const attendanceScope = create.locator('input[name="sc_attendance:read"]')
        assert.equal(await create.locator('input[name="sc_roster:read"]').isChecked(), true)
        assert.equal(await attendanceScope.isChecked(), false, 'attendance requires explicit consent at creation')
        await create.getByLabel('Key label').fill(`Default roster ${width}`)
        await shot(owner, 'default-consent')
        await create.getByRole('button', { name: 'Create integration key', exact: true }).click()
        await owner.getByRole('heading', { name: 'Save your integration secret' }).waitFor()
        const defaultToken = (await owner.locator('p.token').innerText()).trim()
        assert.match(defaultToken, /^strap_int_[0-9a-f]{64}$/)
        assert.deepEqual((await api(h, defaultToken, '/api/strap/integration/key')).value.scopes.map(s => s.name), ['roster:read'])
        assert.equal((await api(h, defaultToken, '/api/strap/integration/attendance')).status, 403)
        await owner.goto(h.origin + '/app/integrations')
        await owner.locator('tr').filter({ hasText: `Default roster ${width}` }).first().getByRole('button', { name: 'Revoke', exact: true }).click()
        assert.equal(await attendanceScope.isChecked(), false)
        await create.getByLabel('Key label').fill(label)
        for (const shared of [/member reference only this key can use/, /outcome \(booked, attended, no-show, excused, late cancel or early cancel\)/, /No reasons, notes, health answers, money, contact details or full names\./]) assert.match(await create.innerText(), shared, 'API-003 the form lists the exact shared fields before the key exists')
        await attendanceScope.check()
        await create.getByLabel(/booking\.changed/).check()
        await create.getByLabel(/attendance\.changed/).check()
        await shot(owner, 'create')
        await create.getByRole('button', { name: 'Create integration key', exact: true }).click()
        await owner.getByRole('heading', { name: 'Save your integration secret' }).waitFor()
        const token = (await owner.locator('p.token').innerText()).trim()
        assert.match(token, /^strap_int_[0-9a-f]{64}$/)
        await shot(owner, 'secret')
        assert.deepEqual((await api(h, token, '/api/strap/integration/key')).value.scopes.map(s => s.name), ['roster:read', 'attendance:read'])
        assert.equal(await attendanceScope.isChecked(), false, 'the next key starts with fresh consent')
        // Both resources and a refused attendance write appear in the same usage log.
        assert.equal((await api(h, token, '/api/strap/integration/roster')).status, 200)
        const outcomes = await api(h, token, '/api/strap/integration/attendance')
        assert.deepEqual([outcomes.status, outcomes.value.scope, Array.isArray(outcomes.value.data)], [200, 'attendance:read', true])
        assert.match((await api(h, token, '/api/strap/integration/key')).value.scopes[1].reads, /member reference only this key can use/)
        assert.equal((await api(h, token, '/api/strap/integration/attendance', { method: 'POST', body: {} })).status, 405)
        await owner.goto(h.origin + '/app/integrations')
        assert.ok(!(await owner.content()).includes(token), 'the secret is shown only once')
        const row = owner.locator('tr').filter({ hasText: label }).first()
        await row.getByText('booking.changed').waitFor()
        await row.getByText('attendance.changed').waitFor()
        await row.getByText('attendance:read', { exact: true }).waitFor()
        await owner.locator('summary', { hasText: `Usage and failures for ${label}` }).click()
        await owner.getByText('read only').first().waitFor()
        await shot(owner, 'usage')
        await row.getByRole('button', { name: 'Rotate secret', exact: true }).click()
        await owner.getByRole('heading', { name: 'Save your integration secret' }).waitFor()
        const rotated = (await owner.locator('p.token').innerText()).trim()
        assert.match(rotated, /^strap_int_[0-9a-f]{64}$/)
        assert.notEqual(rotated, token)
        await shot(owner, 'rotated-secret')
        assert.equal((await api(h, token, '/api/strap/integration/attendance')).value.error, 'integration_credential_revoked')
        assert.equal((await api(h, rotated, '/api/strap/integration/attendance')).status, 200)
        assert.deepEqual((await api(h, rotated, '/api/strap/integration/key')).value.scopes.map(s => s.name), ['roster:read', 'attendance:read'])
        await owner.goto(h.origin + '/app/integrations')
        await owner.locator('tr').filter({ hasText: label }).first().getByRole('button', { name: 'Revoke', exact: true }).click()
        await owner.locator('tr').filter({ hasText: label }).first().locator('span.pill', { hasText: /^Revoked$/ }).waitFor()
        assert.equal((await api(h, rotated, '/api/strap/integration/attendance')).value.error, 'integration_credential_revoked')
        assert.equal((await api(h, rotated, '/api/strap/integration/roster')).value.error, 'integration_credential_revoked')
        await shot(owner, 'revoked')
        const visitor = await pageFor(member.cookie)
        const refused = await visitor.goto(h.origin + '/app/integrations')
        assert.equal(refused.status(), 403)
        await visitor.getByText('Page unavailable').waitFor()
        await shot(visitor, 'member-refused')
      } finally { for (const context of contexts) await context.close() }
    }
  } finally { await browser.close() }
}
