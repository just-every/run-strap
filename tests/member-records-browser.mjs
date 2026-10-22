import assert from 'node:assert/strict'
import { readFile,mkdir } from 'node:fs/promises'
import { join,extname } from 'node:path'
import { chromium } from '@playwright/test'

async function browserProof(h,cookie,run) {
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  try {for(const width of [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:1000}})
    try {
      await context.route(h.origin+'/**',async route=>{
        const path=new URL(route.request().url()).pathname
        if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
        return route.continue()
      })
      const at=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,at),value:cookie.slice(at+1),url:h.origin}])
      const page=await context.newPage()
      const capture=async name=>{
        await page.evaluate(() => document.fonts.ready)
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} fits ${width}`)
        if(process.env.STRAP_PROOF_DIR){await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true});await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`MEM-001-${name}-${width}.png`),fullPage:true})}
      }
      await run(page,width,capture)
    } finally {await context.close()}
  }} finally {await browser.close()}
}
export async function memberRecordsBrowser(h,{desk,member}) {
  await browserProof(h,desk.cookie,async(page,width,capture)=>{
    await page.goto(h.origin+'/app/people?person='+member.id)
    await page.getByRole('heading',{name:'Member records',exact:true}).waitFor()
    await capture('staff-record')
    const create=page.locator('form').filter({has:page.getByRole('button',{name:'Create member profile',exact:true})})
    await create.getByLabel('Full name',{exact:true}).fill('Phone member '+width)
    await create.getByLabel('Email',{exact:true}).fill('phone-'+width+'@studio.example')
    await create.getByLabel('Mobile phone',{exact:true}).fill('5125550188')
    await capture('phone-create')
    await create.getByRole('button',{name:'Create member profile',exact:true}).click()
    await page.getByRole('link',{name:'Phone member '+width,exact:true}).click()
    const profile=page.locator('form').filter({has:page.getByRole('button',{name:'Save profile for member',exact:true})})
    await profile.getByLabel('Mobile phone',{exact:true}).fill('5125550189')
    await profile.getByRole('button',{name:'Save profile for member',exact:true}).click()
    await page.getByRole('button',{name:'Send account invitation',exact:true}).click()
    await page.getByText('Unified member history',{exact:true}).click()
    await page.getByText('Account invitation · submitted',{exact:true}).waitFor()
    await capture('invited-audit')
  })
}
export async function mergedHistoryBrowser(h,{member}) {
  await browserProof(h,h.owner,async(page,width,capture)=>{
    await page.goto(h.origin+'/app/people?person='+member.id)
    await page.getByText('Unified member history',{exact:true}).click()
    await page.getByText('2 retained source identities. Original ledger and consent identities stay intact.',{exact:true}).waitFor()
    await capture('linked-history')
    await page.getByText('Restricted notes and check-in alerts',{exact:true}).click()
    await page.getByText('Private owner alert',{exact:false}).first().waitFor()
    await capture('restricted-note')
    await page.getByText('Review a duplicate identity',{exact:true}).click()
    await capture('merge-review-form')
    const state=await h.state(),entry=state.classes.find(c=>c.title==='History class')
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:state.studio.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(entry.start)).map(p=>[p.type,p.value]))
    await page.goto(h.origin+'/app?day='+[parts.year,parts.month,parts.day].join('-')+'&class='+entry.id)
    await page.getByText('Private owner alert',{exact:true}).waitFor()
    await capture('owner-checkin-alert')
  })
}
