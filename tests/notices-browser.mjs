import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'

export async function noticesBrowser(h,{stage,ana,booking,second}) {
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  try {
    for(const width of [1440,390]) {
      const context=await browser.newContext({viewport:{width,height:1000}})
      await context.route(h.origin+'/**',async route=>{
        const path=new URL(route.request().url()).pathname
        if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path)) return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
        return route.continue()
      })
      const cookie=stage==='studio'||stage==='staff'||stage==='outcome'?h.owner:ana.cookie,index=cookie.indexOf('=')
      await context.addCookies([{name:cookie.slice(0,index),value:cookie.slice(index+1),url:h.origin}])
      const page=await context.newPage()
      const path=stage==='studio'?'/app/studio':stage==='staff'?'/app/people?person='+ana.id:stage==='outcome'?'/app/classes':'/app'
      await page.goto(h.origin+path)
      await page.getByRole('heading',{name:stage==='studio'?'Studio':stage==='staff'?'People':'Classes',exact:true}).first().waitFor()
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,stage+' fits viewport')
      if(stage==='booked') {
        const move=page.locator('form[action*="name=booking.move"]').filter({has:page.locator(`input[name="id"][value="${booking.id}"]`)})
        await move.locator('..').getByText('Reschedule',{exact:true}).click()
        await move.getByLabel('New class').selectOption(second.id)
        await move.scrollIntoViewIfNeeded()
        await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`MSG-002-reschedule-${width}.png`),fullPage:true})
        if(width===390) {
          await move.getByRole('button',{name:'Confirm reschedule'}).click()
          await page.waitForURL(h.origin+'/app')
          await page.getByText('Booking moved: Evening Mat',{exact:true}).waitFor()
          await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`MSG-002-moved-${width}.png`),fullPage:true})
        }
      } else if(stage==='preferences') {
        const panel=page.locator('#message-preferences')
        await panel.scrollIntoViewIfNeeded()
        await panel.getByLabel('Booking and class emails').selectOption('true')
        await panel.screenshot({path:join(process.env.STRAP_PROOF_DIR,`MSG-002-preferences-${width}.png`)})
        if(width===390) {
          await panel.getByRole('button',{name:'Save message preferences'}).click()
          await page.waitForURL(h.origin+'/app#message-preferences')
          assert.equal(await page.locator('#message-preferences').getByLabel('Booking and class emails').inputValue(),'true')
          await page.locator('#message-preferences').screenshot({path:join(process.env.STRAP_PROOF_DIR,`MSG-002-opted-out-${width}.png`)})
        }
      } else if(stage==='studio') {
        const panel=page.locator('.panel').filter({has:page.getByRole('heading',{name:'Booking and class email text',exact:true})})
        await panel.scrollIntoViewIfNeeded()
        await panel.screenshot({path:join(process.env.STRAP_PROOF_DIR,`MSG-002-studio-${width}.png`)})
        if(width===390) {
          await panel.getByLabel('Opening text').fill('Welcome to Brooklyn Studio.')
          await panel.getByLabel('Closing text').fill('Questions? Please call your studio.')
          await panel.getByRole('button',{name:'Save message text'}).click()
          await page.waitForURL(h.origin+'/app/studio')
          assert.equal(await page.getByLabel('Opening text').inputValue(),'Welcome to Brooklyn Studio.')
        }
      } else if(stage==='staff') {
        const detail=page.locator('details').filter({has:page.locator('summary').getByText('Message preferences',{exact:true})}).first()
        await detail.locator('summary').click()
        await detail.scrollIntoViewIfNeeded()
        if(width===390) {
          await detail.getByRole('button',{name:'Open member message preferences'}).click()
          await page.waitForURL(h.origin+path)
          await page.locator('summary').getByText('Message preferences',{exact:true}).click()
          await page.getByRole('link',{name:'Member message sign-in',exact:true}).waitFor()
        }
        await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`MSG-002-staff-${width}.png`),fullPage:true})
      } else await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`MSG-002-${stage}-${width}.png`),fullPage:true})
      await context.close()
    }
  } finally {await browser.close()}
}
