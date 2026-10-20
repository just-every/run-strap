import assert from 'node:assert/strict'
import { readFile,mkdir } from 'node:fs/promises'
import { join,extname } from 'node:path'
import { chromium } from '@playwright/test'

export async function recognitionBrowser(h,{ana,ben}) {
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  try {
    for(const width of [1440,390]) {
      for(const [role,cookie] of [['owner',h.owner],['member',ana.cookie],['new-member',ben.cookie]]) {
        const context=await browser.newContext({viewport:{width,height:1000}})
        await context.route(h.origin+'/**',async route=>{
          const path=new URL(route.request().url()).pathname
          if(!path.includes('..') && /\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
          return route.continue()
        })
        const index=cookie.indexOf('=')
        await context.addCookies([{name:cookie.slice(0,index),value:cookie.slice(index+1),url:h.origin}])
        const page=await context.newPage()
        await page.goto(h.origin+'/app/recognition')
        await page.getByRole('heading',{name:'Visit recognition',exact:true}).waitFor()
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true)
        await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`LEAD-006-${role}-${width}.png`),fullPage:true})
        if(role==='owner') {
          const launch=page.locator('form[action*="name=recognition.launch"]')
          await launch.getByLabel('Member',{exact:true}).selectOption(ana.id)
          await launch.getByRole('button',{name:'Open member preferences door',exact:true}).click()
          await page.getByRole('heading',{name:'Member action required',exact:true}).waitFor()
          assert.equal(await page.getByRole('link',{name:'Member recognition sign-in',exact:true}).getAttribute('href'),'/signin?returnTo=%2Fapp%2Frecognition')
          await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`LEAD-006-launch-${width}.png`),fullPage:true})
          const auditResponse=await page.goto(h.origin+'/app/people?person='+ana.id+'#staff-actions')
          assert.equal(auditResponse.status(),200,await page.locator('body').innerText())
          await page.getByRole('heading',{name:'Staff action history',exact:true}).waitFor()
          await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`LEAD-006-audit-${width}.png`)})
          assert.ok(await page.locator('#staff-actions [data-staff-command="recognition.launch"]').first().isVisible(),'the canonical launch is visible in staff history')
        } else {
          assert.equal(await page.getByRole('heading',{name:'Private milestone tasks',exact:true}).count(),0)
          await page.getByLabel('Private visit recognition',{exact:true}).selectOption('false')
          await page.getByRole('button',{name:'Save recognition choice',exact:true}).click()
          assert.equal((await h.state(cookie)).recognition.preferences[0].optedIn,false)
          await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`LEAD-006-optout-${role}-${width}.png`),fullPage:true})
        }
        await context.close()
      }
    }
  } finally {await browser.close()}
}
