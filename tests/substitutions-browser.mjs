import assert from 'node:assert/strict'
import { mkdir,readFile } from 'node:fs/promises'
import { join,extname } from 'node:path'
import { chromium } from '@playwright/test'

export async function substitutionsBrowser(h,{original,cover,member,publish}) {
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  try {
    for(const width of [1440,390]) {
      const contexts=[]
      try {
        const pageFor=async(cookie)=>{
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
          await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`SCHED-004-${name}-${width}.png`),fullPage:true})
        }
        const start=new Date(Date.now()+600_000).toISOString()
        const entry=await publish(h,{title:'Coverage browser '+width,service:'Mat',room:'Browser '+width,start,end:new Date(Date.parse(start)+60_000).toISOString(),capacity:2,instructorId:original.id})
        await h.cmd('booking.book',{classId:entry.id},member.cookie)
        const teacher=await pageFor(original.cookie),owner=await pageFor(h.owner),memberPage=await pageFor(member.cookie)
        await teacher.goto(h.origin+'/app/substitutions')
        await teacher.getByRole('heading',{name:'Instructor substitutions',exact:true}).waitFor()
        await shot(teacher,'instructor-empty')
        const requestForm=teacher.locator('form[action*="name=substitution.request"]')
        await requestForm.getByLabel('Class',{exact:true}).selectOption(entry.id)
        await requestForm.getByLabel('Coverage request reason',{exact:true}).fill('Workshop cover '+width)
        await requestForm.getByRole('button',{name:'Request substitute',exact:true}).click()
        const request=(await h.state()).substitutions.requests.find(r=>r.classId===entry.id)
        await teacher.locator(`[data-substitution-request="${request.id}"]`).waitFor()
        await shot(teacher,'instructor-requested')
        await owner.goto(h.origin+'/app/substitutions')
        await owner.getByRole('heading',{name:'Studio service qualifications',exact:true}).waitFor()
        const qualification=owner.locator('form[action*="name=substitution.qualification.save"]')
        await qualification.getByLabel('Instructor',{exact:true}).selectOption(cover.id)
        await qualification.getByLabel('Exact service name',{exact:true}).fill('Mat')
        await qualification.getByLabel('Studio approval',{exact:true}).selectOption('true')
        await qualification.getByRole('button',{name:'Save studio qualification',exact:true}).click()
        const row=owner.locator(`[data-substitution-request="${request.id}"]`)
        await row.getByLabel('Available qualified substitute',{exact:true}).selectOption(cover.id)
        await shot(owner,'owner-candidates')
        await row.getByRole('button',{name:'Preview substitution',exact:true}).click()
        const draft=(await h.state()).substitutions.drafts.find(d=>d.requestId===request.id&&d.status==='draft')
        const preview=owner.locator(`[data-substitution-draft="${draft.id}"]`)
        await preview.getByRole('button',{name:'Approve exact substitution',exact:true}).waitFor()
        await preview.getByRole('button',{name:'Approve exact substitution',exact:true}).scrollIntoViewIfNeeded()
        await shot(owner,'owner-preview')
        await preview.getByRole('button',{name:'Approve exact substitution',exact:true}).click()
        assert.equal((await h.state()).classes.find(c=>c.id===entry.id).instructorId,cover.id)
        await shot(owner,'owner-approved')
        await owner.goto(h.origin+'/app/people?person='+member.id+'#staff-actions')
        await owner.getByRole('heading',{name:'Staff action history',exact:true}).waitFor()
        await owner.locator('#staff-actions').scrollIntoViewIfNeeded()
        await shot(owner,'member-profile-history')
        await teacher.reload();await shot(teacher,'original-after-transfer')
        await memberPage.goto(h.origin+'/app')
        const exactNotice=draft.impact.classes[0].bookings[0].body
        await memberPage.getByText(exactNotice,{exact:true}).waitFor()
        await shot(memberPage,'member-notice')
        const substitute=await pageFor(cover.cookie)
        await substitute.goto(h.origin+'/app?class='+entry.id+'#roster')
        await shot(substitute,'substitute-roster')
        const close=await h.cmd('closure.prepare',{scope:'class',classId:entry.id,reason:'Browser pay evidence cancellation'})
        await h.cmd('closure.confirm',{id:close.id,impact:close.impact.key})
        await substitute.goto(h.origin+'/app/teaching-pay')
        await substitute.getByRole('heading',{name:'Teaching pay',exact:true}).waitFor()
        await shot(substitute,'earned-substitute-pay')
        const pay=(await h.send('/api/strap/teaching-pay',undefined,cover.cookie)).value.rows.find(r=>r.classId===entry.id)
        assert.equal(pay.substitute,true);assert.equal(pay.totalCents,6500)
      } finally {for(const context of contexts)await context.close()}
    }
  } finally {await browser.close()}
}
