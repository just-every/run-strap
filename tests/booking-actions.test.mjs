import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'

const hour = 3_600_000, minute = 60_000
const at = hours => new Date(Math.ceil((Date.now() + hours * hour) / minute) * minute).toISOString()
const monday = start => { const d = new Date(start); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (d.getUTCDay() + 6) % 7)).toISOString().slice(0, 10) }
const day = start => new Intl.DateTimeFormat('en-CA', {timeZone:'America/Chicago'}).format(new Date(start))
const roster = c => `/app?day=${day(c.start)}&class=${c.id}`
const profile = p => `/app/people?person=${p.id}`
const form = (h, name, back, fields, cookie = h.owner) => h.mf.dispatchFetch(h.origin + `/app/action?name=${name}&returnTo=${encodeURIComponent(back)}`, {method:'POST',headers:{origin:h.origin,cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields),redirect:'manual'})
async function refused(h, name, input, cookie, code, status = 409) {
  const before = (await h.state()).version, r = await h.send('/api/strap/command',{name,input},cookie)
  assert.equal(r.status,status,JSON.stringify(r.value)); assert.equal(r.value.error,code)
  assert.equal((await h.state()).version,before,`${code}: no writes`)
}
async function studio(h) {
  await h.mf.dispatchFetch(h.origin+'/setup',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
  await h.cmd('studio.save',{location:'Nashville',timeZone:'America/Chicago'})
  await h.cmd('bookingRule.save',{cancelCutoffHours:12,lateCancelReturnsCredit:false,lateCancelFeeCents:1500})
  const coach = await h.person('Maya','instructor')
  const member = async (name, credits = 4) => {
    const p = await h.person(name)
    const pack = await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:p.id,credits,amountCents:credits*2000,expiresAt:'2099-12-31T00:00:00Z'})).id})
    return {...p,packId:pack.id}
  }
  const publish = async (title, hours, capacity = 1, room = title, instructor = coach) => {
    const start = at(hours)
    return (await h.cmd('classes.publish',{id:(await h.cmd('classes.prepare',{week:monday(start),classes:[{title,service:'Mat',room,start,end:new Date(Date.parse(start)+50*minute).toISOString(),capacity,instructorId:instructor.id}]})).id})).classes[0]
  }
  return {coach,member,publish}
}
const packOf = (s,p) => s.packs.find(pack => pack.id === p.packId)
const bookingOf = (s,id) => s.bookings.find(b => b.id === id)
const rows = text => text.trimEnd().split('\r\n').map((line,index) => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(m => { const value = m[1].replace(/""/g,'"'); return index ? JSON.parse(value) : value }))

test('SCHED-014: staff cancellation previews, reasons, waiver and suppression, once-only promotion, restored credit and fee reversal, filtered list/export, bulk partial outcomes, and denied actors', async () => {
  await run(async h => {
    const {coach,member,publish} = await studio(h)
    const ana = await member('Ana'), ben = await member('Ben'), cy = await member('Cy'), dee = await member('Dee'), eve = await member('Eve')
    const flow = await publish('Evening Flow',6), later = await publish('Gentle Flow',2,4), bulkClass = await publish('Weekend Mat',30,4)
    const first = await h.cmd('booking.book',{classId:flow.id},ana.cookie)
    const waiter = await h.cmd('booking.book',{classId:flow.id},ben.cookie)
    const late = await h.cmd('booking.book',{classId:later.id},cy.cookie), courtesy = await h.cmd('booking.book',{classId:later.id},dee.cookie)
    const bulkA = await h.cmd('booking.book',{classId:bulkClass.id},eve.cookie)
    assert.equal((await form(h,'cancellationReasons.save','/app/people',{reasons:'Sick\nTravel\nOther'})).status,303)
    await refused(h,'cancellationReasons.save',{reasons:['Sick','sick']},h.owner,'duplicate_cancellation_reason',400)
    await refused(h,'cancellationReasons.save',{reasons:['Other']},coach.cookie,'owner_required',403)
    let s = await h.state(), effect = bookingOf(s,first.id).cancelEffect
    assert.deepEqual([effect.timing,effect.feeCents],['late',1500],'six hours is inside a twelve-hour cutoff; only explicit early waiver makes fee zero')
    const preview = (await h.send(roster(flow),undefined,h.owner)).text
    assert.match(preview,/\$15\.00 fee added/); assert.match(preview,/Early cancel: credit back, no fee/)
    await refused(h,'booking.cancel',{id:first.id,mode:'early',reason:'Ill'},h.owner,'invalid_cancellation_reason',400)
    await refused(h,'booking.cancel',{id:first.id,mode:'early',reason:'Ill',cancelReason:'Not configured'},h.owner,'unknown_cancellation_reason',400)
    await refused(h,'booking.cancel',{id:first.id,mode:'early',reason:'Ill',cancelReason:'Sick'},coach.cookie,'forbidden',403)
    assert.equal((await form(h,'booking.cancel',roster(flow),{id:first.id,terms:effect.key,mode:'early',reason:'Sick courtesy waiver',cancelReason:'Sick',channel:'desk'})).status,303)
    s = await h.state()
    assert.equal(bookingOf(s,first.id).refunded,true); assert.equal(bookingOf(s,waiter.id).status,'booked')
    assert.equal(s.packCreditEvents.filter(e => e.bookingId === waiter.id && e.type === 'reserve').length,1)
    assert.equal(packOf(s,ana).remaining,4); assert.equal(packOf(s,ben).remaining,3)
    let action = s.bookingActions.find(a => a.bookingId === first.id && a.action === 'cancel')
    assert.deepEqual([action.actorId,action.actorRole,action.channel,action.type,action.reason,action.staffMade,action.right],[s.actor.id,'owner','desk','early','Sick',true,'booking'])
    assert.equal(action.waiver.right,'fee-waiver'); assert.equal(action.notice.status,'in_app'); assert.equal(action.notice.mailStatus,'not_configured')
    assert.equal((await h.state(ana.cookie)).notices.filter(n => n.id === `notice:action:${action.id}`).length,1)
    assert.equal((await h.db.prepare('SELECT count(*) AS n FROM st_notice_deliveries WHERE source_id=?').bind(action.id).first()).n,1)
    await refused(h,'booking.restore',{id:first.id,reason:'Cancelled wrong member'},h.owner,'class_full')
    // Never take back the promoted seat. A reasoned owner override can add a seat.
    assert.equal(bookingOf(await h.state(),waiter.id).status,'booked')
    await h.cmd('booking.restore',{id:first.id,reason:'Wrong booking; extra mat approved',override:'Extra mat approved'})
    s = await h.state(); assert.equal(bookingOf(s,waiter.id).status,'booked'); assert.equal(bookingOf(s,first.id).override.right,'override')
    await h.cmd('booking.cancel',{id:first.id,mode:'early',reason:'Correcting the request',cancelReason:'Other'})
    await h.cmd('booking.cancel',{id:waiter.id,mode:'early',reason:'Member cannot attend',cancelReason:'Other'})
    assert.equal((await form(h,'booking.restore',profile(ana),{id:first.id,reason:'Cancelled wrong member',channel:'phone'})).status,303)
    s = await h.state(); assert.equal(packOf(s,ana).remaining,3); assert.equal(bookingOf(s,first.id).status,'booked')
    assert.ok(s.bookingActions.find(a => a.action === 'cancel' && a.id === action.id).restoredAt)
    await refused(h,'booking.restore',{id:first.id,reason:'Again'},h.owner,'cancellation_not_restorable')
    // A profile late cancel assesses exactly one fee, later reversed once by restore.
    assert.match((await h.send(profile(cy),undefined,h.owner)).text,/\$15\.00 fee added/)
    assert.equal((await form(h,'booking.cancel',profile(cy),{id:late.id,mode:'late',cancelReason:'Other',channel:'phone'})).status,303)
    s = await h.state(); assert.equal(s.charges.filter(c => c.bookingId === late.id && c.reason === 'late_cancel_fee').length,1)
    await refused(h,'booking.cancel',{id:late.id,mode:'late',cancelReason:'Other'},h.owner,'already_cancelled')
    const beforeRestore = packOf(s,cy).remaining
    await h.cmd('booking.restore',{id:late.id,reason:'Wrong booking selected'})
    s = await h.state(); assert.equal(packOf(s,cy).remaining,beforeRestore,'kept credit reused, no second debit')
    assert.equal(s.charges.filter(c => c.bookingId === late.id && c.reason === 'fee_reversal').reduce((n,c) => n+c.amountCents,0),-1500)
    // Courtesy suppression sends neither in-app nor email, and retains the two reasons.
    assert.equal((await form(h,'booking.cancel',profile(dee),{id:courtesy.id,mode:'early',reason:'Manager courtesy',cancelReason:'Travel',suppressNotice:'true',suppressionReason:'Already spoke by phone',channel:'phone'})).status,303)
    s = await h.state(); const suppressed = s.bookingActions.find(a => a.bookingId === courtesy.id && a.action === 'cancel')
    assert.deepEqual([suppressed.notice.status,suppressed.notice.suppressionReason,suppressed.waiver.reason],['suppressed','Already spoke by phone','Manager courtesy'])
    assert.equal((await h.state(dee.cookie)).notices.filter(n => n.id === `notice:action:${suppressed.id}`).length,0)
    assert.equal((await h.db.prepare('SELECT count(*) AS n FROM st_notice_deliveries WHERE source_id=?').bind(suppressed.id).first()).n,0)
    assert.equal(s.charges.filter(c => c.bookingId === courtesy.id).length,0); assert.equal(packOf(s,dee).remaining,4)
    const unpaid = await h.cmd('booking.desk',{personId:eve.id,classId:later.id,pay:'unpaid'})
    const eventsBefore = (await h.state()).packCreditEvents.length
    await h.cmd('booking.cancel',{id:unpaid.id,mode:'early',reason:'Unpaid visit released',cancelReason:'Other'})
    assert.equal(bookingOf(await h.state(),unpaid.id).refunded,false)
    assert.equal((await h.state()).packCreditEvents.length,eventsBefore,'releasing an unpaid visit invents no credit')
    const bulkResponse = await form(h,'booking.bulk.cancel',roster(bulkClass),{[`b_${bulkA.id}`]:'true',[`b_${courtesy.id}`]:'true',cancelReason:'Other',reason:'Instructor unavailable',channel:'desk'})
    assert.equal(bulkResponse.status,200); const bulkText = await bulkResponse.text()
    assert.match(bulkText,/Bulk cancellation results/); assert.match(bulkText,/already_cancelled/)
    const repeat = await h.cmd('booking.bulk.cancel',{ids:[bulkA.id,courtesy.id],cancelReason:'Other',reason:'Repeat'})
    assert.deepEqual(repeat.bulk.outcomes.map(o => o.ok),[false,false])
    s = await h.state(); assert.equal(s.bookingActions.filter(a => a.bookingId === bulkA.id && a.action === 'cancel').length,1)
    const filter = `classId=${later.id}&type=late&staffId=${s.actor.id}&date=${day(new Date().toISOString())}`
    const csv = await h.send('/api/strap/cancellations.csv?'+filter,undefined,h.owner), parsed = rows(csv.text)
    assert.equal(csv.status,200); assert.equal(parsed.length,2)
    const exported = Object.fromEntries(parsed[0].map((key,i) => [key,parsed[1][i]]))
    assert.deepEqual([exported.bookingId,exported.type,exported.channel,exported.feeCents,exported.reason],[late.id,'late','phone',1500,'Other'])
    assert.ok(exported.restoredAt); assert.equal(exported.actorId,s.actor.id)
    const screen = (await h.send('/app/people?'+filter,undefined,h.owner)).text
    assert.match(screen,/1 cancellations · 1 late/); assert.match(screen,/Restored /)
    assert.equal((await h.send('/api/strap/cancellations.csv',undefined,ana.cookie)).status,403)
    assert.equal((await h.send('/api/strap/cancellations.csv',undefined,coach.cookie)).status,403)
    await refused(h,'booking.move',{id:first.id,classId:later.id,cancelReason:'Other'},ben.cookie,'forbidden',403)
    for (const name of ['booking.restore','booking.waitlist.position','booking.bulk.cancel']) await refused(h,name,{id:first.id,classId:later.id,reason:'Unauthorized',ids:[first.id]},ana.cookie,'owner_required',403)
    const key = await h.cmd('agent.create',{label:'Class planner'})
    const version = (await h.state()).version
    assert.equal((await h.send('/api/strap/agent/command',{name:'booking.cancel',input:{id:first.id,cancelReason:'Other'}},'',{authorization:`Bearer ${key.token}`})).status,403)
    assert.equal((await h.state()).version,version)
    const closing = await publish('Storm closure mat',40)
    const closingSeat = await h.cmd('booking.book',{classId:closing.id},eve.cookie)
    const closure = await h.cmd('closure.prepare',{scope:'class',classId:closing.id,reason:'Storm closure'})
    await h.cmd('closure.confirm',{id:closure.id,impact:closure.impact.key})
    const recorded = (await h.state()).bookingActions.find(a => a.bookingId === closingSeat.id && a.action === 'cancel')
    assert.deepEqual([recorded.type,recorded.reason,recorded.notice.status,recorded.actorRole],['class_cancelled','Storm closure','in_app','owner'])
    assert.equal(rows((await h.send('/api/strap/cancellations.csv?type=class_cancelled',undefined,h.owner)).text).length,2)
    if (process.env.STRAP_PROOF_DIR) await (await import('./booking-actions-browser.mjs')).bookingActionsBrowser(h,{flow,later,ana,cy,first,late})
  })
})

test('SCHED-014: an atomic move carries one credit, full targets wait without releasing the source, capacity and spot overrides stay attributable, queue edits and offer acceptance are staff-made, and agent drafts need exact human approval', async () => {
  await run(async h => {
    const {coach,member,publish} = await studio(h)
    const ana = await member('Ana',1), ben = await member('Ben',3), cy = await member('Cy',3), dee = await member('Dee',3)
    const otherCoach = await h.person('Noah','instructor')
    const source = await publish('Six pm Mat',26), full = await publish('Seven pm Mat',27), open = await publish('Seven pm Other Room',27,2,'Other room',otherCoach)
    await h.cmd('spots.save',{room:'Other room',spots:['Mat 1','Mat 2'],disabled:[]})
    const original = await h.cmd('booking.book',{classId:source.id},ana.cookie), waiting = await h.cmd('booking.book',{classId:source.id},ben.cookie)
    const occupied = await h.cmd('booking.book',{classId:full.id},cy.cookie)
    await refused(h,'booking.move',{id:original.id,classId:open.id,cancelReason:'Other'},coach.cookie,'forbidden',403)
    const queued = await h.cmd('booking.move',{id:original.id,classId:full.id,cancelReason:'Other',channel:'phone'})
    let s = await h.state()
    assert.equal(queued.status,'waitlisted'); assert.equal(bookingOf(s,original.id).classId,source.id); assert.equal(bookingOf(s,original.id).status,'booked'); assert.equal(packOf(s,ana).remaining,0)
    assert.equal((await form(h,'booking.move',roster(source),{id:original.id,classId:open.id,cancelReason:'Other',channel:'desk',spot:'Mat 2'})).status,303)
    s = await h.state(); const moved = bookingOf(s,original.id)
    assert.deepEqual([moved.classId,moved.spot,packOf(s,ana).remaining],[open.id,'Mat 2',0])
    assert.equal(s.packCreditEvents.filter(e => e.bookingId === original.id && e.type === 'reserve').length,1,'one original credit debit')
    assert.equal(s.packCreditEvents.filter(e => e.bookingId === original.id && e.type === 'transfer').length,1)
    assert.equal(bookingOf(s,waiting.id).status,'booked'); assert.equal(s.packCreditEvents.filter(e => e.bookingId === waiting.id && e.type === 'reserve').length,1)
    assert.equal(s.bookingActions.filter(a => a.action === 'move' && a.bookingId === original.id).length,1)
    // Duplicate target and taken spot refuse without writes.
    await refused(h,'booking.move',{id:original.id,classId:open.id,cancelReason:'Other'},h.owner,'different_class_required',400)
    await refused(h,'booking.move',{id:waiting.id,classId:open.id,cancelReason:'Other',spot:'Mat 2'},h.owner,'spot_taken')
    const over = await h.cmd('booking.move',{id:waiting.id,classId:full.id,cancelReason:'Other',override:'Extra mat approved',channel:'inbox'})
    assert.equal(over.classId,full.id); assert.equal(over.override.right,'override'); assert.equal(over.override.reason,'Extra mat approved')
    assert.equal(bookingOf(await h.state(),occupied.id).status,'booked','override never steals a seat')
    const deskWaiter = await h.cmd('booking.desk',{personId:dee.id,classId:full.id,waitlist:true})
    await refused(h,'booking.waitlist.position',{id:deskWaiter.id,position:1},h.owner,'invalid_override_reason',400)
    await h.cmd('booking.waitlist.position',{id:deskWaiter.id,position:1,reason:'Arrival correction',channel:'phone'})
    s = await h.state(); assert.equal(s.bookingActions.find(a => a.bookingId === deskWaiter.id && a.action === 'position').overrideRight,'override')
    // Offers are accepted at the desk under the same fence and exactly one credit.
    await h.cmd('waitlist.save',{mode:'offer',claimMinutes:30,lateWindow:'promote'})
    await h.cmd('booking.cancel',{id:occupied.id,cancelReason:'Other'})
    await h.cmd('booking.cancel',{id:waiting.id,cancelReason:'Other'})
    s = await h.state(); assert.equal(bookingOf(s,deskWaiter.id).status,'offered')
    await h.cmd('booking.offer.accept',{id:deskWaiter.id,channel:'phone'})
    s = await h.state(); assert.equal(s.bookingActions.filter(a => a.bookingId === deskWaiter.id && a.action === 'accept').length,1)
    assert.equal(s.packCreditEvents.filter(e => e.bookingId === deskWaiter.id && e.type === 'reserve').length,1)
    // Agent can prepare an exact change, never execute it or approve it.
    const key = await h.cmd('agent.create',{label:'Booking assistant'})
    const prepared = await h.send('/api/strap/agent/command',{name:'booking.change.prepare',input:{action:'cancel',id:original.id,cancelReason:'Other'}},'',{authorization:`Bearer ${key.token}`})
    assert.equal(prepared.status,200)
    assert.equal(bookingOf(await h.state(),original.id).status,'booked')
    assert.equal((await h.send('/api/strap/agent/command',{name:'booking.change.approve',input:{id:prepared.value.id}},'',{authorization:`Bearer ${key.token}`})).status,403)
    if (process.env.STRAP_PROOF_DIR) await (await import('./booking-actions-browser.mjs')).bookingDraftBrowser(h,prepared.value)
    else await h.cmd('booking.change.approve',{id:prepared.value.id})
    assert.equal(bookingOf(await h.state(),original.id).status,'cancelled')
    await refused(h,'booking.change.approve',{id:prepared.value.id},h.owner,'booking_facts_changed')
  })
})

test('SCHED-014: pending moves retain the source and its single credit until an explicit current-effect claim, late moves assess only a disclosed fee, and changed eligibility refuses atomically', async () => {
  const sent = []
  await run(async h => {
    const {member,publish} = await studio(h)
    const ana = await member('Ana',1), ben = await member('Ben',2), cy = await member('Cy',2)
    const source = await publish('Original Mat',6), target = await publish('Target Mat',7), alternate = await publish('Later Mat',8)
    const original = await h.cmd('booking.book',{classId:source.id},ana.cookie), occupied = await h.cmd('booking.book',{classId:target.id},ben.cookie)
    const pending = await h.cmd('booking.move',{id:original.id,classId:target.id,cancelReason:'Other',channel:'phone'})
    assert.equal(pending.moveFromBookingId,original.id)
    const startedVersion = (await h.state()).version
    await refused(h,'booking.move',{id:original.id,classId:alternate.id,mode:'early',cancelReason:'Other'},h.owner,'invalid_waiver_reason',400)
    assert.equal((await h.state()).version,startedVersion)
    await h.cmd('booking.cancel',{id:occupied.id,mode:'early',reason:'Studio courtesy',cancelReason:'Other'})
    let s = await h.state(ana.cookie), offer = bookingOf(s,pending.id)
    assert.equal(offer.status,'offered','a pending move always offers even under automatic promotion policy')
    assert.equal(bookingOf(s,original.id).classId,source.id); assert.equal(packOf(s,ana).remaining,0)
    assert.equal(offer.moveEffect.feeCents,1500)
    assert.match((await h.send('/app',undefined,ana.cookie)).text,/\$15\.00 fee added; your original credit moves/)
    await refused(h,'booking.offer.accept',{id:pending.id,terms:'early|1|0'},ana.cookie,'cancellation_terms_changed')
    await refused(h,'booking.offer.accept',{id:pending.id,terms:offer.moveEffect.key,mode:'early'},ana.cookie,'fee_waiver_right_required',403)
    if (process.env.STRAP_PROOF_DIR) await (await import('./booking-actions-browser.mjs')).pendingMoveBrowser(h,ana,pending)
    else await h.cmd('booking.offer.accept',{id:pending.id,terms:offer.moveEffect.key},ana.cookie)
    s = await h.state()
    assert.equal(bookingOf(s,original.id).classId,target.id); assert.equal(bookingOf(s,pending.id).cancellation,'move_completed')
    assert.equal(packOf(s,ana).remaining,0); assert.equal(packOf(s,ana).summary.reserved,1); assert.equal(packOf(s,ana).summary.consumed,0)
    const fee = s.charges.filter(c => c.bookingId === original.id && c.reason === 'late_move_fee')
    assert.equal(fee.length,1); assert.equal(fee[0].amountCents,1500)
    assert.equal(s.bookingActions.find(a => a.bookingId === original.id && a.action === 'move').acceptedOfferId,pending.id)
    await refused(h,'booking.offer.accept',{id:pending.id,terms:offer.moveEffect.key},ana.cookie,'no_open_offer')
    assert.equal(sent.filter(m => m.to.includes(ana.email)).length,3,'one email for pending request, one offer and one completed move')
    const actionMail = (await h.db.prepare("SELECT status,provider_message_id FROM st_notice_deliveries WHERE source_kind='booking_action' AND person_id=?").bind(ana.id).all()).results
    assert.equal(actionMail.length,2); assert.ok(actionMail.every(m => m.status === 'accepted' && m.provider_message_id))
    // A full move followed by another explicit move closes its old wait request.
    const occupiedLater = await h.cmd('booking.book',{classId:alternate.id},cy.cookie)
    const pendingAgain = await h.cmd('booking.move',{id:original.id,classId:alternate.id,cancelReason:'Other'})
    await h.cmd('booking.move',{id:original.id,classId:source.id,cancelReason:'Other',mode:'late'})
    assert.equal(bookingOf(await h.state(),pendingAgain.id).cancellation,'move_replaced')
    assert.equal(bookingOf(await h.state(),occupiedLater.id).status,'booked')
    // Current waiver and target window are checked again, even with an override.
    await h.cmd('waiver.publish',{text:'A new current studio waiver for every class.'})
    await refused(h,'booking.move',{id:original.id,classId:target.id,cancelReason:'Other',mode:'late',override:'Extra mat'},h.owner,'waiver_acknowledgement_required')
    await h.cmd('waiver.acknowledge',{id:(await h.state()).waiver.id},ana.cookie)
    await h.cmd('bookingRule.save',{service:'Mat',closesMinutesBefore:600,cancelCutoffHours:12,lateCancelFeeCents:1500,lateCancelReturnsCredit:false})
    await refused(h,'booking.move',{id:original.id,classId:target.id,cancelReason:'Other',mode:'late',override:'Extra mat'},h.owner,'booking_window_closed')
  },{auth:{MAIL_PROVIDER:'resend',MAIL_API_KEY:'test-resend-key',MAIL_FROM:'studio@example.test'},outbound:async request => {
    assert.equal(new URL(request.url).hostname,'api.resend.com')
    const message = await request.json()
    if (request.headers.get('idempotency-key')?.startsWith('mail:confirmation:')) return Response.json({id:request.headers.get('idempotency-key')})
    sent.push(message)
    return Response.json({id:`booking-mail-${sent.length}`})
  }})
})
