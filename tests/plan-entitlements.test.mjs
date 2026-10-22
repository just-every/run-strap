import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'

// PLAN-002 journeys run on the New York studio clock: periods, plan hours and
// rule windows are all studio-local.
const zone = 'America/New_York'
const addDays = (date, days) => new Date(Date.parse(date + 'T12:00:00Z') + days * 86400_000).toISOString().slice(0, 10)
const mondayOf = date => addDays(date, -((new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7))
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date())
const offset = date => { const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(new Date(date + 'T12:00:00Z')).find(p => p.type === 'timeZoneName').value; return name === 'GMT' ? '+00:00' : name.slice(3) }
const local = (date, time) => `${date}T${time}:00${offset(date)}`
const setup = h => h.mf.dispatchFetch(h.origin + '/setup', { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=yes', redirect: 'manual' })

async function studio(h) {
  assert.equal((await setup(h)).status, 303)
  await h.cmd('studio.save', { location: 'Park Slope', timeZone: zone })
  return h.person('Priya', 'instructor')
}
/** Publishes classes week by week (a class draft covers one Monday week). */
async function publish(h, coach, items) {
  const byWeek = new Map()
  for (const item of items) { const week = mondayOf(item.date); byWeek.set(week, [...(byWeek.get(week) ?? []), item]) }
  const out = new Map()
  for (const [week, list] of byWeek) {
    const draft = await h.cmd('classes.prepare', { week, classes: list.map(c => ({ title: c.title, service: c.service ?? 'Mat', start: local(c.date, c.time), end: new Date(Date.parse(local(c.date, c.time)) + 3600_000).toISOString(), capacity: c.capacity ?? 10, instructorId: coach.id })) })
    await h.cmd('classes.publish', { id: draft.id })
    draft.classes.forEach((c, i) => out.set(list[i].key, c))
  }
  return out
}
async function sell(h, personId, terms) {
  const draft = await h.cmd('pack.prepare', { personId, amountCents: 18900, expiresAt: '2099-12-01T00:00:00Z', ...terms })
  return h.cmd('pack.approve', { id: draft.id })
}
const book = async (h, cookie, classId) => h.send('/api/strap/command', { name: 'booking.book', input: { classId } }, cookie)
/** A committed answer: a conflicting concurrent commit is retried, a refusal is not. */
async function settle(h, cookie, classId, first) {
  let result = first
  while (result.status === 409 && result.value.error === 'conflict_refresh_and_retry') result = await book(h, cookie, classId)
  return result
}

test('PLAN-002: monthly visits with rollover, unlimited and off-peak plans hold exactly the allowed reservations across a period boundary and concurrent booking', () => run(async h => {
  const coach = await studio(h)
  const alex = await h.person('Alex'), sam = await h.person('Sam'), casey = await h.person('Casey')
  // The first month start at least nine days ahead is the period boundary B.
  let boundary = today().slice(0, 8) + '01'
  while (boundary < addDays(today(), 9)) boundary = addDays(boundary, 32).slice(0, 8) + '01'
  const before = [1, 2, 3, 4, 5, 6].map(n => ({ key: `m${n}`, title: `Mat ${n}`, date: addDays(boundary, -n), time: '11:00' }))
  const after = [0, 1, 2, 3, 4, 5].map(n => ({ key: `n${n}`, title: `Mat next ${n}`, date: addDays(boundary, n), time: '11:00' }))
  let weekday = addDays(today(), 2)
  while ([0, 6].includes(new Date(weekday + 'T12:00:00Z').getUTCDay())) weekday = addDays(weekday, 1)
  const offPeak = [['two', '14:00'], ['six', '18:00'], ['three', '15:00'], ['ten', '10:00']].map(([key, time]) => ({ key, title: `Flow ${time}`, date: weekday, time }))
  const classes = await publish(h, coach, [...before, ...after, { key: 'reformer', title: 'Reformer', service: 'Reformer', date: addDays(boundary, -1), time: '12:00' }, ...offPeak])

  // A four-visit monthly Mat plan with one rollover visit, raced for six Mat classes and a Reformer class in
  // the month before B. When that month is not the plan's first, the first month's unused visit rolls into it.
  const month = addDays(boundary, -1).slice(0, 8) + '01', current = today().slice(0, 8) + '01', allowance = month === current ? 4 : 5
  const monthly = await sell(h, alex.id, { kind: 'visits', planName: 'Monthly four', visits: 4, period: 'month', rollover: 1, eligibleServices: ['Mat'] })
  const draftTerms = (await h.state()).drafts.find(d => d.type === 'pack' && d.personId === alex.id).entitlement
  assert.deepEqual(draftTerms, { kind: 'visits', name: 'Monthly four', visits: 4, period: 'month', rollover: 1, days: null, from: null, to: null, maxUpcoming: null })
  const raced = [...before.map(c => classes.get(c.key).id), classes.get('reformer').id]
  const firsts = await Promise.all(raced.map(id => book(h, alex.cookie, id)))
  const outcomes = []
  for (let i = 0; i < raced.length; i++) outcomes.push(await settle(h, alex.cookie, raced[i], firsts[i]))
  assert.equal(outcomes.filter(r => r.status === 200).length, allowance)
  assert.deepEqual(outcomes.filter(r => r.status !== 200).map(r => r.value.error).sort(), ['eligible_credit_required', ...Array(6 - allowance).fill('plan_visits_used')])
  let state = await h.state(alex.cookie)
  const held = state.bookings.filter(b => b.status === 'booked' && b.packId === monthly.id)
  assert.equal(held.length, allowance)
  assert.ok(!held.some(b => b.classId === classes.get('reformer').id))
  let plan = state.packs.find(p => p.id === monthly.id)
  assert.equal(plan.credits, 0)
  assert.equal(plan.remaining, 0)
  assert.equal(plan.summary.plan.reserved, allowance)
  assert.deepEqual(['used', 'allowance'].map(key => plan.summary.plan.periods.find(p => p.start === month)[key]), [allowance, allowance])
  // Every hold is in the ledger with no credit change.
  assert.ok(state.packCreditEvents.filter(e => e.packId === monthly.id && e.type === 'reserve').every(e => e.credits === 0 && e.remainingAfter === 0))

  // An early cancel returns the visit, so one unused visit rolls into the next month: five there, not six.
  await h.cmd('booking.cancel', { id: held[0].id }, alex.cookie)
  for (const c of after.slice(0, 5)) assert.equal((await book(h, alex.cookie, classes.get(c.key).id)).status, 200)
  assert.equal((await book(h, alex.cookie, classes.get('n5').id)).value.error, 'plan_visits_used')
  // Re-using the returned visit in the first month would take back the rolled-over visit already booked.
  const refused = before.find(c => !held.some(b => b.classId === classes.get(c.key).id))
  assert.equal((await book(h, alex.cookie, classes.get(refused.key).id)).value.error, 'plan_visits_used')
  plan = (await h.state()).packs.find(p => p.id === monthly.id)
  const [first, next] = [plan.summary.plan.periods.find(p => p.start === month), plan.summary.plan.periods.find(p => p.start === boundary)]
  assert.deepEqual([first.used, first.allowance, first.carriedOut, first.returned], [allowance - 1, allowance, 1, 1])
  assert.deepEqual([next.carriedIn, next.allowance, next.used, next.reserved], [1, 5, 5, 5])
  if (month === current) assert.equal(plan.summary.plan.left, 0, 'this month has no visit left that would not take back the rollover')

  // An unlimited plan has no visit count.
  const unlimited = await sell(h, sam.id, { kind: 'unlimited' })
  for (const c of [...before, ...after]) assert.equal((await book(h, sam.cookie, classes.get(c.key).id)).status, 200)
  plan = (await h.state()).packs.find(p => p.id === unlimited.id)
  assert.equal(plan.summary.plan.reserved, 12)
  assert.equal(plan.summary.plan.left, null)
  // Check-in marks a held visit attended without a second hold.
  await h.cmd('attendance.checkin', { id: (await h.state()).bookings.find(b => b.packId === unlimited.id && b.classId === classes.get('n0').id).id }, coach.cookie)
  plan = (await h.state()).packs.find(p => p.id === unlimited.id)
  assert.deepEqual([plan.summary.plan.reserved, plan.summary.plan.attended], [11, 1])

  // Expiring a weekly plan early expires its unused visits by period and stops new bookings.
  const drew = await h.person('Drew'), weekly = await sell(h, drew.id, { kind: 'visits', visits: 3, period: 'week' })
  assert.equal((await book(h, drew.cookie, classes.get('n1').id)).status, 200)
  let drews = (await h.state()).packs.find(p => p.id === weekly.id)
  await h.cmd('pack.adjust', { id: weekly.id, creditsDelta: 0, reason: 'Member moved away', requestId: 'expire-weekly', revision: drews.summary.revision, expiresAt: '2000-01-01T00:00:00Z' })
  drews = (await h.state()).packs.find(p => p.id === weekly.id)
  assert.equal(drews.summary.plan.left, 0)
  assert.ok(drews.summary.plan.periods.length <= 3 && drews.summary.plan.periods.every(p => p.ended && p.start >= mondayOf(today()) && p.expired === p.allowance - p.used))
  assert.equal(drews.summary.plan.periods.reduce((n, p) => n + p.used, 0), 1)
  assert.equal((await book(h, drew.cookie, classes.get('n2').id)).value.error, 'eligible_credit_required')

  // An off-peak plan: weekdays from 10:00 am to before 4:00 pm, two upcoming bookings at once.
  const offpeak = await sell(h, casey.id, { kind: 'unlimited', planName: 'Off-peak', days: [1, 2, 3, 4, 5], from: '10:00', to: '16:00', maxUpcoming: 2 })
  assert.equal((await book(h, casey.cookie, classes.get('two').id)).status, 200)
  assert.equal((await book(h, casey.cookie, classes.get('six').id)).value.error, 'outside_plan_hours')
  assert.equal((await book(h, casey.cookie, classes.get('three').id)).status, 200)
  assert.equal((await book(h, casey.cookie, classes.get('ten').id)).value.error, 'plan_upcoming_limit_reached')
  state = await h.state(casey.cookie)
  assert.deepEqual(state.bookings.filter(b => b.status === 'booked').map(b => b.classId).sort(), [classes.get('two').id, classes.get('three').id].sort())
  assert.ok(!state.bookings.some(b => b.classId === classes.get('six').id))
  // Plans are not credit balances: credit adjustments and PLAN-005 credit changes are refused, expiry adjusts.
  const own = state.packs.find(p => p.id === offpeak.id)
  await h.cmd('pack.adjust', { id: own.id, creditsDelta: 1, reason: 'Courtesy', requestId: 'plan-credit', revision: own.summary.revision }, h.owner, 409)
  await h.cmd('plan.change.request', { packId: own.id, requestId: 'more', note: 'More visits' }, casey.cookie, 409)
  await h.cmd('pack.adjust', { id: own.id, creditsDelta: 0, reason: 'Extended a week', requestId: 'plan-expiry', revision: own.summary.revision, expiresAt: '2099-12-08T00:00:00Z' })
  for (const [cookie, mine] of [[casey.cookie, true], [h.owner, false]]) {
    const packs = await h.send('/app/packs', undefined, cookie)
    assert.match(packs.text, /Unlimited visits · Mon–Fri 10:00 am–4:00 pm starts · up to 2 upcoming bookings at once/)
    assert.equal(packs.text.includes('Alex'), !mine)
  }
  const home = await h.send('/app', undefined, casey.cookie)
  assert.match(home.text, /Outside your plan’s days and hours/)
  assert.match(home.text, /Off-peak: Unlimited visits/)
  const profile = await h.send('/app/people?person=' + alex.id, undefined, h.owner)
  assert.match(profile.text, /Monthly four: 4 visits a month, up to 1 unused rolls over; \d+ visits? left this month/)
  const history = await h.send('/app/packs', undefined, alex.cookie)
  assert.match(history.text, /Rolled in/)
  assert.match(history.text, /5 of 5/)
  if (process.env.STRAP_PROOF_DIR) await (await import('./plan-entitlements-browser.mjs')).planEntitlementsBrowser(h, { member: casey, monthly: alex, evening: 'Flow 18:00' })
}))

test('PLAN-002: plan-level rules and priority seat memberships, and SCHED-014 late cancel, move and restore keep one visit per booking', () => run(async h => {
  const coach = await studio(h)
  const dana = await h.person('Dana'), eli = await h.person('Eli')
  const soon = new Date(Date.now() + 20 * 3600_000), soonDate = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(soon)
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).format(soon)
  const at = `${String(Math.min(Number(hour), 20)).padStart(2, '0')}:00`
  const later = addDays(soonDate, 8)
  const classes = await publish(h, coach, [
    { key: 'x1', title: 'Soon', date: soonDate, time: at },
    { key: 'x2', title: 'Later A', date: later, time: '09:00' }, { key: 'x3', title: 'Later B', date: later, time: '10:00' }, { key: 'x4', title: 'Later C', date: later, time: '11:00' },
  ])
  // Studio rule: booking opens 24 hours ahead, priority packs 30 days ahead. Dana's plan has its own rule.
  await h.cmd('bookingRule.save', { opensHoursBefore: 24, priorityOpensHoursBefore: 720, closesMinutesBefore: 0, cancelCutoffHours: 0, lateCancelReturnsCredit: true, lateCancelFeeCents: 0 })
  await h.cmd('bookingRule.save', { plan: 'Two a week', opensHoursBefore: 720, closesMinutesBefore: 0, cancelCutoffHours: 48, lateCancelReturnsCredit: false, lateCancelFeeCents: 1500 })
  await h.cmd('bookingRule.save', { plan: 'Two a week', service: 'Mat', cancelCutoffHours: 0 }, h.owner, 400)
  const weekly = await sell(h, dana.id, { kind: 'visits', planName: 'Two a week', visits: 2, period: 'week' })
  const credits = await sell(h, eli.id, { credits: 5 })
  // The plan's own window lets Dana book eight days ahead; Eli's credit pack waits for the studio window.
  assert.equal((await book(h, eli.cookie, classes.get('x2').id)).value.error, 'booking_window_not_open')
  const priority = await sell(h, eli.id, { kind: 'unlimited', planName: 'Priority unlimited', priorityBooking: true })
  const eliBooking = await h.cmd('booking.book', { classId: classes.get('x2').id }, eli.cookie)
  assert.equal(eliBooking.packId, priority.id, 'only the priority membership seats inside the priority-only window')
  const dx2 = await h.cmd('booking.book', { classId: classes.get('x2').id }, dana.cookie)
  const dx3 = await h.cmd('booking.book', { classId: classes.get('x3').id }, dana.cookie)
  assert.equal((await book(h, dana.cookie, classes.get('x4').id)).value.error, 'plan_visits_used')
  const dx1 = await h.cmd('booking.book', { classId: classes.get('x1').id }, dana.cookie)
  assert.equal(dx1.packId, weekly.id)
  assert.deepEqual([dx1.cancelTerms.cutoffHours, dx1.cancelTerms.lateReturnsCredit, dx1.cancelTerms.lateFeeCents], [48, false, 1500])
  const ex1 = await h.cmd('booking.book', { classId: classes.get('x1').id }, eli.cookie)
  assert.equal(ex1.packId, credits.id)
  assert.deepEqual([ex1.cancelTerms.cutoffHours, ex1.cancelTerms.lateFeeCents], [0, 0])
  const shown = (await h.state(dana.cookie)).classes.find(c => c.id === classes.get('x2').id).bookingWindow
  assert.equal(shown.plan, 'Two a week')
  assert.match((await h.send('/app', undefined, dana.cookie)).text, /Your Two a week plan’s rule/)

  const weekOf = key => mondayOf(new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(classes.get(key).start)))
  const usedIn = async week => (await h.state()).packs.find(p => p.id === weekly.id).summary.plan.periods.find(p => p.start === week)?.used ?? 0
  // A late cancel under the plan's rule keeps the visit and adds the fee once.
  const preview = (await h.state(dana.cookie)).bookings.find(b => b.id === dx1.id).cancelEffect
  assert.deepEqual([preview.timing, preview.creditReturned, preview.feeCents], ['late', false, 1500])
  await h.cmd('booking.cancel', { id: dx1.id, terms: preview.key }, dana.cookie)
  let state = await h.state()
  assert.equal(state.charges.filter(c => c.bookingId === dx1.id && c.reason === 'late_cancel_fee').length, 1)
  assert.equal(await usedIn(weekOf('x1')), 1)
  assert.equal(state.packs.find(p => p.id === weekly.id).summary.plan.lateCancelled, 1)
  // Restoring reuses that kept visit (no second hold) and reverses the fee once.
  await h.cmd('booking.restore', { id: dx1.id, reason: 'Cancelled in error', channel: 'phone' })
  state = await h.state()
  assert.equal(state.bookings.find(b => b.id === dx1.id).status, 'booked')
  assert.equal(await usedIn(weekOf('x1')), 1)
  assert.equal(state.charges.filter(c => c.bookingId === dx1.id).reduce((n, c) => n + c.amountCents, 0), 0)
  // A move carries the visit into the target's period only while that period has room.
  const blocked = await h.send('/api/strap/command', { name: 'booking.move', input: { id: dx1.id, classId: classes.get('x4').id, cancelReason: 'Schedule conflict', channel: 'phone', mode: 'early', reason: 'Member asked' } }, h.owner)
  assert.deepEqual([blocked.status, blocked.value.error], [409, 'plan_visits_used'])
  assert.equal((await h.state()).bookings.find(b => b.id === dx1.id).classId, classes.get('x1').id, 'the full target week refuses the move')
  const early = (await h.state()).bookings.find(b => b.id === dx3.id).cancelEffect
  await h.cmd('booking.cancel', { id: dx3.id, terms: early.key }, dana.cookie)
  assert.equal(await usedIn(weekOf('x2')), 1)
  const moving = (await h.state()).bookings.find(b => b.id === dx1.id).cancelEffect
  await h.cmd('booking.move', { id: dx1.id, classId: classes.get('x4').id, terms: moving.key, cancelReason: 'Schedule conflict', channel: 'phone', mode: 'early', reason: 'Member asked' })
  state = await h.state()
  assert.equal(state.bookings.find(b => b.id === dx1.id).classId, classes.get('x4').id)
  assert.deepEqual([await usedIn(weekOf('x1')), await usedIn(weekOf('x2'))], [0, 2])
  assert.ok(state.packCreditEvents.filter(e => e.packId === weekly.id).every(e => e.credits === 0))
  // Restoring the early cancellation needs a visit in its full week: refused with no writes.
  const version = (await h.state()).bookings.length
  const full = await h.send('/api/strap/command', { name: 'booking.restore', input: { id: dx3.id, reason: 'Wrong member', channel: 'desk' } }, h.owner)
  assert.deepEqual([full.status, full.value.error], [409, 'plan_visits_used'])
  assert.equal((await h.state()).bookings.find(b => b.id === dx3.id).status, 'cancelled')
  assert.equal((await h.state()).bookings.length, version)
  assert.equal(dx2.packId, weekly.id)
}))

test('Guest allowances: two monthly passes, payer-confirmed excess once, reset, rollover and cross-host guest limits stay separate from own credits', () => run(async h => {
  const coach = await studio(h), host = await h.person('Morgan'), other = await h.person('Robin'), payer = await h.person('Taylor');
  const guests = []; for (const name of ['Avery','Emery','Riley','Quinn','Jamie']) guests.push(await h.person(name));
  // Distinct public sign-ins avoid any shared profile or staff-made consent.
  for (const guest of guests) await h.cmd('guest.consent.save',{sponsorEmail:host.email,consent:true},guest.cookie);
  await h.cmd('guest.consent.save',{sponsorEmail:other.email,consent:true},guests[0].cookie);
  const paidBy = await h.cmd('guest.consent.save',{sponsorEmail:host.email,kind:'payer',consent:true,maxChargeCents:2500},payer.cookie);
  let boundary = today().slice(0,8)+'01';
  while (boundary < addDays(today(),9)) boundary = addDays(boundary,32).slice(0,8)+'01';
  const before = addDays(boundary,-1), classes = await publish(h,coach,[
    ...Array.from({length:6},(_,i)=>({key:`g${i}`,title:`Guest Mat ${i}`,date:before,time:`${String(9+i).padStart(2,'0')}:00`})),
    {key:'next',title:'Next month Mat',date:boundary,time:'10:00'},
    {key:'full',title:'One guest seat',date:boundary,time:'11:00',capacity:1},
    {key:'wrong',title:'Reformer guest',service:'Reformer',date:before,time:'16:00'}
  ]);
  await h.cmd('bookingRule.save',{service:'Mat',cancelCutoffHours:720,lateCancelReturnsCredit:false,lateCancelFeeCents:0});
  const guestTerms = {passes:2,period:'month',rollover:0,services:['Mat'],perGuest:1,windowDays:365,excess:'refuse',priceCents:2500};
  const pack = await sell(h,host.id,{credits:10,guestTerms}), otherPack = await sell(h,other.id,{credits:10,guestTerms});
  const preview = (guest,index,packId=pack.id,cookie=host.cookie,payerId=host.id) => h.cmd('guest.preview',{guestId:guest.id,classId:classes.get(index).id,packId,payerId},cookie);
  const confirm = (d,cookie=host.cookie) => h.cmd('guest.book',{id:d.id,confirm:true},cookie);
  const first = await confirm(await preview(guests[0],'g0')), second = await confirm(await preview(guests[1],'g1'));
  await h.cmd('guest.preview',{guestId:guests[2].id,classId:classes.get('g2').id,packId:pack.id},host.cookie,409);
  assert.equal((await h.state(host.cookie)).packs.find(p=>p.id===pack.id).remaining,10);
  assert.deepEqual((await h.state(host.cookie)).guests.allowances.find(a=>a.packId===pack.id).periods.find(p=>p.start===before.slice(0,8)+'01').used,2);
  await h.cmd('guest.preview',{guestId:guests[0].id,classId:classes.get('g3').id,packId:otherPack.id},other.cookie,409);
  assert.equal((await h.state(other.cookie)).guests.bookings.length,0);
  const reset = await confirm(await preview(guests[2],'next'));
  assert.equal(reset.guestFunding,'pass');
  // Cancellation returns once even when late; restoration reserves once and
  // moving the seat changes its period without touching the host's pack.
  await h.cmd('booking.cancel',{id:first.id},host.cookie);
  await h.cmd('booking.cancel',{id:first.id},host.cookie,409);
  await h.cmd('booking.restore',{id:first.id,reason:'Cancelled wrong guest',channel:'phone'});
  await h.cmd('booking.move',{id:first.id,classId:classes.get('g4').id,requestId:'guest-move'},host.cookie);
  let state = await h.state();
  assert.equal(state.guests.events.filter(e=>e.bookingId===first.id && e.type==='return').length,1);
  assert.equal(state.bookings.find(b=>b.id===first.id).classId,classes.get('g4').id);
  assert.equal(state.packs.find(p=>p.id===pack.id).remaining,10);
  const blocker=await h.cmd('booking.book',{classId:classes.get('full').id},other.cookie);
  const waiter=await h.cmd('booking.move',{id:first.id,classId:classes.get('full').id,requestId:'guest-full-move'},host.cookie);
  assert.equal(waiter.status,'waitlisted');
  assert.equal((await h.state()).bookings.find(b=>b.id===first.id).classId,classes.get('g4').id);
  await h.cmd('booking.cancel',{id:blocker.id},other.cookie);
  const offered=(await h.state(host.cookie)).guests.bookings.find(b=>b.id===waiter.id);
  assert.equal(offered.status,'offered');
  const source=(await h.state()).bookings.find(b=>b.id===first.id);
  await h.cmd('booking.offer.accept',{id:waiter.id,terms:source.cancelEffect.key},host.cookie);
  assert.equal((await h.state()).bookings.find(b=>b.id===first.id).classId,classes.get('full').id);
  // A different pack explicitly adopts charge-on-excess. Every paid quote is
  // confirmed at the real price, charged once to its consenting payer.
  const charged = await sell(h,host.id,{credits:10,guestTerms:{...guestTerms,excess:'charge'}});
  await confirm(await preview(guests[3],'g0',charged.id));
  await confirm(await preview(guests[4],'g1',charged.id));
  const quote = await preview(guests[2],'g2',charged.id,host.cookie,payer.id);
  assert.equal(quote.amountCents,2500);
  const paid = await confirm(quote); assert.equal(paid.guestFunding,'paid');
  assert.equal((await confirm(quote)).id,paid.id);
  state = await h.state();
  assert.equal(state.charges.filter(c=>c.bookingId===paid.id && c.amountCents===2500 && c.personId===payer.id).length,1);
  await h.cmd('booking.cancel',{id:paid.id},host.cookie);
  assert.equal((await h.state()).charges.filter(c=>c.bookingId===paid.id).reduce((n,c)=>n+c.amountCents,0),0);
  await h.cmd('guest.consent.revoke',{id:paidBy.id},payer.cookie);
  await h.cmd('booking.restore',{id:paid.id,reason:'Please restore',channel:'desk'},h.owner,403);
  // Service eligibility, stale previews, missing guest consent and unknown
  // members all refuse rather than exposing or silently changing allocations.
  await h.cmd('guest.preview',{guestId:guests[0].id,classId:classes.get('wrong').id,packId:pack.id},host.cookie,409);
  const stranger = await h.person('Drew');
  await h.cmd('guest.preview',{guestId:stranger.id,classId:classes.get('g5').id,packId:pack.id},host.cookie,403);
  await h.cmd('guest.consent.save',{sponsorEmail:host.email,consent:true},stranger.cookie);
  const stale = await preview(stranger,'g5',charged.id);
  await h.cmd('guest.consent.save',{sponsorEmail:host.email,consent:true},stranger.cookie);
  await h.cmd('guest.book',{id:stale.id,confirm:true},host.cookie,409);
  const grant = (await h.state(stranger.cookie)).guests.consents.find(c=>c.type==='guest');
  await h.cmd('guest.consent.revoke',{id:grant.id},stranger.cookie);
  await h.cmd('guest.book',{id:stale.id,confirm:true},host.cookie,403);
  const hostAfterWithdrawal = await h.state(host.cookie);
  assert.equal(hostAfterWithdrawal.guests.consents.find(c=>c.id===grant.id).active,false);
  assert.notEqual(hostAfterWithdrawal.guests.consents.find(c=>c.id===grant.id).name,stranger.name);
  assert.ok(!hostAfterWithdrawal.guests.guests.some(g=>g.id===stranger.id));
  assert.doesNotMatch((await h.send('/app/packs',undefined,host.cookie)).text,/Drew/);
  assert.equal((await h.state(stranger.cookie)).guests.consents.find(c=>c.id===grant.id).name,host.name,'the guest retains their own authorization history');
  assert.equal((await h.state()).guests.consents.find(c=>c.id===grant.id).name,stranger.name,'the owner retains studio authorization history');
  assert.ok(!(await h.state(other.cookie)).people.some(p=>p.id===host.id));
  assert.equal(second.guestFunding,'pass');
  const rollGuests=[];
  for (const name of ['River','Skyler','Dakota','Marley','Finley']) {
    const guest=await h.person(name); rollGuests.push(guest);
    await h.cmd('guest.consent.save',{sponsorEmail:other.email,consent:true},guest.cookie);
  }
  const rolling=await sell(h,other.id,{credits:4,guestTerms:{...guestTerms,rollover:1}});
  await confirm(await preview(rollGuests[0],'g5',rolling.id,other.cookie,other.id),other.cookie);
  for (const guest of rollGuests.slice(1,4)) await confirm(await preview(guest,'next',rolling.id,other.cookie,other.id),other.cookie);
  const period=(await h.state(other.cookie)).guests.allowances.find(a=>a.packId===rolling.id).periods.find(p=>p.start===boundary);
  assert.deepEqual([period.carriedIn,period.allowance,period.used],[1,3,3]);
  await h.cmd('guest.preview',{guestId:rollGuests[4].id,classId:classes.get('next').id,packId:rolling.id},other.cookie,409);
  const current=(await h.state()).packs.find(p=>p.id===rolling.id);
  await h.cmd('pack.adjust',{id:rolling.id,creditsDelta:0,reason:'Guest allowance ended with the pack',requestId:'guest-expiry',revision:current.summary.revision,expiresAt:new Date(Date.parse(classes.get('next').start)-1000).toISOString()});
  await h.cmd('guest.preview',{guestId:rollGuests[4].id,classId:classes.get('next').id,packId:rolling.id},other.cookie,409);

  if (process.env.STRAP_PROOF_DIR) await (await import('./guests-browser.mjs')).guestsBrowser(h,{host,guest:guests[0],packId:charged.id,classId:classes.get('g2').id});
}));


test('PLAN-010: owner guest charges require live payer caps and guest-seat fees and reversals stay with the host', () => run(async h => {
  const coach = await studio(h), host = await h.person('Morgan'), payer = await h.person('Taylor');
  const guests = []; for (const name of ['Avery','Emery','Riley']) guests.push(await h.person(name));
  for (const guest of guests) await h.cmd('guest.consent.save',{sponsorEmail:host.email,consent:true},guest.cookie);
  const classes = await publish(h,coach,[...['first','paid','self','moved'].map((key,i)=>({key,title:`Mat with ${coach.name} ${i+1}`,date:addDays(today(),3),time:`${10+i}:00`})),{key:'early',title:'Mat next month',date:addDays(today(),40),time:'10:00'}]);
  const rules = {service:'Mat',cancelCutoffHours:720,lateCancelReturnsCredit:false,lateCancelFeeCents:1500,noShowFeeCents:2000};
  await h.cmd('bookingRule.save',rules);
  const pack = await sell(h,host.id,{credits:10,guestTerms:{passes:1,period:'month',rollover:0,services:['Mat'],perGuest:1,windowDays:365,excess:'charge',priceCents:2500}});
  const previewInput = (guest,key,payerId) => ({sponsorId:host.id,guestId:guest.id,classId:classes.get(key).id,packId:pack.id,payerId});
  const reserve = async (guest,key,payerId,cookie=h.owner) => {
    const draft = await h.cmd('guest.preview',previewInput(guest,key,payerId),cookie);
    return h.cmd('guest.book',{id:draft.id,confirm:true},cookie);
  };
  await reserve(guests[0],'first',host.id,host.cookie);
  const refused = async (name,input,status,error) => {
    const before = (await h.state()).version, result = await h.cmd(name,input,h.owner,status);
    if (error) assert.equal(result.error,error);
    assert.equal((await h.state()).version,before,'refusal writes nothing');
  };
  const allow = (person,maxChargeCents) => h.cmd('guest.consent.save',{sponsorEmail:host.email,kind:'payer',consent:true,maxChargeCents},person.cookie);
  // Staff charges need a recorded cap for either a third-party payer or the host.
  for (const [who,guest,key] of [[payer,guests[1],'paid'],[host,guests[2],'self']]) {
    const input = previewInput(guest,key,who.id);
    await refused('guest.preview',input,403,'guest_payer_consent_required');
    await allow(who,2499);
    await refused('guest.preview',input,403,'guest_payer_consent_required');
    await allow(who,2500);
  }
  const early = await reserve(guests[0],'early',host.id);
  const earlyCancel = {id:early.id,cancelReason:'Other',reason:'Avery requested a different week',mode:'late',channel:'desk'};
  await refused('booking.cancel',earlyCancel,400);
  await h.cmd('booking.cancel',{...earlyCancel,mode:'early'});
  assert.equal((await h.state()).bookings.find(b=>b.id===early.id).cancellation,'early','a non-waivable choice must match the current timing');
  const stale = await h.cmd('guest.preview',previewInput(guests[1],'paid',payer.id),host.cookie);
  assert.deepEqual([stale.cancelTerms.cutoffHours,stale.cancelTerms.lateFeeCents,stale.cancelTerms.noShowFeeCents],[720,1500,2000]);
  const page = (await h.send('/app/packs',undefined,host.cookie)).text;
  assert.match(page,/Late cancellation or a late move adds \$15\.00 to the host’s studio balance/);
  assert.match(page,/A no-show adds \$20\.00 to the host’s studio balance/);
  await h.cmd('bookingRule.save',{...rules,lateCancelFeeCents:1800});
  const beforeStale = (await h.state()).version;
  assert.equal((await h.cmd('guest.book',{id:stale.id,confirm:true},host.cookie,409)).error,'guest_preview_changed');
  assert.equal((await h.state()).version,beforeStale);
  const ownerQuote = await h.cmd('guest.preview',previewInput(guests[1],'paid',payer.id));
  await allow(payer,2499);
  await refused('guest.book',{id:ownerQuote.id,confirm:true},403,'guest_payer_consent_required');
  await allow(payer,2500);
  const paid = await reserve(guests[1],'paid',payer.id), selfPaid = await reserve(guests[2],'self',host.id);
  assert.deepEqual([paid.guestFunding,paid.payerId,paid.guestPriceCents,selfPaid.guestFunding,selfPaid.payerId],['paid',payer.id,2500,'paid',host.id]);
  assert.equal(paid.cancelTerms.lateFeeCents,1800,'the seat keeps its confirmed terms');
  let state = await h.state();
  assert.deepEqual(state.charges.filter(c=>[paid.id,selfPaid.id].includes(c.bookingId)).map(c=>[c.bookingId,c.personId,c.reason,c.amountCents]).sort(),[[paid.id,payer.id,'guest_drop_in',2500],[selfPaid.id,host.id,'guest_drop_in',2500]].sort());
  // Staff enters both a reason/comment and an explicit timing choice, even when no waiver is requested.
  const cancelInput = {id:paid.id,cancelReason:'Sick',channel:'desk',mode:'late',reason:'Emery phoned with a fever'};
  await refused('booking.cancel',{...cancelInput,reason:''},400);
  const {mode,...missingTiming} = cancelInput;
  await refused('booking.cancel',missingTiming,400);
  await h.cmd('booking.cancel',cancelInput);
  state = await h.state();
  assert.equal(state.bookingActions.find(a=>a.bookingId===paid.id && a.action==='cancel').comment,cancelInput.reason);
  const cancelFee = state.charges.find(c=>c.bookingId===paid.id && c.reason==='late_cancel_fee');
  assert.deepEqual([cancelFee.personId,cancelFee.amountCents],[host.id,1800]);
  assert.deepEqual(state.charges.filter(c=>c.bookingId===paid.id && c.reason==='guest_drop_in_reversal').map(c=>[c.personId,c.amountCents]),[[payer.id,-2500]]);
  await h.cmd('booking.restore',{id:paid.id,reason:'Emery can attend after all',channel:'phone'});
  state = await h.state();
  assert.deepEqual(state.charges.filter(c=>c.reversesChargeId===cancelFee.id).map(c=>[c.personId,c.amountCents]),[[host.id,-1800]]);
  await h.cmd('booking.move',{id:paid.id,classId:classes.get('moved').id,requestId:'synthetic-strap-1'},host.cookie);
  state = await h.state();
  assert.deepEqual(state.charges.filter(c=>c.bookingId===paid.id && c.reason==='late_move_fee').map(c=>[c.personId,c.amountCents]),[[host.id,1800]]);
  assert.deepEqual([state.bookings.find(b=>b.id===paid.id).payerId,state.bookings.find(b=>b.id===paid.id).guestPriceCents],[payer.id,2500]);
  // A late-cancel correction reverses the fee to its debtor, preserving the payer's price reversal.
  await h.cmd('booking.cancel',{id:selfPaid.id},host.cookie);
  await h.cmd('attendance.correct',{id:selfPaid.id,outcome:'early_cancel',reason:'Studio changed the class time'});
  // Only the stored test class is backdated; no-show and correction still enter through HTTP.
  await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.start',?,'$.end',?) WHERE id=?").bind(new Date(Date.now()-30*60_000).toISOString(),new Date(Date.now()+30*60_000).toISOString(),classes.get('moved').id).run();
  await h.cmd('attendance.noshow',{id:paid.id},coach.cookie);
  await h.cmd('attendance.noshow',{id:paid.id},coach.cookie,409);
  state = await h.state();
  const noShowFee = state.charges.find(c=>c.bookingId===paid.id && c.reason==='no_show_fee');
  assert.deepEqual([noShowFee.personId,noShowFee.amountCents],[host.id,2000]);
  await h.cmd('attendance.correct',{id:paid.id,outcome:'excused',reason:'Emery was excused by the studio'});
  await h.cmd('attendance.correct',{id:paid.id,outcome:'excused',reason:'Repeat correction'},h.owner,409);
  state = await h.state();
  assert.deepEqual(state.charges.filter(c=>c.reversesChargeId===noShowFee.id).map(c=>[c.personId,c.amountCents]),[[host.id,-2000]]);
  const charges = state.charges.filter(c=>[paid.id,selfPaid.id].includes(c.bookingId));
  for (const reversal of charges.filter(c=>c.reversesChargeId)) {
    const original = charges.find(c=>c.id===reversal.reversesChargeId);
    assert.deepEqual([reversal.personId,reversal.amountCents],[original.personId,-original.amountCents]);
    assert.equal(charges.filter(c=>c.reversesChargeId===original.id).length,1);
  }
  assert.equal(charges.filter(c=>c.personId===payer.id).reduce((n,c)=>n+c.amountCents,0),0,'the payer owes no fee or excused guest price');
  assert.ok(!charges.some(c=>guests.some(g=>g.id===c.personId)),'the guest owes neither fees nor their reversals');
  assert.equal(state.packs.find(p=>p.id===pack.id).remaining,10,'guest funding never spends the host’s own credits');
}));

test('Intro offers: verified person and household eligibility, exact once-only sales, visits and reasoned staff exceptions',()=>run(async h=>{
  const coach=await studio(h), ana=await h.person('IntroAna'), alias=await h.person('IntroAlias'), household=await h.person('IntroHousehold'), ben=await h.person('IntroBen'), unknown=await h.person('IntroUnknown');
  const offerInput={name:'Two-week introduction',days:14,credits:2,amountCents:3900,eligibility:'new',limit:'person',eligibleServices:['Mat']};
  const offer=await h.cmd('intro.offer.save',offerInput);
  const verify=(p,extra={})=>h.cmd('intro.identity.verify',{personId:p.id,householdChecked:true,reason:'Identity and household checked with the member',...extra});
  await verify(ana);await verify(alias,{samePersonAsId:ana.id});await verify(household,{householdWithId:ana.id});await verify(ben);
  let n=0;
  const quote=(p,cookie=p.cookie,extra={})=>h.cmd('intro.preview',{offerId:offer.id,requestId:'synthetic-strap-'+(++n),...(cookie===h.owner?{personId:p.id}:{}),...extra},cookie);
  const buy=(q,cookie)=>h.cmd('intro.purchase',{id:q.id,key:q.key,confirm:true},cookie);
  const refused=async(name,input,cookie,status,error)=>{const before=(await h.state()).version,r=await h.cmd(name,input,cookie,status);if(error)assert.equal(r.error,error);assert.equal((await h.state()).version,before,'refused requests write nothing');};
  await refused('intro.preview',{offerId:offer.id,requestId:'synthetic-strap-800'},unknown.cookie,409,'intro_identity_verification_required');
  for(const cookie of [ana.cookie,coach.cookie]){
    await refused('intro.offer.save',offerInput,cookie,403,'owner_required');
    await refused('intro.identity.verify',{personId:ana.id,householdChecked:true,reason:'Cannot self verify'},cookie,403,'owner_required');
  }
  await refused('intro.preview',{personId:ben.id,offerId:offer.id,requestId:'synthetic-strap-801'},ana.cookie,404,'intro_not_found');
  const q=await quote(ana), racing=await quote(alias);
  assert.deepEqual([q.days,q.credits,q.amountCents,q.renewsAutomatically,q.collection],[14,2,3900,false,'studio-balance-only']);
  assert.ok(!JSON.stringify(q).includes(alias.id),'the member preview does not reveal linked accounts');
  await refused('intro.purchase',{id:q.id,key:'changed',confirm:true},ana.cookie,409,'intro_confirmation_required');
  await refused('intro.purchase',{id:q.id,key:q.key,confirm:true},ben.cookie,404,'intro_not_found');
  const sale=await buy(q,ana.cookie);assert.deepEqual(await buy(q,ana.cookie),sale);
  let state=await h.state(), pack=state.packs.find(p=>p.id===sale.packId);
  assert.equal(Date.parse(sale.expiresAt)-Date.parse(sale.startsAt),14*86400_000);
  assert.deepEqual([pack.remaining,state.packCreditEvents.filter(e=>e.packId===pack.id).length,state.charges.filter(c=>c.introSaleId===sale.id).map(c=>c.amountCents)],[2,1,[3900]]);
  assert.ok((await h.state(ana.cookie)).notices.some(n=>n.subject==='Intro offer purchased'));
  await refused('intro.purchase',{id:racing.id,key:racing.key,confirm:true},alias.cookie,409,'intro_eligibility_changed');
  for(const cookie of [ana.cookie,alias.cookie,h.owner])await refused('intro.preview',{personId:cookie===h.owner?alias.id:undefined,offerId:offer.id,requestId:'synthetic-strap-'+(++n)},cookie,409,'intro_already_used');
  const newOffer=await h.cmd('intro.offer.save',{...offerInput,name:'Renamed intro'});
  await refused('intro.preview',{offerId:newOffer.id,requestId:'synthetic-strap-'+(++n)},alias.cookie,409,'intro_already_used');
  const householdOffer=await h.cmd('intro.offer.save',{...offerInput,limit:'household'});
  await refused('intro.preview',{offerId:householdOffer.id,requestId:'synthetic-strap-'+(++n)},household.cookie,409,'intro_already_used');
  const privateState=await h.state(alias.cookie);
  assert.deepEqual([privateState.intros.identities,privateState.intros.links,privateState.intros.sales],[[],[],[]]);
  assert.equal((await h.state(coach.cookie)).intros.offers.length,0);
  // The exact preview expires and any subsequent identity verification invalidates it.
  const stale=await quote(ben);await verify(ben);
  await refused('intro.purchase',{id:stale.id,key:stale.key,confirm:true},ben.cookie,409,'intro_eligibility_changed');
  const expired=await quote(ben);
  await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.validUntil',?) WHERE id=?").bind(new Date(Date.now()-1000).toISOString(),expired.id).run();
  await refused('intro.purchase',{id:expired.id,key:expired.key,confirm:true},ben.cookie,409,'intro_preview_expired');
  // Only the owner holds the price right. An exception uses one preview, charge, grant and audit identity.
  await refused('intro.preview',{offerId:offer.id,requestId:'synthetic-strap-'+(++n),exceptionReason:'Self-approved'},alias.cookie,403,'owner_required');
  const exceptionInput={personId:alias.id,offerId:offer.id,exceptionReason:'Owner approved a second introduction after a studio closure',requestId:'synthetic-strap-810',channel:'phone'};
  const exception=await h.cmd('intro.preview',exceptionInput);
  const confirm={id:exception.id,key:exception.key,confirm:true,requestId:'synthetic-strap-811',channel:'phone'};
  const exceptionSale=await h.cmd('intro.purchase',confirm);
  assert.deepEqual(await h.cmd('intro.purchase',confirm),exceptionSale);
  await refused('intro.purchase',{...confirm,requestId:'synthetic-strap-812'},alias.cookie,404,'intro_not_found');
  state=await h.state();
  const audit=state.staffActions.filter(a=>a.requestId==='synthetic-strap-811');
  assert.equal(audit.length,1);assert.deepEqual([audit[0].personId,audit[0].right,audit[0].channel,audit[0].reason,audit[0].after.id],[alias.id,'price','phone',exceptionInput.exceptionReason,exceptionSale.id]);
  assert.equal(state.charges.filter(c=>c.introSaleId===exceptionSale.id).length,1);
  assert.ok(!JSON.stringify(await h.state(alias.cookie)).includes(exceptionInput.exceptionReason));
  const key=await h.cmd('agent.create',{label:'Intro preparation only'});
  assert.equal((await h.send('/api/strap/agent/command',{name:'intro.preview',input:exceptionInput},'',{authorization:'Bearer '+key.token})).status,403);
  // Existing waiver/service/capacity and immutable usage doors consume these ordinary credits.
  const classes=await publish(h,coach,[{key:'one',title:'Intro Mat one',service:'Mat',date:addDays(today(),1),time:'10:00'},{key:'two',title:'Intro Mat two',service:'Mat',date:addDays(today(),2),time:'10:00'},{key:'wrong',title:'Intro Reformer',service:'Reformer',date:addDays(today(),1),time:'11:00'},{key:'late',title:'Expired intro class',service:'Mat',date:addDays(today(),16),time:'10:00'}]);
  await h.cmd('booking.book',{classId:classes.get('wrong').id},ana.cookie,409);
  await h.cmd('booking.book',{classId:classes.get('late').id},ana.cookie,409);
  const b=await h.cmd('booking.book',{classId:classes.get('one').id},ana.cookie);
  await h.cmd('booking.book',{classId:classes.get('two').id},ana.cookie);
  assert.equal((await h.state()).packs.find(p=>p.id===pack.id).remaining,0);
  await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.start',?,'$.end',?) WHERE id=?").bind(new Date(Date.now()-60_000).toISOString(),new Date(Date.now()+3600_000).toISOString(),classes.get('one').id).run();
  await h.cmd('attendance.checkin',{id:b.id},coach.cookie);
  pack=(await h.state()).packs.find(p=>p.id===pack.id);
  assert.equal(pack.summary.consumed,1);assert.equal(pack.summary.reserved,1);
  assert.equal((await h.state()).packCreditEvents.filter(e=>e.packId===pack.id&&e.type==='grant').length,1);
  // Returning clients require elapsed inactivity; a new client cannot use a returning offer.
  const returning=await h.cmd('intro.offer.save',{...offerInput,eligibility:'returning',returnAfterDays:30});
  await refused('intro.preview',{offerId:returning.id,requestId:'synthetic-strap-820'},ben.cookie,409,'intro_returning_clients_only');
  const former=await h.person('IntroFormer');await verify(former);
  const old=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:former.id,credits:1,amountCents:100,expiresAt:new Date(Date.now()+60_000).toISOString()})).id});
  await refused('intro.preview',{offerId:returning.id,requestId:'synthetic-strap-821'},former.cookie,409,'intro_return_gap_not_met');
  await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.expiresAt',?) WHERE id=?").bind(new Date(Date.now()-31*86400_000).toISOString(),old.id).run();
  const returnQuote=await h.cmd('intro.preview',{offerId:returning.id,requestId:'synthetic-strap-822'},former.cookie);
  assert.ok((await buy(returnQuote,former.cookie)).packId);
  const closed=await quote(ben);await h.cmd('intro.offer.close',{id:offer.id});
  await refused('intro.purchase',{id:closed.id,key:closed.key,confirm:true},ben.cookie,409,'intro_preview_expired');
  if(process.env.STRAP_PROOF_DIR)await(await import('./intro-offers-browser.mjs')).introOffersBrowser(h);
}));

test('Intro conversion: expiry alone never renews; member accepts or declines exact native recurring invoices',()=>run(async h=>{
  await studio(h);
  const offer=await h.cmd('intro.offer.save',{name:'Two weeks then a choice',days:14,credits:3,amountCents:4900,eligibility:'new',limit:'person'});
  const people=[];
  for(const name of ['IntroAccept','IntroDecline','IntroUnanswered']){
    const p=await h.person(name);people.push(p);
    await h.cmd('intro.identity.verify',{personId:p.id,householdChecked:true,reason:'Verified before purchase'});
    const q=await h.cmd('intro.preview',{offerId:offer.id,requestId:'synthetic-strap-'+p.id},p.cookie);
    p.sale=await h.cmd('intro.purchase',{id:q.id,key:q.key,confirm:true},p.cookie);
    p.proposal=await h.cmd('plan.recurring.prepare',{packId:p.sale.packId,intervalMonths:1,requestId:'synthetic-strap-'+p.id});
  }
  const [accepted,declined,unanswered]=people;
  for(const cookie of [h.owner,declined.cookie])await h.cmd('plan.recurring.accept',{id:accepted.proposal.id,key:accepted.proposal.key},cookie,cookie===h.owner?403:404);
  const a=await h.cmd('plan.recurring.accept',{id:accepted.proposal.id,key:accepted.proposal.key},accepted.cookie);
  assert.deepEqual(await h.cmd('plan.recurring.accept',{id:a.id,key:a.key},accepted.cookie),a);
  assert.deepEqual([a.amountCents,a.credits,a.intervalMonths,a.firstDueAt,a.acknowledgement.actorId],[4900,3,1,accepted.sale.expiresAt,(await h.state(accepted.cookie)).actor.id]);
  await h.cmd('plan.recurring.stop',{id:declined.proposal.id,requestId:'synthetic-strap-830'},declined.cookie);
  // Move only the stored clock boundary; purchases and decisions still enter via public commands.
  const due=new Date(Date.now()-1000).toISOString();
  for(const p of people){
    await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.expiresAt',?) WHERE id=?").bind(due,p.sale.packId).run();
    await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.nextRenewalAt',?) WHERE id=?").bind(due,p.proposal.id).run();
  }
  for(let i=0;i<2;i++)await(await h.mf.getWorker()).scheduled({cron:'* * * * *'});
  const state=await h.state();
  assert.deepEqual(state.recurring.invoices.map(i=>[i.personId,i.amountCents]),[[accepted.id,4900]]);
  assert.equal(state.packs.filter(p=>p.personId===accepted.id).length,2);
  for(const p of [declined,unanswered]){
    assert.equal(state.packs.filter(pack=>pack.personId===p.id).length,1);
    assert.equal(state.charges.filter(c=>c.personId===p.id).length,1,'no unaccepted renewal charge');
  }
  assert.equal(state.recurring.terms.find(r=>r.id===unanswered.proposal.id).acceptedAt,undefined);
}));
