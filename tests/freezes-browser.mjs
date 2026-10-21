import assert from 'node:assert/strict'
import { mkdir,readFile } from 'node:fs/promises'
import { join,extname } from 'node:path'
import { chromium } from '@playwright/test'

const clockAt=(zone,days)=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(Date.now()+days*86_400_000)).map(p=>[p.type,p.value]));return {date:`${parts.year}-${parts.month}-${parts.day}`,time:'09:00:00'}}
export async function freezesBrowser(h,{member,direct,stranger,typeId}) {
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  try {
    for(const width of [1440,390]) {
      const contexts=[]
      try {
        const pageFor=async cookie=>{
          const context=await browser.newContext({viewport:{width,height:1000}});contexts.push(context)
          await context.route(h.origin+'/**',async route=>{const path=new URL(route.request().url()).pathname;if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]});return route.continue()})
          const eq=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,eq),value:cookie.slice(eq+1),url:h.origin}]);return context.newPage()
        }
        const shot=async(page,label)=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`PLAN-006-${label}-${width}.png`),fullPage:false})}
        const sale=async who=>(await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:who.id,credits:8,amountCents:14000,expiresAt:'2099-12-31T00:00:00Z'})).id})).id
        const packId=await sale(member),directPackId=await sale(direct),zone=(await h.state()).studio.timeZone
        const staff=await pageFor(h.owner),mine=await pageFor(member.cookie)
        // The actual recurring-consent forms precede any freeze: no balance agreement is inferred.
        await staff.goto(h.origin+'/app/packs?person='+member.id+'#freezes')
        await staff.getByText('Propose recurring studio invoices',{exact:true}).click()
        const recurring=staff.locator('form[action*="name=plan.recurring.prepare"]')
        await recurring.locator('select[name=packId]').selectOption(packId)
        await recurring.getByLabel('Calendar months per invoice',{exact:true}).fill('1')
        await recurring.getByRole('button',{name:'Preview recurring invoices',exact:true}).click()
        const proposal=(await h.state()).recurring.terms.find(t=>t.packId===packId)
        assert.ok(proposal)
        await mine.goto(h.origin+'/app/packs#freezes')
        await mine.locator(`[data-recurring="${proposal.id}"]`).getByRole('button',{name:'I agree to these recurring invoices',exact:true}).click()
        assert.equal((await h.state(member.cookie)).recurring.terms.find(t=>t.id===proposal.id).status,'active')
        const dates=[clockAt(zone,2),clockAt(zone,32)]
        const type=mine.locator(`[data-freeze-type="${typeId}"]`)
        await type.locator('summary').click()
        const ask=type.locator('form[action*="name=freeze.request"]')
        await ask.locator('select[name=packId]').selectOption(packId)
        for(const [prefix,date] of [['Freeze starts',dates[0]],['Resumption',dates[1]]]){await ask.getByLabel(prefix+' date',{exact:true}).fill(date.date);await ask.getByLabel(prefix+' time',{exact:true}).fill(date.time)}
        await ask.getByLabel('Freeze reason',{exact:true}).fill('Family travel planned with the studio')
        await shot(mine,'member-request')
        await ask.getByRole('button',{name:'Request these freeze dates',exact:true}).click()
        const request=(await h.state(member.cookie)).freezes.requests.find(r=>r.packId===packId)
        assert.ok(request)
        await staff.goto(h.origin+'/app/packs?person='+member.id+'#freezes')
        await staff.locator(`[data-freeze-request="${request.id}"]`).getByRole('button',{name:'Preview requested freeze',exact:true}).click()
        const freeze=(await h.state()).freezes.freezes.find(f=>f.packId===packId)
        const preview=staff.locator(`[data-freeze="${freeze.id}"]`)
        await preview.getByText(/Freeze fee \$10\.00/).waitFor()
        await preview.scrollIntoViewIfNeeded();await shot(staff,'staff-preview')
        await mine.goto(h.origin+'/app/packs#freezes')
        await mine.locator(`[data-freeze="${freeze.id}"]`).scrollIntoViewIfNeeded();await shot(mine,'member-preview')
        assert.equal(await mine.getByRole('button',{name:'Approve this exact freeze',exact:true}).count(),0)
        await preview.getByRole('button',{name:'Approve this exact freeze',exact:true}).click()
        assert.equal((await h.state(member.cookie)).freezes.freezes.find(f=>f.id===freeze.id).status,'scheduled')
        await mine.reload();await mine.locator(`[data-freeze="${freeze.id}"]`).scrollIntoViewIfNeeded();await shot(mine,'member-confirmed')
        // Staff begins on the actual member profile and follows its freeze door.
        await staff.goto(h.origin+'/app/people?person='+direct.id)
        await staff.getByRole('link',{name:'Freeze this member’s plan',exact:true}).click()
        const directType=staff.locator(`[data-freeze-type="${typeId}"]`)
        await directType.locator('summary').click()
        const prepare=directType.locator('form[action*="name=freeze.prepare"]')
        await prepare.locator('select[name=packId]').selectOption(directPackId)
        await prepare.getByLabel('Freeze starts date',{exact:true}).fill(dates[0].date)
        await prepare.getByLabel('Freeze starts time',{exact:true}).fill(dates[0].time)
        await prepare.getByLabel('Resumption date',{exact:true}).fill(dates[1].date)
        await prepare.getByLabel('Resumption time',{exact:true}).fill(dates[1].time)
        await shot(staff,'staff-direct-form')
        await prepare.getByRole('button',{name:'Preview direct freeze',exact:true}).click()
        const directFreeze=(await h.state()).freezes.freezes.find(f=>f.packId===directPackId)
        assert.equal(directFreeze.freezeRequestId,null)
        await staff.locator(`[data-freeze="${directFreeze.id}"]`).getByRole('button',{name:'Approve this exact freeze',exact:true}).click()
        await staff.goto(h.origin+'/app/people?person='+direct.id+'#staff-actions')
        await staff.locator('#staff-actions').scrollIntoViewIfNeeded();await shot(staff,'staff-direct-audit')
        assert.equal((await h.state()).staffActions.filter(a=>a.command==='freeze.confirm'&&a.after.id===directFreeze.id&&a.right==='contract-change').length,1)
        assert.equal((await h.state(stranger.cookie)).freezes.requests.length,0)
      } finally {for(const context of contexts)await context.close()}
    }
  } finally {await browser.close()}
}
