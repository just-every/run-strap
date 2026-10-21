import assert from 'node:assert/strict'
import { mkdir,readFile } from 'node:fs/promises'
import { join,extname } from 'node:path'
import { chromium } from '@playwright/test'

export async function leadReportBrowser(h,{ana,unknown,ownerId}) {
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  try {for(const width of [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:1000}})
    await context.route(h.origin+'/**',async route=>{
      const path=new URL(route.request().url()).pathname
      if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path)) return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
      return route.continue()
    })
    const split=h.owner.indexOf('=');await context.addCookies([{name:h.owner.slice(0,split),value:h.owner.slice(split+1),url:h.origin}])
    const page=await context.newPage()
    const shot=async state=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('section').filter({has:page.getByRole('heading',{name:'Inquiry and attendance funnel',exact:true})}).locator('table').evaluateAll(tables=>tables.every(table=>table.getBoundingClientRect().right<=table.closest('section').getBoundingClientRect().right)),true,'RPT-005: report tables stay inside their panel');await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`RPT-005-${state}-${width}.png`),fullPage:true})}
    await page.goto(h.origin+'/app/leads')
    const funnel=page.locator('section').filter({has:page.getByRole('heading',{name:'Inquiry and attendance funnel',exact:true})})
    await funnel.getByText('Unknown source',{exact:true}).first().waitFor()
    await shot('sources')
    await page.getByLabel('Acquisition source',{exact:true}).fill('Community event')
    await page.getByRole('button',{name:'Filter funnel',exact:true}).click()
    assert.equal(await page.locator('[data-funnel-member]').count(),1)
    const row=page.locator(`[data-funnel-member="${ana.id}"]`)
    await row.getByText('2 attended · repeat attendance',{exact:true}).waitFor()
    await shot('filtered')
    await row.getByRole('link',{name:'Visit 1',exact:true}).click()
    await page.locator('#roster').waitFor()
    assert.ok((await page.locator('#roster').innerText()).includes(ana.name))
    await page.goBack()
    await row.getByRole('link',{name:'Inquiry 1',exact:true}).click()
    await page.locator('#lead').waitFor()
    assert.ok((await page.locator('#lead').innerText()).includes('EXTERNAL-PRIYA'))
    await shot('source-history')
    await page.getByLabel('Acquisition source',{exact:true}).fill('No such source')
    await page.getByRole('button',{name:'Filter funnel',exact:true}).click()
    assert.equal(await page.locator('[data-funnel-member]').count(),0)
    await shot('empty')
    const add=page.locator('form[action*="name=lead.create"]')
    await add.getByLabel('Person',{exact:true}).selectOption(unknown.personId)
    await add.getByLabel('Assigned owner',{exact:true}).selectOption(ownerId)
    await add.getByLabel('Next action',{exact:true}).fill('Call about weekday mat classes '+width)
    await add.getByLabel('Due at (UTC)',{exact:true}).fill(new Date(Date.now()+86400000).toISOString().slice(0,16))
    await add.getByLabel('Inquiry source (optional)',{exact:true}).fill('Studio open day '+width)
    await shot('capture-source')
    await add.getByRole('button',{name:'Add inquiry',exact:true}).click()
    const added=(await h.state()).pipeline.leads.find(l=>l.source==='Studio open day '+width)
    assert.ok(added)
    await page.locator(`[data-lead-id="${added.id}"] a`).click()
    await page.locator('#lead').getByText('Inquiry source: Studio open day '+width,{exact:true}).waitFor()
    await shot('saved-source')
    await context.close()
  }}finally{await browser.close()}
}
