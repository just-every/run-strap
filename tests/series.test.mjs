import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'

const day = 86_400_000, plus = (date,n) => new Date(Date.parse(date+'T12:00:00Z')+n*day).toISOString().slice(0,10)
function dstDates() {
  let year = new Date().getUTCFullYear()
  for (;;) {
    const first = new Date(Date.UTC(year,10,1)), transition = new Date(first.getTime()+((7-first.getUTCDay())%7)*day).toISOString().slice(0,10)
    const start = plus(transition,-7)
    if (Date.parse(start) > Date.now()+day) return { start, end:plus(start,21) }
    year++
  }
}
const local = (at,zone='America/New_York') => new Intl.DateTimeFormat('en-GB',{timeZone:zone,hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).format(new Date(at))
const form = (h,name,fields) => h.mf.dispatchFetch(h.origin+`/app/action?name=${name}&returnTo=${encodeURIComponent('/app/classes#timetable')}`,{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields),redirect:'manual'})
async function refused(h,name,input,cookie,status=409,match) {
  const before = (await h.state()).version, r = await h.send('/api/strap/command',{name,input},cookie)
  assert.equal(r.status,status,r.value.error ?? r.value.type ?? String(r.status)); if (match) assert.match(r.value.error,match)
  assert.equal((await h.state()).version,before,'refused commands make no writes'); return r
}

test('SCHED-001: local-hour repeating timetable, exact occurrence/future changes, conflict fences and scoped once-only closure effects through HTTP',async () => {
  const mails = []
  await run(async h => {
    await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
    await h.cmd('studio.save',{location:'New York studio',timeZone:'America/New_York'})
    const coach = await h.person('Maya','instructor'), other = await h.person('Leo','instructor'), people = []
    for (const name of ['Ana','Ben','Cy','Dee']) {
      const p = await h.person(name); people.push(p)
      await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:p.id,credits:8,amountCents:16000,expiresAt:'2099-12-31T00:00:00Z'})).id})
    }
    const [ana,ben,cy,dee] = people, dates = dstDates()
    await h.cmd('spots.save',{room:'Main',spots:['Mat 1'],disabled:[]})
    await h.cmd('spots.save',{room:'Annex',spots:['A1','A2'],disabled:['A2']})
    const input = {startDate:dates.start,endDate:dates.end,time:'09:00',minutes:50,intervalWeeks:1,title:'Sunday Flow',service:'Yoga',room:'Main',equipment:['Shared speaker'],bufferBeforeMinutes:10,bufferAfterMinutes:10,capacity:1,onlineCapacity:1,instructorId:coach.id}
    await refused(h,'series.prepare',input,ana.cookie,403)
    await refused(h,'series.prepare',input,coach.cookie,403)
    const key = await h.cmd('agent.create',{label:'Timetable planner'})
    const agent = (name,input) => h.send('/api/strap/agent/command',{name,input},'',{authorization:`Bearer ${key.token}`})
    const prepared = await agent('series.prepare',input)
    assert.equal(prepared.status,200,JSON.stringify(prepared.value))
    const draft = prepared.value
    assert.equal((await h.state()).classes.length,0,'preparing publishes nothing')
    assert.equal((await agent('series.publish',{id:draft.id})).status,403)
    const published = await h.cmd('series.publish',{id:draft.id})
    const [c0,c1,c2,c3] = published.classes
    assert.equal(published.classes.length,4)
    assert.ok(published.classes.every(c => local(c.start)==='09:00'))
    assert.equal(Date.parse(c1.start)-Date.parse(c0.start),7*day+3_600_000,'DST retains wall hour, not UTC offset')
    assert.ok(published.classes.every(c => c.location==='New York studio' && c.instructorId===coach.id && c.room==='Main' && c.capacity===1))
    await refused(h,'series.publish',{id:draft.id},h.owner)
    await h.cmd('bookingRule.save',{service:'Yoga',closesMinutesBefore:30,cancelCutoffHours:720,lateCancelReturnsCredit:false,lateCancelFeeCents:900})
    const waiver = await h.cmd('waiver.publish',{text:'Review studio waiver before participating.'})
    await refused(h,'booking.book',{classId:c0.id},ana.cookie,409)
    for (const p of people) await h.cmd('waiver.acknowledge',{id:waiver.id},p.cookie)
    for (const [entry,p] of [[c0,ana],[c0,ben],[c1,ana],[c2,ben],[c3,cy]]) await h.cmd('booking.book',{classId:entry.id},p.cookie)
    const scheduled = (await h.state()).classes.find(c=>c.id===c0.id)
    assert.equal(Date.parse(scheduled.start)-Date.parse(scheduled.bookingWindow.closesAt),30*60_000,'recurring classes inherit service booking windows')
    const beforeMove = await h.state(), anaBooking = beforeMove.bookings.find(b => b.classId===c1.id)
    const change = {classId:c1.id,scope:'this',reason:'Teacher availability',change:{startDate:plus(plus(dates.start,7),1),time:'10:00',room:'Annex'}}
    const moved = await h.cmd('series.change.prepare',change)
    assert.deepEqual(moved.impact.classes.map(c=>c.classId),[c1.id])
    assert.deepEqual(moved.impact.classes[0].bookings.map(b=>[b.personId,b.previousSpot,b.spot]),[[ana.id,'Mat 1','A1']])
    assert.deepEqual([moved.impact.creditsChanged,moved.impact.moneyMoved,moved.impact.notices],[0,0,1])
    assert.equal((await h.state()).classes.find(c=>c.id===c1.id).start,c1.start)
    await refused(h,'series.change.approve',{id:moved.id,impact:moved.impact.key},coach.cookie,403)
    await h.cmd('series.change.approve',{id:moved.id,impact:moved.impact.key})
    await h.cmd('series.change.approve',{id:moved.id,impact:moved.impact.key})
    let s = await h.state()
    const movedClass = s.classes.find(c=>c.id===c1.id), movedBooking = s.bookings.find(b=>b.id===anaBooking.id)
    assert.equal(local(movedClass.start),'10:00'); assert.equal(movedBooking.spot,'A1')
    assert.equal(movedBooking.packId,anaBooking.packId); assert.deepEqual(movedBooking.cancelTerms,anaBooking.cancelTerms)
    assert.deepEqual(s.packs.map(p=>p.remaining),beforeMove.packs.map(p=>p.remaining))
    assert.equal(mails.length,1); assert.deepEqual(mails[0].to,['ana@studio.example'])
    assert.equal((await h.state(ben.cookie)).notices.length,0,'unaffected members receive no change notice')
    assert.equal((await h.state(ana.cookie)).notices[0].body,moved.impact.classes[0].bookings[0].body,'previewed message is the delivered in-app message')

    // An existing member change invalidates exact review; no partial class move.
    const future = {classId:c2.id,scope:'future',reason:'Evening schedule',change:{time:'17:00',instructorId:other.id}}
    const stale = await h.cmd('series.change.prepare',future)
    await h.cmd('booking.book',{classId:c2.id},dee.cookie)
    await refused(h,'series.change.approve',{id:stale.id,impact:stale.impact.key},h.owner,409,/series_impact_changed/)
    assert.equal((await h.state()).classes.find(c=>c.id===c2.id).start,c2.start)
    const ready = await h.cmd('series.change.prepare',future)
    // New resource exception after preparation is rechecked and its record named.
    const block = await h.cmd('scheduling.unavailable.save',{resourceKind:'equipment',resourceId:' SHARED  speaker ',start:ready.classes[0].start,end:ready.classes[0].end,reason:'Private maintenance detail'})
    const conflict = await refused(h,'series.change.approve',{id:ready.id,impact:ready.impact.key},h.owner,409,/Scheduling conflict/)
    assert.match(conflict.value.error,new RegExp(block.id))
    const agentConflict = await agent('series.change.prepare',future)
    assert.equal(agentConflict.status,409); assert.match(agentConflict.value.error,new RegExp(block.id)); assert.doesNotMatch(agentConflict.text,/Private maintenance detail/)
    await h.cmd('scheduling.unavailable.remove',{id:block.id})
    const refreshed = await h.cmd('series.change.prepare',future)
    assert.deepEqual(refreshed.impact.classes.map(c=>c.classId),[c2.id,c3.id])
    assert.deepEqual(new Set(refreshed.impact.classes.flatMap(c=>c.bookings.map(b=>b.personId))),new Set([ben.id,cy.id,dee.id]))
    const approvals = await Promise.all([1,2].map(() => h.send('/api/strap/command',{name:'series.change.approve',input:{id:refreshed.id,impact:refreshed.impact.key}},h.owner)))
    assert.ok(approvals.some(r=>r.status===200))
    assert.ok(approvals.every(r=>r.status===200 || (r.status===409 && r.value.error==='conflict_refresh_and_retry')))
    s = await h.state(); assert.deepEqual([c2,c3].map(c=>local(s.classes.find(x=>x.id===c.id).start)),['17:00','17:00'])
    assert.equal(mails.length,4,'one mail per affected booking, despite concurrent approvals')
    assert.equal(s.classes.find(c=>c.id===c0.id).start,c0.start)
    assert.equal(s.classes.find(c=>c.id===c1.id).start,movedClass.start,'one-session exception before the anchor survives')
    assert.equal(s.bookings.find(b=>b.classId===c2.id&&b.personId===dee.id).status,'waitlisted')

    // Invalid smaller capacity and a disabled spot cannot orphan reserved seats.
    await refused(h,'series.change.prepare',{classId:c2.id,scope:'this',reason:'Reduce online pool',change:{onlineCapacity:0}},h.owner,409,/series_capacity/)
    await refused(h,'spots.save',{room:'Main',spots:['Mat 1'],disabled:['Mat 1']},h.owner,409)
    // Every recurring-class cancellation door requires scope explicitly.
    await refused(h,'closure.prepare',{scope:'class',classId:c0.id,reason:'Holiday'},h.owner,400,/series_scope_required/)
    await refused(h,'series.cancel.prepare',{classId:c0.id,scope:'series',reason:'Holiday'},ana.cookie,403)
    assert.equal((await agent('series.cancel.prepare',{classId:c0.id,scope:'series',reason:'Holiday'})).status,403)
    const originalCredits = (await h.state()).packs.map(p=>p.remaining)
    const cancelled = await h.cmd('series.cancel.prepare',{classId:c0.id,scope:'this',reason:'Roof repair'})
    assert.deepEqual(cancelled.impact.classes.map(c=>c.classId),[c0.id]); assert.deepEqual([cancelled.impact.creditsReturned,cancelled.impact.waitlistClosed,cancelled.impact.emails],[1,1,2])
    assert.deepEqual((await h.state()).packs.map(p=>p.remaining),originalCredits)
    await h.cmd('series.cancel.confirm',{id:cancelled.id,impact:cancelled.impact.key})
    await h.cmd('series.cancel.confirm',{id:cancelled.id,impact:cancelled.impact.key})
    s = await h.state(); assert.equal(s.classes.find(c=>c.id===c0.id).status,'cancelled')
    assert.ok(s.bookings.filter(b=>b.classId===c0.id).every(b=>b.status==='cancelled'))
    assert.equal(s.packCreditEvents.filter(e=>e.classId===c0.id&&e.type==='restore').length,1)
    assert.equal(s.charges.filter(charge=>s.bookings.some(b=>b.classId===c0.id&&b.id===charge.bookingId)).length,0,'studio closure overrides member late-cancel penalties without collecting money')
    assert.equal(mails.length,6)
    const pending = await h.cmd('series.cancel.prepare',{classId:c2.id,scope:'future',reason:'Season break'})
    assert.deepEqual(pending.impact.classes.map(c=>c.classId),[c2.id,c3.id])
    // Another reservation makes even a cancellation preview stale.
    await h.cmd('booking.book',{classId:c3.id},ana.cookie)
    await refused(h,'series.cancel.confirm',{id:pending.id,impact:pending.impact.key},h.owner,409,/series_impact_changed/)
    const rest = await h.cmd('series.cancel.prepare',{classId:c2.id,scope:'future',reason:'Season break'})
    await h.cmd('series.cancel.confirm',{id:rest.id,impact:rest.impact.key})
    await h.cmd('series.cancel.confirm',{id:rest.id,impact:rest.impact.key})
    s = await h.state(); assert.equal(s.classes.find(c=>c.id===c1.id).status,'published')
    assert.equal(mails.length,10,'four distinct affected members get one closure mail each')
    const all = await h.cmd('closure.prepare',{classId:c1.id,scope:'class',seriesScope:'series',reason:'Series ended'})
    assert.deepEqual(all.impact.classes.map(c=>c.classId),[c1.id],'whole-series scope takes exactly the remaining open occurrences')
    await h.cmd('closure.confirm',{id:all.id,impact:all.impact.key})
    assert.ok((await h.state()).classes.every(c=>c.status==='cancelled'))
    await refused(h,'booking.book',{classId:c0.id},ben.cookie,409,/class_cancelled/)

    // A member booked on two occurrences gets one grouped cancellation email;
    // an unpaid seat returns zero credits and never invents a pack-credit notice.
    const extraInput = {...input,startDate:plus(dates.end,7),endDate:plus(dates.end,14),time:'11:00',room:'Unmapped',equipment:[],capacity:3,onlineCapacity:3}
    assert.equal((await form(h,'series.prepare',{...extraInput,equipment:''})).status,303)
    const extraDraft = (await h.state()).seriesChanges.find(d=>d.type==='series'&&d.status==='draft'&&d.rule.startDate===extraInput.startDate)
    const extra = await h.cmd('series.publish',{id:extraDraft.id})
    for (const c of extra.classes) await h.cmd('booking.book',{classId:c.id},ana.cookie)
    await h.cmd('booking.desk',{classId:extra.classes[0].id,personId:dee.id,pay:'unpaid',channel:'phone'})
    const grouped = await h.cmd('series.cancel.prepare',{classId:extra.classes[0].id,scope:'series',reason:'Studio closed'})
    assert.deepEqual([grouped.impact.creditsReturned,grouped.impact.waitlistClosed,grouped.impact.members,grouped.impact.emails],[2,0,2,2])
    const unpaid = grouped.impact.classes[0].bookings.find(b=>b.personId===dee.id); assert.equal(unpaid.creditReturned,false)
    const priorMails = mails.length
    await h.cmd('series.cancel.confirm',{id:grouped.id,impact:grouped.impact.key})
    await h.cmd('series.cancel.confirm',{id:grouped.id,impact:grouped.impact.key})
    assert.equal(mails.length-priorMails,2)
    const groupedMails = mails.slice(priorMails), letter = groupedMails.find(m=>m.to[0]===ana.email)
    assert.equal(letter.text.split('Your class credit is back').length-1,2)
    const unpaidLetter = groupedMails.find(m=>m.to[0]===dee.email)
    assert.match(unpaidLetter.text,/unpaid visit is closed; no credit was used/); assert.doesNotMatch(unpaidLetter.text,/credit is back in your pack/)
    s = await h.state()
    assert.equal(s.packCreditEvents.filter(e=>extra.classes.some(c=>c.id===e.classId)&&e.type==='restore').length,2)
    assert.equal(new Set(mails.map(m=>m.key)).size,mails.length,'each provider delivery has a stable distinct idempotency key')
    const ownerPage = await h.send('/app/classes',undefined,h.owner); assert.equal(ownerPage.status,200)
    const memberPage = await h.send('/app',undefined,ana.cookie); assert.equal(memberPage.status,200)
    const portable = await h.send('/api/strap/exit.json',undefined,h.owner)
    assert.equal(portable.status,200)
    assert.ok(portable.value.tables.st_records.some(r=>r.kind==='series'&&JSON.parse(r.data).id===published.series.id))
    assert.ok(portable.value.tables.st_records.some(r=>r.kind==='seriesCancellation'&&JSON.parse(r.data).id===grouped.id))
    const records = portable.value.tables.st_records.map(r=>({...r,data:JSON.parse(r.data)}))
    assert.ok(records.some(r=>r.kind==='class'&&r.data.seriesId===published.series.id))
    assert.ok(records.some(r=>r.kind==='draft'&&r.data.id===moved.id&&r.data.impact.classes[0].before.id===c1.id))
    assert.ok(records.some(r=>r.kind==='bookingAction'&&r.data.seriesChangeId===moved.id&&r.data.beforeClass.id===c1.id))
    assert.ok(records.some(r=>r.kind==='closure'&&r.data.id===grouped.closureId&&r.data.classIds.length===extra.classes.length))
    // A timetable edit cannot put a live claim deadline after its new start.
    const offeredInput = {...extraInput,startDate:plus(dates.end,21),endDate:plus(dates.end,21),room:'Offer room',capacity:1,onlineCapacity:1}
    const offeredSeries = await h.cmd('series.publish',{id:(await h.cmd('series.prepare',offeredInput)).id})
    const offeredClass = offeredSeries.classes[0]
    await h.cmd('waitlist.save',{mode:'offer',claimMinutes:60,lateWindow:'promote'})
    const booked = await h.cmd('booking.book',{classId:offeredClass.id},ana.cookie)
    const waiting = await h.cmd('booking.book',{classId:offeredClass.id},ben.cookie)
    await h.cmd('booking.cancel',{id:booked.id},ana.cookie)
    assert.equal((await h.state()).bookings.find(b=>b.id===waiting.id).status,'offered')
    const sooner = new Date(Date.now()+15*60_000).toISOString()
    const date = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date(sooner))
    await refused(h,'series.change.prepare',{classId:offeredClass.id,scope:'this',reason:'Earlier session',change:{startDate:date,time:local(sooner)}},h.owner,409,/series_offer_deadline_after_start/)
    if (process.env.STRAP_PROOF_DIR) await (await import('./series-browser.mjs')).seriesBrowser(h,{coach,member:ana,startDate:plus(dates.end,35)})
  },{auth:{MAIL_PROVIDER:'resend',MAIL_API_KEY:'test-only-key'},outbound:async request=>{
    assert.equal(request.url,'https://api.resend.com/emails'); const message = {...await request.json(),key:request.headers.get('idempotency-key')}; mails.push(message); return Response.json({id:`series_${mails.length}`})
  }})
})
