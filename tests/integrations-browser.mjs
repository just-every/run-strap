import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'

// API-002 screens at 1440 and 390: the owner creates a read-roster key through the
// Integrations form, reads its one-time secret, sees its usage and failures after the
// key reads the roster and is refused a write, rotates the secret and revokes the key.
// A member cannot open the page.
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
          await page.screenshot({ path: join(process.env.STRAP_PROOF_DIR, `API-002-${name}-${width}.png`), fullPage: true })
        }
        const label = `Lobby screen ${width}`, owner = await pageFor(h.owner)
        await owner.goto(h.origin + '/app/integrations')
        const create = owner.locator('form[action*="name=integration.create"]')
        await create.getByLabel('Key label').fill(label)
        await create.getByLabel(/booking\.changed/).check()
        await shot(owner, 'create')
        await create.getByRole('button', { name: 'Create integration key', exact: true }).click()
        await owner.getByRole('heading', { name: 'Save your integration secret' }).waitFor()
        const token = (await owner.locator('p.token').innerText()).trim()
        assert.match(token, /^strap_int_[0-9a-f]{64}$/)
        await shot(owner, 'secret')
        // The new key reads the roster once and is refused a write; both appear in its log.
        assert.equal((await api(h, token, '/api/strap/integration/roster')).status, 200)
        assert.equal((await api(h, token, '/api/strap/integration/roster', { method: 'POST', body: {} })).status, 405)
        await owner.goto(h.origin + '/app/integrations')
        assert.ok(!(await owner.content()).includes(token), 'the secret is shown only once')
        const row = owner.locator('tr').filter({ hasText: label }).first()
        await row.getByText('booking.changed').waitFor()
        await owner.locator('summary', { hasText: `Usage and failures for ${label}` }).click()
        await owner.getByText('read only').first().waitFor()
        await shot(owner, 'usage')
        await row.getByRole('button', { name: 'Rotate secret', exact: true }).click()
        await owner.getByRole('heading', { name: 'Save your integration secret' }).waitFor()
        const rotated = (await owner.locator('p.token').innerText()).trim()
        assert.notEqual(rotated, token)
        assert.equal((await api(h, token, '/api/strap/integration/roster')).value.error, 'integration_credential_revoked')
        await owner.goto(h.origin + '/app/integrations')
        await owner.locator('tr').filter({ hasText: label }).first().getByRole('button', { name: 'Revoke', exact: true }).click()
        await owner.locator('tr').filter({ hasText: label }).first().locator('span.pill', { hasText: /^Revoked$/ }).waitFor()
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
