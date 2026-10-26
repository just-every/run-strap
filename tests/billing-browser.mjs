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
      const sign=async cookie=>{await context.clearCookies();const at=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,at),value:cookie.slice(at+1),url:h.origin}])}
      const capture=async name=>{
        await page.evaluate(()=>document.fonts.ready)
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+' fits '+width)
        const missing=await page.locator('button,a,summary,[role=button]').evaluateAll(cs=>cs.filter(c=>c.checkVisibility()&&!c.innerText.trim()&&c.querySelector('svg,img')&&!c.querySelector('[role=tooltip]')).map(c=>c.tagName));assert.deepEqual(missing,[])
        await panel.screenshot({path:join(process.env.STRAP_PROOF_DIR,`BILL-014-${name}-${width}.png`)})
        for(const tip of await page.locator('.has-tooltip:visible').all()){await tip.focus();await tip.locator('[role=tooltip]').waitFor({state:'visible'});await tip.hover();await page.waitForTimeout(350);await tip.locator('[role=tooltip]').waitFor({state:'visible'})}
      }
      await sign(h.owner);await page.goto(h.origin+'/app/packs#billing')
      await panel.getByText('Prepare an additional membership agreement',{exact:true}).click()
      const prepare=panel.locator('form[action*="name=billing.agreement.prepare"]')
      await prepare.getByLabel('Accepted membership',{exact:true}).selectOption(seed.terms.id)
      await prepare.getByLabel('Agreement title',{exact:true}).fill(seed.prepare.title)
      await prepare.getByLabel('Exact additional agreement text',{exact:true}).fill(seed.prepare.documentText)
      await prepare.getByLabel('Adult eligibility evidence reference',{exact:true}).fill(seed.prepare.adultEvidenceReference)
      await prepare.getByRole('checkbox').check();await capture('staff-prepare')
      await prepare.getByRole('button',{name:'Prepare for personal signing',exact:true}).click()
      const agreement=(await h.send('/api/strap/billing',undefined,h.owner)).value.agreements.find(a=>a.personId===seed.member.id);assert.ok(agreement)
      await sign(seed.member.cookie);await page.goto(h.origin+'/app/packs#billing')
      const section=panel.locator('[data-billing-agreement="'+agreement.id+'"]')
      await section.getByText('Read the exact agreement and payment permission',{exact:true}).click()
      const accept=section.locator('form[action*="name=billing.agreement.accept"]')
      await accept.getByLabel('Your full name',{exact:true}).fill(seed.member.name)
      for(const checkbox of await accept.getByRole('checkbox').all())await checkbox.check()
      await capture('personal-consent')
      await accept.getByRole('button',{name:'Sign agreement and grant separate payment permission',exact:true}).click()
      await section.getByRole('button',{name:'Authorize a test card with Stripe',exact:true}).waitFor();await capture('signed')
      const [download]=await Promise.all([page.waitForEvent('download'),section.getByRole('link',{name:'Download readable agreement',exact:true}).click()])
      const copy=await readFile(await download.path(),'utf8');assert.ok(copy.includes(seed.member.name));assert.ok(copy.includes(agreement.documentHash))
      const launch=page.waitForRequest(r=>r.url().startsWith('https://checkout.stripe.com/'))
      await section.getByRole('button',{name:'Authorize a test card with Stripe',exact:true}).click();await launch
      await page.goto(h.origin+'/app/packs#billing')
      await section.getByRole('button',{name:'Check Stripe authorization',exact:true}).click()
      await panel.getByText(/hosted setup incomplete/).waitFor();await capture('incomplete')
      edge.setComplete(true)
      await section.getByRole('button',{name:'Check Stripe authorization',exact:true}).click()
      await section.getByText(/visa ending 4242/).waitFor();await capture('method-authorized')
      await section.getByRole('button',{name:'Revoke future payment permission',exact:true}).click()
      await section.getByText(/Future payment permission revoked/).waitFor();await capture('revoked')
      const state=(await h.send('/api/strap/billing',undefined,seed.member.cookie)).value
      assert.equal(state.mandates.find(m=>m.agreementId===agreement.id).status,'revoked')
      edge.setComplete(false)
    } finally {await context.close()}
  }} finally {await browser.close()}
}
