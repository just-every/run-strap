import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'
import { assertReportDownloads, assertCancellationDownload } from './report-downloads.mjs'

const hour = 3_600_000
const monday = start => { const d = new Date(start); return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7)).toISOString().slice(0,10) }

test('RPT-002 / RPT-006: attendance, usable-seat occupancy and historical member/staff cancellations drill to their public source records', () => run(async h => {
  await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
  await h.cmd('studio.save',{location:'Nashville',timeZone:'America/Chicago'})
  const coach = await h.person('Maya','instructor'), other = await h.person('Rae','instructor'), people = {}
  for (const name of ['Ana','Ben','Cy','Dee','Eli']) {
    people[name] = await h.person(name)
    await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:people[name].id,credits:10,amountCents:20000,expiresAt:'2099-12-31T00:00:00Z'})).id})
  }
  const {Ana,Ben,Cy,Dee,Eli} = people
  await h.cmd('spots.save',{room:'Reformer room',spots:['R1','R2','R3'],disabled:['R3']})
  await h.cmd('bookingRule.save',{cancelCutoffHours:12,lateCancelReturnsCredit:true,lateCancelFeeCents:1500,noShowFeeCents:700})
  const start = new Date(Date.now()+20_000).toISOString()
  const publish = async (title,offset,room,instructorId=coach.id,service='Reformer') => {
    const date = new Date(Date.parse(start)+offset).toISOString()
    return (await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:monday(date),classes:[{title,service,start:date,end:new Date(Date.parse(date)+30*60_000).toISOString(),capacity:3,onlineCapacity:room==='Reformer room'?1:3,room,instructorId}]})).id})).classes[0]
  }
  const flow = await publish('Reformer Flow',0,'Reformer room')
  const later = await publish('Reformer Later',2*hour,'Studio B'), closed = await publish('Holiday Flow',4*hour,'Studio C'), mat = await publish('Mat Flow',6*hour,'Mat room',other.id,'Mat')
  const a = await h.cmd('booking.book',{classId:flow.id},Ana.cookie)
  const b = await h.cmd('booking.desk',{classId:flow.id,personId:Ben.id,channel:'phone'})
  const waiter = await h.cmd('booking.book',{classId:flow.id},Cy.cookie)
  assert.equal(waiter.status,'waitlisted')
  await h.cmd('attendance.checkin',{id:a.id},coach.cookie)
  const d = await h.cmd('booking.book',{classId:later.id},Dee.cookie)
  const e = await h.cmd('booking.book',{classId:later.id},Eli.cookie)
  await h.cmd('booking.book',{classId:mat.id},Ana.cookie)
  await h.cmd('attendance.checkin',{id:(await h.state()).bookings.find(v=>v.classId===mat.id).id},other.cookie)
  const terms = (await h.state(Dee.cookie)).bookings.find(v=>v.id===d.id).cancelEffect.key
  await h.cmd('booking.cancel',{id:d.id,terms},Dee.cookie)
  await h.cmd('booking.restore',{id:d.id,reason:'Cancelled wrong session',channel:'phone'})
  const effect = (await h.state()).bookings.find(v=>v.id===e.id).cancelEffect.key
  await h.cmd('booking.cancel',{id:e.id,terms:effect,mode:'early',cancelReason:'Sick',reason:'Called the desk',channel:'desk'})
  const closure = await h.cmd('closure.prepare',{scope:'class',classId:closed.id,reason:'Holiday'})
  await h.cmd('closure.confirm',{id:closure.id,impact:closure.impact.key})
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(flow.start)-Date.now()+30)))
  await h.cmd('attendance.noshow',{id:b.id},coach.cookie)
  const read = async query => {
    const r = await h.send('/api/strap/reports/attendance'+(query?'?'+query:''),undefined,h.owner)
    assert.equal(r.status,200,r.text); return r.value
  }
  const report = await read(''), state = await h.state(), row = report.rows.find(v=>v.classId===flow.id)
  assert.deepEqual([row.configuredSeats,row.disabledSpots,row.usableSeats,row.onlineSeats,row.heldSeats,row.occupiedSeats,row.occupancyPercent],[3,1,2,1,1,2,100])
  assert.deepEqual([row.booked,row.waitlisted,row.attended,row.noShow,row.uniqueVisitors],[2,1,1,1,1])
  assert.deepEqual(new Set(row.bookingIds),new Set([a.id,b.id,waiter.id]))
  const second = report.rows.find(v=>v.classId===later.id), cancellationActions = state.bookingActions.filter(v=>v.classId===later.id&&v.action==='cancel')
  assert.deepEqual([second.earlyCancelled,second.lateCancelled,second.memberCancelled,second.staffCancelled],[1,1,1,1])
  assert.deepEqual([second.memberEarlyCancelled,second.memberLateCancelled,second.staffEarlyCancelled,second.staffLateCancelled],[0,1,1,0])
  assert.deepEqual(new Set(second.cancellationIds),new Set(cancellationActions.map(v=>v.id)))
  assert.equal(cancellationActions.find(v=>v.bookingId===d.id).restoredAt!==null,true,'restoration retains the single historical late action')
  assert.deepEqual([report.totals.uniqueVisitors,report.totals.attended,report.totals.noShow],[1,2,1],'one visitor attends two classes')
  assert.deepEqual([report.totals.usableSeats,report.totals.occupiedSeats,report.totals.occupancyPercent],[8,4,50])
  assert.equal(report.rows.find(v=>v.classId===closed.id).usableSeats,0)
  assert.equal(report.rows.find(v=>v.classId===closed.id).occupancyPercent,null)
  assert.equal(report.totals.cancelledClasses,1)
  assert.equal(report.inventory.aggregatorSeats,0)
  // Every filter acts on the same class set returned by the public report.
  const day = row.date
  for (const query of [`from=${day}&to=${day}&time=${encodeURIComponent(row.time)}`,`room=${encodeURIComponent('  reformer ROOM ')}`,`instructorId=${coach.id}&service=Reformer&location=Nashville`]) {
    const filtered = await read(query)
    const expected = query.startsWith('instructorId') ? [flow.id,later.id,closed.id] : [flow.id]
    assert.deepEqual(filtered.rows.map(v=>v.classId),expected)
  }
  assert.equal((await read('location=Elsewhere')).rows.length,0)
  assert.equal((await read('room=Missing')).totals.occupancyPercent,null)
  for (const query of ['from=2026-02-30','from=2099-01-02&to=2099-01-01','time=24:00']) assert.equal((await h.send('/api/strap/reports/attendance?'+query,undefined,h.owner)).status,400)
  for (const cookie of [Ana.cookie,coach.cookie]) {
    assert.equal((await h.send('/api/strap/reports/attendance',undefined,cookie)).status,403)
    assert.equal((await h.send('/app/reports',undefined,cookie)).status,403)
  }
  for (const r of report.rows) {
    assert.equal((await h.send(r.rosterUrl,undefined,h.owner)).status,200)
    const cancelPage = await h.send(r.cancellationsUrl,undefined,h.owner)
    assert.equal(cancelPage.status,200)
    for (const action of cancellationActions.filter(v=>v.classId===r.classId)) assert.ok(cancelPage.text.includes(action.reason))
    for (const id of r.bookingIds) assert.ok(state.bookings.some(v=>v.id===id&&v.classId===r.classId))
  }
  const page = await h.send('/app/reports',undefined,h.owner)
  assert.equal(page.status,200)
  assert.ok(page.text.includes(`data-class-id="${flow.id}"`))
  await assertReportDownloads(h,'attendance',['',`from=${day.slice(0,7)}-01&to=${day.slice(0,7)}-28`,`room=Reformer+room`,`instructorId=${coach.id}&service=Reformer&location=Nashville`,`time=${encodeURIComponent(row.time)}`,'location=Elsewhere','from=2099-01-01&to=2099-01-31'],[Ana.cookie,coach.cookie,''])
  await assertCancellationDownload(h,['',`classId=${later.id}`,`date=${day}`,`staffId=${state.actor.id}`,'type=early','type=late','classId=missing'],[Ana.cookie,coach.cookie,''])
  if (process.env.STRAP_PROOF_DIR) await (await import('./reports-browser.mjs')).reportsBrowser(h,{flow,later,report})
  await h.cmd('attendance.correct',{id:b.id,outcome:'attended',reason:'The instructor confirmed Ben attended'})
  const revenue = await h.send('/api/strap/reports/revenue',undefined,h.owner)
  assert.equal(revenue.status,200)
  assert.ok(revenue.value.sources.some(r=>r.record.reason==='fee_reversal' && r.record.amountCents===-700),'RPT-001: corrected no-show fee remains a signed ledger reversal')
  const corrected = await read('')
  assert.deepEqual([corrected.totals.attended,corrected.totals.noShow,corrected.totals.uniqueVisitors,corrected.totals.lateCancelled],[3,0,2,1])
}))

test('RPT-001 / RPT-006: current sales, collections, refunds, fee reversals and member snapshots reconcile to public ledgers with plan, period and location filters and exact source drill-through', () => run(async h => {
  await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
  await h.cmd('studio.save',{location:'Brooklyn studio',timeZone:'America/New_York'})
  const coach = await h.person('Maya','instructor'), ana = await h.person('Ana'), ben = await h.person('Ben'), cy = await h.person('Cy')
  const buy = async (p,amountCents,extra={}) => h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:p.id,credits:10,amountCents,expiresAt:'2099-12-31T00:00:00Z',...extra})).id})
  const pack = await buy(ana,20000), second = await buy(ben,15000,{kind:'unlimited',credits:undefined,planName:'Monthly mat'})
  await buy(cy,5000)
  await h.cmd('pack.prepare',{personId:ana.id,credits:100,amountCents:99999,expiresAt:'2099-12-31T00:00:00Z'}) // unapproved draft is not a purchase
  await h.cmd('payment.record',{personId:ana.id,amountCents:20000,reference:'bank-transfer-ana'})
  await h.cmd('payment.record',{personId:cy.id,amountCents:6000,reference:'cash-cy'})
  await h.cmd('bookingRule.save',{cancelCutoffHours:100,lateCancelReturnsCredit:false,lateCancelFeeCents:1500})
  const start = new Date(Date.now()+48*hour).toISOString()
  const flow = (await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:monday(start),classes:[{title:'Morning Mat',service:'Mat',start,end:new Date(Date.parse(start)+hour).toISOString(),capacity:6,instructorId:coach.id}]})).id})).classes[0]
  const first = await h.cmd('booking.book',{classId:flow.id},ana.cookie)
  const cancel = async (booking,p) => {
    const terms = (await h.state(p.cookie)).bookings.find(b=>b.id===booking.id).cancelEffect.key
    return h.cmd('booking.cancel',{id:booking.id,terms},p.cookie)
  }
  await cancel(first,ana)
  const fee = (await h.state()).fees.find(f=>f.bookingId===first.id)
  await h.cmd('fee.collect',{id:fee.id,reference:'cash-fee-ana',channel:'desk',requestId:'fee-receipt'})
  await h.cmd('attendance.correct',{id:first.id,outcome:'early_cancel',reason:'Fee was assessed in error',refundReference:'cash-refund-ana'})
  const other = await h.cmd('booking.book',{classId:flow.id},ben.cookie)
  await cancel(other,ben)
  // A second fee stays assessed, distinguishing collections from assessments.
  const preview = await h.cmd('plan.change.prepare',{packId:pack.id,mode:'now',credits:8,amountCents:10000,effectiveAt:new Date(Math.ceil((Date.now()+3000)/1000)*1000).toISOString(),exceptionReason:'Agreed smaller pack',requestId:'downsize'})
  await h.cmd('plan.change.accept',{id:preview.id,key:preview.key},ana.cookie)
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(preview.effectiveAt)-Date.now()+30)))
  await h.cmd('studio.save',{location:'Brooklyn studio',timeZone:'America/New_York'}) // ordinary command applies due change
  const read = async (query='') => {
    const r = await h.send('/api/strap/reports/revenue'+(query?'?'+query:''),undefined,h.owner)
    assert.equal(r.status,200,r.text); return r.value
  }
  const state = await h.state(), report = await read(), t = report.totals
  const feeReasons = ['late_cancel_fee','no_show_fee','late_move_fee','fee_reversal']
  const sales = state.charges.filter(c=>!feeReasons.includes(c.reason)), fees = state.charges.filter(c=>feeReasons.includes(c.reason))
  const sum = rows => rows.reduce((n,r)=>n+r.amountCents,0)
  assert.equal(t.grossSalesCents,40000)
  assert.equal(t.salesCreditsCents,preview.chargeCents)
  assert.equal(t.netSalesCents,sum(sales)); assert.equal(t.feesCents,sum(fees)); assert.equal(t.feesCents,1500)
  assert.equal(t.assessedCents,sum(state.charges))
  assert.equal(t.collectionsCents,27500); assert.equal(t.refundsCents,1500)
  assert.equal(t.netCollectionsCents,sum(state.payments)); assert.equal(t.netCollectionsCents,26000)
  assert.equal(t.newPlans,3); assert.equal(t.bookingCancellations,2); assert.equal(t.activeMembers,3)
  assert.equal(t.outstandingCents,16500)
  assert.equal(t.memberCreditCents,1000-preview.chargeCents)
  for (const key of ['overdueCents','membershipCancellations','returnedAchCents','processorFeesCents']) assert.equal(t[key],null)
  assert.deepEqual(new Set(report.sources.filter(r=>['sale','fee'].includes(r.kind)).map(r=>r.id)),new Set(state.charges.map(r=>r.id)))
  assert.deepEqual(new Set(report.sources.filter(r=>['receipt','refund'].includes(r.kind)).map(r=>r.id)),new Set(state.payments.map(r=>r.id)))
  for (const row of report.sources) {
    const source = await h.send(row.sourceUrl,undefined,h.owner)
    assert.equal(source.status,200); assert.ok(source.text.includes(row.id))
    const detail = await read('sourceId='+encodeURIComponent(row.id))
    assert.deepEqual(detail.selectedSource.record,row.record)
    if (row.amountCents !== null) assert.equal(row.record.amountCents,row.amountCents)
    assert.equal((await h.send(row.memberUrl,undefined,h.owner)).status,200)
  }
  for (const row of report.balanceRows) {
    const ledger = [...state.charges,...state.payments].filter(r=>r.personId===row.personId)
    assert.deepEqual(new Set(row.sourceIds),new Set(ledger.map(r=>r.id)))
    assert.equal(row.balanceCents,sum(state.charges.filter(r=>r.personId===row.personId))-sum(state.payments.filter(r=>r.personId===row.personId)))
  }
  const date = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date())
  const period = await read(`from=${date}&to=${date}&location=${encodeURIComponent('Brooklyn studio')}`)
  assert.deepEqual(period.totals,t)
  assert.ok(period.sources.every(r=>r.date===date))
  assert.equal((await read('from=2099-01-01&to=2099-01-31')).sources.length,0)
  assert.equal((await read('location=Elsewhere')).sources.length,0)
  assert.equal((await read('location=Elsewhere')).totals.activeMembers,0)
  const filtered = await read('plan='+encodeURIComponent('unlimited: Monthly mat'))
  assert.equal(filtered.totals.newPlans,1); assert.equal(filtered.totals.netSalesCents,15000); assert.equal(filtered.totals.feesCents,1500)
  assert.equal(filtered.totals.collectionsCents,0); assert.equal(filtered.totals.outstandingCents,null)
  const unallocated = await read('plan=Unallocated')
  assert.equal(unallocated.totals.collectionsCents,26000); assert.equal(unallocated.totals.netSalesCents,0)
  for (const query of ['from=2026-02-30','from=2026-11-02&to=2026-11-01']) assert.equal((await h.send('/api/strap/reports/revenue?'+query,undefined,h.owner)).status,400)
  const version = state.version
  for (const cookie of [ana.cookie,coach.cookie,'']) {
    for (const path of ['/api/strap/reports/revenue','/app/revenue','/app/revenue?sourceId='+fee.id]) {
      const r = await h.send(path,undefined,cookie)
      assert.equal(r.status,cookie ? 403 : path.startsWith('/app/') ? 303 : 401)
      if (r.status===303) assert.equal(r.headers.get('location'),'/signin?returnTo=%2Fapp%2Frevenue')
    }
  }
  const agent = await h.cmd('agent.create',{label:'Report preparation'})
  for (const path of ['/api/strap/reports/revenue','/api/strap/reports/revenue.csv','/api/strap/reports/revenue.xlsx','/api/strap/reports/attendance.xlsx','/api/strap/cancellations.xlsx']) assert.equal((await h.send(path,undefined,'',{authorization:`Bearer ${agent.token}`})).status,401)
  // Repeated reads never change the ledger or replay any money effect.
  assert.equal((await h.state()).version,version)
  assert.deepEqual((await read()).totals,t)
  await assertReportDownloads(h,'revenue',['',`from=${date.slice(0,7)}-01&to=${date.slice(0,7)}-28&location=Brooklyn+studio`,'plan='+encodeURIComponent('unlimited: Monthly mat'),'plan=Unallocated','location=Elsewhere','from=2099-01-01&to=2099-01-31'],[ana.cookie,coach.cookie,''])
  if (process.env.STRAP_PROOF_DIR) await (await import('./revenue-browser.mjs')).revenueBrowser(h,{report,ana,coach,date})
  await h.cmd('person.save',{id:cy.id,name:'Cy',email:cy.email,role:'member',active:false,version:state.people.find(p=>p.id===cy.id).version})
  assert.equal((await read()).totals.activeMembers,2)
}))

test('RPT-007: finite-pack expiry and low-credit screen/HTTP worklist, matching CSV, corrected visits and once-only assigned lead follow-up; other plan kinds remain partial', () => run(async h => {
  await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
  const ana = await h.person('RenewAna'), ben = await h.person('RenewBen'), coach = await h.person('RenewCoach','instructor')
  const day = 86_400_000, base = Date.now()
  const buy = async (p,days,credits=5,extra={}) => h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:p.id,credits,amountCents:10000,expiresAt:new Date(base+days*day).toISOString(),...extra})).id})
  const soon = await buy(ana,20), far = await buy(ana,40), low = await buy(ben,40,1), both = await buy(ana,7,1)
  const unlimited = await buy(ben,5,undefined,{kind:'unlimited',planName:'Unlimited',credits:undefined})
  const expired = await buy(ben,5)
  let pack = (await h.state()).packs.find(p=>p.id===expired.id)
  await h.cmd('pack.adjust',{id:pack.id,revision:pack.creditRevision,creditsDelta:0,expiresAt:'2020-01-01T00:00:00Z',reason:'Corrected expiration',requestId:'expired-renewal-fixture'})
  const read = async (query='') => {
    const response = await h.send('/api/strap/reports/renewals'+(query?'?'+query:''),undefined,h.owner)
    assert.equal(response.status,200,response.text); assert.equal(response.headers.get('cache-control'),'no-store'); return response.value
  }
  let report = await read()
  assert.deepEqual(new Set(report.rows.map(r=>r.packId)),new Set([soon.id,low.id,both.id]))
  assert.equal(report.rows.filter(r=>r.packId===both.id).length,1)
  assert.deepEqual(report.rows.find(r=>r.packId===both.id).reasons,['expiring','low-credits'])
  assert.deepEqual(report.rows.find(r=>r.packId===low.id).reasons,['low-credits'])
  for (const row of report.rows) {
    assert.equal(row.remainingValueCents,null); assert.equal(row.contactPermission,'unavailable'); assert.equal(row.lastVisit,null)
    assert.equal(row.expiresAt,(await h.state()).packs.find(p=>p.id===row.packId).expiresAt)
  }
  assert.equal(Date.parse(report.through)-Date.parse(report.asOf),30*day)
  assert.deepEqual(new Set((await read('days=45&lowCredits=0')).rows.map(r=>r.packId)),new Set([soon.id,far.id,low.id,both.id]))
  assert.deepEqual((await read('days=1&lowCredits=0')).rows,[])
  for (const query of ['days=0','days=367','days=1.5','days=','days=-1','days=NaN','lowCredits=-1','lowCredits=10001','lowCredits=1.1']) {
    assert.equal((await h.send('/api/strap/reports/renewals?'+query,undefined,h.owner)).status,400)
    assert.equal((await h.send('/api/strap/reports/renewals.csv?'+query,undefined,h.owner)).status,400)
    assert.equal((await h.send('/app/renewals?'+query,undefined,h.owner)).status,400)
  }
  const before = await h.state(), ownerId = before.actor.id
  const dueAt = new Date(Date.now()+day).toISOString(), task = {packId:soon.id,basis:report.rows.find(r=>r.packId===soon.id).basis,ownerId,nextAction:'Review renewal options internally',dueAt}
  // A stale row may not create work based on obsolete source facts.
  await h.cmd('studio.save',{location:'Brooklyn',timeZone:'America/New_York'})
  await h.cmd('renewal.followup.create',task,h.owner,409)
  assert.equal((await h.state()).pipeline.leads.length,before.pipeline.leads.length)
  report = await read(); task.basis=report.rows.find(r=>r.packId===soon.id).basis
  await h.cmd('renewal.followup.create',{...task,ownerId:coach.id},h.owner,409)
  assert.equal((await h.state()).pipeline.leads.length,before.pipeline.leads.length,'a non-owner assignee cannot receive a private renewal task')
  const assigned = await h.cmd('renewal.followup.create',task)
  assert.deepEqual(await h.cmd('renewal.followup.create',task),assigned)
  await h.cmd('renewal.followup.create',{...task,ownerId:coach.id},h.owner,409)
  await h.cmd('renewal.followup.create',{...task,nextAction:'Changed request'},h.owner,409)
  const after = await h.state(), lead = after.pipeline.leads.find(l=>l.id===assigned.leadId)
  assert.equal(after.pipeline.leads.length,before.pipeline.leads.length+1)
  assert.deepEqual([lead.personId,lead.ownerId,lead.nextAction,lead.dueAt],[ana.id,ownerId,task.nextAction,dueAt])
  assert.equal(after.pipeline.events.filter(e=>e.leadId===lead.id).length,1)
  assert.deepEqual([after.charges.length,after.payments.length,after.staffNotices.length,after.noticeDeliveries.length],[before.charges.length,before.payments.length,before.staffNotices.length,before.noticeDeliveries.length],'an internal follow-up sends nothing and changes no money')
  report = await read()
  assert.equal(report.rows.find(r=>r.packId===soon.id).followup.leadId,lead.id)
  const csv = await h.send('/api/strap/reports/renewals.csv',undefined,h.owner)
  assert.equal(csv.status,200); assert.match(csv.headers.get('content-type'),/^text\/csv/)
  assert.equal(csv.headers.get('cache-control'),'no-store')
  // Parse the actual download independently; JSON-valued CSV cells retain typed values.
  const parse = text => text.trimEnd().split('\r\n').map(line=>[...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(m=>m[1].replaceAll('""','"')))
  const [columns,...data] = parse(csv.text)
  assert.deepEqual(data.map(values=>Object.fromEntries(columns.map((key,i)=>[key,JSON.parse(values[i])]))),report.rows.map(({basis,...row})=>row))
  for (const cookie of [ana.cookie,coach.cookie,'']) {
    const status=cookie ? 403 : 401
    for (const path of ['/api/strap/reports/renewals','/api/strap/reports/renewals.csv','/app/renewals']) assert.equal((await h.send(path,undefined,cookie)).status,!cookie && path.startsWith('/app/') ? 303 : status)
    await h.cmd('renewal.followup.create',task,cookie,status)
  }
  const agent = await h.cmd('agent.create',{label:'Renewal reader denied'})
  for (const path of ['/api/strap/reports/renewals','/api/strap/reports/renewals.csv']) assert.equal((await h.send(path,undefined,'',{authorization:`Bearer ${agent.token}`})).status,401)
  assert.equal((await h.send('/api/strap/agent/command',{name:'renewal.followup.create',input:task},'',{authorization:`Bearer ${agent.token}`})).status,403)
  const screen = await h.send('/app/renewals?days=45&lowCredits=0',undefined,h.owner)
  assert.equal(screen.status,200)
  assert.deepEqual([...screen.text.matchAll(/data-pack-id="([^"]+)"/g)].map(m=>m[1]),(await read('days=45&lowCredits=0')).rows.map(r=>r.packId))
  const preview = await h.cmd('plan.change.prepare',{packId:soon.id,mode:'renewal',credits:5,amountCents:10000,expiresAt:new Date(base+60*day).toISOString(),requestId:'renew-worklist'})
  assert.ok((await read()).rows.some(r=>r.packId===soon.id),'a preview alone is not a renewal')
  await h.cmd('plan.change.accept',{id:preview.id,key:preview.key},ana.cookie)
  assert.ok(!(await read()).rows.some(r=>r.packId===soon.id),'member-accepted renewal removes its source pack')
  assert.ok(!(await h.send('/app/renewals',undefined,h.owner)).text.includes('data-pack-id="'+soon.id+'"'),'accepted renewal leaves the screen')
  assert.ok(!(await h.send('/api/strap/reports/renewals.csv',undefined,h.owner)).text.includes(soon.id),'accepted renewal leaves the CSV')
  const stale = (await read()).rows.find(r=>r.packId===low.id)
  await h.cmd('renewal.followup.create',{...task,packId:soon.id,basis:stale.basis},h.owner,200) // prior task remains one even after renewal
  const version = (await h.state()).version
  await h.cmd('renewal.followup.create',{...task,packId:far.id,basis:stale.basis},h.owner,409)
  assert.equal((await h.state()).version,version)
  if (process.env.STRAP_PROOF_DIR || process.env.CI) {
    const taskMembers = [await h.person('JordanLane'),await h.person('AveryChen')]
    for (const [member,name] of [[ana,'Ana Lopez'],[ben,'Ben Walker'],[taskMembers[0],'Jordan Lane'],[taskMembers[1],'Avery Chen']]) await h.cmd('person.save',{id:member.id,name,email:member.email,role:'member',active:true})
    const packs = []; for (const member of taskMembers) packs.push({...await buy(member,20,1,{planName:'Mat five-class pack'}),personId:member.id})
    await (await import('./renewals-browser.mjs')).renewalsBrowser(h,{packs})
  }
  // Corrected attendance alone controls the last-visit field; future check-in is not a past visit.
  const cy = await h.person('RenewCy'), cyPack = await buy(cy,40,1)
  const start = new Date(Date.now()+2500).toISOString()
  const session = (await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:monday(start),classes:[{title:'Renewal visit',start,end:new Date(Date.parse(start)+60000).toISOString(),capacity:2,instructorId:coach.id}]})).id})).classes[0]
  const booking = await h.cmd('booking.book',{classId:session.id},ben.cookie)
  const cyBooking = await h.cmd('booking.book',{classId:session.id},cy.cookie)
  await h.cmd('attendance.checkin',{id:booking.id},coach.cookie)
  assert.equal((await read()).rows.find(r=>r.packId===low.id).lastVisit,null)
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(start)-Date.now()+30)))
  assert.equal((await read()).rows.find(r=>r.packId===low.id).lastVisit,start)
  await h.cmd('attendance.noshow',{id:cyBooking.id},coach.cookie)
  assert.equal((await read()).rows.find(r=>r.packId===cyPack.id).lastVisit,null,'a no-show is not a visit')
  await h.cmd('attendance.correct',{id:cyBooking.id,outcome:'attended',reason:'Instructor confirmed attendance'})
  assert.equal((await read()).rows.find(r=>r.packId===cyPack.id).lastVisit,start,'corrected attendance becomes the authoritative last visit')

}))

test('RPT-003: native finite-pack acquisition cohorts reconcile applied, scheduled, failed and absent renewals to exact pack/change/charge evidence through owner HTTP and matching CSV', () => run(async h => {
  await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
  await h.cmd('studio.save',{location:'Brooklyn studio',timeZone:'America/New_York'})
  const ana = await h.person('CohortAna'), ben = await h.person('CohortBen'), cy = await h.person('CohortCy'), dax = await h.person('CohortDax'), coach = await h.person('CohortCoach','instructor')
  const base = Date.now(), expiry = new Date(base+12_000).toISOString(), later = new Date(base+86400_000).toISOString()
  const buy = async (member,expiresAt,planName='Mat five',extra={}) => h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:5,amountCents:10000,expiresAt,planName,...extra})).id})
  const first = await buy(ana,expiry), second = await buy(ana,later,'Different later offer'), unrenewed = await buy(ben,later,'Mat five'), failedPack = await buy(dax,expiry,'Failed renewal')
  await buy(cy,later,'Unlimited',{kind:'unlimited',credits:undefined})
  await h.cmd('pack.prepare',{personId:cy.id,credits:99,amountCents:99999,expiresAt:later,planName:'Draft only'})
  const renew = async (member,pack) => {
    const preview = await h.cmd('plan.change.prepare',{packId:pack.id,mode:'renewal',credits:5,amountCents:12000,expiresAt:new Date(base+2*86400_000).toISOString(),requestId:'cohort-'+pack.id})
    await h.cmd('plan.change.accept',{id:preview.id,key:preview.key},member.cookie)
    return preview
  }
  const applied = await renew(ana,first), scheduled = await renew(ana,second), failed = await renew(dax,failedPack)
  const expire = async pack => {
    const current = (await h.state()).packs.find(row=>row.id===pack.id)
    await h.cmd('pack.adjust',{id:pack.id,revision:current.creditRevision,creditsDelta:0,expiresAt:'2020-01-01T00:00:00Z',reason:'Corrected original expiration',requestId:'expired-'+pack.id})
  }
  const unaccepted = await h.cmd('plan.change.prepare',{packId:unrenewed.id,mode:'renewal',credits:5,amountCents:12000,expiresAt:new Date(base+2*86400_000).toISOString(),requestId:'unaccepted-cohort'})
  const future = (await h.send('/api/strap/reports/retention',undefined,h.owner)).value
  assert.ok(future.cohorts.every(cohort=>cohort.completedTerms===0&&cohort.renewalRatePercent===null),'RPT-003: no completed terms means an unavailable rate, never zero')
  assert.equal(future.rows.find(row=>row.packId===unrenewed.id).renewalStatus,'not-recorded','RPT-003: an unaccepted preview is not a renewal')
  const anotherExpired = await buy(ben,later,'Mat five')
  await expire(unrenewed); await expire(anotherExpired); await expire(failedPack)
  // A recorded receipt is deliberately unallocated; it cannot prove renewal collection.
  await h.cmd('payment.record',{personId:ana.id,amountCents:10000,reference:'unallocated-cohort-receipt'})
  const path = '/api/strap/reports/retention'
  const read = async (query='') => {
    const response = await h.send(path+(query?'?'+query:''),undefined,h.owner)
    assert.equal(response.status,200,response.text); assert.equal(response.headers.get('cache-control'),'no-store'); return response.value
  }
  let report = await read()
  assert.deepEqual(report.rows.filter(row=>row.personId===ana.id).map(row=>row.renewalStatus),['scheduled','scheduled'])
  assert.ok(report.cohorts.every(cohort=>cohort.renewedTerms===0),'acceptance before the effective date is not applied renewal')
  const futureOnly = await read('offer=Different+later+offer')
  assert.deepEqual(futureOnly.rows,[],'a later offer does not create a second acquisition cohort')
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(expiry)-Date.now()+40)))
  await h.cmd('studio.save',{location:'Brooklyn studio',timeZone:'America/New_York'}) // ordinary public command applies due renewals
  const state = await h.state(), version = state.version
  report = await read()
  const row = report.rows.find(row=>row.packId===first.id), successor = state.packs.find(pack=>pack.renewedFromPackId===first.id)
  assert.ok(successor)
  assert.deepEqual([row.completed,row.renewalStatus,row.renewalChangeId,row.successorPackId],[true,'applied',applied.id,successor.id])
  assert.deepEqual(row.renewalAttemptIds,[applied.id])
  const successorRow = report.rows.find(row=>row.packId===successor.id)
  assert.deepEqual([successorRow.firstPackId,successorRow.initialOffer],[first.id,'Mat five'])
  assert.equal(report.rows.find(row=>row.packId===second.id).renewalChangeId,scheduled.id)
  assert.equal(report.rows.find(row=>row.packId===second.id).renewalStatus,'scheduled')
  assert.deepEqual(report.rows.find(row=>row.packId===unrenewed.id).renewalAttemptIds,[unaccepted.id])
  assert.equal(state.planChanges.changes.find(change=>change.id===failed.id).status,'failed')
  assert.equal(report.rows.find(row=>row.packId===failedPack.id).renewalStatus,'expired-without-linked-renewal')
  assert.deepEqual(report.rows.find(row=>row.packId===failedPack.id).renewalAttemptIds,[failed.id])
  const mat = report.cohorts.find(cohort=>cohort.initialOffer==='Mat five')
  assert.deepEqual([mat.members,mat.terms,mat.completedTerms,mat.renewedTerms,mat.scheduledRenewals,mat.expiredWithoutLinkedRenewal,mat.renewalRatePercent],[2,5,3,1,1,2,33.33])
  const localMonth = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(state.packs.find(pack=>pack.id===first.id).createdAt)).slice(0,7)
  assert.equal(mat.acquisitionMonth,localMonth)
  assert.deepEqual(new Set(report.rows.map(row=>row.packId)),new Set([first.id,second.id,unrenewed.id,anotherExpired.id,failedPack.id,successor.id]))
  for (const item of report.rows) {
    assert.equal(item.collectedRenewalCents,null); assert.equal(item.paymentIds,null)
    const charges = state.charges.filter(charge=>charge.packId===item.packId)
    assert.deepEqual(item.chargeIds,charges.map(charge=>charge.id))
    assert.equal(item.assessedCents,charges.reduce((sum,charge)=>sum+charge.amountCents,0))
    const packPage = await h.send(item.packUrl,undefined,h.owner)
    assert.equal(packPage.status,200); assert.ok(packPage.text.includes('id="pack-'+item.packId+'"'))
    if (item.renewalUrl) {
      const page = await h.send(item.renewalUrl,undefined,h.owner)
      assert.equal(page.status,200); assert.ok(page.text.includes('data-plan-change="'+item.renewalChangeId+'"'))
    }
    for (const [i,url] of item.chargeUrls.entries()) {
      const page = await h.send(url,undefined,h.owner)
      assert.equal(page.status,200); assert.ok(page.text.includes(item.chargeIds[i]))
      const source = (await h.send('/api/strap/reports/revenue?sourceId='+item.chargeIds[i],undefined,h.owner)).value.selectedSource.record
      assert.deepEqual(source,charges[i])
    }
  }
  assert.ok(Object.values(report.unavailable).every(value=>value===null))
  const screen = await h.send('/app/retention?month='+localMonth+'&offer=Mat+five',undefined,h.owner), filtered = await read('month='+localMonth+'&offer=Mat+five')
  assert.equal(screen.status,200)
  assert.deepEqual([...screen.text.matchAll(/data-pack-id="([^"]+)"/g)].map(m=>m[1]),filtered.rows.map(r=>r.packId),'RPT-003: the screen lists the same filtered terms as HTTP and CSV')
  assert.equal((await h.send('/app/retention?month=2026-13',undefined,h.owner)).status,400)
  assert.equal((await h.send('/app/retention',undefined,ana.cookie)).status,403); assert.equal((await h.send('/app/retention',undefined,'')).status,303)
  assert.deepEqual((await read('month=1900-01')).rows,[])
  for (const query of ['',`month=${localMonth}&offer=Mat+five`,'offer=Failed+renewal','month=1900-01']) {
    const expected = await read(query), response = await h.send(path+'.csv?'+query,undefined,h.owner)
    assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'no-store')
    assert.match(response.headers.get('content-disposition'),/attachment;/)
    const {parseCsv} = await import('./report-downloads.mjs'), [keys,...values] = parseCsv(response.text)
    assert.deepEqual(values.map(values=>Object.fromEntries(keys.map((key,i)=>[key,values[i]]))),expected.rows)
    for (const cohort of expected.cohorts) assert.deepEqual(cohort.packIds,expected.rows.filter(row=>row.acquisitionMonth===cohort.acquisitionMonth&&row.initialOffer===cohort.initialOffer).map(row=>row.packId))
  }
  for (const query of ['month=','month=2026-00','month=2026-13','month=2026-1','month=2026-01-01','offer=','offer='+encodeURIComponent('x'.repeat(81))]) {
    for (const suffix of ['','.csv']) assert.equal((await h.send(path+suffix+'?'+query,undefined,h.owner)).status,400)
  }
  for (const cookie of [ana.cookie,coach.cookie,'']) for (const suffix of ['','.csv']) assert.equal((await h.send(path+suffix,undefined,cookie)).status,cookie ? 403 : 401)
  const agent = await h.cmd('agent.create',{label:'No cohort access'})
  for (const suffix of ['','.csv']) assert.equal((await h.send(path+suffix,undefined,'',{authorization:`Bearer ${agent.token}`})).status,401)
  assert.equal((await h.state()).version,version,'report/download/evidence reads have no domain side effects')
  if (process.env.STRAP_PROOF_DIR || process.env.CI) await (await import('./reports-browser.mjs')).retentionEvidenceBrowser(h,row,'month='+localMonth+'&offer=Mat+five')
  // Deactivation is not churn and does not erase retained cohort history.
  const member = (await h.state()).people.find(person=>person.id===ben.id)
  await h.cmd('person.save',{id:member.id,name:member.name,email:member.email,role:'member',active:false,version:member.version})
  assert.deepEqual((await read()).cohorts,report.cohorts)
  assert.equal((await h.send(path,undefined,ben.cookie)).status,403)
}))

test('RPT-003: tenure and attendance frequency count only corrected attended visits inside each member\'s retained-pack span, per member and pooled per cohort, in HTTP and CSV', () => run(async h => {
  await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
  await h.cmd('studio.save',{location:'Brooklyn studio',timeZone:'America/New_York'})
  const coach = await h.person('SpanCoach','instructor'), tia = await h.person('SpanTia'), xan = await h.person('SpanXan'), uma = await h.person('SpanUma'), wes = await h.person('SpanWes')
  const day = 86_400_000, base = Date.now(), at = offset => new Date(base+offset).toISOString()
  const edit = (id,fields) => h.db.prepare(`UPDATE st_records SET data=json_set(data,${Object.keys(fields).map(k=>`'$.${k}',?`).join(',')}) WHERE id=?`).bind(...Object.values(fields),id).run()
  const buy = async (member,planName,expiresAt='2099-12-31T00:00:00Z') => h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:10,amountCents:10000,expiresAt,planName})).id})
  const tiaPack = await buy(tia,'Mat five'), xanPack = await buy(xan,'Mat five'), umaPack = await buy(uma,'Reformer ten'), wesPack = await buy(wes,'Wes offer')
  const sessions = [], visit = async (member,offset,outcome='attended') => {
    const start = new Date(Date.now()+3_600_000*(sessions.length+2)).toISOString()
    const session = (await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:monday(start),classes:[{title:'Span visit '+sessions.length,start,end:new Date(Date.parse(start)+60_000).toISOString(),capacity:5,instructorId:coach.id}]})).id})).classes[0]
    const booking = await h.cmd('booking.book',{classId:session.id},member.cookie)
    if (outcome === 'attended') await h.cmd('attendance.checkin',{id:booking.id},coach.cookie)
    sessions.push({session,booking,offset,outcome})
  }
  // Tia: 60-day span (pack created 100 days ago, expired 40 days ago); two visits inside it, three outside it or not attended.
  for (const [offset,outcome] of [[-70*day],[-50*day],[-101*day],[-39*day],[-60*day,'noshow']]) await visit(tia,offset,outcome)
  for (const offset of [-80*day,-75*day]) await visit(xan,offset)
  await visit(uma,-20*day)
  for (const entry of sessions) await edit(entry.session.id,{start:at(entry.offset),end:at(entry.offset+60_000)})
  for (const entry of sessions.filter(entry=>entry.outcome==='noshow')) await h.cmd('attendance.noshow',{id:entry.booking.id},coach.cookie)
  await edit(tiaPack.id,{createdAt:at(-100*day),expiresAt:at(-40*day)})
  await edit(xanPack.id,{createdAt:at(-100*day),expiresAt:at(-70*day)})
  await edit(umaPack.id,{createdAt:at(-45*day-12*3_600_000)}) // later expiry, so the span ends at the report instant
  await edit(wesPack.id,{createdAt:at(-3_600_000)})
  const path = '/api/strap/reports/retention', read = async query => (await h.send(path+(query?'?'+query:''),undefined,h.owner)).value
  const report = await read(), version = (await h.state()).version
  const row = member => report.rows.find(r=>r.personId===member.id)
  assert.deepEqual([row(tia).tenureDays,row(tia).attendedVisits,row(tia).visitsPer30Days],[60,2,1],'RPT-003: only attended visits whose class started inside the span count')
  assert.deepEqual([row(xan).tenureDays,row(xan).attendedVisits,row(xan).visitsPer30Days],[30,2,2])
  assert.deepEqual([row(uma).tenureDays,row(uma).attendedVisits,row(uma).visitsPer30Days],[45,1,0.67],'RPT-003: span ends at the report instant when a pack is still running')
  assert.deepEqual([row(wes).tenureDays,row(wes).attendedVisits,row(wes).visitsPer30Days],[0,0,null],'RPT-003: zero tenure has an unavailable frequency, never zero')
  const mat = report.cohorts.find(cohort=>cohort.initialOffer==='Mat five')
  assert.deepEqual([mat.members,mat.meanTenureDays,mat.attendedVisits,mat.visitsPer30Days],[2,45,4,1.33],'RPT-003: cohort frequency pools visits over pooled tenure days rather than averaging member rates')
  assert.deepEqual(report.cohorts.find(cohort=>cohort.initialOffer==='Wes offer').visitsPer30Days,null)
  assert.ok(!('tenure' in report.unavailable)&&!('attendanceFrequency' in report.unavailable))
  const {parseCsv} = await import('./report-downloads.mjs'), csv = await h.send(path+'.csv?offer=Mat+five',undefined,h.owner)
  const [keys,...values] = parseCsv(csv.text), exported = values.map(values=>Object.fromEntries(keys.map((key,i)=>[key,values[i]])))
  assert.deepEqual(exported,(await read('offer=Mat+five')).rows,'RPT-003: CSV carries the same tenure and frequency columns as HTTP')
  assert.deepEqual(exported.map(r=>[r.tenureDays,r.attendedVisits,r.visitsPer30Days]).sort(),[[30,2,2],[60,2,1]])
  assert.equal((await h.send(path,undefined,tia.cookie)).status,403)
  assert.equal((await h.state()).version,version,'tenure and frequency reads have no domain side effects')
}))
