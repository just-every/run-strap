import assert from 'node:assert/strict'
import { readFile,mkdir } from 'node:fs/promises'
import { join,extname } from 'node:path'
import { chromium } from '@playwright/test'
export async function classRemindersBrowser(h,{stage,ana}) {
 await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 try {
  for(const width of [1440,390]) {
   const context=await browser.newContext({viewport:{width,height:1000}})
   await context.route(h.origin+'/**',async route=>{
    const path=new URL(route.request().url()).pathname
    if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
    return route.continue()
   })
   const cookie=stage==='member'?ana.cookie:h.owner,index=cookie.indexOf('=')
   await context.addCookies([{name:cookie.slice(0,index),value:cookie.slice(index+1),url:h.origin}])
   const page=await context.newPage(),path=stage==='member'?'/app':'/app/studio'
   await page.goto(h.origin+path)
   await page.getByRole('heading',{name:stage==='member'?'Classes':'Studio',exact:true}).waitFor()
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'reminder screen fits viewport')
   if(stage==='rules') {
    const panel=page.locator('#class-reminders')
    await panel.getByText('Add a reminder rule',{exact:true}).click()
    await panel.getByLabel('Service (blank for studio default)').last().fill('Evening Pilates')
    await panel.getByLabel('Reminders').last().selectOption('false')
    await panel.screenshot({path:join(process.env.STRAP_PROOF_DIR,`MSG-003-rules-${width}.png`)})
    if(width===390) {
     await panel.getByRole('button',{name:'Save reminder rule',exact:true}).last().click()
     await page.waitForURL(h.origin+'/app/studio')
     await page.locator('#class-reminders').getByText('Evening Pilates',{exact:true}).waitFor()
     await page.locator('#class-reminders').screenshot({path:join(process.env.STRAP_PROOF_DIR,`MSG-003-saved-${width}.png`)})
    }
   } else if(stage==='failure') {
    const panel=page.locator('#reminder-tasks')
    await panel.getByText('Provider refused the email',{exact:true}).waitFor()
    await panel.getByLabel('Follow-up outcome').fill('Called the member')
    await panel.screenshot({path:join(process.env.STRAP_PROOF_DIR,`MSG-003-failure-${width}.png`)})
    if(width===390) {
     await panel.getByRole('button',{name:'Complete follow-up'}).click()
     await page.waitForURL(h.origin+'/app/studio')
     await page.locator('#reminder-tasks').getByText('No open reminder follow-up tasks.',{exact:true}).waitFor()
     await page.locator('#reminder-tasks').screenshot({path:join(process.env.STRAP_PROOF_DIR,`MSG-003-completed-${width}.png`)})
    }
   } else {
    const notices=page.locator('.panel').filter({has:page.getByRole('heading',{name:'Notices',exact:true})})
    await notices.screenshot({path:join(process.env.STRAP_PROOF_DIR,`MSG-003-member-${width}.png`)})
   }
   await context.close()
  }
 } finally {await browser.close()}
}
