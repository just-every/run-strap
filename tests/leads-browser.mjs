import assert from 'node:assert/strict'
import { mkdir,readFile } from 'node:fs/promises'
import { join,extname } from 'node:path'
import { chromium } from '@playwright/test'
export async function leadsBrowser(h,{ana,ownerId,lead}) {
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
    const shot=async state=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`LEAD-002-${state}-${width}.png`),fullPage:true})}
    await page.goto(h.origin+'/app/leads')
    await page.getByRole('heading',{name:'Lead follow-up',exact:true}).waitFor();await shot('queue')
    const add=page.locator('form[action*="name=lead.create"]')
    await add.getByLabel('Person',{exact:true}).selectOption(ana.id)
    await add.getByLabel('Assigned owner',{exact:true}).selectOption(ownerId)
    await add.getByLabel('Next action',{exact:true}).fill('Call about a morning intro '+width)
    await add.getByLabel('Due at (UTC)',{exact:true}).fill(new Date(Date.now()-3600000).toISOString().slice(0,16))
    await add.getByLabel('Inquiry note',{exact:true}).fill('Ana asked for a call after trying an evening class.')
    await add.getByRole('button',{name:'Add inquiry',exact:true}).click()
    await page.getByRole('heading',{name:'Staff queue',exact:true}).waitFor()
    let added=(await h.state()).pipeline.leads.find(l=>l.nextAction==='Call about a morning intro '+width)
    assert.ok(added.overdue);await shot('inquiry-overdue')
    await page.locator(`[data-lead-id="${added.id}"] a`).click()
    const update=page.locator('form[action*="name=lead.update"]')
    await update.getByLabel('Next action',{exact:true}).fill('Confirm Ana’s intro time by phone')
    await update.getByLabel('Due at (UTC)',{exact:true}).fill(new Date(Date.now()+86400000).toISOString().slice(0,16))
    await update.getByLabel('Change note',{exact:true}).fill('Owner agreed to call tomorrow.')
    await update.getByRole('button',{name:'Save follow-up',exact:true}).click()
    added=(await h.state()).pipeline.leads.find(l=>l.id===added.id);assert.equal(added.overdue,false);assert.equal(added.nextAction,'Confirm Ana’s intro time by phone')
    await shot('assigned-next-action')
    const note=page.locator('form[action*="name=lead.note"]')
    await note.getByLabel('Conversation note',{exact:true}).fill('Recorded an actual callback; Ana will come for a first visit.')
    await note.getByRole('button',{name:'Record conversation',exact:true}).click()
    assert.ok((await h.state()).pipeline.events.some(e=>e.leadId===added.id&&e.note?.includes('actual callback')))
    await shot('conversation')
    await page.goto(h.origin+'/app/leads?lead='+encodeURIComponent(lead.id))
    await page.getByRole('heading',{name:'Stage report',exact:true}).waitFor();await shot('membership-history')
    await page.goto(h.origin+'/app/leads?stage=membership')
    assert.equal(await page.locator('[data-lead-id]').count(),1);await shot('stage-filter')
    await context.close()
  }} finally {await browser.close()}
}

export async function recoveryBrowser(h,{ana,task}) {
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  try {for(const width of [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:1000}})
    await context.route(h.origin+'/**',async route=>{
      const path=new URL(route.request().url()).pathname
      if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
      return route.continue()
    })
    const split=h.owner.indexOf('=');await context.addCookies([{name:h.owner.slice(0,split),value:h.owner.slice(split+1),url:h.origin}])
    const page=await context.newPage();await page.goto(h.origin+'/app/leads')
    await page.getByRole('heading',{name:'Missed routine recovery',exact:true}).waitFor()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    const article=page.locator(`[data-recovery-task="${task.id}"]`)
    await article.getByText('Booking evidence and alternatives',{exact:true}).click()
    assert.ok(await article.getByText(ana.name+' · open',{exact:true}).isVisible())
    assert.ok(await article.getByText('class_cancelled_or_holiday',{exact:false}).isVisible())
    // Audit the touched screen: every visible interactive control has visible
    // words. There are no icon-only controls requiring a delayed tooltip.
    assert.deepEqual(await page.locator('button,a,summary').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility() && n.getBoundingClientRect().width && n.getBoundingClientRect().height && !n.innerText.trim()).map(n=>n.outerHTML)),[])
    await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`LEAD-004-evidence-${width}.png`),fullPage:true})
    const refresh=page.locator('form[action*="name=lead.recovery.process"]')
    await refresh.getByRole('button',{name:'Refresh recovery tasks',exact:true}).click()
    assert.equal((await h.state()).pipeline.recoveryTasks.length,1)
    await context.close()
  }}finally{await browser.close()}
}

export async function emptyPlacesBrowser(h,{member,preview,offer,acceptAt390=false}) {
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  try {for(const width of [1440,390])for(const [who,cookie,url] of [['owner',h.owner,'/app/leads'],['member',member.cookie,'/app/offers']]) {
    const context=await browser.newContext({viewport:{width,height:1000}})
    await context.route(h.origin+'/**',async route=>{
      const path=new URL(route.request().url()).pathname
      if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
      return route.continue()
    })
    const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:h.origin}])
    const page=await context.newPage();await page.goto(h.origin+url)
    await page.getByRole('heading',{name:'Empty-place offers',exact:true}).waitFor()
    if(who==='owner')await page.locator(`[data-empty-campaign="${preview.id}"] summary`).click()
    else assert.equal(await page.locator('[data-empty-offer]').count(),1)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    assert.deepEqual(await page.locator('button,a,summary').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility() && n.getBoundingClientRect().width && n.getBoundingClientRect().height && !n.innerText.trim()).map(n=>n.outerHTML)),[])
    if(acceptAt390 && who==='owner' && width===390) {
      const accept=page.locator(`[data-empty-offer="${offer.id}"] form[action*="name=lead.empty.accept"]`);await accept.getByLabel('Member request channel').selectOption('phone');await accept.getByRole('button',{name:'Accept class offer',exact:true}).click();
      assert.equal((await h.state()).emptyPlaces.offers.find(o=>o.id===offer.id).status,'accepted');
    }
    await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`LEAD-007-${acceptAt390?'staff-action-':''}${who}-${width}.png`),fullPage:true})
    await context.close()
  }}finally{await browser.close()}
}

export async function nurtureBrowser(h,{member,offer}) {
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  try {for(const width of [1440,390])for(const [who,cookie,url] of [['owner',h.owner,'/app/leads'],['member',member.cookie,'/app/offers']]) {
    const context=await browser.newContext({viewport:{width,height:1000}})
    await context.route(h.origin+'/**',async route=>{const path=new URL(route.request().url()).pathname;if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]});return route.continue()})
    const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:h.origin}])
    const page=await context.newPage();await page.goto(h.origin+url)
    await page.getByRole('heading',{name:'Intro welcome and next steps',exact:true}).waitFor()
    const card=page.locator(`[data-nurture-offer="${offer.id}"]`);await card.scrollIntoViewIfNeeded()
    assert.ok(await card.getByRole('button',{name:'Accept exact finite membership',exact:true}).isVisible())
    if(who==='member')assert.equal(await page.locator('[data-nurture-offer]').count(),1)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    assert.deepEqual(await page.locator('button,a,summary').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility() && n.getBoundingClientRect().width && n.getBoundingClientRect().height && !n.innerText.trim()).map(n=>n.outerHTML)),[])
    await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`LEAD-003-${who}-${width}.png`),fullPage:true});await context.close()
  }}finally{await browser.close()}
}
