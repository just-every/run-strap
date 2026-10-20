import assert from 'node:assert/strict'
import { readFile,mkdir } from 'node:fs/promises'
import { join,extname } from 'node:path'
import { chromium } from '@playwright/test'

export async function teachingPayBrowser(h,maya) {
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  try {
    for(const width of [1440,390]) {
      for(const [role,cookie] of [['owner',h.owner],['instructor',maya.cookie]]) {
        const context=await browser.newContext({viewport:{width,height:1000}})
        await context.route(h.origin+'/**',async route=>{
          const path=new URL(route.request().url()).pathname
          if(!path.includes('..') && /\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
          return route.continue()
        })
        const index=cookie.indexOf('=')
        await context.addCookies([{name:cookie.slice(0,index),value:cookie.slice(index+1),url:h.origin}])
        const page=await context.newPage()
        await page.goto(h.origin+'/app/teaching-pay')
        await page.getByRole('heading',{name:'Teaching pay',exact:true}).waitFor()
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true)
        if(role==='owner') {
          await page.getByLabel('Service (blank for all)',{exact:true}).fill('Evening Yoga')
          await page.getByLabel('Effective from (UTC)',{exact:true}).fill(new Date(Date.now()+86400_000).toISOString().slice(0,19))
          await page.getByLabel('Rate in USD',{exact:true}).fill('45.00')
          await page.getByRole('button',{name:'Publish pay rule',exact:true}).click()
          await page.getByRole('heading',{name:'Teaching pay',exact:true}).waitFor()
          assert.ok((await h.state()).payRules.some(r=>r.service==='Evening Yoga'&&r.rateCents===4500))
        } else {
          assert.equal(await page.getByRole('button',{name:'Publish pay rule',exact:true}).count(),0)
          assert.equal(await page.getByText('Low Flow',{exact:true}).count(),0)
        }
        await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`STAFF-002-${role}-${width}.png`),fullPage:true})
        await context.close()
      }
    }
  } finally {await browser.close()}
}
