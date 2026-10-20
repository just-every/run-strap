import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'

export async function feesBrowser(h, { entry, Ana, Ben, Dee, deeFee }) {
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  const dir = process.env.STRAP_PROOF_DIR
  await mkdir(dir, { recursive: true })
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } })
      await context.route(h.origin + '/**', async route => {
        const path = new URL(route.request().url()).pathname
        if (!path.includes('..') && /\.(css|svg|woff2|png|ico)$/.test(path)) return route.fulfill({ body: await readFile(join(process.cwd(),'public',path)), contentType: { '.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon' }[extname(path)] })
        return route.continue()
      })
      const login = async cookie => { await context.clearCookies(); const at=cookie.indexOf('='); await context.addCookies([{name:cookie.slice(0,at),value:cookie.slice(at+1),url:h.origin}]) }
      await login(h.owner)
      const page = await context.newPage(), shot = label => page.screenshot({path:join(dir,`ATT-002-${label}-${width}.png`),fullPage:true})
      await page.goto(h.origin+'/app/studio#booking-rules')
      await page.getByLabel('No-show grace (minutes after start)').fill('10')
      await shot('grace-form')
      await page.getByRole('button',{name:'Save booking rule',exact:true}).click()
      assert.equal((await h.state()).bookingRules.find(r=>r.service===null).noShowGraceMinutes,10)
      await page.goto(h.origin+'/app/packs#attendance-fees')
      const panel=page.locator('#attendance-fees')
      assert.ok(await panel.getByText(/CASH-BEN-ATT2/).isVisible())
      await panel.getByRole('row').filter({hasText:'Dee'}).getByText('Record receipt or waive',{exact:true}).click()
      await shot('pending-desk')
      await page.goto(h.origin+`/app/people?person=${Dee.id}#attendance-fees`)
      await shot('pending-profile')
      await page.goto(h.origin+`/app/people?person=${Ben.id}#attendance-fees`)
      await shot('collected-profile')
      await login(Ben.cookie)
      await page.goto(h.origin+'/app/packs#attendance-fees')
      assert.ok(await page.locator('#attendance-fees').getByText(/CASH-BEN-ATT2/).isVisible())
      await shot('member-receipt')
      await login(h.owner)
      const s=await h.state(), day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date(s.classes.find(c=>c.id===entry.id).start))
      await page.goto(h.origin+`/app?day=${day}&class=${entry.id}#roster`)
      await shot('no-show-roster')
      await context.close()
    }
    // Complete a desk receipt through the mobile profile form and inspect the end state.
    const context=await browser.newContext({viewport:{width:390,height:1000}})
    await context.route(h.origin+'/**',async route=>{const path=new URL(route.request().url()).pathname;if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]});return route.continue()})
    const at=h.owner.indexOf('=');await context.addCookies([{name:h.owner.slice(0,at),value:h.owner.slice(at+1),url:h.origin}])
    const page=await context.newPage()
    await page.goto(h.origin+`/app/people?person=${Dee.id}#attendance-fees`)
    const panel=page.locator('#attendance-fees')
    await panel.getByText('Record receipt or waive',{exact:true}).click()
    await panel.getByLabel('External receipt reference').fill('DESK-DEE-ATT2')
    await panel.getByRole('button',{name:'Record fee receipt',exact:true}).click()
    assert.equal((await h.state()).fees.find(f=>f.id===deeFee.id).status,'collected')
    for(const width of [1440,390]) {
      await page.setViewportSize({width,height:1000})
      await page.goto(h.origin+'/app/packs#attendance-fees')
      assert.ok(await page.locator('#attendance-fees').getByText(/DESK-DEE-ATT2/).isVisible())
      await page.screenshot({path:join(dir,`ATT-002-desk-collected-${width}.png`),fullPage:true})
      await page.goto(h.origin+`/app/people?person=${Ana.id}#attendance-fees`)
      await page.screenshot({path:join(dir,`ATT-002-waived-${width}.png`),fullPage:true})
    }
    await context.close()
  } finally { await browser.close() }
}
