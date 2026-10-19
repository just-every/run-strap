import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'

// SCHED-014 public staff path at both sizes: roster preview -> courtesy cancel
// -> cancellations list -> restore -> profile, including persisted end states.
export async function bookingActionsBrowser(h,{flow,ana,first}) {
  const browser = await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  const day = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date(flow.start))
  try {
    for (const width of [1440,390]) {
      const context = await browser.newContext({viewport:{width,height:1000}})
      await context.route(h.origin+'/**',async route => {
        const path = new URL(route.request().url()).pathname
        if (!path.includes('..') && /\.(css|svg|woff2|png|ico)$/.test(path)) return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
        return route.continue()
      })
      const index = h.owner.indexOf('=')
      await context.addCookies([{name:h.owner.slice(0,index),value:h.owner.slice(index+1),url:h.origin}])
      const page = await context.newPage()
      await page.goto(h.origin+`/app?day=${day}&class=${flow.id}#roster`)
      await page.getByText('Cancel for Ana',{exact:true}).click()
      const cancel = page.locator(`form[action*="name=booking.cancel"]`).filter({has:page.locator(`input[name="id"][value="${first.id}"]`)}).filter({has:page.locator('input[name="mode"][value="early"]')})
      await cancel.getByLabel('Cancellation reason').selectOption('Sick')
      await cancel.getByLabel('Waiver reason (early cancel)',{exact:true}).fill('Spoke to Ana at the desk')
      await page.locator('#roster').screenshot({path:join(process.env.STRAP_PROOF_DIR,`SCHED-014-roster-preview-${width}.png`)})
      const move = page.locator('#roster details.more').filter({has:page.getByText('Move booking',{exact:true})}).first()
      await move.locator('summary').click()
      await move.screenshot({path:join(process.env.STRAP_PROOF_DIR,`SCHED-014-move-preview-${width}.png`)})
      await move.locator('summary').click()
      await cancel.getByRole('button',{name:'Early cancel: credit back, no fee',exact:true}).click()
      let s = await h.state()
      assert.equal(s.bookings.find(b => b.id === first.id).status,'cancelled')
      await page.goto(h.origin+`/app/people?person=${ana.id}#cancellations`)
      const cancellation = page.locator('#cancellations')
      await cancellation.screenshot({path:join(process.env.STRAP_PROOF_DIR,`SCHED-014-cancellations-${width}.png`)})
      const restore = cancellation.locator('form[action*="name=booking.restore"]').filter({has:page.locator(`input[name="id"][value="${first.id}"]`)})
      await restore.locator('..').locator('..').getByText('Restore booking',{exact:true}).first().click()
      await restore.getByLabel('Restore reason',{exact:true}).fill('Cancelled the wrong booking')
      await restore.getByRole('button',{name:'Restore booking',exact:true}).click()
      s = await h.state()
      assert.equal(s.bookings.find(b => b.id === first.id).status,'booked')
      assert.equal(s.packs.find(p => p.id === ana.packId).remaining,3)
      await page.goto(h.origin+`/app/people?person=${ana.id}#person`)
      await page.locator('#person').screenshot({path:join(process.env.STRAP_PROOF_DIR,`SCHED-014-profile-restored-${width}.png`)})
      await context.close()
    }
  } finally { await browser.close() }
}

export async function pendingMoveBrowser(h,ana,pending) {
  const browser = await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  try {
    for (const width of [1440,390]) {
      const context = await browser.newContext({viewport:{width,height:1000}})
      await context.route(h.origin+'/**',async route => {
        const path = new URL(route.request().url()).pathname
        if (!path.includes('..') && /\.(css|svg|woff2|png|ico)$/.test(path)) return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
        return route.continue()
      })
      const index = ana.cookie.indexOf('=')
      await context.addCookies([{name:ana.cookie.slice(0,index),value:ana.cookie.slice(index+1),url:h.origin}])
      const page = await context.newPage(); await page.goto(h.origin+'/app')
      const claim = page.locator('form[action*="name=booking.offer.accept"]').filter({has:page.locator(`input[name="id"][value="${pending.id}"]`)})
      await claim.scrollIntoViewIfNeeded()
      assert.ok(await page.getByText(/\$15\.00 fee added; your original credit moves/).isVisible())
      await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`SCHED-014-member-move-offer-${width}.png`)})
      if (width === 390) {
        await claim.getByRole('button',{name:'Claim spot',exact:true}).click()
        assert.ok(!(await h.state(ana.cookie)).bookings.some(b => b.id === pending.id && b.status === 'offered'))
        await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`SCHED-014-member-moved-${width}.png`)})
      }
      await context.close()
    }
  } finally { await browser.close() }
}

export async function bookingDraftBrowser(h,draft) {
  const browser = await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  try {
    for (const width of [1440,390]) {
      const context = await browser.newContext({viewport:{width,height:1000}})
      await context.route(h.origin+'/**',async route => {
        const path = new URL(route.request().url()).pathname
        if (!path.includes('..') && /\.(css|svg|woff2|png|ico)$/.test(path)) return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
        return route.continue()
      })
      const index = h.owner.indexOf('=')
      await context.addCookies([{name:h.owner.slice(0,index),value:h.owner.slice(index+1),url:h.origin}])
      const page = await context.newPage(); await page.goto(h.origin+`/app/people#draft-${draft.id}`)
      const record = page.locator(`#draft-${draft.id}`)
      await record.screenshot({path:join(process.env.STRAP_PROOF_DIR,`SCHED-014-draft-${width}.png`)})
      if (width === 390) await record.getByRole('button',{name:'Approve this exact booking change',exact:true}).click()
      await context.close()
    }
  } finally { await browser.close() }
}
