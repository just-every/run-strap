import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'
import { billingSeed } from './billing-sandbox.mjs'

export async function billingBrowser(h,edge) {
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  edge.setUncertain(false);edge.setComplete(false)
  const browser=await chromium.launch({headless:true,executablePath:process.env.STRAP_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
  try {for(const width of [1440,390]){
    const seed=await billingSeed(h,'MonthlyMember'+width)
    const context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true})
    try {
      await context.route(h.origin+'/**',async route=>{const path=new URL(route.request().url()).pathname;if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]});return route.continue()})
      // Hosted provider UI is an external paid edge; this proves only the native launch.
      await context.route('https://checkout.stripe.com/**',route=>route.abort())
      const page=await context.newPage(),panel=page.locator('#billing')
      const sign=async cookie=>{await page.goto('about:blank');await context.clearCookies();const at=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,at),value:cookie.slice(at+1),url:h.origin}])}
      const capture=async name=>{
        await page.evaluate(()=>document.fonts.ready)
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+' fits '+width)
        const missing=await page.locator('button,a,summary,[role=button]').evaluateAll(cs=>cs.filter(c=>c.checkVisibility()&&!c.innerText.trim()&&c.querySelector('svg,img')&&!c.querySelector('[role=tooltip]')).map(c=>c.tagName));assert.deepEqual(missing,[])
        if(name==='stripe-handoff'||name.startsWith('staff-')&&name!=='staff-prepare')await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`BILL-014-${name}-${width}.png`),fullPage:true})
        else await panel.screenshot({path:join(process.env.STRAP_PROOF_DIR,`BILL-014-${name}-${width}.png`)})
        for(const tip of await page.locator('.has-tooltip:visible').all()){await tip.focus();await tip.locator('[role=tooltip]').waitFor({state:'visible'});await tip.hover();await page.waitForTimeout(350);await tip.locator('[role=tooltip]').waitFor({state:'visible'})}
      }
      await sign(h.owner);await page.goto(h.origin+'/app/packs#billing')
      await panel.getByText('Prepare an additional membership agreement',{exact:true}).click()
      const prepare=panel.locator('form[action*="name=billing.agreement.prepare"]')
      await prepare.getByLabel('Accepted membership',{exact:true}).selectOption(seed.terms.id)
      await prepare.getByLabel('Agreement title',{exact:true}).fill(seed.prepare.title)
      await prepare.getByLabel('Exact additional agreement text',{exact:true}).fill(seed.prepare.documentText)
      await prepare.getByLabel('Adult eligibility evidence reference',{exact:true}).fill(seed.prepare.adultEvidenceReference)
      assert.equal(await prepare.getByRole('checkbox').isChecked(),false)
      await prepare.getByRole('checkbox').check();await capture('staff-prepare')
      await prepare.getByRole('button',{name:'Prepare for personal signing',exact:true}).click()
      const agreement=(await h.send('/api/strap/billing',undefined,h.owner)).value.agreements.find(a=>a.personId===seed.member.id);assert.ok(agreement)
      await panel.locator('[data-billing-agreement="'+agreement.id+'"]').waitFor()
      const section=panel.locator('[data-billing-agreement="'+agreement.id+'"]')
      const staffLaunch=async(command,label,name)=>{
        const before=(await h.send('/api/strap/billing',undefined,seed.member.cookie)).value,calls=edge.calls.length,history=(await h.state()).staffActions
        await sign(h.owner);await page.goto(h.origin+'/app/packs#billing')
        await section.getByText('Member personal steps',{exact:true}).click()
        await section.getByRole('button',{name:label,exact:true}).click()
        const link=page.getByRole('link',{name:'Open member personal step',exact:true});await link.waitFor()
        const target=new URL(await link.getAttribute('href'),h.origin)
        assert.equal(target.pathname,'/signin');assert.equal(target.searchParams.get('returnTo'),'/app/packs#billing-'+agreement.id)
        await section.getByText('Member personal steps',{exact:true}).click();await capture('staff-'+name+'-launch')
        const after=(await h.send('/api/strap/billing',undefined,seed.member.cookie)).value
        for(const key of ['agreements','mandates','methods','setups','operations'])assert.deepEqual(after[key],before[key],'the staff form preserves the personal act')
        assert.equal(edge.calls.length,calls)
        const fresh=(await h.state()).staffActions.filter(a=>!history.some(old=>old.id===a.id))
        assert.equal(fresh.length,1);assert.equal(fresh[0].command,command+'.launch');assert.equal(fresh[0].personId,seed.member.id)
        assert.equal(fresh[0].right,command==='billing.agreement.accept'?'membership-sale':'collection');assert.equal(fresh[0].channel,'desk')
        await sign(seed.member.cookie);await page.goto(h.origin+target.searchParams.get('returnTo'))
      }
      await staffLaunch('billing.agreement.accept','Open personal signing','signing')
      await sign(seed.member.cookie);await page.goto(h.origin+'/app/packs#billing')
      await page.getByRole('heading',{name:'My packs',exact:true}).waitFor()
      await section.getByText('Read the exact agreement and payment permission',{exact:true}).click()
      await capture('member-review')
      assert.equal(await section.locator('form[action*="name=billing.agreement.accept"]').count(),1,(await section.innerText()).slice(0,1500))
      const accept=section.locator('form[action*="name=billing.agreement.accept"]')
      await accept.getByLabel('Your full name',{exact:true}).fill(seed.member.name)
      for(const checkbox of await accept.getByRole('checkbox').all()){assert.equal(await checkbox.isChecked(),false);assert.equal(await checkbox.getAttribute('required'),'');await checkbox.check()}
      await capture('personal-consent')
      await accept.getByRole('button',{name:'Sign and authorize',exact:true}).click()
      await section.getByRole('button',{name:'Authorize a test card with Stripe',exact:true}).waitFor();await capture('signed')
      const [download]=await Promise.all([page.waitForEvent('download'),section.getByRole('link',{name:'Download readable agreement',exact:true}).click()])
      const copy=await readFile(await download.path(),'utf8');assert.ok(copy.includes(seed.member.name));assert.ok(copy.includes(agreement.documentHash))
      const readable=await context.newPage()
      try {await readable.setContent(copy);assert.equal(await readable.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await readable.screenshot({path:join(process.env.STRAP_PROOF_DIR,`BILL-014-readable-copy-${width}.png`),fullPage:true})}finally{await readable.close()}
      await staffLaunch('billing.setup.start','Open method authorization','method')
      const launch=page.waitForRequest(r=>r.url().startsWith('https://checkout.stripe.com/'))
      await section.getByRole('button',{name:'Authorize a test card with Stripe',exact:true}).click()
      await page.getByRole('link',{name:'Continue to Stripe test card setup',exact:true}).waitFor();await capture('stripe-handoff')
      await page.getByRole('link',{name:'Continue to Stripe test card setup',exact:true}).click();await launch
      await page.goto(h.origin+'/app/packs#billing')
      await staffLaunch('billing.setup.complete','Open authorization status','status')
      await section.getByRole('button',{name:'Check Stripe authorization',exact:true}).click()
      await section.getByRole('status').filter({hasText:'Stripe has not confirmed'}).waitFor();await capture('incomplete')
      edge.setComplete(true)
      await section.getByRole('button',{name:'Check Stripe authorization',exact:true}).click()
      await section.getByText(/visa ending 4242/).waitFor();await capture('method-authorized')
      await staffLaunch('billing.mandate.revoke','Open payment revocation','revocation')
      await section.getByRole('button',{name:'Revoke future payment permission',exact:true}).click()
      await section.getByText(/Future payment permission revoked/).waitFor();await capture('revoked')
      const state=(await h.send('/api/strap/billing',undefined,seed.member.cookie)).value
      assert.equal(state.mandates.find(m=>m.agreementId===agreement.id).status,'revoked')
      assert.equal(state.methods.find(m=>m.agreementId===agreement.id).available,false)
      assert.equal(await section.getByRole('button',{name:'Authorize a test card with Stripe',exact:true}).count(),0)
      assert.equal(await section.getByRole('button',{name:'Check Stripe authorization',exact:true}).count(),0)
      await sign(h.owner);await page.goto(h.origin+'/app/people?person='+seed.member.id+'#staff-actions')
      const audit=page.locator('#staff-actions')
      for(const command of ['billing.agreement.prepare','billing.agreement.accept.launch','billing.setup.start.launch','billing.setup.complete.launch','billing.mandate.revoke.launch'])assert.equal(await audit.locator('[data-staff-command="'+command+'"]').count(),1)
      for(const details of await audit.locator('details').all())await details.locator('summary').click()
      await capture('staff-history')
      edge.setComplete(false)
    } finally {await context.close()}
  }} finally {await browser.close()}
}
