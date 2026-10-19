import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'

const minute = 60_000, hour = 60 * minute
const at = offset => new Date(Math.ceil((Date.now() + offset) / minute) * minute).toISOString()
const monday = start => { const d = new Date(start); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (d.getUTCDay() + 6) % 7)).toISOString().slice(0, 10) }
const studioDay = start => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(start))
const ago = (start, minutes) => new Date(Date.parse(start) - minutes * minute).toISOString()

async function studio(h) {
  await h.mf.dispatchFetch(h.origin + '/setup', { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=yes', redirect: 'manual' })
  await h.cmd('studio.save', { location: 'Nashville', timeZone: 'America/Chicago' })
  const coach = await h.person('Maya', 'instructor'), people = {}
  for (const name of ['Ana', 'Ben', 'Cy', 'Dee', 'Eve']) people[name] = await h.person(name)
  const pack = async (who, extra = {}) => h.cmd('pack.approve', { id: (await h.cmd('pack.prepare', { personId: who.id, credits: 5, amountCents: 10000, expiresAt: '2099-12-31T00:00:00Z', ...extra })).id })
  for (const name of ['Ana', 'Cy', 'Dee', 'Eve']) await pack(people[name])
  // Ben's regular pack expires first; only the priority pack may seat him early.
  await pack(people.Ben, { expiresAt: '2099-06-30T00:00:00Z' })
  const priority = await pack(people.Ben, { priorityBooking: true })
  const publish = async (title, service, start) => {
    const draft = await h.cmd('classes.prepare', { week: monday(start), classes: [{ title, service, start, end: new Date(Date.parse(start) + 50 * minute).toISOString(), capacity: 10, instructorId: coach.id }] })
    return (await h.cmd('classes.publish', { id: draft.id })).classes[0]
  }
  return { coach, people, priority, publish }
}
const form = (h, name, back, fields, cookie = h.owner) => h.mf.dispatchFetch(h.origin + `/app/action?name=${name}&returnTo=${encodeURIComponent(back)}`, { method: 'POST', headers: { origin: h.origin, cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields), redirect: 'manual' })
async function refused(h, name, input, cookie, status, code) {
  const before = (await h.state()).version
  const r = await h.send('/api/strap/command', { name, input }, cookie)
  assert.equal(r.status, status, JSON.stringify(r.value)); assert.equal(r.value.error, code)
  assert.equal((await h.state()).version, before, `${code}: no writes`)
}

test('SCHED-006: booking windows, priority packs and the shown cancellation effect match persisted outcomes', () => run(async h => {
  const { people: { Ana, Ben, Cy }, priority, publish } = await studio(h)
  await refused(h, 'bookingRule.save', { opensHoursBefore: 168 }, Ana.cookie, 403, 'owner_required')
  await refused(h, 'bookingRule.save', { opensHoursBefore: 168, priorityOpensHoursBefore: 100 }, h.owner, 400, 'priority_window_must_open_before_regular_window')
  await h.cmd('bookingRule.save', { opensHoursBefore: 168, priorityOpensHoursBefore: 336, closesMinutesBefore: 60 })
  // The owner's browser form: dollars and blank hours become the same command input.
  assert.equal((await form(h, 'bookingRule.save', '/app/studio', { service: 'Reformer', opensHoursBefore: '168', priorityOpensHoursBefore: '', closesMinutesBefore: '60', cancelCutoffHours: '12', lateCancelReturnsCredit: 'false', lateFee: '15.00' })).status, 303)
  const reformer = (await h.state()).bookingRules.find(r => r.service === 'Reformer')
  assert.deepEqual([reformer.opensHoursBefore, reformer.priorityOpensHoursBefore, reformer.cancelCutoffHours, reformer.lateCancelReturnsCredit, reformer.lateCancelFeeCents], [168, null, 12, false, 1500])
  assert.match((await h.send('/app/studio', undefined, h.owner)).text, /All services \(studio rule\)[\s\S]*Reformer[\s\S]*Credit kept · \$15\.00 fee/)

  const far = await publish('Mat Flow', 'Mat', at(10 * 24 * hour)), closing = await publish('Mat Express', 'Mat', at(40 * minute))
  const near = await publish('Reformer Early', 'Reformer', at(3 * hour)), mid = await publish('Reformer Later', 'Reformer', at(48 * hour))
  let s = await h.state(Ana.cookie), window = s.classes.find(c => c.id === far.id).bookingWindow
  assert.deepEqual([window.opensAt, window.priorityOpensAt, window.closesAt], [ago(far.start, 168 * 60), ago(far.start, 336 * 60), ago(far.start, 60)])
  assert.equal(s.classes.find(c => c.id === near.id).bookingWindow.cutoffAt, ago(near.start, 12 * 60))
  let page = (await h.send('/app', undefined, Ana.cookie)).text
  assert.match(page, /Opens&nbsp;<time datetime="[^"]+">/, 'the regular member sees when booking opens')
  assert.match(page, /Booking closed/)
  assert.match(page, /Cancel by <time[^>]*>[^<]*<\/time> for your credit back; later the credit is kept and a \$15\.00 late fee is added\./)

  // Both sides of the opening and closing boundaries.
  await refused(h, 'booking.book', { classId: far.id }, Ana.cookie, 409, 'booking_window_not_open')
  const early = await h.cmd('booking.book', { classId: far.id }, Ben.cookie)
  assert.equal(early.packId, priority.id, 'the priority window seats only from the priority pack')
  await refused(h, 'booking.book', { classId: closing.id }, Ana.cookie, 409, 'booking_window_closed')
  await refused(h, 'booking.desk', { classId: closing.id, personId: Ana.id }, h.owner, 409, 'booking_window_closed')

  // Late side of the Reformer cutoff: the shown effect is exactly what happens.
  const late = await h.cmd('booking.book', { classId: near.id }, Ana.cookie)
  s = await h.state(Ana.cookie)
  const effect = s.bookings.find(b => b.id === late.id).cancelEffect, packBefore = s.packs[0].remaining, owedBefore = s.balances[0].balanceCents
  assert.deepEqual([effect.timing, effect.creditReturned, effect.feeCents], ['late', false, 1500])
  assert.match((await h.send('/app', undefined, Ana.cookie)).text, /Late cancel: credit kept, \$15\.00 fee added\./)
  await refused(h, 'booking.cancel', { id: late.id, mode: 'early' }, Ana.cookie, 403, 'fee_waiver_right_required')
  await refused(h, 'booking.cancel', { id: late.id, terms: 'early|1|0' }, Ana.cookie, 409, 'cancellation_terms_changed')
  const cancelled = await h.cmd('booking.cancel', { id: late.id, terms: effect.key }, Ana.cookie)
  s = await h.state(Ana.cookie)
  assert.deepEqual([cancelled.cancellation, cancelled.refunded, cancelled.feeCents], ['late', false, 1500])
  assert.equal(s.packs[0].remaining, packBefore, 'the late cancel keeps the credit')
  assert.equal(s.balances[0].balanceCents, owedBefore + 1500, 'one fee is added')
  assert.equal(s.charges.filter(c => c.bookingId === late.id).length, 1)
  assert.equal(s.packCreditEvents.filter(e => e.bookingId === late.id && e.type === 'consume' && e.reason === 'late_cancel').length, 1)
  assert.equal(s.packs[0].summary.consumed, 1)

  // Early side: credit back, no fee.
  const ok = await h.cmd('booking.book', { classId: mid.id }, Ana.cookie)
  const before = await h.state(Ana.cookie)
  assert.equal(before.bookings.find(b => b.id === ok.id).cancelEffect.key, 'early|1|0')
  assert.match((await h.send('/app', undefined, Ana.cookie)).text, /Cancel now: your credit returns\./)
  assert.equal((await form(h, 'booking.cancel', '/app', { id: ok.id, terms: 'early|1|0' }, Ana.cookie)).status, 303)
  s = await h.state(Ana.cookie)
  assert.equal(s.packs[0].remaining, before.packs[0].remaining + 1)
  assert.equal(s.balances[0].balanceCents, before.balances[0].balanceCents)

  // A booking keeps the rule it was made under; new bookings get the new rule.
  const kept = await h.cmd('booking.book', { classId: mid.id }, Cy.cookie)
  await h.cmd('bookingRule.save', { service: 'reformer', opensHoursBefore: 168, closesMinutesBefore: 60, cancelCutoffHours: 72, lateCancelReturnsCredit: false, lateCancelFeeCents: 2000 })
  s = await h.state(Cy.cookie)
  assert.equal(s.bookings.find(b => b.id === kept.id).cancelEffect.timing, 'early')
  assert.equal(s.classes.find(c => c.id === mid.id).bookingWindow.cutoffAt, ago(mid.start, 72 * 60))
  assert.equal((await h.cmd('booking.cancel', { id: kept.id }, Cy.cookie)).refunded, true)
  if (process.env.STRAP_PROOF_DIR) await (await import('./booking-rules-browser.mjs')).memberRulesBrowser(h, Ana)
}))

test('SCHED-006: front desk sees the late fee before choosing a late cancel or a reasoned early cancel', () => run(async h => {
  const { coach, people: { Ana, Dee, Eve }, publish } = await studio(h)
  await h.cmd('bookingRule.save', { service: 'Reformer', closesMinutesBefore: 0, cancelCutoffHours: 12, lateCancelReturnsCredit: false, lateCancelFeeCents: 1500 })
  const near = await publish('Reformer Early', 'Reformer', at(3 * hour))
  const dee = await h.cmd('booking.desk', { classId: near.id, personId: Dee.id }), eve = await h.cmd('booking.desk', { classId: near.id, personId: Eve.id })
  const ana = await h.cmd('booking.book', { classId: near.id }, Ana.cookie)
  let s = await h.state(), effect = s.bookings.find(b => b.id === dee.id).cancelEffect
  assert.deepEqual([effect.timing, effect.feeCents, effect.waivable], ['late', 1500, true])
  const roster = (await h.send(`/app?day=${studioDay(near.start)}&class=${near.id}`, undefined, h.owner)).text
  assert.match(roster, /Late cancel: credit kept, \$15\.00 fee added\./)
  assert.match(roster, /Early cancel: credit back, no fee/)
  assert.doesNotMatch((await h.send(`/app?day=${studioDay(near.start)}&class=${near.id}`, undefined, coach.cookie)).text, /fee added/, 'instructors see no fee preview')
  await refused(h, 'booking.cancel', { id: dee.id }, h.owner, 400, 'invalid_cancel_choice')
  await refused(h, 'booking.cancel', { id: dee.id, mode: 'early' }, h.owner, 400, 'invalid_waiver_reason')
  await refused(h, 'booking.cancel', { id: dee.id, mode: 'late' }, coach.cookie, 403, 'forbidden')
  const key = await h.cmd('agent.create', { label: 'Planner' })
  assert.equal((await h.send('/api/strap/agent/command', { name: 'booking.cancel', input: { id: dee.id, mode: 'late' } }, '', { authorization: `Bearer ${key.token}` })).status, 403)

  const late = await h.cmd('booking.cancel', { id: dee.id, mode: 'late', terms: effect.key })
  assert.deepEqual([late.cancellation, late.refunded, late.feeCents, late.cancelledByRole], ['late', false, 1500, 'owner'])
  assert.equal((await form(h, 'booking.cancel', `/app?day=${studioDay(near.start)}&class=${near.id}`, { id: eve.id, terms: effect.key, mode: 'early', reason: 'Studio heater failed' })).status, 303)
  s = await h.state()
  const waived = s.bookings.find(b => b.id === eve.id)
  assert.deepEqual([waived.cancellation, waived.refunded, waived.feeCents, waived.waiver.reason, waived.waiver.right, waived.waiver.waivedFeeCents], ['early', true, 0, 'Studio heater failed', 'fee-waiver', 1500])
  assert.equal(s.charges.filter(c => c.reason === 'late_cancel_fee').length, 1, 'only the late cancel assessed a fee')
  assert.equal(s.balances.find(b => b.personId === Dee.id).balanceCents, 10000 + 1500)
  assert.equal(s.balances.find(b => b.personId === Eve.id).balanceCents, 10000)
  assert.equal(s.packs.find(p => p.personId === Eve.id).remaining, 5)
  assert.equal(s.packs.find(p => p.personId === Dee.id).remaining, 4)
  await refused(h, 'booking.cancel', { id: eve.id, mode: 'late' }, h.owner, 409, 'already_cancelled')
  assert.match((await h.send(`/app?day=${studioDay(near.start)}&class=${near.id}`, undefined, h.owner)).text, /Waived: Studio heater failed/)
  if (process.env.STRAP_PROOF_DIR) await (await import('./booking-rules-browser.mjs')).deskCancelBrowser(h, near, ana)
}))
