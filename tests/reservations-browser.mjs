import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'
const plus = (date,n) => new Date(Date.parse(date+'T12:00:00Z')+n*86_400_000).toISOString().slice(0,10)
// SCHED-005: members and the owner's booking-right door review every outcome,
// commit eight weeks at 6 pm (six booked, one waitlisted, one closed), cancel a single occurrence, then review and cancel the future series.
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
          await page.waitForLoadState('networkidle')
          await page.evaluate(()=>document.fonts.ready)
          if (locator) await locator.waitFor({state:'visible'})
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,`${name} fits ${width}`)
          await (locator??page).screenshot({path:join(process.env.STRAP_PROOF_DIR,`SCHED-005-${name}-${width}.png`),...(locator?{}:{fullPage:true})})
        }
        const date=plus(start,width===390?70:0),end=plus(date,49),member=await h.person(`Series${width}`)
        await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:8,amountCents:16000,expiresAt:'2099-12-31T00:00:00Z'})).id})
        const waiver=(await h.state()).waiver;if(waiver) await h.cmd('waiver.acknowledge',{id:waiver.id},member.cookie)
        const published=await h.cmd('series.publish',{id:(await h.cmd('series.prepare',{startDate:date,endDate:end,time:'18:00',minutes:50,intervalWeeks:1,title:`Weekly practice ${width}`,service:'Yoga',room:`Practice ${width}`,capacity:1,instructorId:coach.id})).id})
        await h.cmd('booking.book',{classId:published.classes[1].id},ben.cookie)
        const closure=await h.cmd('series.cancel.prepare',{classId:published.classes[2].id,scope:'this',reason:'Holiday closure'});await h.cmd('series.cancel.confirm',{id:closure.id,impact:closure.impact.key})
        const mine=await pageFor(member.cookie);await mine.goto(h.origin+'/app#recurring-reservations')
        await shot(mine,'member-page')
        const panel=mine.locator('#recurring-reservations')
        await panel.getByLabel('First class').selectOption(published.classes[0].id)
        await panel.getByLabel('Reserve through (inclusive)').fill(end)
        await shot(mine,'member-form',panel)
        await panel.getByRole('button',{name:'Preview recurring reservation',exact:true}).click()
        const preview=(await h.state(member.cookie)).reservationPreviews.at(-1),review=mine.locator(`[data-reservation-preview="${preview.id}"]`)
        assert.ok(published.classes.every(c=>new Intl.DateTimeFormat('en-GB',{timeZone:c.timeZone,hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).format(new Date(c.start))==='18:00'));
        assert.deepEqual(preview.outcomes.map(o=>o.status),['booked','waitlisted','skipped','booked','booked','booked','booked','booked'])
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
        assert.equal(cancellation.outcomes.length,6)
        await shot(mine,'member-cancel-preview',cancelReview)
        await cancelReview.getByRole('button',{name:'Confirm future cancellations',exact:true}).click()
        await mine.getByText('Future cancellations recorded. Past and started visits were kept.',{exact:true}).waitFor()
        await shot(mine,'member-cancelled',saved)
        assert.equal((await h.state(member.cookie)).packs[0].remaining,8)
        // The same existing screen's owner door, with request channel and one
        // canonical booking-right audit for each command.
        const staff=await pageFor(h.owner),back=`/app/people?person=${member.id}#person`;await staff.goto(h.origin+back)
        await shot(staff,'staff-page')
        const staffPanel=staff.locator('#recurring-reservations')
        await staffPanel.getByLabel('First class').selectOption(published.classes[0].id)
        await staffPanel.getByLabel('Reserve through (inclusive)').fill(end)
        await staffPanel.getByLabel('Request channel').selectOption('phone')
        await staffPanel.getByRole('button',{name:'Preview recurring reservation',exact:true}).click()
        const staffDraft=(await h.state()).reservationPreviews.filter(r=>r.personId===member.id).at(-1),staffReview=staff.locator(`[data-reservation-preview="${staffDraft.id}"]`)
        assert.equal(await staffReview.getByLabel('Request channel').inputValue(),'phone','review preserves the chosen phone channel')
        await shot(staff,'staff-preview',staffReview)
        await staffReview.getByRole('button',{name:'Confirm recurring reservation',exact:true}).click()
        const staffReservation=(await h.state()).reservations.filter(r=>r.personId===member.id).at(-1),staffSaved=staff.locator(`[data-reservation="${staffReservation.id}"]`)
        await shot(staff,'staff-saved',staffSaved)
        assert.deepEqual(staffReservation.outcomes.map(o=>o.status),['booked','waitlisted','skipped','booked','booked','booked','booked','booked'])
        assert.equal((await h.state()).packs.find(p=>p.personId===member.id).remaining,2,'only the six booked occurrences reserve a credit')
        assert.ok((await h.state()).bookings.filter(b=>b.reservationId===staffReservation.id).every(b=>b.madeByRole==='owner'&&b.right==='booking'&&b.bookingChannel==='phone'))

        await staffSaved.getByRole('button',{name:'Review future cancellations',exact:true}).click()
        const staffCancellation=(await h.state()).reservationPreviews.filter(r=>r.personId===member.id).at(-1),staffCancel=staff.locator(`[data-reservation-preview="${staffCancellation.id}"]`)
        await staffCancel.getByLabel('Cancellation reason').selectOption('Schedule conflict')
        await shot(staff,'staff-cancel-preview',staffCancel)
        await staffCancel.getByRole('button',{name:'Confirm future cancellations',exact:true}).click()
        await shot(staff,'staff-cancelled',staffSaved)
        const state=await h.state(),actions=state.staffActions.filter(a=>a.personId===member.id&&a.command?.startsWith('reservation.'))
        assert.equal(actions.length,4);assert.ok(actions.every(a=>a.right==='booking'&&a.actorRole==='owner'))
        // The member is already on this hash route; reload requests the staff's
        // newly committed result instead of doing same-document navigation.
        await mine.reload()
        const final=mine.locator(`[data-reservation="${staffReservation.id}"]`)
        await final.getByText('Future cancellations recorded. Past and started visits were kept.',{exact:true}).waitFor()
        await shot(mine,'member-reads-staff-result',final)
      } finally {for(const c of contexts) await c.close()}
    }
  } finally {await browser.close()}
}

// The private desk path uses real form posts, native sessions and D1 records.
export async function appointmentsBrowser(h,{coach,start}) {
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  try {for(const width of [1440,390]) {
    const contexts=[]
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
      await page.waitForLoadState('networkidle');await page.evaluate(()=>document.fonts.ready)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,`${name} fits ${width}`)
      if(locator) await locator.waitFor({state:'visible'})
      await (locator??page).screenshot({path:join(process.env.STRAP_PROOF_DIR,`SCHED-013-${name}-${width}.png`),...(locator?{}:{fullPage:true})})
    }
    try {
      const date=plus(start,width===390?91:0),end=plus(date,63),member=await h.person('Amelia'+width),desk=await h.person('Reception'+width)
      await h.cmd('person.save',{id:member.id,version:member.version,name:'Amelia Rivers',email:member.email,role:'member',active:true})
      await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:10,amountCents:85000,expiresAt:'2099-12-31T00:00:00Z',eligibleServices:['Private Pilates']})).id})
      await h.cmd('member.record.grant',{personId:desk.id,enabled:true,canCreate:false,memberIds:[member.id]})
      desk.cookie=await h.signIn(desk.email);await h.enroll(desk.cookie)
      const owner=await pageFor(h.owner);await owner.goto(h.origin+'/app/people')
      const access=owner.locator('#appointment-booking-access')
      await access.getByLabel('Staff sign-in identity').selectOption(desk.id)
      await access.locator(`[name="member_${member.id}"]`).check();await access.locator('[name="loc_studio"]').check()
      await shot(owner,'booking-right',access)
      await access.getByRole('button',{name:'Save appointment booking access',exact:true}).click()
      await shot(owner,'booking-right-saved',access)
      const offer=await h.cmd('appointment.series.offer.save',{requestId:'synthetic-strap-browser-offer-'+width,service:'Private Pilates',instructorId:coach.id,room:'Reformer studio',startDate:date,endDate:end,time:'09:00',minutes:50})
      await h.cmd('scheduling.unavailable.save',{resourceKind:'instructor',resourceId:coach.id,start:offer.occurrences[3].start,end:offer.occurrences[3].end,reason:'Private family leave'})
      const page=await pageFor(desk.cookie),back='/app/people?person='+member.id;await page.goto(h.origin+back)
      const panel=page.locator('#appointments');await panel.getByText('Book a private series',{exact:true}).click()
      const compose=panel.locator('form').filter({has:page.getByRole('button',{name:'Preview private series',exact:true})})
      await compose.getByLabel('Private service').fill('Private Pilates');await compose.getByLabel('Instructor',{exact:true}).selectOption(coach.id)
      await compose.getByLabel('Room',{exact:true}).fill('Reformer studio');await compose.getByLabel('First appointment date').fill(date);await compose.getByLabel('Last appointment date').fill(end)
      await compose.getByLabel('Request received by').selectOption('phone');await shot(page,'desk-series-form',panel)
      await compose.getByRole('button',{name:'Preview private series',exact:true}).click()
      let preview=(await h.state(desk.cookie)).appointmentPreviews.at(-1),review=page.locator(`[data-appointment-preview="${preview.id}"]`)
      assert.equal(preview.available,false);assert.ok(!(await review.innerText()).includes('Private family leave'))
      await shot(page,'dated-conflict',review)
      const conflict=preview.occurrences[3],alternative=conflict.alternatives.find(a=>a.date===plus(date,22));assert.ok(alternative)
      await review.getByLabel('Alternative for '+conflict.occurrenceDate).selectOption(alternative.start)
      await review.getByRole('button',{name:'Review chosen alternatives',exact:true}).click()
      preview=(await h.state(desk.cookie)).appointmentPreviews.at(-1);review=page.locator(`[data-appointment-preview="${preview.id}"]`)
      assert.equal(preview.available,true);assert.equal(preview.occurrences.length,10)
      await shot(page,'ten-session-preview',review)
      await review.getByRole('button',{name:'Confirm appointment reservation',exact:true}).click()
      let saved=(await h.state(desk.cookie)).appointments.at(-1),savedPanel=page.locator(`[data-appointment-reservation="${saved.id}"]`)
      await shot(page,'ten-sessions-saved',savedPanel)
      let row=savedPanel.locator('tbody tr').nth(1);await row.getByText('Move appointment',{exact:true}).click()
      await row.getByLabel('New appointment date').fill(plus(date,8));await row.getByLabel('Request received by').first().selectOption('phone')
      await row.getByRole('button',{name:'Preview appointment move',exact:true}).click()
      preview=(await h.state(desk.cookie)).appointmentPreviews.at(-1);review=page.locator(`[data-appointment-preview="${preview.id}"]`)
      await shot(page,'move-preview',review);await review.getByRole('button',{name:'Confirm appointment move',exact:true}).click()
      await shot(page,'moved',savedPanel)
      row=savedPanel.locator('tbody tr').nth(5);await row.getByText('Cancel appointment',{exact:true}).click()
      await row.getByLabel('Cancellation scope').selectOption('future');await row.getByLabel('Cancellation reason').fill('Away from week six')
      await row.getByRole('button',{name:'Preview appointment cancellation',exact:true}).click()
      preview=(await h.state(desk.cookie)).appointmentPreviews.at(-1);review=page.locator(`[data-appointment-preview="${preview.id}"]`)
      assert.equal(preview.occurrences.length,5);await shot(page,'week-six-preview',review)
      await review.getByRole('button',{name:'Confirm appointment cancellation',exact:true}).click();await shot(page,'five-sessions-released',savedPanel)
      const state=await h.state(),pack=state.packs.find(p=>p.personId===member.id);assert.deepEqual([pack.summary.remaining,pack.summary.reserved,pack.summary.consumed],[5,5,0])
      const first=saved.occurrences[0]
      await h.cmd('attendance.checkin',{id:first.bookingId})
      const past=new Date(Date.now()-3_600_000).toISOString()
      await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.start',?,'$.end',?) WHERE id=?").bind(past,new Date(Date.parse(past)+50*60_000).toISOString(),first.id).run()
      const rule=await h.cmd('pay.rule.save',{service:'Private Pilates',instructorId:coach.id,effectiveAt:new Date(Date.now()+60_000).toISOString(),mode:'per-appointment',rateCents:4500,minimumCents:0,cancellation:{treatment:'none'}})
      await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.effectiveAt',?) WHERE id=?").bind(new Date(Date.parse(past)-60_000).toISOString(),rule.id).run()
      await owner.goto(h.origin+back);await shot(owner,'owner-ending',owner.locator('.person-card'))
      await owner.keyboard.press('Tab')
      const iconControls=owner.locator('a,button').filter({has:owner.locator('svg')})
      for(let i=0;i<await iconControls.count();i++) {
        const control=iconControls.nth(i)
        if((await control.innerText()).trim()) continue
        assert.ok(await control.getAttribute('aria-describedby'),'icon-only controls have tooltips')
        await control.focus();const tooltip=owner.locator('[id="'+await control.getAttribute('aria-describedby')+'"]');await tooltip.waitFor({state:'visible'})
        await owner.screenshot({path:join(process.env.STRAP_PROOF_DIR,`SCHED-013-focus-tooltip-${width}.png`)})
        await control.blur();await control.hover();await tooltip.waitFor({state:'visible'})
        await owner.screenshot({path:join(process.env.STRAP_PROOF_DIR,`SCHED-013-hover-tooltip-${width}.png`)});break
      }
      const mine=await pageFor(member.cookie);await mine.goto(h.origin+'/app');await shot(mine,'member-notices-and-balance')
      assert.equal((await h.state(member.cookie)).notices.length,3)
      // Pay screen and its private appointment rate selector are the same built route.
      await owner.goto(h.origin+'/app/teaching-pay');await shot(owner,'taught-pay-report')
      await owner.locator(`[data-pay-class="${first.id}"]`).getByText('$45.00',{exact:true}).waitFor()
      assert.ok((await owner.content()).includes('Per taught private appointment'))
    } finally {for(const context of contexts) await context.close()}
  }} finally {await browser.close()}
}
