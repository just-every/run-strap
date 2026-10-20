import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'

const hour = 3_600_000
const monday = start => { const d = new Date(start); return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7)).toISOString().slice(0,10) }

test('RPT-002: attendance, usable-seat occupancy and historical member/staff cancellations drill to their public source records', () => run(async h => {
  await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
  await h.cmd('studio.save',{location:'Nashville',timeZone:'America/Chicago'})
  const coach = await h.person('Maya','instructor'), other = await h.person('Rae','instructor'), people = {}
  for (const name of ['Ana','Ben','Cy','Dee','Eli']) {
    people[name] = await h.person(name)
    await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:people[name].id,credits:10,amountCents:20000,expiresAt:'2099-12-31T00:00:00Z'})).id})
  }
  const {Ana,Ben,Cy,Dee,Eli} = people
  await h.cmd('spots.save',{room:'Reformer room',spots:['R1','R2','R3'],disabled:['R3']})
  await h.cmd('bookingRule.save',{cancelCutoffHours:12,lateCancelReturnsCredit:true,lateCancelFeeCents:1500})
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
  if (process.env.STRAP_PROOF_DIR) await (await import('./reports-browser.mjs')).reportsBrowser(h,{flow,later,report})
  await h.cmd('attendance.correct',{id:b.id,outcome:'attended',reason:'The instructor confirmed Ben attended'})
  const corrected = await read('')
  assert.deepEqual([corrected.totals.attended,corrected.totals.noShow,corrected.totals.uniqueVisitors,corrected.totals.lateCancelled],[3,0,2,1])
}))
