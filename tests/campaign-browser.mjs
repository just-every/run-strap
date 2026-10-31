import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import {join,extname} from 'node:path'
import {chromium} from '@playwright/test'

async function proof(h,run) {
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  const browser=await chromium.launch({headless:true,...(process.env.STRAP_CHROMIUM ? {executablePath:process.env.STRAP_CHROMIUM} : {}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
  try {for(const width of [1440,390]) {
    const contexts=[]
    const pageFor=async cookie=>{
      const context=await browser.newContext({viewport:{width,height:1000}});contexts.push(context)
      await context.route(h.origin+'/**',async route=>{
        const path=new URL(route.request().url()).pathname
        if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
        return route.continue()
      })
      const i=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,i),value:cookie.slice(i+1),url:h.origin}]);return context.newPage()
    }
    const shot=async(page,name)=>{
      await page.evaluate(()=>document.fonts.ready)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} fits ${width}`)
      for(const control of await page.locator('a,button,summary').all()) {
        if(!await control.isVisible())continue
        const iconOnly=await control.evaluate(el=>{const copy=el.cloneNode(true);copy.querySelectorAll('[role="tooltip"]').forEach(t=>t.remove());return el.querySelector('svg')&&!copy.textContent.trim()})
        if(iconOnly){const tip=control.locator('[role="tooltip"]');assert.equal(await tip.count(),1);assert.ok((await tip.innerText()).trim().split(/\s+/).length>=2);await control.focus();assert.ok(await tip.isVisible());await control.evaluate(el=>el.blur());await page.mouse.move(0,0);await control.hover();await page.waitForTimeout(350);assert.ok(await tip.isVisible());await page.mouse.move(0,0)}
      }
      await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`${name}-${width}.png`),fullPage:true})
    }
    try {await run({width,pageFor,shot})}finally{for(const c of contexts)await c.close()}
  }}finally{await browser.close()}
}
export async function prorationBrowser(h,{member}) {
  await proof(h,async({width,pageFor,shot})=>{
    const owner=await pageFor(h.owner),mine=await pageFor(member.cookie)
    await owner.goto(h.origin+'/app/packs')
    const prepare=owner.locator('form[action*="name=pack.prepare"]')
    await prepare.getByLabel('Member',{exact:true}).selectOption(member.id)
    await prepare.getByLabel('Price',{exact:true}).fill('310.00')
    await prepare.getByText('Prorate a first term',{exact:true}).click()
    const expiry=await prepare.getByLabel('Good for',{exact:true}).inputValue(),date=new Date(expiry+'T00:00:00Z')
    if(date.getUTCDate()<16)date.setUTCMonth(date.getUTCMonth()-1)
    const month=date.toISOString().slice(0,7)
    await prepare.getByLabel('Full cycle starts',{exact:true}).fill(month+'-01')
    await prepare.getByLabel('Member joins',{exact:true}).fill(month+'-15')
    await prepare.scrollIntoViewIfNeeded();await shot(owner,'BILL-006-join-form')
    await prepare.getByRole('button',{name:'Prepare pack',exact:true}).click()
    const draft=(await h.state()).drafts.filter(d=>d.type==='pack'&&d.status==='draft'&&d.personId===member.id&&d.proration).at(-1)
    assert.ok(draft,'UI prepared a prorated first term')
    const preview=owner.locator('#draft-'+draft.id);await preview.getByText(/First-term calculation/).waitFor();await preview.scrollIntoViewIfNeeded();await shot(owner,'BILL-006-join-preview')
    await preview.getByRole('button',{name:'Approve this exact pack',exact:true}).click()
    const pack=(await h.state()).packs.find(p=>p.draftId===draft.id);assert.ok(pack)
    const charge=(await h.state()).charges.find(c=>c.packId===pack.id);assert.equal(charge.amountCents,draft.amountCents)
    await owner.goto(h.origin+'/app/packs#receipt-'+pack.id);await owner.locator('#receipt-'+pack.id).scrollIntoViewIfNeeded();await shot(owner,'BILL-006-staff-receipt')
    await mine.goto(h.origin+'/app/packs#receipt-'+pack.id);await mine.locator('#receipt-'+pack.id).scrollIntoViewIfNeeded();await shot(mine,'BILL-006-member-receipt')
    assert.ok((await mine.locator('#receipt-'+pack.id).innerText()).includes((draft.amountCents/100).toFixed(2)))
  })
}
export async function attendancePlanBrowser(h,{member,other,publish}) {
  await h.cmd('studio.save',{location:'Synthetic attendance studio',timeZone:'America/New_York'})
  const staff=await h.person('AttendanceProofDesk');await h.cmd('member.record.grant',{personId:staff.id,enabled:true,canCreate:false,memberIds:[member.id]});staff.cookie=await h.signIn(staff.email);await h.enroll(staff.cookie);
  await h.cmd('attendance.booking.grant',{personId:staff.id,enabled:true,memberIds:[member.id],locationIds:['studio']})
  await proof(h,async({width,pageFor,shot})=>{
    const hour=width===1440?16:18,entry=await publish('Workable class '+width,'Mat',hour,2),deskClass=await publish('Desk workable class '+width,'Mat',hour+1,2)
    const mine=await pageFor(member.cookie),owner=await pageFor(staff.cookie),supervisor=await pageFor(h.owner)
    await supervisor.goto(h.origin+'/app/people#attendance-booking-access');await supervisor.locator('#attendance-booking-access').scrollIntoViewIfNeeded();await shot(supervisor,'SUCCESS-002-owner-scoped-access')
    await mine.goto(h.origin+'/app#attendance-plan');await mine.reload();await mine.locator('#attendance-plan > summary').click()
    const availability=mine.locator('form[action*="name=attendance.availability.save"]')
    await availability.getByLabel('Available from',{exact:true}).fill(`2099-02-02T${String(hour-5).padStart(2,'0')}:00`)
    await availability.getByLabel('Available until',{exact:true}).fill(`2099-02-02T${String(hour-3).padStart(2,'0')}:00`)
    await availability.getByLabel('Preferred location',{exact:true}).selectOption('studio')
    await shot(mine,'SUCCESS-002-member-availability')
    await availability.getByRole('button',{name:'Save my availability',exact:true}).click()
    await owner.goto(h.origin+'/app/people?person='+member.id+'#attendance-plan');await owner.locator('#attendance-plan > summary').click()
    await owner.getByRole('button',{name:'Start member availability',exact:true}).click();await owner.locator('#attendance-plan > summary').click();assert.ok(await owner.getByRole('link',{name:'Member availability sign-in',exact:true}).isVisible());
    await owner.getByRole('button',{name:'Prepare attendance options',exact:true}).click()
    const offer=(await h.state()).attendancePlans.offers.filter(o=>o.personId===member.id&&o.choices.some(c=>c.classId===entry.id)).at(-1);assert.ok(offer)
    assert.deepEqual(offer.choices.map(c=>c.classId),[entry.id,deskClass.id])
    await owner.locator('#attendance-plan > summary').click();await owner.locator('#attendance-plan').scrollIntoViewIfNeeded();await shot(owner,'SUCCESS-002-staff-options')
    await h.cmd('booking.book',{classId:entry.id},other.cookie)
    await mine.goto(h.origin+'/app#attendance-plan');await mine.reload();await mine.locator('#attendance-plan > summary').click()
    const choice=mine.locator(`[data-attendance-offer="${offer.id}"]`);await choice.scrollIntoViewIfNeeded();await shot(mine,'SUCCESS-002-member-options')
    await choice.locator('form').filter({has:mine.locator(`input[name="classId"][value="${entry.id}"]`)}).getByRole('button',{name:'Accept class option',exact:true}).click()
    assert.equal((await h.state()).bookings.filter(b=>b.classId===entry.id&&b.status==='booked').length,2)
    await mine.locator('#attendance-plan > summary').click();await mine.locator(`[data-attendance-offer="${offer.id}"]`).getByText('Booked from this offer.',{exact:true}).waitFor();await shot(mine,'SUCCESS-002-member-booked')
    await owner.reload();await owner.locator('#attendance-plan > summary').click();await owner.getByRole('button',{name:'Prepare attendance options',exact:true}).click()
    const desk=(await h.state()).attendancePlans.offers.filter(o=>o.personId===member.id&&o.status==='offered'&&o.choices.some(c=>c.classId===deskClass.id)).at(-1)
    await owner.locator('#attendance-plan > summary').click()
    const form=owner.locator(`[data-attendance-offer="${desk.id}"] form`).filter({has:owner.locator(`input[name="classId"][value="${deskClass.id}"]`)})
    await form.getByLabel('Request channel',{exact:true}).selectOption('phone');await form.getByRole('button',{name:'Book option for member',exact:true}).click()
    assert.equal((await h.state()).staffActions.filter(a=>a.command==='attendance.plan.accept.staff'&&a.after?.classId===deskClass.id).length,1)
    await owner.locator('#attendance-plan > summary').click();await owner.locator('#attendance-plan').scrollIntoViewIfNeeded();await shot(owner,'SUCCESS-002-staff-booked')
  })
}

export async function combinedProrationBrowser(h,{member,pack,upgrade,freeze}) {
  await proof(h,async({pageFor,shot})=>{
    for(const [cookie,role] of [[h.owner,'owner'],[member.cookie,'member']]){
      const page=await pageFor(cookie);await page.goto(h.origin+'/app/packs');
      const receipt=page.locator('#receipt-'+pack.id);await receipt.scrollIntoViewIfNeeded();
      const text=await receipt.innerText();
      for(const value of ['$160.00','$70.01','$10.00','$80.01','Itemized adjustments'])assert.ok(text.includes(value),value);
      assert.equal(await receipt.locator('[data-charge-id]').count(),2);
      await shot(page,'BILL-006-combined-'+role+'-invoice');
      const change=page.locator('[data-plan-change="'+upgrade.id+'"]');await change.scrollIntoViewIfNeeded();
      assert.ok((await change.innerText()).includes('$70.01'));await shot(page,'BILL-006-combined-'+role+'-upgrade');
      const frozen=page.locator('[data-freeze="'+freeze.id+'"]');await frozen.scrollIntoViewIfNeeded();
      assert.ok((await frozen.innerText()).includes('$10.00'));await shot(page,'BILL-006-combined-'+role+'-freeze');
    }
  });
}

export async function prorationStageBrowser(h,{cookie,selector,name,amount}) {
  await proof(h,async({pageFor,shot})=>{
    const page=await pageFor(cookie);await page.goto(h.origin+'/app/packs');
    const preview=page.locator(selector);await preview.scrollIntoViewIfNeeded();
    assert.ok((await preview.innerText()).includes(amount));await shot(page,'BILL-006-combined-'+name);
  });
}

// The ordinary studio journey asserts at desktop; candidate proof also records
// the same populated report and source detail at the phone width.
export async function recoveryOutcomesBrowser(h,{campaignId,offerId,bookingId,classId,memberName,visits}) {
  const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os')
  const temporary=!process.env.STRAP_PROOF_DIR,dir=process.env.STRAP_PROOF_DIR ?? await mkdtemp(join(tmpdir(),'strap-outcomes-browser-'))
  const browser=await chromium.launch({headless:true,...(process.env.STRAP_CHROMIUM ? {executablePath:process.env.STRAP_CHROMIUM} : {}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
  try {for(const width of temporary ? [1440] : [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:1000}})
    try {
      await context.route(h.origin+'/**',async route=>{
        const path=new URL(route.request().url()).pathname
        if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
        return route.continue()
      })
      const i=h.owner.indexOf('=');await context.addCookies([{name:h.owner.slice(0,i),value:h.owner.slice(i+1),url:h.origin}])
      const page=await context.newPage()
      await page.goto(h.origin+'/app/recovery-outcomes?campaign='+campaignId+'&windowDays=30')
      await page.getByRole('heading',{name:'Recovery outcomes',exact:true}).waitFor()
      assert.equal(await page.locator('[data-outcome-total="visits"]').innerText(),String(visits))
      assert.ok((await page.locator('[data-outcome-campaign="'+campaignId+'"]').innerText()).includes('incomplete'))
      await page.getByLabel('Observation days',{exact:true}).fill('1')
      await page.getByRole('button',{name:'Apply observation window',exact:true}).click()
      assert.equal(new URL(page.url()).searchParams.get('windowDays'),'1')
      await page.goto(h.origin+'/app/recovery-outcomes?campaign='+campaignId+'&windowDays=30')
      await page.locator('[data-outcome-offer="'+offerId+'"]').getByRole('link',{name:'Inspect outcome sources',exact:true}).click()
      await page.locator('[data-outcome-booking="'+bookingId+'"]').waitFor()
      assert.ok((await page.locator('#outcome-source').innerText()).includes('no show to attended'))
      await page.evaluate(()=>document.fonts.ready)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'report fits '+width)
      const tooSmall=await page.locator('main p, main a, main button, main input, main td').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length&&parseFloat(getComputedStyle(n).fontSize)<13).map(n=>n.textContent))
      assert.deepEqual(tooSmall,[],'report text is readable')
      for(const control of await page.locator('a,button,summary').all()) {
        if(!await control.isVisible())continue
        const iconOnly=await control.evaluate(el=>{const copy=el.cloneNode(true);copy.querySelectorAll('[role="tooltip"]').forEach(t=>t.remove());return !!el.querySelector('svg')&&!copy.textContent.trim()})
        if(iconOnly){const tip=control.locator('[role="tooltip"]');assert.equal(await tip.count(),1);await control.focus();assert.ok(await tip.isVisible());await control.evaluate(el=>el.blur());await control.hover();await page.waitForTimeout(350);assert.ok(await tip.isVisible());await page.mouse.move(0,0)}
      }
      if(!temporary)await page.screenshot({path:join(dir,'SUCCESS-004-sources-'+width+'.png'),fullPage:true})
      await page.locator('[data-outcome-booking="'+bookingId+'"]').getByRole('link').click()
      assert.equal(new URL(page.url()).pathname,'/app')
      const roster=page.locator('[id="class-'+classId+'"] #roster')
      await roster.waitFor()
      assert.ok((await roster.innerText()).includes(memberName),'source link shows the observed member roster')
      assert.ok((await roster.innerText()).includes('Paper roster confirmed completed attendance'),'source link shows retained correction')
      if(!temporary)await page.screenshot({path:join(dir,'SUCCESS-004-roster-'+width+'.png'),fullPage:true})
      await page.goto(h.origin+'/app/recovery-outcomes?campaign='+campaignId)
      if(!temporary)await page.screenshot({path:join(dir,'SUCCESS-004-report-'+width+'.png'),fullPage:true})
    } finally {await context.close()}
  }} finally {await browser.close();if(temporary)await rm(dir,{recursive:true,force:true})}
}
