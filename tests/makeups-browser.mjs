import assert from 'node:assert/strict'
import { mkdir,readFile } from 'node:fs/promises'
import { join,extname } from 'node:path'
import { chromium } from '@playwright/test'

export async function makeupsBrowser(h,participant,guardian) {
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  try {
    for(const [proofIndex,width] of [1440,390].entries()) {
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
        const before=await h.state(),instructorId=before.classes[0].instructorId
        const publish=async offset=>{
          const start=new Date(Math.ceil((Date.now()+(160+proofIndex*12+offset)*3_600_000)/60_000)*60_000).toISOString(),d=new Date(start)
          const week=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7)).toISOString().slice(0,10)
          return(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week,classes:[{title:`Youth Mat · ${width} · ${offset}`,service:'Youth Mat',start,end:new Date(Date.parse(start)+30*60_000).toISOString(),capacity:2,instructorId,room:`Makeup ${width} ${offset}`}]})).id})).classes[0]
        }
        const source=await publish(0),target=await publish(2),undoSource=await publish(4)
        const original=await h.cmd('booking.book',{classId:source.id},participant.cookie)
        const staff=await pageFor(h.owner),grant=staff.locator('form[action*="name=makeup.guardian.save"]')
        await grant.locator('select[name=personId]').selectOption(participant.id)
        await grant.locator('select[name=guardianId]').selectOption(guardian.id)
        await grant.locator('select[name=relationship]').selectOption('legal-guardian')
        await grant.getByLabel('Verified youth status and legal authority, or adult delegation evidence',{exact:true}).fill('Youth status and current legal guardian verified at the desk')
        await grant.getByLabel('Date participant turns 18 (legal guardian only)',{exact:true}).fill(`${new Date().getUTCFullYear()+1}-07-01`)
        await shot(staff,'staff-authority')
        await grant.getByRole('button',{name:'Record makeup authority',exact:true}).click()
        const relation=(await h.state()).makeups.guardians.find(r=>r.personId===participant.id&&r.guardianId===guardian.id&&!r.revokedAt)
        await parent.reload()
        await parent.locator(`form[action*="name=makeup.guardian.accept"]:has(input[value="${relation.id}"]) button`).click()
        const report=parent.locator(`[data-absence-booking="${original.id}"]`)
        await report.getByLabel('Absence reason',{exact:true}).fill('Parent reported a family commitment')
        await report.scrollIntoViewIfNeeded();await shot(parent,'parent-report')
        await report.getByRole('button',{name:'Review absence',exact:true}).click()
        const preview=parent.locator(`[data-absence-preview]:has(input[name="id"][value="${original.id}"])`)
        assert.match(await preview.innerText(),/credit returns/)
        await preview.scrollIntoViewIfNeeded();await shot(parent,'parent-absence-preview')
        await preview.getByRole('button',{name:'Confirm absence',exact:true}).click()
        const credit=(await h.state(guardian.cookie)).makeups.credits.find(c=>c.originalBookingId===original.id)
        const creditPanel=parent.locator(`[data-makeup-credit="${credit.id}"]`)
        await creditPanel.locator('select[name=classId]').selectOption(target.id)
        await creditPanel.scrollIntoViewIfNeeded();await shot(parent,'parent-replacement')
        await creditPanel.getByRole('button',{name:'Book makeup',exact:true}).click()
        const held=(await h.state(guardian.cookie)).makeups.credits.find(c=>c.id===credit.id)
        const booking=(await h.state()).bookings.find(b=>b.id===held.bookingId)
        assert.equal(booking.originalBookingId,original.id)
        assert.equal((await h.state()).bookings.find(b=>b.id===original.id).attendance,'absence')
        await parent.locator(`[data-makeup-credit="${credit.id}"]`).scrollIntoViewIfNeeded();await shot(parent,'parent-booked')
        // The owner follows the same preview, then restores an unused original.
        const undoOriginal=await h.cmd('booking.book',{classId:undoSource.id},participant.cookie)
        await staff.goto(h.origin+'/app/makeups')
        const staffReport=staff.locator(`[data-absence-booking="${undoOriginal.id}"]`)
        await staffReport.getByLabel('Absence reason',{exact:true}).fill('Family called to report a clash')
        await staffReport.getByLabel('Reported by',{exact:true}).selectOption('phone')
        await staffReport.getByRole('button',{name:'Review absence',exact:true}).click()
        const staffPreview=staff.locator(`[data-absence-preview]:has(input[name="id"][value="${undoOriginal.id}"])`)
        assert.match(await staffPreview.innerText(),/credit returns/)
        await staffPreview.getByRole('button',{name:'Confirm absence',exact:true}).click()
        const undoCredit=(await h.state()).makeups.credits.find(c=>c.originalBookingId===undoOriginal.id)
        const undo=staff.locator(`[data-absence-restore="${undoOriginal.id}"]`)
        await undo.getByLabel('Reason for restoring absence',{exact:true}).fill('The family confirmed they can attend')
        await undo.getByLabel('Reported by',{exact:true}).selectOption('phone')
        await undo.scrollIntoViewIfNeeded();await shot(staff,'staff-undo-absence')
        await undo.getByRole('button',{name:'Restore absence',exact:true}).click()
        const restored=await h.state()
        assert.equal(restored.bookings.find(b=>b.id===undoOriginal.id).status,'booked')
        assert.ok(restored.makeups.credits.find(c=>c.id===undoCredit.id).voidedAt)
        assert.equal(await staff.locator(`[data-absence-restore="${undoOriginal.id}"]`).count(),0)
        await staff.locator(`[data-makeup-credit="${undoCredit.id}"]`).scrollIntoViewIfNeeded();await shot(staff,'staff-undo-complete')
        const mine=await pageFor(participant.cookie)
        await mine.locator(`[data-makeup-credit="${credit.id}"]`).scrollIntoViewIfNeeded();await shot(mine,'participant')
        const history=await staff.goto(h.origin+'/app/people?person='+participant.id+'#staff-actions')
        assert.equal(history.status(),200)
        await staff.locator('#staff-actions').scrollIntoViewIfNeeded();await shot(staff,'staff-history')
        await parent.reload()
        await parent.locator(`[data-makeup-credit="${credit.id}"]`).getByRole('button',{name:'Cancel makeup',exact:true}).click()
        assert.equal((await h.state()).makeups.credits.find(c=>c.id===credit.id).bookingId,null)
        await parent.locator(`form[action*="name=makeup.guardian.revoke"]:has(input[value="${relation.id}"]) button`).click()
        assert.equal(await parent.locator('[data-makeup-credit]').count(),0)
      } finally {for(const context of contexts)await context.close()}
    }
  } finally {await browser.close()}
}
