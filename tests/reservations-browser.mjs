import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'
const plus = (date,n) => new Date(Date.parse(date+'T12:00:00Z')+n*86_400_000).toISOString().slice(0,10)
// SCHED-005: members and the owner's booking-right door review every outcome,
// commit, cancel a single occurrence, then review and cancel the future series.
export async function reservationsBrowser(h,{coach,ben,start}) {
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
            if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path)) return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
            return route.continue()
          })
          const index=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,index),value:cookie.slice(index+1),url:h.origin}]);return context.newPage()
        }
        const shot=async(page,name,locator)=>{
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,`${name} fits ${width}`)
          await (locator??page).screenshot({path:join(process.env.STRAP_PROOF_DIR,`SCHED-005-${name}-${width}.png`),...(locator?{}:{fullPage:true})})
        }
        const date=plus(start,width===390?42:0),end=plus(date,21),member=await h.person(`Series${width}`)
        await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:4,amountCents:8000,expiresAt:'2099-12-31T00:00:00Z'})).id})
        const waiver=(await h.state()).waiver;if(waiver) await h.cmd('waiver.acknowledge',{id:waiver.id},member.cookie)
        const published=await h.cmd('series.publish',{id:(await h.cmd('series.prepare',{startDate:date,endDate:end,time:'14:00',minutes:50,intervalWeeks:1,title:`Weekly practice ${width}`,service:'Yoga',room:`Practice ${width}`,capacity:1,instructorId:coach.id})).id})
        await h.cmd('booking.book',{classId:published.classes[1].id},ben.cookie)
        const closure=await h.cmd('series.cancel.prepare',{classId:published.classes[2].id,scope:'this',reason:'Holiday closure'});await h.cmd('series.cancel.confirm',{id:closure.id,impact:closure.impact.key})
        const mine=await pageFor(member.cookie);await mine.goto(h.origin+'/app#recurring-reservations')
        const panel=mine.locator('#recurring-reservations')
        await panel.getByLabel('First class').selectOption(published.classes[0].id)
        await panel.getByLabel('Reserve through (inclusive)').fill(end)
        await shot(mine,'member-form',panel)
        await panel.getByRole('button',{name:'Preview recurring reservation',exact:true}).click()
        const preview=(await h.state(member.cookie)).reservationPreviews.at(-1),review=mine.locator(`[data-reservation-preview="${preview.id}"]`)
        assert.deepEqual(preview.outcomes.map(o=>o.status),['booked','waitlisted','skipped','booked'])
        await review.getByText('Class closed',{exact:true}).waitFor();await shot(mine,'member-preview',review)
        await review.getByRole('button',{name:'Confirm recurring reservation',exact:true}).click()
        const reservation=(await h.state(member.cookie)).reservations.at(-1),saved=mine.locator(`[data-reservation="${reservation.id}"]`)
        await saved.getByText('Waitlisted',{exact:true}).waitFor();await shot(mine,'member-saved',saved)
        const first=reservation.outcomes[0].bookingId
        const row=mine.locator('tr').filter({hasText:published.classes[0].title}).filter({has:mine.getByRole('button',{name:'Cancel',exact:true})}).first()
        await row.getByRole('button',{name:'Cancel',exact:true}).click()
        assert.equal((await h.state(member.cookie)).bookings.find(b=>b.id===first).status,'cancelled')
        await saved.getByRole('button',{name:'Review future cancellations',exact:true}).click()
        const cancellation=(await h.state(member.cookie)).reservationPreviews.at(-1),cancelReview=mine.locator(`[data-reservation-preview="${cancellation.id}"]`)
        assert.equal(cancellation.outcomes.length,2)
        await shot(mine,'member-cancel-preview',cancelReview)
        await cancelReview.getByRole('button',{name:'Confirm future cancellations',exact:true}).click()
        await mine.getByText('Future cancellations recorded. Past and started visits were kept.',{exact:true}).waitFor()
        await shot(mine,'member-cancelled',saved)
        assert.equal((await h.state(member.cookie)).packs[0].remaining,4)
        // The same existing screen's owner door, with request channel and one
        // canonical booking-right audit for each command.
        const staff=await pageFor(h.owner),back=`/app/people?person=${member.id}#person`;await staff.goto(h.origin+back)
        const staffPanel=staff.locator('#recurring-reservations')
        await staffPanel.getByLabel('First class').selectOption(published.classes[0].id)
        await staffPanel.getByLabel('Reserve through (inclusive)').fill(end)
        await staffPanel.getByLabel('Request channel').selectOption('phone')
        await staffPanel.getByRole('button',{name:'Preview recurring reservation',exact:true}).click()
        const staffDraft=(await h.state()).reservationPreviews.filter(r=>r.personId===member.id).at(-1),staffReview=staff.locator(`[data-reservation-preview="${staffDraft.id}"]`)
        assert.ok(await staffReview.count(),JSON.stringify({previews:await staff.locator('[data-reservation-preview]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-reservation-preview'))),text:(await staff.locator('main').innerText()).slice(-8000)}))
        await shot(staff,'staff-preview',staffReview)
        await staffReview.getByRole('button',{name:'Confirm recurring reservation',exact:true}).click()
        const staffReservation=(await h.state()).reservations.filter(r=>r.personId===member.id).at(-1),staffSaved=staff.locator(`[data-reservation="${staffReservation.id}"]`)
        await shot(staff,'staff-saved',staffSaved)
        await staffSaved.getByRole('button',{name:'Review future cancellations',exact:true}).click()
        const staffCancellation=(await h.state()).reservationPreviews.filter(r=>r.personId===member.id).at(-1),staffCancel=staff.locator(`[data-reservation-preview="${staffCancellation.id}"]`)
        await staffCancel.getByLabel('Cancellation reason').selectOption('Schedule conflict')
        await shot(staff,'staff-cancel-preview',staffCancel)
        await staffCancel.getByRole('button',{name:'Confirm future cancellations',exact:true}).click()
        await shot(staff,'staff-cancelled',staffSaved)
        const state=await h.state(),actions=state.staffActions.filter(a=>a.personId===member.id&&a.command?.startsWith('reservation.'))
        assert.equal(actions.length,4);assert.ok(actions.every(a=>a.right==='booking'&&a.actorRole==='owner'))
        await mine.goto(h.origin+'/app#recurring-reservations')
        const final=mine.locator(`[data-reservation="${staffReservation.id}"]`)
        await final.getByText('Future cancellations recorded. Past and started visits were kept.',{exact:true}).waitFor()
        await shot(mine,'member-reads-staff-result',final)
      } finally {for(const c of contexts) await c.close()}
    }
  } finally {await browser.close()}
}
