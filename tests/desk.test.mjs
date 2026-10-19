import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'

const minute = 60_000, hour = 60 * minute
const at = offset => new Date(Math.ceil((Date.now() + offset) / minute) * minute).toISOString()
const monday = start => { const d = new Date(start); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (d.getUTCDay() + 6) % 7)).toISOString().slice(0, 10) }
const form = (h, name, back, fields, cookie = h.owner) => h.mf.dispatchFetch(h.origin + `/app/action?name=${name}&returnTo=${encodeURIComponent(back)}`, { method: 'POST', headers: { origin: h.origin, cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields), redirect: 'manual' })
const roster = entry => `/app?day=${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(entry.start))}&class=${entry.id}`
async function refused(h, name, input, cookie, status, code) {
  const before = (await h.state()).version
  const r = await h.send('/api/strap/command', { name, input }, cookie)
  assert.equal(r.status, status, JSON.stringify(r.value)); assert.equal(r.value.error, code)
  assert.equal((await h.state()).version, before, `${code}: no writes`)
}
const sell = async (h, personId, credits, expiresAt) => (await h.cmd('pack.approve', { id: (await h.cmd('pack.prepare', { personId, credits, amountCents: credits * 2000, expiresAt })).id }))

test('SCHED-010: the front desk books a phoned-in member on a chosen pack, sells a drop-in at booking, settles an unpaid walk-in once, and overrides capacity and the window only with a reason', async () => {
  await run(async h => {
    await h.mf.dispatchFetch(h.origin + '/setup', { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=yes', redirect: 'manual' })
    await h.cmd('studio.save', { location: 'Nashville', timeZone: 'America/Chicago' })
    const coach = await h.person('Maya', 'instructor'), ana = await h.person('Ana'), ben = await h.person('Ben'), cy = await h.person('Cy'), dee = await h.person('Dee')
    const sooner = await sell(h, ana.id, 5, '2099-06-30T00:00:00Z'), longer = await sell(h, ana.id, 10, '2099-12-31T00:00:00Z')
    await sell(h, dee.id, 5, '2099-12-31T00:00:00Z')
    // Booking opens 48 hours before class for everyone, the desk included.
    await h.cmd('bookingRule.save', { opensHoursBefore: 48 })
    const publish = async (title, start, capacity) => (await h.cmd('classes.publish', { id: (await h.cmd('classes.prepare', { week: monday(start), classes: [{ title, start, end: new Date(Date.parse(start) + 50 * minute).toISOString(), capacity, room: `${title} room`, instructorId: coach.id }] })).id })).classes[0]
    const flow = await publish('Reformer Flow', at(26 * hour), 3), future = await publish('Reformer Sunday', at(80 * hour), 8)

    // Only the owner (front desk until STAFF-001) books at the desk; an agent key cannot.
    await refused(h, 'booking.desk', { classId: flow.id, personId: ana.id }, coach.cookie, 403, 'owner_required')
    await refused(h, 'booking.desk', { classId: flow.id, personId: ana.id }, ben.cookie, 403, 'owner_required')
    const key = await h.cmd('agent.create', { label: 'Planner' })
    assert.equal((await h.send('/api/strap/agent/command', { name: 'booking.desk', input: { classId: flow.id, personId: ana.id } }, '', { authorization: `Bearer ${key.token}` })).status, 403)

    // A phoned-in member on the pack the desk chose (not the one that expires first); another member's pack is refused.
    await refused(h, 'booking.desk', { classId: flow.id, personId: ana.id, pay: 'pack', packId: (await h.state()).packs.find(p => p.personId === dee.id).id }, h.owner, 409, 'pack_not_eligible')
    assert.equal((await form(h, 'booking.desk', roster(flow), { classId: flow.id, personId: ana.id, channel: 'phone', pay: 'pack', packId: longer.id, amount: '', credits: '', expiresOn: '', reference: '', override: '' })).status, 303)
    let s = await h.state()
    const anaVisit = s.bookings.find(b => b.personId === ana.id)
    assert.deepEqual([anaVisit.packId, anaVisit.bookingChannel, anaVisit.madeBy, anaVisit.right, anaVisit.payment], [longer.id, 'phone', s.actor.id, 'booking', 'pack'])
    assert.deepEqual([s.packs.find(p => p.id === longer.id).remaining, s.packs.find(p => p.id === sooner.id).remaining], [9, 5])

    // A drop-in sold at the moment of booking: one credit for this class, its charge and the payment taken at the desk.
    assert.equal((await form(h, 'booking.desk', roster(flow), { classId: flow.id, personId: ben.id, channel: 'desk', pay: 'drop-in', amount: '25.00', credits: '', expiresOn: '', reference: 'Desk cash 1', override: '' })).status, 303)
    s = await h.state()
    const benVisit = s.bookings.find(b => b.personId === ben.id), drop = s.packs.find(p => p.id === benVisit.packId)
    assert.deepEqual([drop.kind, drop.credits, drop.remaining, drop.expiresAt, drop.amountCents], ['drop-in', 1, 0, flow.end, 2500])
    assert.equal(s.balances.find(b => b.personId === ben.id).balanceCents, 0, 'charge and recorded payment match')

    // A walk-in with no credit is booked as an unpaid visit, checked in, and settled once by their next ten-pack.
    await refused(h, 'booking.desk', { classId: flow.id, personId: cy.id }, h.owner, 409, 'eligible_credit_required')
    const cyVisit = await h.cmd('booking.desk', { classId: flow.id, personId: cy.id, pay: 'unpaid' })
    assert.deepEqual([cyVisit.status, cyVisit.unpaid, cyVisit.packId], ['booked', true, null])
    await h.cmd('attendance.checkin', { id: cyVisit.id })
    assert.match((await h.send(roster(flow), undefined, h.owner)).text, /Unpaid visit: their next pack settles it/)
    const ten = await sell(h, cy.id, 10, '2099-12-31T00:00:00Z')
    s = await h.state()
    assert.deepEqual([s.bookings.find(b => b.id === cyVisit.id).packId, s.packs.find(p => p.id === ten.id).remaining], [ten.id, 9])
    assert.deepEqual(s.packCreditEvents.filter(e => e.bookingId === cyVisit.id).map(e => e.type), ['reserve', 'consume'])
    const another = await sell(h, cy.id, 5, '2099-12-31T00:00:00Z')
    assert.equal((await h.state()).packs.find(p => p.id === another.id).remaining, 5, 'settled exactly once')

    // Full roster and an unopened window: refused with no writes without an override, booked and recorded with one.
    await refused(h, 'booking.desk', { classId: flow.id, personId: dee.id }, h.owner, 409, 'class_full')
    await refused(h, 'booking.desk', { classId: future.id, personId: dee.id }, h.owner, 409, 'booking_window_not_open')
    await h.cmd('booking.desk', { classId: flow.id, personId: dee.id, override: 'Regular; fits at the back' })
    assert.equal((await form(h, 'booking.desk', roster(future), { classId: future.id, personId: dee.id, channel: 'phone', pay: 'auto', amount: '', credits: '', expiresOn: '', reference: '', override: 'Away until Saturday' })).status, 303)
    s = await h.state()
    const [over, early] = [flow, future].map(c => s.bookings.find(b => b.classId === c.id && b.personId === dee.id))
    assert.deepEqual([over.status, over.override.reason, over.override.bypassed, over.override.by, over.override.right], ['booked', 'Regular; fits at the back', ['class full (3 of 3)'], s.actor.id, 'override'])
    assert.equal(early.override.bypassed.length, 1); assert.match(early.override.bypassed[0], /^booking window opens at /)
    assert.equal(s.classes.find(c => c.id === flow.id).occupancy.booked, 4)
    assert.equal(s.bookings.filter(b => b.personId === ana.id && b.status !== 'cancelled').length, 1)
    assert.ok(!('override' in anaVisit), 'no override is recorded when none was needed')

    // Exactly one credit debit per visit throughout.
    for (const b of s.bookings) assert.equal(s.packCreditEvents.filter(e => e.bookingId === b.id && e.type === 'reserve').length, 1, b.id)
    assert.equal(s.packs.find(p => p.personId === dee.id).remaining, 3)
    const page = (await h.send(roster(flow), undefined, h.owner)).text
    assert.match(page, /Override: Regular; fits at the back \(class full \(3 of 3\)\)/)
    assert.match(page, /Unpaid visit, settled by a later pack/); assert.match(page, /Drop-in sold at the desk/)
    // The member sees the desk booking as their own; the waitlist the desk adds to is MSG-004's.
    assert.match((await h.send('/app', undefined, ana.cookie)).text, /Reformer Flow[\s\S]*Booked/)
    if (process.env.STRAP_PROOF_DIR) await (await import('./desk-browser.mjs')).deskBrowser(h, flow)
  })
})
