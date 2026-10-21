import assert from 'node:assert/strict'
import { readFile,mkdir } from 'node:fs/promises'
import { join,extname } from 'node:path'
import { chromium } from '@playwright/test'
import { downloadNativePair } from './report-downloads-browser.mjs'
import { run } from './harness.mjs'

export async function teachingPayBrowser() {
  await run(async h=>{
    await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
    await h.cmd('studio.save',{location:'Brooklyn studio',timeZone:'America/New_York'})
    const maya=await h.person('Maya','instructor'),leo=await h.person('Leo','instructor'),ana=await h.person('Ana'),ben=await h.person('Ben')
    for(const p of [ana,ben])await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:p.id,credits:10,amountCents:20000,expiresAt:'2099-12-31T00:00:00Z'})).id})
    const effectiveAt=new Date(Date.now()+5000).toISOString(),start=new Date(Date.now()+30_000).toISOString()
    await h.cmd('pay.rule.save',{service:'Yoga',effectiveAt,mode:'flat-class',rateCents:4500,minimumCents:0,cancellation:{treatment:'flat',amountCents:1500}})
    await h.cmd('pay.rule.save',{service:'Pilates',effectiveAt,mode:'per-attendee',rateCents:1200,minimumCents:3000,cancellation:{treatment:'none'}})
    const week=at=>{const d=new Date(at);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7)).toISOString().slice(0,10)}
    const publish=async(title,service,instructorId,at,minutes)=>(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:week(at),classes:[{title,service,instructorId,room:service+' room',start:at,end:new Date(Date.parse(at)+minutes*60_000).toISOString(),capacity:12}]})).id})).classes[0]
    const yoga=await publish('Morning Yoga','Yoga',maya.id,start,5),pilates=await publish('Pilates Foundations','Pilates',leo.id,start,5)
    for(const c of [yoga,pilates])for(const p of (c.id===yoga.id?[ana,ben]:[ana])){const b=await h.cmd('booking.book',{classId:c.id},p.cookie);await h.cmd('attendance.checkin',{id:b.id},c.id===yoga.id?maya.cookie:leo.cookie)}
    const cancel=async c=>{const draft=await h.cmd('closure.prepare',{scope:'class',classId:c.id,reason:'Building maintenance'});await h.cmd('closure.confirm',{id:draft.id,impact:draft.impact.key})}
    await cancel(await publish('Evening Restorative','Yoga',maya.id,new Date(Date.now()+86400_000).toISOString(),50))
    await cancel(await publish('Guest Workshop','Workshop',maya.id,new Date(Date.now()+2*86400_000).toISOString(),90))
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(yoga.end)-Date.now()+50)))
    await h.cmd('pay.adjust',{classId:yoga.id,amountCents:1000,reason:'Agreed additional room preparation',requestId:'room-preparation'})
    await captureTeachingPay(h,maya)
  })
}

async function captureTeachingPay(h,maya) {
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
          const exported = await downloadNativePair(page,'teaching-pay',width,'Download pay CSV','Download pay XLSX')
          assert.deepEqual(exported.map(row=>row.classId),await page.locator('[data-pay-class]').evaluateAll(rows=>rows.map(row=>row.dataset.payClass)))
          await page.getByLabel('Service (blank for all)',{exact:true}).fill('Evening Yoga')
          await page.getByLabel('Effective from (UTC)',{exact:true}).fill(new Date(Date.now()+86400_000+width*1000).toISOString().slice(0,19))
          await page.getByLabel('Rate in USD',{exact:true}).fill('45.00')
          await page.getByRole('button',{name:'Publish pay rule',exact:true}).click()
          await page.getByRole('heading',{name:'Teaching pay',exact:true}).waitFor()
          assert.ok((await h.state()).payRules.some(r=>r.service==='Evening Yoga'&&r.rateCents===4500))
        } else {
          assert.equal(await page.getByRole('link',{name:'Download pay XLSX',exact:true}).count(),0)
          assert.equal(await page.getByRole('button',{name:'Publish pay rule',exact:true}).count(),0)
          assert.equal(await page.getByText('Pilates Foundations',{exact:true}).count(),0)
        }
        await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`STAFF-002-${role}-${width}.png`),fullPage:true})
        await context.close()
      }
    }
  } finally {await browser.close()}
}
