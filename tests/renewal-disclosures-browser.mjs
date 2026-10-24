import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import {join,extname} from 'node:path'
import {chromium} from '@playwright/test'

export async function proofPages(h,run){
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  try{for(const width of [1440,390]){
    const contexts=[]
    try{
      const pageFor=async cookie=>{
        const context=await browser.newContext({viewport:{width,height:1000}});contexts.push(context)
        await context.route(h.origin+'/**',async route=>{
          const path=new URL(route.request().url()).pathname
          if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
          return route.continue()
        })
        const i=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,i),value:cookie.slice(i+1),url:h.origin}])
        return context.newPage()
      }
      const shot=async(page,name)=>{
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+' fits '+width)
        // Every visible icon-only control must expose the shared short tooltip.
        for(const control of await page.locator('a,button').all()){
          if(!await control.isVisible())continue
          const iconOnly=await control.evaluate(el=>{const copy=el.cloneNode(true);copy.querySelectorAll('[role="tooltip"]').forEach(t=>t.remove());return el.querySelector('svg')&&!copy.textContent.trim()})
          if(iconOnly){
            const tip=control.locator('[role="tooltip"]');assert.equal(await tip.count(),1,'icon control has a tooltip');
            const scroll=await page.evaluate(()=>scrollY);
            await control.focus();assert.equal(await tip.isVisible(),true,'tooltip appears on keyboard focus');
            await control.evaluate(el=>el.blur());await control.hover();await page.waitForTimeout(350);
            assert.equal(await tip.isVisible(),true,'tooltip appears after hover delay');
            await page.mouse.move(0,0);await page.evaluate(y=>scrollTo(0,y),scroll);
          }
        }
        await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`${name}-${width}.png`),fullPage:true})
        await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`${name}-viewport-${width}.png`)})
      }
      await run({width,pageFor,shot})
    }finally{for(const context of contexts)await context.close()}
  }}finally{await browser.close()}
}

export async function disclosuresBrowser(h,{member,disclosure,terms}){
  await proofPages(h,async({width,pageFor,shot})=>{
    const owner=await pageFor(h.owner),page=await pageFor(member.cookie)
    const spare=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:5,amountCents:10000,expiresAt:new Date(Date.now()+90*86400000).toISOString()})).id});
    await owner.goto(h.origin+'/app/packs#freezes')
    await owner.getByText('Propose recurring studio invoices',{exact:true}).click();
    const prepare=owner.locator('form[action*="name=plan.recurring.prepare"]');
    await prepare.locator('select[name="packId"]').selectOption(spare.id);
    await prepare.getByLabel('Minimum price notice days',{exact:true}).fill('21');
    await shot(owner,'PLAN-008-owner-accepted-notice-terms');
    await prepare.getByRole('button',{name:'Preview recurring invoices',exact:true}).click();
    const proposed=(await h.state()).recurring.terms.find(t=>t.packId===spare.id);assert.equal(proposed.noticeLeadDays,21);
    const own=await pageFor(member.cookie);await own.goto(h.origin+'/app/packs#freezes');
    const consent=own.locator(`[data-recurring="${proposed.id}"]`);await consent.scrollIntoViewIfNeeded();
    assert.match(await consent.innerText(),/at least 21 elapsed days/);await shot(own,'PLAN-008-member-accepted-notice-terms');
    await consent.getByRole('button',{name:'I agree to these recurring invoices',exact:true}).click();
    assert.equal((await h.state()).recurring.terms.find(t=>t.id===proposed.id).noticeLeadDays,21);
    await owner.goto(h.origin+'/app/packs#freezes');
    const article=owner.locator(`[data-renewal-disclosure="${disclosure.id}"]`)
    await article.scrollIntoViewIfNeeded();assert.match(await article.innerText(),/accepted/)
    const recurring=owner.locator(`[data-recurring="${terms.id}"]`)
    await recurring.getByText('Schedule renewal disclosure',{exact:true}).click()
    await shot(owner,'PLAN-008-owner-disclosure')
    await page.goto(h.origin+'/app/packs#freezes')
    const notice=page.locator(`[data-renewal-disclosure="${disclosure.id}"]`)
    await notice.scrollIntoViewIfNeeded();assert.match(await notice.innerText(),/120.00/)
    await shot(page,'PLAN-008-member-disclosure')
    await notice.getByRole('link',{name:'Review terms and stop future invoices',exact:true}).click()
    const stop=page.locator(`[data-recurring="${terms.id}"]`)
    await stop.scrollIntoViewIfNeeded()
    assert.equal(await stop.getByRole('button',{name:'Stop future invoices now',exact:true}).count(),1)
    await shot(page,'PLAN-008-member-stop')
    if(width===390){await stop.getByRole('button',{name:'Stop future invoices now',exact:true}).click();assert.equal((await h.state()).recurring.terms.find(t=>t.id===terms.id).status,'cancellation_scheduled');await shot(page,'PLAN-008-member-cancelled');}
  })
}

export async function priceAcceptanceBrowser(h,{member,terms,disclosure}){
  await proofPages(h,async({width,pageFor,shot})=>{
    const owner=await pageFor(h.owner),page=await pageFor(member.cookie)
    await owner.goto(h.origin+'/app/packs#freezes')
    const staff=owner.locator(`[data-renewal-disclosure="${disclosure.id}"]`)
    await staff.scrollIntoViewIfNeeded()
    await staff.getByRole('button',{name:'Open member price acceptance',exact:true}).click()
    assert.ok((await h.state()).staffActions.some(a=>a.command==='plan.disclosure.accept.launch'&&a.personId===member.id&&a.right==='contract-change'))
    await shot(owner,'PLAN-008-staff-price-launch')
    await page.goto(h.origin+'/app/packs#freezes')
    const price=page.locator(`[data-renewal-disclosure="${disclosure.id}"]`)
    await price.scrollIntoViewIfNeeded()
    assert.match(await price.innerText(),/120.00/);assert.ok((await price.innerText()).includes(disclosure.dueAt))
    assert.equal(await price.getByRole('button',{name:'I accept this exact renewal price',exact:true}).count(),1)
    await shot(page,'PLAN-008-exact-price-acceptance')
    if(width===390){
      await price.getByRole('button',{name:'I accept this exact renewal price',exact:true}).click()
      await page.locator(`[data-renewal-disclosure="${disclosure.id}"]`).getByText(/Price personally accepted/).waitFor()
      await shot(page,'PLAN-008-price-accepted')
    }
  })
}

export async function expiryDisclosureBrowser(h,{member,disclosure}){
  await proofPages(h,async({pageFor,shot})=>{
    const owner=await pageFor(h.owner),page=await pageFor(member.cookie)
    await owner.goto(h.origin+'/app/packs#freezes')
    await owner.getByText('Schedule a pack expiry notice',{exact:true}).click()
    await owner.getByLabel('Finite pack for expiry notice',{exact:true}).selectOption(disclosure.packId)
    await shot(owner,'PLAN-008-expiry-schedule')
    await page.goto(h.origin+'/app/packs#freezes')
    const notice=page.locator(`[data-renewal-disclosure="${disclosure.id}"]`)
    await notice.scrollIntoViewIfNeeded();assert.match(await notice.innerText(),/No renewal has been accepted/)
    await shot(page,'PLAN-008-pack-expiry-notice')
  })
}

export async function failedDisclosureBrowser(h,{member,disclosure}){
  await proofPages(h,async({pageFor,shot})=>{
    for(const [role,cookie] of [['owner',h.owner],['member',member.cookie]]){
      const page=await pageFor(cookie);await page.goto(h.origin+'/app/packs#freezes');
      const notice=page.locator(`[data-renewal-disclosure="${disclosure.id}"]`);await notice.scrollIntoViewIfNeeded();
      assert.match(await notice.innerText(),/Email: uncertain/);assert.match(await notice.innerText(),/Accept before/);
      await shot(page,'PLAN-008-failed-email-'+role);
    }
  });
}

export async function restoredDisclosureBrowser(h,{owner,member,disclosure}){
  await proofPages(h,async({pageFor,shot})=>{
    for(const [role,cookie] of [['owner',owner],['member',member]]){
      const page=await pageFor(cookie);await page.goto(h.origin+'/app/packs#freezes');
      const notice=page.locator(`[data-renewal-disclosure="${disclosure.id}"]`);await notice.scrollIntoViewIfNeeded();
      assert.match(await notice.innerText(),/Email: paused/);await shot(page,'PLAN-008-restored-email-'+role);
    }
  });
}
