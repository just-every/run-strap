import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { chromium } from '@playwright/test'
const plus = (date,n) => new Date(Date.parse(date+'T12:00:00Z')+n*86_400_000).toISOString().slice(0,10)
// SCHED-005: members and the owner's booking-right door review every outcome,
// commit eight weeks at 6 pm (six booked, one waitlisted, one closed), cancel a single occurrence, then review and cancel the future series.
export async function reservationsBrowser(h,{coach,ben,start}) {
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
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
          const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)
      if(!fits) {
        await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`SCHED-013-overflow-${name}-${width}.png`),fullPage:true})
        const overflowing=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(-8).map(e=>({tag:e.tagName,class:e.className,text:e.textContent?.slice(0,80)})))
        assert.fail(`${name} fits ${width}: ${JSON.stringify(overflowing)}`)
      }
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
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
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
      const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)
      if(!fits) {
        await page.screenshot({path:join(process.env.STRAP_PROOF_DIR,`SCHED-013-overflow-${name}-${width}.png`),fullPage:true})
        const overflowing=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(-8).map(e=>({tag:e.tagName,class:e.className,text:e.textContent?.slice(0,80)})))
        assert.fail(`${name} fits ${width}: ${JSON.stringify(overflowing)}`)
      }
      if(locator) await locator.waitFor({state:'visible'})
      await (locator??page).screenshot({path:join(process.env.STRAP_PROOF_DIR,`SCHED-013-${name}-${width}.png`),...(locator?{}:{fullPage:true})})
    }
    try {
      const date=plus(start,width===390?91:0),end=plus(date,63),member=await h.person('Amelia'+width),desk=await h.person('Reception'+width)
      await h.cmd('person.save',{id:member.id,version:member.version,name:'Amelia Rivers',email:member.email,role:'member',active:true})
      await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:10,amountCents:85000,expiresAt:'2099-12-31T00:00:00Z',eligibleServices:['Private Pilates']})).id})
      await h.cmd('member.record.grant',{personId:desk.id,enabled:true,canCreate:false,memberIds:[member.id]})
      desk.cookie=await h.signIn(desk.email);await h.enroll(desk.cookie)
      const owner=await pageFor(h.owner),ownerResponse=await owner.goto(h.origin+'/app/people');assert.equal(ownerResponse.status(),200,(await owner.locator('body').innerText()).slice(0,1000))
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
      await owner.goto(h.origin+'/app/people?classId='+saved.occurrences[5].id+'#cancellations')
      await owner.locator('#cancellations').getByText('1 cancellations · 0 late',{exact:false}).waitFor()
      await owner.locator('#cancellations').getByText('Away from week six',{exact:true}).waitFor()
      await shot(owner,'private-cancellation-history',owner.locator('#cancellations'))

      const first=saved.occurrences[0]
      await h.cmd('attendance.checkin',{id:first.bookingId})
      const past=new Date(Date.now()-3_600_000).toISOString()
      await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.start',?,'$.end',?) WHERE id=?").bind(past,new Date(Date.parse(past)+50*60_000).toISOString(),first.id).run()
      const rule=await h.cmd('pay.rule.save',{service:'Private Pilates',instructorId:coach.id,effectiveAt:new Date(Date.now()+60_000).toISOString(),mode:'per-appointment',rateCents:4500,minimumCents:0,cancellation:{treatment:'none'}})
      await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.effectiveAt',?) WHERE id=?").bind(new Date(Date.parse(past)-60_000).toISOString(),rule.id).run()
      await owner.goto(h.origin+back);await shot(owner,'owner-ending',owner.locator('#appointments'))
      await owner.keyboard.press('Tab')
      const iconControls=owner.locator('a,button').filter({has:owner.locator('svg')})
      for(let i=0;i<await iconControls.count();i++) {
        const control=iconControls.nth(i)
        if(!await control.isVisible() || (await control.innerText()).trim()) continue
        assert.ok(await control.getAttribute('aria-describedby'),'icon-only controls have tooltips: '+await control.evaluate(e=>e.outerHTML))
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

      // Extend the same front-desk journey with reviewed following moves and a
      // canceled occurrence returning to its original booking and allocation.
      await page.goto(h.origin+back)
      let active=(await h.state(desk.cookie)).appointments.find(r=>r.id===saved.id)
      const moveDates=active.occurrences.slice(1,5).map(o=>o.localDate)
      row=savedPanel.locator('tbody tr').nth(1);await row.getByText('Move appointment',{exact:true}).click()
      await row.getByLabel('Move scope').selectOption('future')
      await row.getByLabel('New appointment date').fill(plus(moveDates[0],1))
      await row.getByRole('button',{name:'Preview appointment move',exact:true}).click()
      preview=(await h.state(desk.cookie)).appointmentPreviews.at(-1);review=page.locator(`[data-appointment-preview="${preview.id}"]`)
      assert.equal(preview.occurrences.length,4)
      assert.ok(preview.occurrences.every((o,i)=>o.localDate===plus(moveDates[i],1)))
      await shot(page,'following-move-preview',review)
      await review.getByRole('button',{name:'Confirm appointment move',exact:true}).click()
      await shot(page,'following-moved',savedPanel)
      active=(await h.state(desk.cookie)).appointments.find(r=>r.id===saved.id)
      const canceledOccurrence=active.occurrences[5]
      row=savedPanel.locator('tbody tr').nth(5);await row.getByText('Restore appointment',{exact:true}).click()
      await row.getByLabel('Restoration reason').fill('Member returned earlier')
      await row.getByRole('button',{name:'Preview appointment restoration',exact:true}).click()
      preview=(await h.state(desk.cookie)).appointmentPreviews.at(-1);review=page.locator(`[data-appointment-preview="${preview.id}"]`)
      assert.equal(preview.occurrences[0].bookingId,canceledOccurrence.bookingId)
      await shot(page,'restore-preview',review)
      await review.getByRole('button',{name:'Confirm appointment restoration',exact:true}).click()
      await shot(page,'restored-private-occurrence',savedPanel)
      await owner.goto(h.origin+'/app/people?classId='+canceledOccurrence.id+'#cancellations')
      await owner.locator('#cancellations').getByText(/^Restored /).waitFor()
      await shot(owner,'private-restored-history',owner.locator('#cancellations'))

      active=(await h.state(desk.cookie)).appointments.find(r=>r.id===saved.id)
      assert.equal(active.occurrences[5].status,'booked');assert.equal(active.occurrences[5].bookingId,canceledOccurrence.bookingId)
      const restoredPack=(await h.state()).packs.find(p=>p.personId===member.id)
      assert.deepEqual([restoredPack.summary.remaining,restoredPack.summary.reserved,restoredPack.summary.consumed],[4,5,1])
      await mine.reload();assert.equal((await h.state(member.cookie)).notices.length,5)
      await shot(mine,'member-reads-following-move-and-restore')
      // The cancellations list uses the same reviewed private restoration door.
      const listedOccurrence=active.occurrences[6]
      await owner.goto(h.origin+'/app/people?classId='+listedOccurrence.id+'#cancellations')
      const listed=owner.locator('#cancellations')
      await listed.getByText('Restore appointment',{exact:true}).click()
      await listed.getByLabel('Restoration reason').fill('Member requested the listed session')
      await listed.getByRole('button',{name:'Preview appointment restoration',exact:true}).click()
      const listPreview=(await h.state()).appointmentPreviews.filter(p=>p.personId===member.id&&p.operation==='restore').at(-1)
      assert.equal(listPreview.occurrences[0].bookingId,listedOccurrence.bookingId)
      const listReview=owner.locator(`[data-appointment-preview="${listPreview.id}"]`)
      await listReview.getByRole('button',{name:'Confirm appointment restoration',exact:true}).click()
      const listedRestored=await h.state()
      assert.equal(listedRestored.bookings.find(b=>b.id===listedOccurrence.bookingId).status,'booked')
      assert.equal(listedRestored.packs.find(p=>p.personId===member.id).remaining,3)
      await owner.locator('#cancellations').getByText(/^Restored /).waitFor()


      // Owner and member screens retain an explicitly skipped date and reason;
      // the two held appointments use the membership allowance without credits.
      const allowanceMember=await h.person('Allowance'+width),allowanceMonth=plus(new Date().toISOString().slice(0,10),width===390?210:140).slice(0,8)
      await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:allowanceMember.id,kind:'visits',planName:'Two private visits',visits:2,period:'month',rollover:0,amountCents:15000,expiresAt:'2099-12-31T00:00:00Z',eligibleServices:['Private allowance']})).id})
      const allowanceOffer=await h.cmd('appointment.series.offer.save',{requestId:'synthetic-strap-browser-allowance-'+width,service:'Private allowance',instructorId:coach.id,room:'Allowance studio',startDate:allowanceMonth+'08',endDate:allowanceMonth+'22',time:'11:00',minutes:50})
      await h.cmd('scheduling.unavailable.save',{resourceKind:'instructor',resourceId:coach.id,start:allowanceOffer.occurrences[1].start,end:allowanceOffer.occurrences[1].end,reason:'Unavailable that week'})
      await owner.goto(h.origin+'/app/people?person='+allowanceMember.id)
      const allowancePanel=owner.locator('#appointments');await allowancePanel.getByText('Book a private series',{exact:true}).click()
      const allowanceForm=allowancePanel.locator('form').filter({has:owner.getByRole('button',{name:'Preview private series',exact:true})})
      await allowanceForm.getByLabel('Private service').fill('Private allowance');await allowanceForm.getByLabel('Instructor',{exact:true}).selectOption(coach.id)
      await allowanceForm.getByLabel('Room',{exact:true}).fill('Allowance studio');await allowanceForm.getByLabel('First appointment date').fill(allowanceMonth+'08')
      await allowanceForm.getByLabel('Last appointment date').fill(allowanceMonth+'22');await allowanceForm.getByLabel('Local start time',{exact:true}).fill('11:00')
      await allowanceForm.getByRole('button',{name:'Preview private series',exact:true}).click()
      let allowancePreview=(await h.state()).appointmentPreviews.filter(r=>r.personId===allowanceMember.id).at(-1),allowanceReview=owner.locator(`[data-appointment-preview="${allowancePreview.id}"]`)
      await allowanceReview.getByLabel('Alternative for '+allowanceMonth+'15').selectOption('skip')
      await allowanceReview.getByLabel('Reason if skipping '+allowanceMonth+'15').fill('Member away this week')
      await shot(owner,'explicit-skip-choice',allowanceReview)
      await allowanceReview.getByRole('button',{name:'Review chosen alternatives',exact:true}).click()
      allowancePreview=(await h.state()).appointmentPreviews.filter(r=>r.personId===allowanceMember.id).at(-1);allowanceReview=owner.locator(`[data-appointment-preview="${allowancePreview.id}"]`)
      assert.deepEqual(allowancePreview.occurrences.map(o=>o.status),['booked','skipped','booked'])
      await shot(owner,'membership-skip-preview',allowanceReview)
      await allowanceReview.getByRole('button',{name:'Confirm appointment reservation',exact:true}).click()
      const allowanceSaved=(await h.state()).appointments.find(r=>r.personId===allowanceMember.id)
      await shot(owner,'membership-skip-saved',owner.locator(`[data-appointment-reservation="${allowanceSaved.id}"]`))
      const allowancePack=(await h.state()).packs.find(p=>p.personId===allowanceMember.id)
      assert.equal(allowancePack.remaining,0);assert.equal(allowancePack.summary.reserved,2)
      const allowanceMine=await pageFor(allowanceMember.cookie);await allowanceMine.goto(h.origin+'/app')
      assert.ok((await h.state(allowanceMember.cookie)).notices[0].body.includes('Member away this week'))
      await shot(allowanceMine,'member-skipped-reason')
      const pricedMember=await h.person('Priced'+width),pricedService='Private priced '+width,pricedDate=plus(date,210);
      await owner.goto(h.origin+'/app/studio');const pricing=owner.locator('#appointment-prices');
      await pricing.getByLabel('Private service',{exact:true}).fill(pricedService);await pricing.getByLabel('Price location',{exact:true}).selectOption('studio');await pricing.getByLabel('Price per visit',{exact:true}).fill('90.00');
      await pricing.getByRole('button',{name:'Publish appointment price',exact:true}).click();
      const price=(await h.state()).appointmentPrices.find(p=>p.service===pricedService);assert.equal(price.amountCents,9000);await shot(owner,'published-appointment-price',pricing);
      const scope={enabled:true,scopes:[{memberIds:[member.id,pricedMember.id],locationIds:['studio'],doors:['all']}]};
      await h.cmd('staff.access.grant',{personId:desk.id,role:'front-desk',enabled:true,rights:{booking:scope,'member-record':scope,sale:scope}});
      await page.goto(h.origin+'/app/people?person='+pricedMember.id);const pricedPanel=page.locator('#appointments');await pricedPanel.getByText('Book a private series',{exact:true}).click();
      const pricedForm=pricedPanel.locator('form').filter({has:page.getByRole('button',{name:'Preview private series',exact:true})});
      await pricedForm.getByLabel('Private service',{exact:true}).fill(pricedService);await pricedForm.getByLabel('Instructor',{exact:true}).selectOption(coach.id);await pricedForm.getByLabel('Room',{exact:true}).fill('Priced private studio');
      await pricedForm.getByLabel('First appointment date').fill(pricedDate);await pricedForm.getByLabel('Last appointment date').fill(plus(pricedDate,7));await pricedForm.getByLabel('Local start time',{exact:true}).fill('15:00');
      await pricedForm.getByLabel('Appointment funding',{exact:true}).selectOption('pay-per-visit');await pricedForm.getByLabel('Pay-per-visit price (when chosen)',{exact:true}).selectOption(price.id);
      await pricedForm.getByRole('button',{name:'Preview private series',exact:true}).click();
      const paymentPreview=(await h.state(desk.cookie)).appointmentPreviews.filter(p=>p.personId===pricedMember.id).at(-1),paymentReview=page.locator('[data-appointment-preview="'+paymentPreview.id+'"]');
      assert.equal(paymentPreview.funding.amountCents,9000);await shot(page,'priced-series-preview',paymentReview);await paymentReview.getByRole('button',{name:'Confirm appointment reservation',exact:true}).click();
      const priced=(await h.state(desk.cookie)).appointments.find(p=>p.personId===pricedMember.id);assert.equal(priced.occurrences.length,2);
      assert.deepEqual((await h.state()).charges.filter(c=>c.appointmentReservationId===priced.id).map(c=>c.amountCents),[9000,9000]);
      await shot(page,'priced-series-saved',page.locator('[data-appointment-reservation="'+priced.id+'"]'));
    } finally {for(const context of contexts) await context.close()}
  }} finally {await browser.close()}
}

// The manager and assigned instructor use the same reviewed private changes
// as front desk, with their own actor and current named grants.
export async function delegatedPrivateBrowser(h,{staff,role,member,reservation}) {
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
  await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true})
  try {for(const width of [390,1440]) {
    const context=await browser.newContext({viewport:{width,height:1000}})
    try {
      await context.route(h.origin+'/**',async route=>{
        const path=new URL(route.request().url()).pathname
        if(!path.includes('..')&&/\.(css|svg|woff2|png|ico)$/.test(path)) return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:{'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[extname(path)]})
        return route.continue()
      })
      const index=staff.cookie.indexOf('=');await context.addCookies([{name:staff.cookie.slice(0,index),value:staff.cookie.slice(index+1),url:h.origin}])
      const page=await context.newPage();await page.goto(h.origin+'/app/people?person='+member.id)
      const saved=page.locator(`[data-appointment-reservation="${reservation.id}"]`),row=saved.locator('tbody tr').first()
      const shot=async name=>{
        await page.waitForLoadState('networkidle');await page.evaluate(()=>document.fonts.ready)
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
        await saved.screenshot({path:join(process.env.STRAP_PROOF_DIR,`SCHED-013-${role}-${name}-${width}.png`)})
      }
      if(width===390) {
        const before=await h.state(),remaining=before.packs.find(p=>p.personId===member.id).remaining
        await row.getByText('Cancel appointment',{exact:true}).click()
        await row.getByLabel('Cancellation reason').fill('Member phoned to cancel')
        await row.locator('form').filter({has:page.getByRole('button',{name:'Preview appointment cancellation',exact:true})}).getByLabel('Request received by').selectOption('phone')
        await row.getByRole('button',{name:'Preview appointment cancellation',exact:true}).click()
        let preview=(await h.state(staff.cookie)).appointmentPreviews.filter(p=>p.reservationId===reservation.id&&p.operation==='cancel').at(-1)
        let review=page.locator(`[data-appointment-preview="${preview.id}"]`)
        assert.deepEqual(preview.occurrences.map(o=>o.bookingId),[reservation.occurrences[0].bookingId])
        await review.getByRole('button',{name:'Confirm appointment cancellation',exact:true}).click()
        assert.equal((await h.state()).packs.find(p=>p.personId===member.id).remaining,remaining+1)
        await shot('cancelled')
        await row.getByText('Restore appointment',{exact:true}).click()
        await row.getByLabel('Restoration reason').fill('Member phoned to restore')
        await row.getByLabel('Request received by').selectOption('phone')
        await row.getByRole('button',{name:'Preview appointment restoration',exact:true}).click()
        preview=(await h.state(staff.cookie)).appointmentPreviews.filter(p=>p.reservationId===reservation.id&&p.operation==='restore').at(-1)
        review=page.locator(`[data-appointment-preview="${preview.id}"]`)
        await review.getByRole('button',{name:'Confirm appointment restoration',exact:true}).click()
        const state=await h.state(),booking=state.bookings.find(b=>b.id===reservation.occurrences[0].bookingId)
        assert.equal(booking.status,'booked');assert.equal(booking.classId,reservation.occurrences[0].id)
        assert.equal(state.packs.find(p=>p.personId===member.id).remaining,remaining)
        const events=state.staffActions.filter(a=>a.after?.id===reservation.id)
        assert.equal(events.length,6,'four HTTP changes plus two phone-view changes, one canonical event each')
        assert.ok(events.every(a=>a.actorRole===role&&a.right==='booking'&&a.personId===member.id&&a.channel==='phone'))
        assert.equal((await h.state(member.cookie)).notices.filter(n=>n.appointmentReservationId===reservation.id).length,6)
      }
      await shot('restored')
    } finally {await context.close()}
  }} finally {await browser.close()}
}
