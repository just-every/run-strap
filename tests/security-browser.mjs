import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'
import { totp } from './mfa-helpers.mjs'

// SEC-004 screens at 1440 and 390 in a real browser with a WebAuthn virtual authenticator: a finance user is held
// at enrollment, adds a passkey, reads the report, and a new session is held until the passkey is presented; a
// member opts in with an authenticator app; the owner sees factors, resets and finance grants. The page must not overflow.
const types = { '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.js': 'text/javascript' }
export async function securityBrowser(h, { finance, nextSession, member }) {
  const proof = process.env.STRAP_PROOF_DIR ?? join(tmpdir(), 'strap-security-proof')
  await mkdir(proof, { recursive: true })
  const browser = await chromium.launch({ headless: true, executablePath: process.env.STRAP_CHROMIUM_PATH, args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
  try {
    for (const width of [1440, 390]) {
      const open = async cookie => {
        const context = await browser.newContext({ viewport: { width, height: 1000 } })
        await context.route(h.origin + '/**', async route => {
          const path = new URL(route.request().url()).pathname
          if (!path.includes('..') && types[extname(path)] && path.startsWith('/brand') || path === '/rer-theme.css' || path === '/fonts/fonts.css' || path === '/favicon.ico') return route.fulfill({ body: await readFile(join(process.cwd(), 'public', path)), contentType: types[extname(path)] })
          return route.continue()
        })
        const index = cookie.indexOf('='); await context.addCookies([{ name: cookie.slice(0, index), value: cookie.slice(index + 1), url: h.origin }])
        return { context, page: await context.newPage() }
      }
      const capture = async (page, name) => {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name + ' does not overflow')
        await page.screenshot({ path: join(proof, `SEC-004-${name}-${width}.png`), fullPage: true })
      }
      const confirmEmail = async (page, email, button) => {
        await page.getByRole('button', { name: button, exact: true }).click()
        await page.getByText('Confirmation link sent.', { exact: false }).waitFor()
        const messages = (await h.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence DESC').all()).results.map(r => JSON.parse(r.message))
        const message = messages.find(m => m.to.includes(email))
        const link = message.text.match(/http:\/\/[^\s]+\/auth\/confirm\?token=[^\s]+/)[0]
        await page.goto(link)
        await page.getByRole('button', { name: 'Confirm', exact: true }).click()
        await page.getByRole('heading', { name: 'Security', exact: true }).waitFor()
      }
      const person = finance[width]
      // Held at enrollment, then a passkey in the virtual authenticator.
      const first = await open(person.cookie)
      try {
        const cdp = await first.context.newCDPSession(first.page)
        await cdp.send('WebAuthn.enable')
        await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })
        const held = await first.page.goto(h.origin + '/app/revenue')
        assert.equal(held.status(), 403)
        await first.page.getByRole('heading', { name: 'Security', exact: true }).waitFor()
        assert.equal(new URL(first.page.url()).pathname, '/app/revenue')
        await first.page.getByText('Reports, pay, exports, staff access').waitFor()
        await capture(first.page, 'finance-held-enrollment')
        await confirmEmail(first.page, person.email, 'Email a confirmation link')
        await first.page.getByRole('button', { name: 'Add a passkey', exact: true }).click()
        await first.page.getByRole('heading', { name: 'Passkey added', exact: true }).waitFor()
        assert.equal(await first.page.locator('.recovery li').count(), 10)
        await capture(first.page, 'recovery-codes')
        await first.page.getByRole('link', { name: 'Continue', exact: true }).click()
        await first.page.getByRole('heading', { name: 'Revenue and collections', exact: true }).waitFor()
        await capture(first.page, 'finance-report')
        // A new session is held until the passkey is presented (the same virtual authenticator holds the credential).
        const again = await nextSession(person)
        await first.context.clearCookies()
        const index = again.indexOf('='); await first.context.addCookies([{ name: again.slice(0, index), value: again.slice(index + 1), url: h.origin }])
        await first.page.goto(h.origin + '/app/revenue')
        await first.page.getByRole('heading', { name: 'Confirm it is you', exact: true }).waitFor()
        await capture(first.page, 'verify')
        await first.page.getByRole('button', { name: 'Use a passkey', exact: true }).click()
        await first.page.getByRole('heading', { name: 'Revenue and collections', exact: true }).waitFor()
        await first.page.goto(h.origin + '/app/security')
        await first.page.getByRole('heading', { name: 'Your second factors', exact: true }).waitFor()
        await capture(first.page, 'finance-factors')
      } finally { await first.context.close() }
      // A member opts in with an authenticator app.
      const opted = await open(member[width].cookie)
      try {
        await opted.page.goto(h.origin + '/app/security')
        await capture(opted.page, 'email-step-up')
        await confirmEmail(opted.page, member[width].email, 'Email a confirmation link')
        await opted.page.getByRole('button', { name: 'Set up an authenticator app', exact: true }).click()
        await opted.page.getByRole('heading', { name: 'Authenticator app', exact: true }).waitFor()
        const secret = await opted.page.locator('.checkin-code code').innerText()
        await capture(opted.page, 'totp-setup')
        await opted.page.getByLabel('Code from the app', { exact: true }).fill(totp(secret))
        await opted.page.getByRole('button', { name: 'Turn on', exact: true }).click()
        await opted.page.getByRole('heading', { name: 'Save your recovery codes', exact: true }).waitFor()
        await capture(opted.page, 'totp-recovery-codes')
      } finally { await opted.context.close() }
      // The owner: factors, who can sign in, and finance users.
      const owner = await open(h.owner)
      try {
        await owner.page.goto(h.origin + '/app/security')
        await owner.page.getByRole('heading', { name: 'Who can sign in', exact: true }).waitFor()
        await owner.page.getByRole('heading', { name: 'Finance users', exact: true }).waitFor()
        await capture(owner.page, 'owner-access')
        await confirmEmail(owner.page, h.auth.OWNER_EMAIL, 'Confirm email before a reset')
        const row = owner.page.getByRole('row').filter({ hasText: person.email })
        const reason = row.getByLabel('Reason', { exact: true })
        assert.equal(await reason.getAttribute('required'), '')
        await reason.fill('Lost device')
        await capture(owner.page, 'reset-reason')
        await row.getByRole('button', { name: 'Reset factors', exact: true }).click()
        await owner.page.getByRole('heading', { name: 'Who can sign in', exact: true }).waitFor()
        assert.equal((await h.send('/auth/session', undefined, person.cookie)).status, 401, 'browser reset ends the target session')
        assert.equal(await owner.page.getByRole('row').filter({ hasText: person.email }).getByRole('button', { name: 'Reset factors', exact: true }).count(), 0)
        await capture(owner.page, 'reset-complete')
      } finally { await owner.context.close() }
    }
  } finally { await browser.close() }
}

/** The recovery page uses real authenticated HTTP, with assets served locally. */
export async function recoveryDiagnosticsBrowser(h, {failedId, bookingId, checkoutId, failedTaxId, uncertainTaxId, rejectedSmsId, integrationId, secrets}) {
  const browser = await chromium.launch({headless:true, executablePath:process.env.STRAP_CHROMIUM_PATH, args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1000}})
    try {
      await context.route(h.origin+'/**', async route => {
        const path = new URL(route.request().url()).pathname
        if (!path.includes('..') && types[extname(path)]) return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:types[extname(path)]})
        return route.continue()
      })
      const index = h.owner.indexOf('=')
      await context.addCookies([{name:h.owner.slice(0,index),value:h.owner.slice(index+1),url:h.origin}])
      const page = await context.newPage()
      await page.goto(h.origin+'/app/studio')
      await page.getByRole('link',{name:'Open recovery diagnostics',exact:true}).click()
      await page.getByRole('heading',{name:'Recovery diagnostics',exact:true}).waitFor()
      const failed = page.getByRole('row').filter({hasText:failedId})
      assert.match(await failed.innerText(),/Failed/)
      assert.match(await failed.innerText(),/HTTP 403/)
      assert.match(await page.getByRole('row').filter({hasText:bookingId}).innerText(),/Rate limited/)
      const checkout = page.getByRole('row').filter({has:page.getByText(checkoutId,{exact:true})}).filter({hasText:'Pack'})
      assert.match(await checkout.innerText(),/Paid/)
      const failedTax = page.getByRole('row').filter({hasText:failedTaxId})
      assert.match(await failedTax.innerText(),/Failed/)
      assert.match(await failedTax.innerText(),/HTTP 403/)
      assert.match(await page.getByRole('row').filter({hasText:uncertainTaxId}).innerText(),/Uncertain/)
      assert.equal(await page.getByRole('row').filter({hasText:checkoutId}).filter({hasText:'Payment recorded by this attempt: Yes'}).count(),1)
      assert.equal(await page.getByRole('row').filter({hasText:checkoutId}).filter({hasText:'Payment recorded by this attempt: No'}).count(),1)
      assert.match(await page.locator('.recovery-diagnostics').innerText(),/provider health unknown/)
      const rejectedSms = page.getByRole('row').filter({hasText:rejectedSmsId})
      assert.match(await rejectedSms.innerText(),/Rejected/); assert.match(await rejectedSms.innerText(),/Provider error 21211/)
      const key = page.getByRole('row').filter({hasText:integrationId})
      assert.match(await key.innerText(),/HTTP 403; scope not granted/); assert.match(await key.innerText(),/Refused among retained requests: 1/)
      for (const secret of secrets) assert.ok(!(await page.content()).includes(secret))
      assert.equal(await page.locator('.recovery-diagnostics form, .recovery-diagnostics button').count(),0,'diagnostics contain no execution controls')
      const smallText = await page.locator('.recovery-diagnostics *').evaluateAll(elements=>elements.filter(el=>el.checkVisibility()&&el.textContent.trim()&&parseFloat(getComputedStyle(el).fontSize)<13).map(el=>el.tagName))
      assert.deepEqual(smallText,[])
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
      const missing = await page.locator('button,a,summary,[role=button]').evaluateAll(elements=>elements.filter(el=>el.checkVisibility()&&!el.innerText.trim()&&el.querySelector('svg,img')&&!el.querySelector('[role=tooltip]')).map(el=>el.tagName))
      assert.deepEqual(missing,[])
      // The phone layout keeps every history readable without sideways scrolling.
      await page.setViewportSize({width:390,height:1000})
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'390 layout does not overflow')
      assert.ok(await rejectedSms.isVisible()); assert.ok(await key.isVisible())
      await page.setViewportSize({width:1440,height:1000})
      const proof = process.env.STRAP_RECOVERY_PROOF_DIR
      if (proof) {
        await mkdir(proof,{recursive:true})
        await page.screenshot({path:join(proof,'SEC-001-recovery-1440.png'),fullPage:true})
        await page.setViewportSize({width:390,height:1000})
        await page.screenshot({path:join(proof,'SEC-001-recovery-390.png'),fullPage:true})
        await page.setViewportSize({width:1440,height:1000})
      }
      await rejectedSms.getByRole('link',{name:'Review SMS test',exact:true}).click()
      assert.equal(new URL(page.url()).hash,'#sms-test')
      await page.getByRole('heading',{name:'Twilio SMS test',exact:true}).waitFor()
      await page.goBack()
      await key.getByRole('link',{name:'Review integration key',exact:true}).click()
      assert.equal(new URL(page.url()).pathname,'/app/integrations')
      await page.goBack()
      await failedTax.getByRole('link',{name:'Review tax connection',exact:true}).click()
      assert.equal(new URL(page.url()).pathname,'/app/studio')
      assert.equal(new URL(page.url()).hash,'#tax')
      await page.getByRole('heading',{name:'Sales tax',exact:true}).waitFor()
      await page.goBack()
      await checkout.getByRole('link',{name:'Review payment',exact:true}).click()
      assert.equal(new URL(page.url()).pathname,'/app/packs')
      await page.getByRole('heading',{name:'Plan payments and reconciliation',exact:true}).waitFor()
      await page.goBack()
      await failed.getByRole('link',{name:'Review billing connection',exact:true}).click()
      assert.equal(new URL(page.url()).pathname,'/app/studio')
      await page.getByRole('heading',{name:'Stripe test connection',exact:true}).waitFor()
    } finally { await context.close() }
  } finally { await browser.close() }
}
