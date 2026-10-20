import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'

const minute = 60_000, hour = 60 * minute
const at = offset => new Date(Math.ceil((Date.now() + offset) / minute) * minute).toISOString()
const monday = start => { const d = new Date(start); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (d.getUTCDay() + 6) % 7)).toISOString().slice(0, 10) }
const studioDay = start => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(start))
const form = (h, name, back, fields, cookie = h.owner) => h.mf.dispatchFetch(h.origin + `/app/action?name=${name}&returnTo=${encodeURIComponent(back)}`, { method: 'POST', headers: { origin: h.origin, cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields), redirect: 'manual' })
async function refused(h, name, input, cookie, status, code) {
  const before = (await h.state()).version
  const r = await h.send('/api/strap/command', { name, input }, cookie)
  assert.equal(r.status, status, JSON.stringify(r.value)); assert.equal(r.value.error, code)
  assert.equal((await h.state()).version, before, `${code}: no writes`)
}
// Time passes in the stored record only: the class (or pack) now lies behind the clock.
const backdate = (h, id, fields) => h.db.prepare(`UPDATE st_records SET data=json_set(data,${Object.keys(fields).map(k => `'$.${k}',?`).join(',')}) WHERE id=?`).bind(...Object.values(fields), id).run()

test('ATT-003: the owner corrects a paid no-show and a late cancel once, restoring the credit and reversing the fee with history kept', () => run(async h => {
  await h.mf.dispatchFetch(h.origin + '/setup', { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=yes', redirect: 'manual' })
  await h.cmd('studio.save', { location: 'Nashville', timeZone: 'America/Chicago' })
  const coach = await h.person('Maya', 'instructor'), other = await h.person('Rae', 'instructor'), people = {}
  for (const name of ['Ana', 'Ben', 'Cy', 'Dee']) {
    people[name] = await h.person(name)
    await h.cmd('pack.approve', { id: (await h.cmd('pack.prepare', { personId: people[name].id, credits: 5, amountCents: 10000, expiresAt: '2099-12-31T00:00:00Z' })).id })
    await h.cmd('payment.record', { personId: people[name].id, amountCents: 10000, reference: `PACK-${name}` })
  }
  const { Ana, Ben, Cy, Dee } = people
  // The owner's form: the no-show fee is entered in dollars beside the late-cancel fee.
  assert.equal((await form(h, 'bookingRule.save', '/app/studio', { service: 'Reformer', opensHoursBefore: '', priorityOpensHoursBefore: '', closesMinutesBefore: '0', cancelCutoffHours: '12', lateCancelReturnsCredit: 'false', lateFee: '15.00', noShowFee: '20.00' })).status, 303)
  assert.equal((await h.state()).bookingRules[0].noShowFeeCents, 2000)
  assert.match((await h.send('/app/studio', undefined, h.owner)).text, /Credit kept · \$15\.00 fee[\s\S]*\$20\.00 fee/)
  const publish = async (title, start) => (await h.cmd('classes.publish', { id: (await h.cmd('classes.prepare', { week: monday(start), classes: [{ title, service: 'Reformer', start, end: new Date(Date.parse(start) + 50 * minute).toISOString(), capacity: 10, instructorId: coach.id }] })).id })).classes[0]
  const entry = await publish('Reformer Early', at(3 * hour)), later = await publish('Reformer Later', at(4 * hour))
  assert.match((await h.send('/app', undefined, Ana.cookie)).text, /Missing class without cancelling uses the credit and adds a \$20\.00 no-show fee\./, 'the fee is disclosed before booking')
  const seat = {}
  for (const [name, who] of Object.entries(people)) seat[name] = await h.cmd('booking.book', { classId: entry.id }, who.cookie)
  await refused(h, 'attendance.noshow', { id: seat.Ana.id }, coach.cookie, 409, 'class_not_started')

  await backdate(h, entry.id, { start: new Date(Date.now() - 30 * minute).toISOString(), end: new Date(Date.now() + 20 * minute).toISOString() })
  const back = `/app?day=${studioDay(Date.now() - 30 * minute)}&class=${entry.id}`
  await refused(h, 'attendance.noshow', { id: seat.Ana.id }, other.cookie, 403, 'instructor_required')
  await refused(h, 'attendance.noshow', { id: seat.Ana.id }, Ana.cookie, 403, 'instructor_required')
  assert.match((await h.send(back, undefined, coach.cookie)).text, /name=attendance\.noshow/, 'the assigned instructor gets the no-show button once class starts')
  assert.equal((await form(h, 'attendance.noshow', back, { id: seat.Ana.id }, coach.cookie)).status, 303)
  for (const name of ['Ben', 'Dee']) await h.cmd('attendance.noshow', { id: seat[name].id }, coach.cookie)
  await refused(h, 'attendance.noshow', { id: seat.Ana.id }, coach.cookie, 409, 'attendance_already_recorded')
  await refused(h, 'attendance.checkin', { id: seat.Ana.id }, coach.cookie, 409, 'attendance_needs_correction')
  let s = await h.state()
  const noShowFee = s.charges.filter(c => c.bookingId === seat.Ana.id)
  assert.deepEqual(noShowFee.map(c => [c.reason, c.amountCents]), [['no_show_fee', 2000]], 'one no-show fee')
  assert.equal(s.packs.find(p => p.personId === Ana.id).remaining, 4, 'the no-show spent the credit')
  await h.cmd('payment.record', { personId: Ana.id, amountCents: 2000, reference: 'CASH-FEE-ANA' })

  // Only the owner (manager until STAFF-001) corrects; instructors, members and agents cannot.
  await refused(h, 'attendance.correct', { id: seat.Ana.id, outcome: 'excused', reason: 'Booked in error' }, coach.cookie, 403, 'owner_required')
  await refused(h, 'attendance.correct', { id: seat.Ana.id, outcome: 'excused', reason: 'Booked in error' }, Ana.cookie, 403, 'owner_required')
  const key = await h.cmd('agent.create', { label: 'Planner' })
  assert.equal((await h.send('/api/strap/agent/command', { name: 'attendance.correct', input: { id: seat.Ana.id, outcome: 'excused', reason: 'x' } }, '', { authorization: `Bearer ${key.token}` })).status, 403)
  assert.doesNotMatch((await h.send(back, undefined, coach.cookie)).text, /attendance\.correct|\$20\.00/, 'instructors see no correction or fee')
  await refused(h, 'attendance.correct', { id: seat.Ana.id, outcome: 'excused' }, h.owner, 400, 'invalid_correction_reason')
  await refused(h, 'attendance.correct', { id: seat.Ana.id, outcome: 'early_cancel', reason: 'x' }, h.owner, 400, 'invalid_outcome')
  await refused(h, 'attendance.correct', { id: seat.Cy.id, outcome: 'excused', reason: 'x' }, h.owner, 409, 'nothing_to_correct')
  await refused(h, 'attendance.correct', { id: seat.Ben.id, outcome: 'attended', reason: 'Was there', refundReference: 'REFUND-BEN' }, h.owner, 409, 'fee_not_paid_nothing_to_refund')
  const page = (await h.send(back, undefined, h.owner)).text
  assert.match(page, /Correct no-show for Ana/)
  assert.match(page, /Excused returns the spent credit; attended keeps it spent\. The \$20\.00 fee is reversed\./)
  assert.match(page, /the \$20\.00 fee was paid; record it as paid back outside Strap/)

  // The paid no-show, corrected through the owner's roster form with a recorded refund.
  const ledger = (await h.state()).packCreditEvents.length
  assert.equal((await form(h, 'attendance.correct', back, { id: seat.Ana.id, outcome: 'excused', reason: 'Front desk booked the wrong class', refundReference: 'REFUND-ANA' })).status, 303)
  await refused(h, 'attendance.correct', { id: seat.Ana.id, outcome: 'excused', reason: 'Again' }, h.owner, 409, 'nothing_to_correct')
  s = await h.state()
  const ana = s.bookings.find(b => b.id === seat.Ana.id)
  assert.equal(ana.attendance, 'excused')
  assert.equal(ana.noShowAt !== undefined && ana.noShowFeeCents, 2000, 'the original no-show stays on the booking')
  assert.deepEqual(ana.corrections.map(c => [c.from, c.to, c.reason, c.creditRestored, c.feeReversedCents, c.before.attendance]), [['no_show', 'excused', 'Front desk booked the wrong class', true, 2000, 'no_show']])
  assert.equal(s.packs.find(p => p.personId === Ana.id).remaining, 5, 'one credit restored')
  assert.equal(s.packCreditEvents.length, ledger + 1)
  assert.deepEqual(s.packCreditEvents.filter(e => e.bookingId === seat.Ana.id).map(e => [e.type, e.credits, e.reason ?? null]), [['reserve', -1, null], ['consume', 0, 'no_show'], ['restore', 1, 'attendance_correction']])
  const reversal = s.charges.filter(c => c.reason === 'fee_reversal' && c.bookingId === seat.Ana.id)
  assert.deepEqual(reversal.map(c => [c.amountCents, c.reversesChargeId]), [[-2000, noShowFee[0].id]], 'one fee reversal')
  assert.deepEqual(s.payments.filter(p => p.kind === 'refund').map(p => [p.personId, p.amountCents, p.reference]), [[Ana.id, -2000, 'REFUND-ANA']])
  assert.equal(s.balances.find(b => b.personId === Ana.id).balanceCents, 0, 'nothing owed either way')
  assert.match((await h.send(back, undefined, h.owner)).text, /Excused[\s\S]*Corrected from no-show: Front desk booked the wrong class · credit returned · \$20\.00 fee reversed · refund recorded/)
  assert.match((await h.send('/app/packs', undefined, h.owner)).text, /REFUND-ANA<small>Refund paid back outside Strap<\/small>/)

  // An unpaid no-show corrected to attended: credit stays spent, fee reversed, no refund.
  await h.cmd('attendance.correct', { id: seat.Ben.id, outcome: 'attended', reason: 'Signed the paper sheet' })
  s = await h.state()
  const ben = s.bookings.find(b => b.id === seat.Ben.id)
  assert.deepEqual([ben.attendance, ben.checkedInAt, s.packs.find(p => p.personId === Ben.id).remaining], ['attended', s.classes.find(c => c.id === entry.id).start, 4])
  assert.equal(s.balances.find(b => b.personId === Ben.id).balanceCents, 0)
  // Restoring needs the credit's own pack to still be usable.
  await backdate(h, s.packs.find(p => p.personId === Dee.id).id, { expiresAt: new Date(Date.now() - minute).toISOString() })
  await refused(h, 'attendance.correct', { id: seat.Dee.id, outcome: 'excused', reason: 'Sick note' }, h.owner, 409, 'pack_expired_extend_first')

  // A late cancel corrected to early: the kept credit returns and the late fee reverses, once.
  const late = await h.cmd('booking.book', { classId: later.id }, Cy.cookie)
  const effect = (await h.state(Cy.cookie)).bookings.find(b => b.id === late.id).cancelEffect
  await h.cmd('booking.cancel', { id: late.id, terms: effect.key }, Cy.cookie)
  s = await h.state()
  assert.deepEqual([s.packs.find(p => p.personId === Cy.id).remaining, s.balances.find(b => b.personId === Cy.id).balanceCents], [3, 1500])
  await h.cmd('attendance.correct', { id: late.id, outcome: 'early_cancel', reason: 'Studio changed the start time' })
  await refused(h, 'attendance.correct', { id: late.id, outcome: 'early_cancel', reason: 'Again' }, h.owner, 409, 'nothing_to_correct')
  s = await h.state()
  const cy = s.bookings.find(b => b.id === late.id)
  assert.deepEqual([cy.cancellation, cy.refunded, cy.feeCents, cy.corrections[0].before.cancellation, cy.corrections[0].before.feeCents], ['early', true, 0, 'late', 1500])
  assert.deepEqual([s.packs.find(p => p.personId === Cy.id).remaining, s.balances.find(b => b.personId === Cy.id).balanceCents], [4, 0])
  assert.equal(s.charges.filter(c => c.bookingId === late.id && c.reason === 'fee_reversal').length, 1)
  if (process.env.STRAP_PROOF_DIR) await (await import('./attendance-browser.mjs')).correctionBrowser(h, entry, seat.Dee)
}))

test('ATT-002: disclosed fee assessments, grace, reasoned waivers and desk receipts have separate once-only outcomes', () => run(async h => {
  await h.mf.dispatchFetch(h.origin + '/setup', { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=yes', redirect: 'manual' })
  await h.cmd('studio.save', { location: 'Nashville', timeZone: 'America/Chicago' })
  const coach = await h.person('Maya', 'instructor'), Ana = await h.person('Ana'), Ben = await h.person('Ben'), Cy = await h.person('Cy'), Dee = await h.person('Dee')
  for (const member of [Ana, Ben, Cy, Dee]) await h.cmd('pack.approve', { id: (await h.cmd('pack.prepare', { personId: member.id, credits: 5, amountCents: 0, expiresAt: '2099-12-31T00:00:00Z' })).id })
  const rule = { service: 'Reformer', cancelCutoffHours: '12', lateCancelReturnsCredit: 'false', lateFee: '15.00', noShowFee: '20.00', noShowGraceMinutes: '10' }
  assert.equal((await form(h, 'bookingRule.save', '/app/studio', rule)).status, 303)
  const start = at(3 * hour), entry = (await h.cmd('classes.publish', { id: (await h.cmd('classes.prepare', { week: monday(start), classes: [{ title: 'Reformer', service: 'Reformer', start, end: at(4 * hour), capacity: 10, instructorId: coach.id }] })).id })).classes[0]
  assert.equal((await h.state()).bookingRules[0].noShowGraceMinutes, 10)
  const bookings = {}
  for (const member of [Ana, Ben, Cy, Dee]) bookings[member.name] = await h.cmd('booking.book', { classId: entry.id }, member.cookie)
  assert.equal((await h.state(Ana.cookie)).bookings[0].cancelTerms.noShowGraceMinutes, 10)
  // Staff uses the same disclosed late fee; an explicit early cancel waives it with a reason.
  const late = await h.cmd('booking.cancel', { id: bookings.Ana.id, mode: 'late', cancelReason: 'Other', channel: 'desk', requestId: 'att2-late' })
  assert.equal(late.feeCents, 1500)
  await h.cmd('booking.cancel', { id: bookings.Cy.id, mode: 'early', reason: 'Sick', cancelReason: 'Other', channel: 'desk', requestId: 'att2-early' })
  await h.cmd('booking.cancel', { id: bookings.Ana.id, mode: 'late', cancelReason: 'Other', channel: 'desk', requestId: 'att2-late' })
  let s = await h.state()
  assert.equal(s.charges.filter(c => c.bookingId === bookings.Ana.id).length, 1)
  assert.equal(s.charges.filter(c => c.bookingId === bookings.Cy.id).length, 0)
  assert.equal(s.packs.find(p => p.personId === Cy.id).remaining, 5)
  assert.ok(s.bookingActions.some(a => a.bookingId === bookings.Cy.id && a.waiver?.reason === 'Sick'))
  // A later policy cannot erase the grace disclosed when the booking was made.
  await h.cmd('bookingRule.save', { service: 'Reformer', noShowGraceMinutes: 0 })
  await backdate(h, entry.id, { start: new Date(Date.now() - 5 * minute).toISOString(), end: new Date(Date.now() + 45 * minute).toISOString() })
  await refused(h, 'attendance.noshow', { id: bookings.Ben.id }, coach.cookie, 409, 'no_show_grace_active')
  const rosterPath = `/app?day=${studioDay(Date.now())}&class=${entry.id}`
  assert.doesNotMatch((await h.send(rosterPath, undefined, coach.cookie)).text, /name=attendance\.noshow/)
  await backdate(h, entry.id, { start: new Date(Date.now() - 11 * minute).toISOString() })
  for (const member of [Ben, Dee]) await h.cmd('attendance.noshow', { id: bookings[member.name].id }, coach.cookie)
  await refused(h, 'attendance.noshow', { id: bookings.Ben.id }, coach.cookie, 409, 'attendance_already_recorded')
  s = await h.state()
  const fee = member => s.fees.find(f => f.personId === member.id)
  const anaFee = fee(Ana), benFee = fee(Ben), deeFee = fee(Dee)
  assert.deepEqual([anaFee.status, benFee.status, benFee.amountCents], ['pending', 'pending', 2000])
  assert.equal(s.charges.filter(c => c.bookingId === bookings.Ben.id).length, 1)
  for (const cookie of [Ana.cookie, coach.cookie]) {
    await refused(h, 'fee.collect', { id: benFee.id, reference: 'BAD' }, cookie, 403, 'owner_required')
    await refused(h, 'fee.waive', { id: benFee.id, reason: 'Bad' }, cookie, 403, 'owner_required')
  }
  const key = await h.cmd('agent.create', { label: 'Fee planner' })
  assert.equal((await h.send('/api/strap/agent/command', { name: 'fee.collect', input: { id: benFee.id, reference: 'BAD' } }, '', { authorization: `Bearer ${key.token}` })).status, 403)
  await refused(h, 'fee.waive', { id: anaFee.id }, h.owner, 400, 'invalid_waiver_reason')
  const credits = s.packs.find(p => p.personId === Ana.id).remaining
  await h.cmd('fee.waive', { id: anaFee.id, reason: 'Studio error', requestId: 'att2-waive' })
  await h.cmd('fee.waive', { id: anaFee.id, reason: 'Studio error', requestId: 'att2-waive' })
  await refused(h, 'fee.collect', { id: anaFee.id, reference: 'WAIVED' }, h.owner, 409, 'fee_already_waived')
  assert.equal((await form(h, 'fee.collect', '/app/packs', { id: benFee.id, reference: 'CASH-BEN-ATT2' })).status, 303)
  await refused(h, 'fee.collect', { id: benFee.id, reference: 'SECOND-BEN' }, h.owner, 409, 'fee_already_collected')
  await refused(h, 'fee.collect', { id: deeFee.id, reference: 'CASH-BEN-ATT2' }, h.owner, 409, 'payment_reference_used')
  s = await h.state()
  assert.deepEqual(s.fees.filter(f => f.personId !== Dee.id).map(f => [f.personId, f.status]).sort(), [[Ana.id, 'waived'], [Ben.id, 'collected']].sort())
  assert.equal(s.packs.find(p => p.personId === Ana.id).remaining, credits, 'fee waiver leaves the attendance credit outcome intact')
  assert.equal(s.charges.filter(c => c.reversesChargeId === anaFee.id).length, 1)
  assert.deepEqual(s.payments.map(p => [p.chargeId, p.amountCents, p.reference]), [[benFee.id, 2000, 'CASH-BEN-ATT2']])
  assert.equal(s.balances.find(b => b.personId === Ben.id).balanceCents, 0)
  assert.deepEqual(s.staffActions.filter(a => ['fee.collect','fee.waive'].includes(a.command)).map(a => [a.right,a.channel,a.personId]).sort(), [['collection','desk',Ben.id],['fee-waiver','desk',Ana.id]].sort())
  assert.equal((await h.state(Ben.cookie)).fees.length, 1, 'member sees only their own fee')
  assert.equal((await h.state(coach.cookie)).fees.length, 0, 'instructor has no member fee list')
  for (const [path,cookie] of [['/app/packs',h.owner],[`/app/people?person=${Ben.id}`,h.owner],['/app/packs',Ben.cookie]]) {
    const page = await h.send(path,undefined,cookie)
    assert.equal(page.status,200, path+': '+page.text)
    assert.ok(page.text.includes('CASH-BEN-ATT2'), 'linked receipt appears through each fee door')
  }
  const exported = await h.send('/api/strap/exit.json',undefined,h.owner)
  assert.equal(exported.status,200)
  const records = exported.value.tables.st_records.map(r => JSON.parse(r.data))
  assert.equal(records.find(r => r.id === benFee.receipt?.id || r.chargeId === benFee.id).chargeId,benFee.id)
  assert.equal(records.filter(r => r.reversesChargeId === anaFee.id).length,1)
  assert.equal(records.filter(r => r.command === 'fee.collect').length,1)
  if (process.env.STRAP_PROOF_DIR) await (await import('./fees-browser.mjs')).feesBrowser(h, { entry, Ana, Ben, Dee, deeFee })
  await h.cmd('fee.waive',{id:benFee.id,reason:'Member courtesy after receipt'})
  s=await h.state()
  assert.equal(s.fees.find(f=>f.id===benFee.id).status,'waived')
  assert.equal(s.balances.find(b=>b.personId===Ben.id).balanceCents,-2000,'waiving a collected fee leaves member credit without sending money')
  assert.equal(s.payments.filter(p=>p.kind==='refund').length,0)
  const waiverAudit=s.staffActions.find(a=>a.command==='fee.waive' && a.personId===Ben.id)
  assert.deepEqual([waiverAudit.before.status,waiverAudit.before.receipt.reference,waiverAudit.after.status],['collected','CASH-BEN-ATT2','waived'])
  await refused(h,'fee.waive',{id:benFee.id,reason:'Again'},h.owner,409,'fee_already_waived')
}))
