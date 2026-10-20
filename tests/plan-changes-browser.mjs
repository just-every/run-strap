import assert from 'node:assert/strict'
import { mkdir,readFile } from 'node:fs/promises'
import { join,extname } from 'node:path'
import { chromium } from '@playwright/test'

// Studio-clock date and time ten minutes ahead, as the effective-time inputs take them.
const studioClock = (timeZone,ms) => {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(Date.now()+ms)).map(p=>[p.type,p.value]))
  return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`}
}
export async function planChangesBrowser(h,{member}) {
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  try {
    for(const width of [1440,390]) {
      const contexts=[]
      try {
        const pageFor=async cookie=>{
          const context=await browser.newContext({viewport:{width,height:1000}});contexts.push(context)
          await context.route(h.origin+'/**',async route=>{
            const path=new URL(route.request().url()).pathname
            if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path))return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
            return route.continue()
          })
          const index=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,index),value:cookie.slice(index+1),url:h.origin}])
          return context.newPage()
        }
        const shot=async(page,name)=>{
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true)
          await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`PLAN-005-${name}-${width}.png`),fullPage:true})
        }
        const credits=40+width%7
        await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:12,amountCents:15000,expiresAt:'2099-12-31T00:00:00Z'})).id})
        const pack=(await h.state()).packs.filter(p=>p.personId===member.id&&p.credits===12).at(-1)
        const owner=await pageFor(h.owner),memberPage=await pageFor(member.cookie)
        await owner.goto(h.origin+'/app/people?person='+member.id)
        await owner.getByText('Plan changes',{exact:true}).click()
        await owner.getByRole('link',{name:'Change this member’s plan',exact:true}).click()
        const prepare=owner.locator('form[action*="name=plan.change.prepare"]')
        await prepare.getByLabel('Pack to change',{exact:true}).selectOption(pack.id)
        await prepare.getByLabel('When it takes effect',{exact:true}).selectOption('now')
        await prepare.getByLabel('New class credits',{exact:true}).fill(String(credits))
        await prepare.getByLabel('New price',{exact:true}).fill('240.00')
        const effective=studioClock((await h.state()).studio.timeZone,10*60_000)
        await prepare.getByLabel('Effective date',{exact:true}).fill(effective.date)
        await prepare.getByLabel('Effective time',{exact:true}).fill(effective.time)
        await prepare.getByLabel('Member asked by',{exact:true}).selectOption('phone')
        await shot(owner,'staff-form')
        await prepare.getByRole('button',{name:'Preview plan change',exact:true}).click()
        const change=(await h.state()).planChanges.changes.find(c=>c.packId===pack.id&&c.credits===credits)
        assert.ok(change,'the staff form prepared the exact preview')
        await owner.locator(`[data-plan-change="${change.id}"]`).scrollIntoViewIfNeeded()
        await shot(owner,'staff-preview')
        await memberPage.goto(h.origin+'/app/packs')
        const preview=memberPage.locator(`[data-plan-change="${change.id}"]`)
        await preview.getByText(/rounded half-up to the cent/).waitFor()
        await preview.scrollIntoViewIfNeeded()
        await shot(memberPage,'member-preview')
        await preview.getByRole('button',{name:'Accept this exact change',exact:true}).click()
        assert.equal((await h.state(member.cookie)).planChanges.changes.find(c=>c.id===change.id).status,'accepted')
        await memberPage.locator(`[data-plan-change="${change.id}"]`).getByText(/Accepted by the member/).waitFor()
        await shot(memberPage,'member-accepted')
        await owner.goto(h.origin+'/app/people?person='+member.id+'#staff-actions')
        await owner.getByRole('heading',{name:'Staff action history',exact:true}).waitFor()
        await owner.locator('#staff-actions').scrollIntoViewIfNeeded()
        await shot(owner,'staff-history')
        assert.equal((await h.state()).staffActions.filter(a=>a.command==='plan.change.prepare'&&a.after?.id===change.id&&a.right==='contract-change'&&a.channel==='phone').length,1)
      } finally {for(const context of contexts)await context.close()}
    }
  } finally {await browser.close()}
}
