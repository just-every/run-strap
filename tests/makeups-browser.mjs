import assert from 'node:assert/strict'
import { mkdir,readFile } from 'node:fs/promises'
import { join,extname } from 'node:path'
import { chromium } from '@playwright/test'

export async function makeupsBrowser(h,participant,guardian) {
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
          const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:h.origin}])
          const page=await context.newPage();await page.goto(h.origin+'/app/makeups');return page
        }
        const shot=async(page,label)=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`SCHED-009-${label}-${width}.png`),fullPage:false})}
        const parent=await pageFor(guardian.cookie)
        assert.equal(await parent.locator('[data-makeup-credit]').count(),0)
        await shot(parent,'revoked-guardian')
        const before=await h.state(participant.cookie)
        const source=before.classes.find(c=>c.status==='published'&&c.service==='Youth Mat'&&c.occupancy.onlineOpen>0&&!before.bookings.some(b=>b.classId===c.id&&b.status!=='cancelled'))
        assert.ok(source)
        const original=await h.cmd('booking.book',{classId:source.id},participant.cookie)
        const staff=await pageFor(h.owner),grant=staff.locator('form[action*="name=makeup.guardian.save"]')
        await grant.locator('select[name=personId]').selectOption(participant.id)
        await grant.locator('select[name=guardianId]').selectOption(guardian.id)
        await grant.locator('select[name=relationship]').selectOption('legal-guardian')
        await grant.getByLabel('Verified youth status and legal authority, or adult delegation evidence',{exact:true}).fill('Youth status and current legal guardian verified at the desk')
        await shot(staff,'staff-authority')
        await grant.getByRole('button',{name:'Record makeup authority',exact:true}).click()
        const relation=(await h.state()).makeups.guardians.find(r=>r.personId===participant.id&&r.guardianId===guardian.id&&!r.revokedAt)
        await parent.reload()
        await parent.locator(`form[action*="name=makeup.guardian.accept"]:has(input[value="${relation.id}"]) button`).click()
        const report=parent.locator(`[data-absence-booking="${original.id}"]`)
        await report.getByLabel('Absence reason',{exact:true}).fill('Parent reported a family commitment')
        await report.scrollIntoViewIfNeeded();await shot(parent,'parent-report')
        await report.getByRole('button',{name:'Report absence',exact:true}).click()
        const credit=(await h.state(guardian.cookie)).makeups.credits.find(c=>c.originalBookingId===original.id)
        const state=await h.state(participant.cookie)
        const target=state.classes.find(c=>c.id!==source.id&&c.service==='Youth Mat'&&c.status==='published'&&c.start<credit.expiresAt&&c.occupancy.onlineOpen>0&&!state.bookings.some(b=>b.classId===c.id&&b.status!=='cancelled'))
        assert.ok(target)
        const creditPanel=parent.locator(`[data-makeup-credit="${credit.id}"]`)
        await creditPanel.locator('select[name=classId]').selectOption(target.id)
        await creditPanel.scrollIntoViewIfNeeded();await shot(parent,'parent-replacement')
        await creditPanel.getByRole('button',{name:'Book makeup',exact:true}).click()
        const held=(await h.state(guardian.cookie)).makeups.credits.find(c=>c.id===credit.id)
        const booking=(await h.state()).bookings.find(b=>b.id===held.bookingId)
        assert.equal(booking.originalBookingId,original.id)
        assert.equal((await h.state()).bookings.find(b=>b.id===original.id).attendance,'absence')
        await parent.locator(`[data-makeup-credit="${credit.id}"]`).scrollIntoViewIfNeeded();await shot(parent,'parent-booked')
        const mine=await pageFor(participant.cookie)
        await mine.locator(`[data-makeup-credit="${credit.id}"]`).scrollIntoViewIfNeeded();await shot(mine,'participant')
        const history=await staff.goto(h.origin+'/app/people?person='+participant.id+'#staff-actions')
        assert.equal(history.status(),200)
        await staff.locator('#staff-actions').scrollIntoViewIfNeeded();await shot(staff,'staff-history')
        await parent.locator(`[data-makeup-credit="${credit.id}"]`).getByRole('button',{name:'Cancel makeup',exact:true}).click()
        assert.equal((await h.state()).makeups.credits.find(c=>c.id===credit.id).bookingId,null)
        await parent.locator(`form[action*="name=makeup.guardian.revoke"]:has(input[value="${relation.id}"]) button`).click()
        assert.equal(await parent.locator('[data-makeup-credit]').count(),0)
      } finally {for(const context of contexts)await context.close()}
    }
  } finally {await browser.close()}
}
