import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'

export async function demandBrowser(h,{draft,stage,stale=false}) {
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  try {
    for(const width of [1440,390]) {
      const context=await browser.newContext({viewport:{width,height:1000}})
      await context.route(h.origin+'/**',async route=>{
        const path=new URL(route.request().url()).pathname
        if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path)) return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
        return route.continue()
      })
      const index=h.owner.indexOf('=')
      await context.addCookies([{name:h.owner.slice(0,index),value:h.owner.slice(index+1),url:h.origin}])
      const page=await context.newPage()
      await page.goto(h.origin+'/app/classes')
      await page.getByRole('heading',{name:'Classes',exact:true}).waitFor()
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'classes screen fits viewport')
      if(draft) {
        const card=page.locator('#draft-'+draft.id)
        await card.scrollIntoViewIfNeeded()
        await card.getByText('Demand recommendation: '+draft.recommendation.action,{exact:true}).waitFor()
        assert.equal(await card.getByRole('button',{name:'Approve this exact recommendation',exact:true}).count(),stale?0:1)
        if(stale) await card.getByRole('alert').getByText(/Source facts changed/).waitFor()
        else await card.getByLabel('Member notification',{exact:true}).selectOption(draft.recommendation.notification)
        if(draft.impact.bookings) {
          await card.getByText('Review member notices',{exact:true}).click()
          for(const c of draft.impact.classes) for(const b of c.bookings) await card.getByText(b.body,{exact:true}).waitFor()
        }
        await card.screenshot({path:join(process.env.STRAP_PROOF_DIR,`SUCCESS-006-${stage}-${width}.png`)})
        if(stage==='additional' && width===390) {
          await card.getByRole('button',{name:'Approve this exact recommendation',exact:true}).click()
          await page.waitForURL(h.origin+'/app/classes')
          assert.equal(await page.locator('#draft-'+draft.id).count(),0)
          await page.locator('.panel').filter({has:page.getByRole('heading',{name:'Upcoming classes',exact:true})}).getByText('Extra Mat',{exact:true}).waitFor()
        }
      } else {
        await page.getByRole('heading',{name:'Upcoming classes',exact:true}).waitFor()
        await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`SUCCESS-006-${stage}-${width}.png`),fullPage:false})
      }
      await context.close()
    }
  } finally {await browser.close()}
}
