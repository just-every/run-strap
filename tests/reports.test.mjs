import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'
import { parseCsv, assertReportDownloads, assertCancellationDownload, assertNativeDownloads } from './report-downloads.mjs'

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
  assert.equal(t.membershipCancellations,0)
  assert.equal(t.newPlans,3); assert.equal(t.bookingCancellations,2); assert.equal(t.activeMembers,3)
  assert.equal(t.outstandingCents,16500)
  assert.equal(t.memberCreditCents,1000-preview.chargeCents)
  for (const key of ['overdueCents','returnedAchCents','processorFeesCents']) assert.equal(t[key],null)
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

test('RPT-007 / RPT-006: native plan endings and low-credit screen/HTTP worklist, matching CSV, receipt value, corrected visits and once-only assigned lead follow-up', () => run(async h => {
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
  assert.deepEqual(new Set(report.rows.map(r=>r.packId)),new Set([soon.id,low.id,both.id,unlimited.id]))
  assert.equal(report.rows.filter(r=>r.packId===both.id).length,1)
  assert.deepEqual(report.rows.find(r=>r.packId===both.id).reasons,['expiring','low-credits'])
  assert.deepEqual(report.rows.find(r=>r.packId===low.id).reasons,['low-credits'])
  for (const row of report.rows) {
    assert.equal(row.remainingValueCents,0); assert.equal(row.valueBasis.paidCents,0); assert.deepEqual(row.contactPermission,{email:'permission_denied',sms:'permission_denied',inApp:'permission_denied'}); assert.equal(row.lastVisit,null)
    assert.equal(row.expiresAt,(await h.state()).packs.find(p=>p.id===row.packId).expiresAt)
  }
  assert.equal(Date.parse(report.through)-Date.parse(report.asOf),30*day)
  assert.deepEqual(new Set((await read('days=45&lowCredits=0')).rows.map(r=>r.packId)),new Set([soon.id,far.id,low.id,both.id,unlimited.id]))
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
  await assertNativeDownloads(h,'/api/strap/reports/renewals',['','days=45&lowCredits=0','days=1&lowCredits=0'],[ana.cookie,coach.cookie,''],['days=0','days=367','lowCredits=-1','lowCredits=10001'])
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
  await (await import('./renewal-plan-cases.mjs')).renewalPlanCases(h)
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

test('RPT-003 / RPT-006: native finite-pack acquisition cohorts reconcile applied, scheduled, failed and absent renewals to exact pack, change and charge evidence through owner HTTP and matching CSV', () => run(async h => {
  await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
  await h.cmd('studio.save',{location:'Brooklyn studio',timeZone:'America/New_York'})
  const ana = await h.person('CohortAna'), ben = await h.person('CohortBen'), cy = await h.person('CohortCy'), dax = await h.person('CohortDax'), coach = await h.person('CohortCoach','instructor')
  const base = Date.now(), expiry = new Date(base+12_000).toISOString(), later = new Date(base+86400_000).toISOString()
  const buy = async (member,expiresAt,planName='Mat five',extra={}) => h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:5,amountCents:10000,expiresAt,planName,...extra})).id})
  const first = await buy(ana,expiry), second = await buy(ana,later,'Different later offer'), unrenewed = await buy(ben,later,'Mat five'), failedPack = await buy(dax,expiry,'Failed renewal')
  const unlimited = await buy(cy,later,'Unlimited',{kind:'unlimited',credits:undefined})
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
  assert.deepEqual(new Set(report.rows.map(row=>row.packId)),new Set([first.id,second.id,unrenewed.id,anotherExpired.id,failedPack.id,successor.id,unlimited.id]))
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
  await assertNativeDownloads(h,path,['','month='+localMonth+'&offer=Mat+five','month=1900-01'],[ana.cookie,coach.cookie,''],['month=2026-13','offer='])
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

test('RPT-003: native termination reasons, started freezes, resumptions and allocated successor receipts reconcile once through owner report and CSV',()=>run(async h=>{
  await h.confirmSetup(h.owner)
  for(const [code,label] of [['moved-away','Moved away'],['price','Price']])await h.cmd('plan.cancellation.reason.save',{code,label,active:true,revision:0})
  const members=[await h.person('MovedMember'),await h.person('PriceMember'),await h.person('RenewedMember')]
  const day=86400000,base=Date.now(),at=d=>new Date(base+d*day).toISOString()
  const buy=async(member,expiry=at(90))=>h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:5,amountCents:10000,expiresAt:expiry,planName:'Lifecycle offer'})).id})
  const edit=async(kind,row)=>h.db.prepare('UPDATE st_records SET data=? WHERE kind=? AND id=?').bind(JSON.stringify(row),kind,row.id).run()
  const packs=[]
  for(const [index,member] of members.entries()){
    const pack=await buy(member);packs.push(pack)
    const proposal=await h.cmd('plan.recurring.prepare',{packId:pack.id,intervalMonths:1,requestId:'synthetic-strap-terms-'+index})
    await h.cmd('plan.recurring.accept',{id:proposal.id,key:proposal.key},member.cookie)
  }
  const type=await h.cmd('freeze.type.save',{name:'Travel leave',reason:'Member travel',feeCents:0,defaultLengthDays:2,maxLengthDays:30})
  const f=await h.cmd('freeze.prepare',{packId:packs[2].id,freezeTypeId:type.id,startAt:at(2).slice(0,10),endAt:at(4).slice(0,10),requestId:'synthetic-strap-freeze'})
  const confirmed=await h.cmd('freeze.confirm',{id:f.id,key:f.key,requestId:'synthetic-strap-freeze-confirm'})
  await edit('freeze',{...confirmed,startAt:at(-4),endAt:at(-2)})
  const cancelled=[]
  for(const [index,reasonCode] of ['moved-away','price'].entries()){
    const p=await h.cmd('plan.cancellation.prepare',{packId:packs[index].id,effectiveAt:at(5),reasonCode,reason:'Member requested stop',requestId:'synthetic-strap-end-'+index})
    const c=await h.cmd('plan.cancellation.confirm',{id:p.id,key:p.key,requestId:'synthetic-strap-confirm-'+index})
    cancelled.push(c)
    await edit('contractCancellation',{...c,effectiveAt:at(-1)})
  }
  await h.cmd('plan.cancellation.reason.save',{code:'moved-away',label:'Relocated elsewhere',active:false,revision:1})
  const terms=(await h.state()).recurring.terms.find(t=>t.personId===members[2].id)
  const pack=(await h.state()).packs.find(p=>p.id===packs[2].id)
  await edit('recurringTerms',{...terms,nextRenewalAt:at(-1)})
  await edit('pack',{...pack,expiresAt:at(-1)})
  await(await h.mf.getWorker()).scheduled();await(await h.mf.getWorker()).scheduled()
  const state=await h.state(),invoice=state.recurring.invoices.find(i=>i.recurringTermsId===terms.id)
  assert.ok(invoice,'real recurring invoice links a successor')
  const payment=await h.cmd('payment.record',{personId:members[2].id,amountCents:10000,reference:'synthetic-strap-renewal-receipt'})
  const input={packId:invoice.packId,paymentId:payment.id,chargeId:invoice.chargeId,amountCents:7000,reference:'synthetic-strap-renewal-allocation'}
  const allocation=await h.cmd('contract.prepayment.record',input);await h.cmd('contract.prepayment.record',input)
  const version=(await h.state()).version,path='/api/strap/reports/retention'
  const report=(await h.send(path,undefined,h.owner)).value,cohort=report.cohorts.find(c=>c.initialOffer==='Lifecycle offer')
  assert.deepEqual(cohort.churnByReason,[{label:'Moved away',count:1},{label:'Price',count:1}])
  assert.deepEqual(report.rows.find(r=>r.packId===packs[0].id).terminationReasonCodes,['moved-away'])
  assert.deepEqual(state.cancellations.cancellations.find(c=>c.id===cancelled[0].id).reasonLabel,'Moved away')
  assert.equal(cohort.terminatedAgreements,2);assert.equal(cohort.scheduledTerminations,0)
  assert.deepEqual(cohort.freezeByType,[{label:'Travel leave',count:1}]);assert.equal(cohort.reactivations,1)
  const row=report.rows.find(r=>r.packId===pack.id)
  assert.equal(row.renewalStatus,'applied');assert.equal(row.renewalInvoiceId,invoice.id)
  assert.equal(row.collectedRenewalCents,7000);assert.deepEqual(row.paymentIds,[payment.id]);assert.deepEqual(row.allocationIds,[allocation.id])
  assert.equal(cohort.collectedRenewalCents,7000,'unallocated remainder is not counted')
  for(const url of row.paymentUrls)assert.equal((await h.send(url,undefined,h.owner)).status,200)
  const {parseCsv}=await import('./report-downloads.mjs'),[keys,...values]=parseCsv((await h.send(path+'.csv',undefined,h.owner)).text)
  assert.deepEqual(values.map(v=>Object.fromEntries(keys.map((k,i)=>[k,v[i]]))),report.rows)
  assert.equal((await h.send(path,undefined,members[0].cookie)).status,403)
  assert.equal((await h.state()).version,version,'report and evidence reads remain read-only')
  if(process.env.STRAP_PROOF_DIR)await(await import('./reports-browser.mjs')).retentionLifecycleBrowser(h,report)
}))


// The clock fixture ages native records; every agreement, stop, withdrawal and application uses its public command.
async function recurringRevenueJourney(h) {
  const west = await h.cmd('location.save',{name:'Lifecycle West',timeZone:'America/Los_Angeles'})
  const multi=await h.person('LifecycleMulti'),kept=await h.person('LifecycleKept'),withdrawn=await h.person('LifecycleWithdrawn'),legacy=await h.person('LifecycleLegacy'),scheduled=await h.person('LifecycleScheduled'),previewMember=await h.person('LifecyclePreview'),manager=await h.person('LifecycleManager'),finance=await h.person('LifecycleFinance')
  const acceptedAt='2026-03-10T04:30:00.000Z',stoppedAt='2026-03-11T04:30:00.000Z',endedAt='2026-03-12T04:30:00.000Z'
  const save = async (kind,row) => h.db.prepare('UPDATE st_records SET data=? WHERE kind=? AND id=?').bind(JSON.stringify(row),kind,row.id).run()
  const sell = async (member,locationId='studio',accept=true) => {
    const pack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,kind:'unlimited',amountCents:10000,planName:'Lifecycle',expiresAt:'2099-12-31T00:00:00Z',locationId})).id})
    const proposal=await h.cmd('plan.recurring.prepare',{packId:pack.id,intervalMonths:1,requestId:'synthetic-strap-'+pack.id})
    const terms=accept ? await h.cmd('plan.recurring.accept',{id:proposal.id,key:proposal.key},member.cookie) : proposal
    if(accept)await save('recurringTerms',{...terms,acceptedAt})
    return {pack,terms,member}
  }
  const first=await sell(multi),second=await sell(multi),replaced=await sell(kept,west.id),withdraw=await sell(withdrawn),unknown=await sell(legacy),future=await sell(scheduled,west.id),preview=await sell(previewMember,'studio',false)
  const cancel = async (item,apply=false) => {
    const proposal=await h.cmd('plan.cancellation.prepare',{packId:item.pack.id,effectiveAt:'2098-01-01T00:00:00Z',reasonCode:'moved-away',reason:'Requested end',requestId:'synthetic-strap-'+item.terms.id})
    const result=await h.cmd('plan.cancellation.confirm',{id:proposal.id,key:proposal.key,requestId:'synthetic-strap-confirm-'+item.terms.id})
    if(apply)await save('contractCancellation',{...result,effectiveAt:endedAt})
    return result
  }
  const applied=[]
  for(const item of [first,second,replaced])applied.push(await cancel(item,true))
  const withdrawalSource=await cancel(withdraw)
  const withdrawal=await h.cmd('plan.cancellation.withdraw.prepare',{id:withdrawalSource.id,requestId:'synthetic-strap-withdraw'})
  await h.cmd('plan.cancellation.withdraw.confirm',{id:withdrawal.id,key:withdrawal.key})
  // The old scheduled date is retained history, not an end of access after withdrawal.
  await save('contractCancellation',{...(await h.state()).cancellations.cancellations.find(c=>c.id===withdrawalSource.id),effectiveAt:endedAt})
  const stopInput={id:future.terms.id,requestId:'synthetic-strap-stop'}
  const stop=await h.cmd('plan.recurring.stop',stopInput,future.member.cookie)
  assert.equal((await h.cmd('plan.recurring.stop',stopInput,future.member.cookie)).id,stop.id,'replayed stops retain the same source identity')
  await h.cmd('plan.cancellation.prepare',{packId:unknown.pack.id,effectiveAt:'2098-01-01T00:00:00Z',reasonCode:'moved-away',reason:'Preview only',requestId:'synthetic-strap-preview'})
  await (await h.mf.getWorker()).scheduled();await (await h.mf.getWorker()).scheduled()
  const replacement=await sell(kept,west.id)
  await save('recurringTerms',{...replacement.terms,acceptedAt:'2026-03-13T04:30:00.000Z'})
  let state=await h.state()
  for(const item of [first,second,replaced,withdraw,future]) {
    const terms=state.recurring.terms.find(t=>t.id===item.terms.id)
    await save('recurringTerms',{...terms,stoppedAt,stop:{...terms.stop,at:stoppedAt,effectiveAt:stoppedAt,accessEndsAt:item===withdraw ? endedAt : terms.stop.accessEndsAt}})
  }
  const {locationId,...oldPack}=state.packs.find(p=>p.id===unknown.pack.id)
  await save('pack',oldPack)
  state=await h.state()
  const baseQuery=new URLSearchParams({plan:'unlimited: Lifecycle',from:'2026-03-01',to:'2026-03-31'})
  const read=async (query=baseQuery,cookie=h.owner) => {
    const response=await h.send('/api/strap/reports/revenue?'+query,undefined,cookie)
    assert.equal(response.status,200,response.text);return response.value
  }
  const report=await read(),t=report.totals,version=state.version
  assert.deepEqual([t.recurringStarts,t.recurringStops,t.recurringEndings,t.membershipCancellations],[7,5,3,3])
  assert.equal(t.newPlans,0,'a historical agreement acceptance is not a pack creation event')
  assert.equal((await read(new URLSearchParams({plan:'unlimited: Lifecycle'}))).totals.newPlans,8,'eight sold packs include one whose recurring proposal was never accepted')
  assert.equal(t.bookingCancellations,0,'agreement events are not booking actions')
  const terms=state.recurring.terms.filter(t=>t.entitlement?.name==='Lifecycle'&&t.acceptedBy)
  assert.deepEqual(new Set(report.sources.filter(r=>r.kind==='recurring-start').map(r=>r.sourceId)),new Set(terms.map(t=>t.id)),'independent accepted agreement identities reconcile')
  assert.deepEqual(new Set(report.sources.filter(r=>r.kind==='recurring-stop').map(r=>r.sourceId)),new Set(terms.filter(t=>t.stoppedAt).map(t=>t.id)))
  const cancellations=state.cancellations.cancellations.filter(c=>c.status==='applied'&&terms.some(t=>t.id===c.termsId))
  assert.deepEqual(new Set(report.sources.filter(r=>r.kind==='membership-cancellation').map(r=>r.sourceId)),new Set(cancellations.map(c=>c.id)))
  assert.deepEqual(report.sources.filter(r=>r.kind==='recurring-end').map(r=>r.at),[endedAt,endedAt,endedAt])
  assert.ok(!report.sources.some(r=>r.sourceId===preview.terms.id || r.sourceId===withdrawalSource.id))
  assert.ok(!report.sources.some(r=>r.agreementId===withdraw.terms.id&&r.kind==='recurring-end'))
  assert.ok(!report.sources.some(r=>r.agreementId===future.terms.id&&['recurring-end','membership-cancellation'].includes(r.kind)))
  assert.equal(new Set(report.sources.map(r=>r.id)).size,report.sources.length,'each event has one stable identity')
  for(const metric of ['recurringStarts','recurringStops','recurringEndings','membershipCancellations'])assert.equal(report.locationTotals.reduce((n,l)=>n+l[metric],0),t[metric])
  const scoped=(extra)=>new URLSearchParams({...Object.fromEntries(baseQuery),...extra})
  const ny=await read(scoped({location:'studio'})),la=await read(scoped({location:west.id})),unattributed=await read(scoped({location:'Unattributed'}))
  assert.deepEqual([ny.totals.recurringStarts,la.totals.recurringStarts,unattributed.totals.recurringStarts],[3,3,1])
  assert.equal(unattributed.sources[0].locationId,null)
  assert.equal(unattributed.sources[0].sourceId,unknown.terms.id)
  const march9=await read(scoped({from:'2026-03-09',to:'2026-03-09'})),march10=await read(scoped({from:'2026-03-10',to:'2026-03-10'}))
  assert.equal(march9.totals.recurringStarts,2,'same instant is March 9 in Los Angeles')
  assert.equal(march10.totals.recurringStarts,4,'same instant is March 10 in New York, including the unattributed retained clock')
  assert.equal(march10.totals.recurringStops,2,'LA stop date differs from NY; the inclusive one-day window selects its own events')
  assert.equal((await read(scoped({plan:'missing'}))).sources.length,0)
  const eventMetrics=[['recurring-start','recurringStarts'],['recurring-stop','recurringStops'],['recurring-end','recurringEndings'],['membership-cancellation','membershipCancellations']]
  for(const [kind,metric] of eventMetrics) {
    const selected=await read(scoped({event:kind}))
    assert.equal(selected.event,kind)
    assert.equal(selected.sources.length,t[metric])
    assert.deepEqual(selected.sources.map(r=>r.id),report.sources.filter(r=>r.kind===kind).map(r=>r.id),'a total drills to exactly its independently reconciled source identities')
    assert.equal(selected.totals[metric],t[metric])
    assert.ok(selected.sources.every(r=>r.kind===kind&&r.metric===metric&&r.eventCount===1))
    assert.equal(selected.totals.assessedCents,0,'an event drill-through invents no sales or collections')
    const source=selected.sources[0]
    assert.deepEqual((await read(scoped({event:kind,sourceId:source.id}))).selectedSource.record,source.record)
    assert.equal((await read(scoped({event:kind,sourceId:report.sources.find(r=>r.kind!==kind).id}))).selectedSource,null)
  }
  for(const path of ['/app/revenue','/api/strap/reports/revenue','/api/strap/reports/revenue.csv','/api/strap/reports/revenue.xlsx']) {
    const invalid=await h.send(path+'?'+scoped({event:'not-a-retained-event'}),undefined,h.owner)
    assert.equal(invalid.status,400)
    assert.ok(invalid.text.includes('invalid_revenue_event'))
  }
  const churn=(await h.send('/api/strap/reports/retention?'+new URLSearchParams({churnFrom:'2026-03-11T00:00:00.000Z',churnTo:'2026-03-14T00:00:00.000Z'}),undefined,h.owner)).value
  assert.equal(churn.rows.find(r=>r.personId===multi.id).churnEvidence.lostMember,true)
  assert.equal(churn.rows.find(r=>r.personId===kept.id).churnEvidence.lostMember,false,'a replacement preserves the member after an agreement ends')
  assert.equal(churn.rows.find(r=>r.personId===withdrawn.id).churnEvidence.endedAgreementIds.length,0,'withdrawn date creates neither an agreement end nor commitment loss')
  for(const row of report.sources) {
    const detail=await read(scoped({sourceId:row.id}))
    assert.deepEqual(detail.selectedSource.record,row.record)
    assert.equal(detail.selectedSource.record.id,row.sourceId)
    assert.equal((await h.send(row.sourceUrl,undefined,h.owner)).status,200)
    assert.ok(!JSON.stringify(row).includes('connectionId')&&!JSON.stringify(row).includes('termsKey'),'report facts exclude authorization material')
  }
  await assertReportDownloads(h,'revenue',[baseQuery.toString(),scoped({location:west.id}).toString(),scoped({location:'Unattributed'}).toString(),scoped({from:'2026-03-09',to:'2026-03-09'}).toString(),...eventMetrics.map(([event])=>scoped({event}).toString())],[multi.cookie,''])
  const [csvKeys,...csvValues]=parseCsv((await h.send('/api/strap/reports/revenue.csv?'+baseQuery,undefined,h.owner)).text)
  const csvSources=csvValues.map(row=>Object.fromEntries(csvKeys.map((key,i)=>[key,row[i]])))
  for(const metric of ['recurringStarts','recurringStops','recurringEndings','membershipCancellations'])assert.equal(csvSources.filter(row=>row.metric===metric).reduce((n,row)=>n+row.eventCount,0),t[metric],'downloaded event counts reconcile independently')
  assert.equal((await h.state()).version,version,'report and source reads create no lifecycle or financial effects')
  await h.cmd('manager.grant',{id:manager.id,locationIds:[west.id]});await h.enroll(manager.cookie)
  const managed=await read(baseQuery,manager.cookie)
  assert.deepEqual([managed.totals.recurringStarts,managed.totals.recurringStops,managed.totals.membershipCancellations],[3,2,1])
  assert.ok(managed.sources.every(r=>r.locationId===west.id))
  assert.equal((await read(scoped({sourceId:report.sources.find(r=>r.locationId==='studio').id}),manager.cookie)).selectedSource,null)
  const assertScopedDownloads=async(cookie,expected) => {
    const {default:readXlsx}=await import('read-excel-file/node')
    for(const [event,metric] of eventMetrics) {
      const query=scoped({event}),selected=expected.sources.filter(r=>r.kind===event)
      const csv=await h.send('/api/strap/reports/revenue.csv?'+query,undefined,cookie)
      assert.equal(csv.status,200)
      const [keys,...values]=parseCsv(csv.text)
      const rows=values.map(row=>Object.fromEntries(keys.map((key,i)=>[key,row[i]])))
      assert.deepEqual(rows.map(r=>r.id),selected.map(r=>r.id),'scoped CSV retains exactly the permitted event sources')
      assert.ok(!csv.text.includes(multi.id),'another member remains hidden in the downloaded records')
      const response=await h.mf.dispatchFetch(h.origin+'/api/strap/reports/revenue.xlsx?'+query,{headers:{cookie}})
      assert.equal(response.status,200)
      const sheets=await readXlsx(Buffer.from(await response.arrayBuffer()))
      assert.deepEqual(sheets.find(s=>s.sheet==='Sources').data,[keys,...values],'scoped XLSX cells equal the permitted CSV values')
      assert.equal(Object.fromEntries(sheets.find(s=>s.sheet==='Totals').data.slice(1))[metric],selected.length)
      const foreign=report.sources.find(r=>r.personId===multi.id)
      assert.equal((await read(scoped({event,sourceId:foreign.id}),cookie)).selectedSource,null)
    }
  }
  await assertScopedDownloads(manager.cookie,managed)
  assert.equal((await read(scoped({location:'Unattributed'}),manager.cookie)).totals.recurringStarts,0,'location-scoped managers cannot read unattributed history')
  await h.cmd('finance.grant',{id:finance.id});await h.enroll(finance.cookie)
  const {default:readXlsx}=await import('read-excel-file/node')
  for(const query of [baseQuery,scoped({location:'Unattributed'})]) {
    const expected=await read(query),actual=await read(query,finance.cookie)
    assert.deepEqual(actual.sources,expected.sources,'unrestricted finance retains the same historical events as the owner, including missing locations')
    assert.deepEqual(actual.totals,expected.totals)
    assert.deepEqual(actual.locationTotals,expected.locationTotals)
    const screen=await h.send('/app/revenue?'+query,undefined,finance.cookie)
    assert.equal(screen.status,200)
    assert.deepEqual([...screen.text.matchAll(/data-source-id="([^"]+)"/g)].map(match=>match[1]),expected.sources.map(row=>row.id))
    const csv=await h.send('/api/strap/reports/revenue.csv?'+query,undefined,finance.cookie)
    assert.equal(csv.status,200)
    const ownerCsv=await h.send('/api/strap/reports/revenue.csv?'+query,undefined,h.owner)
    assert.deepEqual(parseCsv(csv.text),parseCsv(ownerCsv.text),'unrestricted finance CSV matches every owner source field')
    const response=await h.mf.dispatchFetch(h.origin+'/api/strap/reports/revenue.xlsx?'+query,{headers:{cookie:finance.cookie}})
    assert.equal(response.status,200)
    const sheets=await readXlsx(Buffer.from(await response.arrayBuffer()))
    assert.deepEqual(sheets.find(s=>s.sheet==='Sources').data,parseCsv(csv.text),'unrestricted finance XLSX retains every CSV cell')
    assert.deepEqual(Object.fromEntries(sheets.find(s=>s.sheet==='Totals').data.slice(1)),expected.totals)
  }
  if(process.env.CI||process.env.STRAP_PROOF_DIR)await (await import('./revenue-browser.mjs')).unattributedFinanceBrowser(h,{query:scoped({location:'Unattributed'}),sourceId:'recurring-start:'+unknown.terms.id,finance:finance.cookie})
  console.log('PROBE RPT-001 A: owner and unrestricted finance read historical recurring events without a location through the screen, JSON, CSV and XLSX -> both retain one Unattributed start with the same source identity and totals')
  await h.cmd('staff.access.grant',{personId:finance.id,role:'finance',enabled:true,rights:{exports:{enabled:true,scopes:[{memberIds:[kept.id],locationIds:[west.id],doors:['all']}]}}})
  const financeReport=await read(baseQuery,finance.cookie)
  assert.equal(financeReport.totals.recurringStarts,2)
  assert.ok(financeReport.sources.every(r=>r.personId===kept.id&&r.locationId===west.id))
  await assertScopedDownloads(finance.cookie,financeReport)
  assert.equal((await read(scoped({location:'Unattributed'}),finance.cookie)).totals.recurringStarts,0,'a replacement scoped finance grant excludes unattributed history immediately')
  const deniedVersion=(await h.state()).version
  await h.cmd('manager.revoke',{id:manager.id})
  await h.cmd('staff.access.grant',{personId:finance.id,role:'finance',enabled:false,rights:{}})
  const afterRevoke=(await h.state()).version
  for(const cookie of [manager.cookie,finance.cookie,multi.cookie])for(const path of ['/app/revenue','/api/strap/reports/revenue','/api/strap/reports/revenue.csv','/api/strap/reports/revenue.xlsx'])assert.equal((await h.send(path+'?'+baseQuery,undefined,cookie)).status,403)
  for(const cookie of [manager.cookie,finance.cookie,multi.cookie])for(const [event] of eventMetrics)for(const path of ['/app/revenue','/api/strap/reports/revenue','/api/strap/reports/revenue.csv','/api/strap/reports/revenue.xlsx'])assert.equal((await h.send(path+'?'+scoped({event}),undefined,cookie)).status,403)
  assert.equal((await h.state()).version,afterRevoke,'denied reads leave sources untouched')
  assert.ok(deniedVersion>=version)
  if(process.env.CI||process.env.STRAP_PROOF_DIR)await (await import('./revenue-browser.mjs')).recurringRevenueBrowser(h,{query:baseQuery,report,west,march9})
  const erasedMember=await h.person('LifecycleErased'),erasedAgreement=await sell(erasedMember)
  const capturedId='recurring-start:'+erasedAgreement.terms.id
  assert.equal((await read(scoped({sourceId:capturedId}))).selectedSource.sourceId,erasedAgreement.terms.id)
  const erasure=await h.cmd('privacy.request',{personId:erasedMember.id,type:'erasure',channel:'desk',requestId:'synthetic-strap-report-erasure'})
  await h.cmd('privacy.verify',{id:erasure.id,method:'signed-in-member',confirm:true})
  const review=await h.cmd('privacy.erase.prepare',{id:erasure.id,obligations:'retain',reason:'Retain native financial chronology',retainUntil:'2099-01-01T00:00:00.000Z',documents:'delete',retireAccess:true})
  await h.cmd('privacy.erase.confirm',{id:review.id,confirm:true})
  await (await h.mf.getWorker()).scheduled()
  const erased=await read(scoped({sourceId:capturedId}))
  assert.equal(erased.selectedSource,null,'a previously captured source URL cannot restore erased recurring evidence')
  assert.ok(!erased.sources.some(row=>row.agreementId===erasedAgreement.terms.id))
  assert.equal((await read(scoped({event:'recurring-start',sourceId:capturedId}))).selectedSource,null,'captured event drill-through cannot revive erased evidence')
  assert.ok(!JSON.stringify(erased).includes('LifecycleErased'))
  assert.equal((await h.send('/api/strap/reports/revenue',undefined,erasedMember.cookie)).status,401,'erasure retires the old session')
  console.log('PROBE RPT-001 counts: revenue JSON, screen and parsed CSV and XLSX -> starts=7 stops=5 access endings=3 applied cancellations=3; each event drill-through equals independent source identities')
  console.log('PROBE RPT-001 filters: March one-day bounds, accepted plan and two source locations -> March 9 LA starts=2; March 10 NY plus retained clock starts=4; source location sums match')
  console.log('PROBE RPT-001 distinctions: eight sold packs and multiple accepted agreements -> historical new packs=0 booking cancellations=0; three agreement endings leave one unique lost member in the separate churn cohort')
  console.log('PROBE RPT-001 exclusions: preview, withdrawn termination and replacement agreement -> no fabricated applied cancellations or withdrawn access endings; retained and replacement access do not become lost members')
  console.log('PROBE RPT-001 attribution: agreement with missing historical sale location -> one Unattributed start; no studio attribution invented')
  console.log('PROBE RPT-001 authority: scoped manager and member-specific finance reads of JSON, event links, CSV and XLSX -> only permitted sources; revoked grants denied; erased captured source URLs remain unavailable; no financial writes')
}

test('RPT-001 and RPT-003: period churn and native recurring lifecycle reconcile unique lost members and opening recurring commitments across multiple plans, retained access and replacement agreements', () => run(async h => {
  await h.confirmSetup(h.owner)
  for(const [code,label] of [['moved-away','Moved away'],['price','Price']])await h.cmd('plan.cancellation.reason.save',{code,label,active:true,revision:0})
  await h.cmd('studio.save',{location:'Brooklyn studio',timeZone:'America/New_York'})
  const members = [await h.person('ChurnLost'),await h.person('ChurnRetained'),await h.person('ChurnReplacement'),await h.person('ChurnScheduled')]
  const day = 86400000, base = Date.now(), at = d => new Date(base+d*day).toISOString()
  const editClock = async (kind,row) => h.db.prepare('UPDATE st_records SET data=? WHERE kind=? AND id=?').bind(JSON.stringify(row),kind,row.id).run()
  const agreements = []
  const buy = async (member,kind='credits',amountCents=12000,intervalMonths=1,historical=true) => {
    const pack = await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,kind,credits:kind==='credits'?5:undefined,amountCents,expiresAt:at(90),planName:'Churn offer'})).id})
    const proposed = await h.cmd('plan.recurring.prepare',{packId:pack.id,intervalMonths,requestId:'synthetic-strap-'+pack.id})
    const terms = await h.cmd('plan.recurring.accept',{id:proposed.id,key:proposed.key},member.cookie)
    if(historical) await editClock('recurringTerms',{...terms,acceptedAt:at(-20)})
    const item={pack,terms}; agreements.push(item);return item
  }
  const lost1=await buy(members[0]),lost2=await buy(members[0],'unlimited',24000,2)
  const kept=await buy(members[1]),replaced=await buy(members[2]),scheduled=await buy(members[3])
  // A real, separately sold plan preserves member access when a recurring agreement ends.
  const other=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:members[1].id,kind:'visits',visits:2,period:'month',amountCents:5000,expiresAt:at(90),planName:'Other access'})).id})
  for(const [i,item] of [lost1,lost2,kept,replaced,scheduled].entries()) {
    const p=await h.cmd('plan.cancellation.prepare',{packId:item.pack.id,effectiveAt:at(5),reasonCode:i<2?'moved-away':'price',reason:'Requested stop',requestId:'synthetic-strap-churn-'+i})
    const c=await h.cmd('plan.cancellation.confirm',{id:p.id,key:p.key,requestId:'synthetic-strap-churn-confirm-'+i})
    if(item!==scheduled)await editClock('contractCancellation',{...c,effectiveAt:at(-1)})
  }
  await(await h.mf.getWorker()).scheduled();await(await h.mf.getWorker()).scheduled()
  await buy(members[2],'unlimited',9000,1,false)
  const query=new URLSearchParams({churnFrom:at(-10),churnTo:new Date().toISOString()}).toString(),path='/api/strap/reports/retention'
  const before=(await h.state()).version,response=await h.send(path+'?'+query,undefined,h.owner)
  assert.equal(response.status,200,response.text)
  assert.equal((await h.send('/app/retention?month=&offer=&'+query,undefined,h.owner)).status,200,'blank optional form fields are omitted without weakening API validation')
  const report=response.value,cohort=report.cohorts.find(c=>c.initialOffer==='Churn offer')
  assert.deepEqual([cohort.churn.openingMembers,cohort.churn.lostMembers,cohort.churn.memberChurnPercent],[4,1,25])
  assert.deepEqual([cohort.churn.openingMonthlyCents,cohort.churn.lostMonthlyCents,cohort.churn.revenueChurnPercent],[60000,48000,80])
  const lost=report.rows.find(r=>r.personId===members[0].id).churnEvidence
  assert.equal(lost.openingAgreementIds.length,2);assert.equal(lost.cancellationIds.length,2);assert.equal(lost.lostMember,true)
  assert.equal(report.rows.find(r=>r.personId===members[1].id).churnEvidence.lostMember,false)
  assert.ok(report.rows.some(r=>r.packId===other.id),'non-credit plan access appears in the same cohort projection')
  for(const row of report.rows) for(const url of row.churnEvidence.agreementUrls)assert.equal((await h.send(url,undefined,h.owner)).status,200)
  const {parseCsv}=await import('./report-downloads.mjs'),[keys,...values]=parseCsv((await h.send(path+'.csv?'+query,undefined,h.owner)).text)
  assert.deepEqual(values.map(v=>Object.fromEntries(keys.map((k,i)=>[k,v[i]]))),report.rows)
  await assertNativeDownloads(h,path,[query,'churnFrom='+encodeURIComponent(at(-40))+'&churnTo='+encodeURIComponent(at(-30))],[members[0].cookie,''],['churnFrom=bad','churnTo=2099-01-01T00:00:00Z','churnFrom='+encodeURIComponent(at(-1))+'&churnTo='+encodeURIComponent(at(-2))])
  const empty=(await h.send(path+'?churnFrom='+encodeURIComponent(at(-40))+'&churnTo='+encodeURIComponent(at(-30)),undefined,h.owner)).value.cohorts[0].churn
  assert.equal(empty.memberChurnPercent,null);assert.equal(empty.revenueChurnPercent,null)
  assert.equal((await h.state()).version,before,'churn and source reads are read-only')
  if(process.env.STRAP_PROOF_DIR)await(await import('./reports-browser.mjs')).retentionChurnBrowser(h,report,query)
  await recurringRevenueJourney(h)
}))


test('RPT-003: reviewed eighteen-month historical terms join native cutover renewals and terminations with labeled source and payment evidence', () => run(async h => {
  await h.confirmSetup(h.owner)
  for(const [code,label] of [['moved-away','Moved away'],['price','Price']])await h.cmd('plan.cancellation.reason.save',{code,label,active:true,revision:0})
  await h.cmd('studio.save',{location:'Brooklyn studio',timeZone:'America/New_York'})
  const member=await h.person('HistoryMember'),other=await h.person('HistoryOther'),coach=await h.person('HistoryCoach','instructor')
  const day=86400000,base=Date.now(),at=d=>new Date(base+d*day).toISOString()
  const pack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:5,amountCents:12000,expiresAt:at(90),planName:'Native cutover'})).id})
  const storedPack={...(await h.state()).packs.find(p=>p.id===pack.id),createdAt:at(-3)}
  await h.db.prepare('UPDATE st_records SET data=? WHERE id=?').bind(JSON.stringify(storedPack),pack.id).run()
  for(const [index,days] of [-4,-2].entries()) {
    const start=new Date(Date.now()+(index+2)*3600000).toISOString()
    const session=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:monday(start),classes:[{title:'Cutover visit '+index,start,end:new Date(Date.parse(start)+60000).toISOString(),capacity:5,instructorId:coach.id}]})).id})).classes[0]
    const booking=await h.cmd('booking.book',{classId:session.id},member.cookie)
    await h.cmd('attendance.checkin',{id:booking.id},coach.cookie)
    await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.start',?,'$.end',?) WHERE id=?").bind(at(days),new Date(Date.parse(at(days))+60000).toISOString(),session.id).run()
  }
  const clock=new Date(storedPack.createdAt),month=n=>new Date(Date.UTC(clock.getUTCFullYear(),clock.getUTCMonth()+n,clock.getUTCDate(),clock.getUTCHours(),clock.getUTCMinutes(),clock.getUTCSeconds(),clock.getUTCMilliseconds())).toISOString()
  const history={format:'strap-retention-history-v1',personId:member.id,source:'synthetic-strap-18-month-export',cutoverPackId:pack.id,
    definitionDifferences:'Source terms use UTC month boundaries and reported visit totals. Historical freezes and churn denominators were not exported. Native bookings use corrected attendance; recorded source payments are external observations, never imported debt or receipts.',
    terms:Array.from({length:18},(_,i)=>({sourceId:'synthetic-strap-'+i,startsAt:month(i-18),endsAt:month(i-17),offer:'Original source offer',contractReference:'synthetic-strap-contract-'+i,paymentReference:'synthetic-strap-payment-'+i,amountCents:10000,paidCents:9000,attendedVisits:2,renewed:true,terminationReason:null}))}
  const agent=await h.cmd('agent.create',{label:'History import denied'})
  assert.equal((await h.send('/api/strap/agent/command',{name:'retention.history.import',input:{history}},'',{authorization:`Bearer ${agent.token}`})).status,403)
  await h.cmd('retention.history.preview',{history},'',401)
  const before=await h.state(),preview=await h.cmd('retention.history.preview',{history})
  await h.cmd('retention.history.import',{history:{...history,source:'changed'},fingerprint:preview.fingerprint},h.owner,409)
  for(const cookie of [member.cookie,coach.cookie])for(const command of ['retention.history.preview','retention.history.import'])await h.cmd(command,{history,fingerprint:preview.fingerprint},cookie,403)
  await h.cmd('retention.history.preview',{history:{...history,personId:other.id}},h.owner,400)
  await h.cmd('retention.history.preview',{history:{...history,terms:[history.terms[0],history.terms[0]]}},h.owner,400)
  await h.cmd('retention.history.preview',{history:{...history,terms:[{...history.terms[0],endsAt:at(1)}]}},h.owner,400)
  const imported=await h.cmd('retention.history.import',{history:JSON.stringify(history),fingerprint:preview.fingerprint})
  assert.deepEqual(await h.cmd('retention.history.import',{history,fingerprint:preview.fingerprint}),imported)
  const changed=await h.cmd('retention.history.preview',{history:{...history,source:'Different source'}})
  await h.cmd('retention.history.import',{history:{...history,source:'Different source'},fingerprint:changed.fingerprint},h.owner,409)
  const after=await h.state()
  for(const key of ['packs','charges','payments','bookings','people'])assert.deepEqual(after[key],before[key],key+' is unaffected by reporting import')
  const terms=await h.cmd('plan.recurring.prepare',{packId:pack.id,intervalMonths:1,requestId:'synthetic-strap-history-native'})
  await h.cmd('plan.recurring.accept',{id:terms.id,key:terms.key},member.cookie)
  const editClock=async(kind,row)=>h.db.prepare('UPDATE st_records SET data=? WHERE kind=? AND id=?').bind(JSON.stringify(row),kind,row.id).run()
  await editClock('recurringTerms',{...(await h.state()).recurring.terms.find(t=>t.id===terms.id),nextRenewalAt:at(-1)})
  await editClock('pack',{...(await h.state()).packs.find(p=>p.id===pack.id),expiresAt:at(-1)})
  await(await h.mf.getWorker()).scheduled()
  const state=await h.state(),invoice=state.recurring.invoices.find(i=>i.recurringTermsId===terms.id)
  assert.ok(invoice)
  const payment=await h.cmd('payment.record',{personId:member.id,amountCents:12000,reference:'synthetic-strap-history-native-payment'})
  await h.cmd('contract.prepayment.record',{packId:invoice.packId,paymentId:payment.id,chargeId:invoice.chargeId,amountCents:12000,reference:'synthetic-strap-history-allocation'})
  const end=await h.cmd('plan.cancellation.prepare',{packId:invoice.packId,effectiveAt:at(5),reasonCode:'moved-away',reason:'Requested stop',requestId:'synthetic-strap-history-stop'})
  const cancellation=await h.cmd('plan.cancellation.confirm',{id:end.id,key:end.key,requestId:'synthetic-strap-history-stop-confirm'})
  await editClock('contractCancellation',{...cancellation,effectiveAt:at(-0.5)})
  await(await h.mf.getWorker()).scheduled();await(await h.mf.getWorker()).scheduled()
  const path='/api/strap/reports/retention',report=(await h.send(path,undefined,h.owner)).value
  assert.equal(report.cohorts.length,1)
  const cohort=report.cohorts[0]
  assert.equal(cohort.acquisitionMonth,month(-18).slice(0,7));assert.equal(cohort.initialOffer,'Original source offer')
  assert.equal(cohort.terms,20);assert.equal(cohort.attendedVisits,37,'reported historical visits and post-cutover native visits reconcile without counting a pre-cutover native observation twice');assert.equal(cohort.renewedTerms,19)
  assert.deepEqual(cohort.churnByReason,[{label:'Moved away',count:1}])
  assert.equal(report.rows.filter(r=>r.source==='imported').length,18)
  const original=report.rows.find(r=>r.source==='imported')
  assert.deepEqual(original.sourceRecord,preview.history.terms[0]);assert.equal(original.collectedRenewalCents,9000)
  const native=report.rows.find(r=>r.packId===pack.id)
  assert.equal(native.renewalInvoiceId,invoice.id);assert.equal(native.collectedRenewalCents,12000);assert.deepEqual(native.paymentIds,[payment.id])
  const selected=(await h.send(path+'?history='+encodeURIComponent(imported.id),undefined,h.owner)).value.selectedHistory
  assert.deepEqual(selected.terms,preview.history.terms);assert.equal(selected.importedBy,imported.importedBy)
  for(const url of [original.packUrl,...original.chargeUrls,...original.paymentUrls,native.renewalUrl,...native.paymentUrls])assert.equal((await h.send(url,undefined,h.owner)).status,200)
  const {parseCsv}=await import('./report-downloads.mjs'),[keys,...values]=parseCsv((await h.send(path+'.csv',undefined,h.owner)).text)
  assert.deepEqual(values.map(v=>Object.fromEntries(keys.map((k,i)=>[k,v[i]]))),report.rows)
  await assertNativeDownloads(h,path,['','month='+cohort.acquisitionMonth],[member.cookie,coach.cookie,''])
  if(process.env.STRAP_PROOF_DIR)await(await import('./reports-browser.mjs')).retentionHistoryBrowser(h,report,original)
}))

test('RPT-004: monthly annual-plan, ten-pack and gift cash, earned value and liabilities reconcile through recorded sales, attendance, partial funding refund and source downloads',async()=>{
  if(process.env.STRAP_FINANCE_TIMING==='1'){await(await import('./finance-timing.mjs')).financeTiming();return}
  await run(async h=>{
  await h.confirmSetup(h.owner)
  for(const ext of ['', '.csv','.xlsx']){const denied=await h.send('/api/strap/reports/finance'+ext,undefined,h.owner);assert.equal(denied.status,403);assert.equal(denied.value.error,'mfa_enrollment_required')}
  await h.enroll(h.owner)
  await h.cmd('studio.save',{location:'Finance studio',timeZone:'America/Phoenix'})
  const member=await h.person('FinanceMember'), coach=await h.person('FinanceCoach','instructor')
  const buy=async extra=>h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,amountCents:120000,kind:'unlimited',planName:'Annual studio',expiresAt:'2099-12-31T00:00:00Z',...extra})).id})
  const annual=await buy({}), ten=await buy({kind:'credits',credits:10,planName:'Ten pack',amountCents:20000})
  await h.cmd('payment.record',{personId:member.id,amountCents:120000,reference:'synthetic-strap-finance-1'})
  await h.cmd('payment.record',{personId:member.id,amountCents:20000,reference:'synthetic-strap-finance-2'})
  const gift=await h.cmd('retail.gift.issue',{personId:member.id,recipientId:member.id,amountCents:10000,tender:'external',reference:'synthetic-strap-finance-3',locationId:'studio',requestId:'synthetic-strap-finance-3'})
  const supplier=await h.cmd('retail.supplier.add',{name:'Finance supplier',reference:'synthetic-strap-finance-4',requestId:'synthetic-strap-finance-4'})
  const sku=await h.cmd('retail.sku.add',{supplierId:supplier.id,sku:'FINANCE-MAT',barcode:'synthetic-strap-finance-5',name:'Mat',variant:'Standard',priceCents:2000,lowStock:0,requestId:'synthetic-strap-finance-5'})
  await h.cmd('retail.receive',{skuId:sku.id,quantity:2,locationId:'studio',reference:'synthetic-strap-finance-6',requestId:'synthetic-strap-finance-6'})
  const retail=await h.cmd('retail.sell',{personId:member.id,skuId:sku.id,locationId:'studio',quantity:1,expectedCents:2000,tender:'gift',giftCardId:gift.id,reference:'synthetic-strap-finance-7',requestId:'synthetic-strap-finance-7'})
  const refundInput={giftCardId:gift.id,amountCents:3000,reason:'Partial unused funding returned externally',reference:'synthetic-strap-finance-8',requestId:'synthetic-strap-finance-8'}
  const refund=await h.cmd('retail.gift.refund',refundInput)
  assert.deepEqual(await h.cmd('retail.gift.refund',refundInput),refund)
  const start=new Date(Date.now()+48*hour).toISOString()
  const entry=(await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:monday(start),classes:[{title:'Finance attended service',start,end:new Date(Date.parse(start)+hour).toISOString(),capacity:3,instructorId:coach.id}]})).id})).classes[0]
  // The earlier-expiring finite pack supplies this booking through the real door.
  const pack=(await h.state()).packs.find(p=>p.id===ten.id)
  await h.cmd('pack.adjust',{id:ten.id,revision:pack.creditRevision,creditsDelta:0,expiresAt:'2098-12-31T00:00:00Z',reason:'Access correction retains original sale',requestId:'synthetic-strap-finance-9'})
  const booking=await h.cmd('booking.book',{classId:entry.id},member.cookie)
  assert.equal(booking.packId,ten.id)
  await h.cmd('attendance.checkin',{id:booking.id},coach.cookie)
  // Only retained historical timestamps move: sales, tender and attendance were all made through HTTP.
  const rows=(await h.db.prepare('SELECT id,kind,data FROM st_records').all()).results
  await h.db.batch(rows.map(row=>{
    const r=JSON.parse(row.data)
    if(r.createdAt)r.createdAt='2020-01-01T07:00:00.000Z'
    if(row.kind==='pack'){r.createdAt='2020-01-01T07:00:00.000Z';r.expiresAt='2021-01-01T07:00:00.000Z'}
    if(row.kind==='draft'&&r.type==='pack')r.expiresAt='2021-01-01T07:00:00.000Z'
    if(row.kind==='class'){r.start='2020-01-15T10:00:00.000Z';r.end='2020-01-15T11:00:00.000Z'}
    if(row.kind==='booking')r.checkedInAt='2020-01-15T10:00:00.000Z'
    if(row.id===refund.chargeId||row.id===refund.paymentId||row.kind==='giftEntry'&&r.kind==='funding_refund')r.createdAt='2020-02-05T00:00:00.000Z'
    return h.db.prepare('UPDATE st_records SET data=? WHERE id=?').bind(JSON.stringify(r),row.id)
  }))
  const read=async month=>{const r=await h.send('/api/strap/reports/finance?financeMonth='+month,undefined,h.owner);assert.equal(r.status,200,r.text);return r.value}
  const jan=await read('2020-01'), feb=await read('2020-02'), earnedAnnual=Math.floor((120000*31+183)/366)
  assert.deepEqual([jan.closing.cashCents,jan.closing.serviceInvoiceCents,jan.closing.giftFundingCents,jan.closing.noncashGiftTenderCents,jan.closing.receivableCents],[150000,142000,10000,2000,0])
  assert.deepEqual([jan.closing.earnedCents,jan.closing.deferredCents,jan.closing.unusedPackCents,jan.closing.giftLiabilityCents,jan.closing.unclassifiedCents],[earnedAnnual+4000,120000-earnedAnnual+18000,18000,8000,0])
  assert.deepEqual([feb.period.cashCents,feb.period.giftFundingCents,feb.closing.giftLiabilityCents],[-3000,-3000,5000])
  assert.deepEqual(feb.opening,jan.closing)
  for(const report of [jan,feb,await read('2020-12'),await read('2021-01')]){
    const t=report.closing
    assert.equal(t.reconciliationDifferenceCents,0)
    assert.equal(t.cashCents+t.receivableCents,t.earnedCents+t.deferredCents+t.giftLiabilityCents+t.unclassifiedCents)
    assert.equal(t.serviceInvoiceCents,t.earnedCents+t.deferredCents+t.unclassifiedCents)
    assert.equal(report.taxCents,null)
  }
  assert.equal((await read('2021-01')).rows.find(r=>r.packId===annual.id).deferredCents,0)
  assert.equal((await read('2021-01')).closing.unusedPackCents,18000,'expired unused credits never become automatic breakage revenue')
  assert.deepEqual(jan.rows.find(r=>r.packId===ten.id).consumedBookingIds,[booking.id])
  assert.equal(jan.sources.find(r=>r.id===retail.paymentId).kind,'gift-tender')
  const version=(await h.state()).version
  for(const report of [jan,feb])await (await import('./finance-downloads.mjs')).assertFinanceDownloads(h,h.owner,report)
  for(const invalid of ['2020-00','2020-13','2020-01-01'])assert.equal((await h.send('/api/strap/reports/finance?financeMonth='+invalid,undefined,h.owner)).status,400)
  for(const cookie of [member.cookie,coach.cookie,''])for(const ext of ['', '.csv','.xlsx'])assert.equal((await h.send('/api/strap/reports/finance'+ext,undefined,cookie)).status,cookie?403:401)
  const agent=await h.cmd('agent.create',{label:'Finance refusal'})
  for(const ext of ['', '.csv','.xlsx'])assert.equal((await h.send('/api/strap/reports/finance'+ext,undefined,'',{authorization:'Bearer '+agent.token})).status,401)
  const afterAgent=(await h.state()).version
  await read('2020-02');assert.equal((await h.state()).version,afterAgent,'report reads have no business writes')
  assert.equal(afterAgent,version)
  if(process.env.STRAP_PROOF_DIR)await(await import('./finance-browser.mjs')).financeBrowser(h,{report:feb,month:'2020-02'})
},{mfa:false})})
