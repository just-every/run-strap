import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import {join,extname} from 'node:path'
import {chromium} from '@playwright/test'

export async function coolingOffBrowser(h,cases){
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  try{for(const width of [1440,390]){
    const contexts=[]
    try{
      const pageFor=async cookie=>{
        const context=await browser.newContext({viewport:{width,height:1000}});contexts.push(context)
        await context.route(h.origin+'/**',async route=>{const path=new URL(route.request().url()).pathname;if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]});return route.continue()})
        const eq=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,eq),value:cookie.slice(eq+1),url:h.origin}]);return context.newPage()
      }
      const shot=async(page,label)=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`PLAN-007-cooling-${label}-${width}.png`)})}
      for(const [name,a] of Object.entries(cases)){
        await h.cmd('studio.save',{location:a.studio.location,timeZone:'America/Phoenix',address:a.studio.address??null,businessHours:a.hours})
        const page=await pageFor(a.member.cookie);await page.goto(h.origin+'/app/packs#cancellations')
        const copy=page.locator(`[data-contract-copy="${a.terms.id}"]`)
        await copy.scrollIntoViewIfNeeded();assert.match(await copy.innerText(),/Cooling-off closes/);assert.match(await copy.innerText(),/Governing rule:/)
        assert.ok((await copy.innerText()).includes(a.window.governingRule.label));assert.equal(await copy.locator('[data-cooling-window] time').getAttribute('datetime'),a.window.deadline)
        await shot(page,name+'-closing-instant');await page.context().close();contexts.splice(contexts.indexOf(page.context()),1)
      }
      const a=width===1440?cases.ga:cases.gaMobile;await h.cmd('studio.save',{location:a.studio.location,timeZone:'America/Phoenix',address:a.studio.address??null,businessHours:a.hours});const staff=await pageFor(h.owner)
      await staff.goto(h.origin+'/app/packs?person='+a.member.id+'#cancellations')
      const copy=staff.locator(`[data-contract-copy="${a.terms.id}"]`)
      await copy.getByText('Record member state for statutory rules',{exact:true}).click()
      const region=copy.locator('form[action*="name=contract.jurisdiction.save"]')
      await region.locator('input[name=region]').fill('GA');await region.locator('input[name=evidenceReference]').fill(`synthetic-strap-${width}`)
      await region.getByRole('button',{name:'Record member state',exact:true}).click()
      await copy.getByText('Record actual full-contract delivery',{exact:true}).click()
      const delivery=copy.locator('form[action*="name=contract.copy.delivery.record"]')
      await delivery.locator('input[name=deliveredDate]').fill('2026-01-05');await delivery.locator('input[name=deliveredTime]').fill('09:00:00');await delivery.locator('input[name=evidenceReference]').fill(`synthetic-strap-${width+1}`)
      await delivery.scrollIntoViewIfNeeded();await shot(staff,'owner-delivery-evidence')
      await delivery.getByRole('button',{name:'Record actual contract delivery',exact:true}).click()
      await staff.goto(h.origin+'/app/people?person='+a.member.id+'#person')
      await staff.getByText('Membership freezes',{exact:true}).click()
      const endLink=staff.getByRole('link',{name:'End this member’s plan',exact:true})
      await endLink.scrollIntoViewIfNeeded();await shot(staff,'owner-profile-contract-action');await endLink.click()
      assert.equal(new URL(staff.url()).hash,'#cancellations','the member-profile contract action reaches the scoped cancellation door')
      await staff.goto(h.origin+'/app/people?person='+a.member.id+'#staff-actions')
      const audit=staff.locator('#staff-actions');await audit.scrollIntoViewIfNeeded()
      assert.ok(await audit.locator('[data-staff-command="contract.copy.delivery.record"]').count());assert.ok(await audit.locator('[data-staff-command="contract.jurisdiction.save"]').count())
      await audit.getByText('Recorded change',{exact:true}).first().click();await shot(staff,'owner-delivery-and-jurisdiction-audit')
      const mine=await pageFor(a.member.cookie);await mine.goto(h.origin+'/app/packs#cancellations')
      await mine.getByText('Document a statutory cancellation',{exact:true}).click()
      const form=mine.locator('form[action*="name=plan.cancellation.statutory"]')
      await form.locator('select[name=packId]').selectOption(a.pack.id);await form.locator('select[name=reasonCode]').selectOption('cooling-off')
      await form.locator('input[name=documentedDate]').fill('2026-01-14');await form.locator('input[name=documentedTime]').fill('12:00:00');await form.locator('input[name=evidenceReference]').fill(`synthetic-strap-${width+2}`)
      await form.getByRole('button',{name:'Submit documented cancellation',exact:true}).click()
      const confirmation=mine.locator('[data-contract-cancellation]').last();await confirmation.scrollIntoViewIfNeeded()
      assert.match(await confirmation.innerText(),/GA: 7 business days/);assert.match(await confirmation.innerText(),/Refund settle-by/)
      await shot(mine,'confirmed-and-refund-deadline')
    }finally{for(const context of contexts)await context.close()}
  }}finally{await browser.close()}
}
