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
          const iconOnly=await control.evaluate(el=>el.querySelector('svg')&&!el.textContent.trim())
          if(iconOnly)assert.equal(await control.locator('[role="tooltip"]').count(),1,'icon control has a tooltip')
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
    await owner.goto(h.origin+'/app/packs#freezes')
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
