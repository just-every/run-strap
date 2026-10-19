import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'

const minute = 60_000, hour = 60 * minute
const at = offset => new Date(Math.ceil((Date.now() + offset) / minute) * minute).toISOString()
const monday = start => { const d = new Date(start); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (d.getUTCDay() + 6) % 7)).toISOString().slice(0, 10) }
const form = (h, name, back, fields, cookie = h.owner) => h.mf.dispatchFetch(h.origin + `/app/action?name=${name}&returnTo=${encodeURIComponent(back)}`, { method: 'POST', headers: { origin: h.origin, cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields), redirect: 'manual' })
// The installation's Cron Trigger, as the runtime fires it every minute.
const tick = async h => (await h.mf.getWorker()).scheduled({ cron: '* * * * *' })
async function refused(h, name, input, cookie, status, code) {
  const before = (await h.state()).version
  const r = await h.send('/api/strap/command', { name, input }, cookie)
  assert.equal(r.status, status, JSON.stringify(r.value)); assert.equal(r.value.error, code)
  assert.equal((await h.state()).version, before, `${code}: no writes`)
}
async function studio(h, names, mat = []) {
  await h.mf.dispatchFetch(h.origin + '/setup', { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=yes', redirect: 'manual' })
  await h.cmd('studio.save', { location: 'Nashville', timeZone: 'America/Chicago' })
  const coach = await h.person('Maya', 'instructor'), people = {}
  for (const name of names) {
    people[name] = await h.person(name)
    await h.cmd('pack.approve', { id: (await h.cmd('pack.prepare', { personId: people[name].id, credits: 5, amountCents: 10000, expiresAt: '2099-12-31T00:00:00Z', ...(mat.includes(name) ? { eligibleServices: ['Mat'] } : {}) })).id })
  }
  const publish = async (title, start, capacity = 1) => (await h.cmd('classes.publish', { id: (await h.cmd('classes.prepare', { week: monday(start), classes: [{ title, start, end: new Date(Date.parse(start) + 50 * minute).toISOString(), capacity, room: `${title} room`, instructorId: coach.id }] })).id })).classes[0]
  return { coach, people, publish }
}
const booking = (s, classId, personId) => s.bookings.find(b => b.classId === classId && b.personId === personId && b.status !== 'cancelled') ?? s.bookings.filter(b => b.classId === classId && b.personId === personId).at(-1)
// The desk's roster for one class, on its studio day.
const roster = entry => `/app?day=${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(entry.start))}&class=${entry.id}`
const credits = (s, personId) => s.packs.find(p => p.personId === personId).remaining

test('MSG-004: a vacancy offers the next eligible waiter a timed claim, expiry moves it on, and the claim seats once with one credit debit', async () => {
  const mails = []
  // The real Resend adapter; only its HTTPS endpoint is faked.
  const outbound = async request => {
    assert.equal(request.url, 'https://api.resend.com/emails', 'no other network destination')
    mails.push({ ...await request.json(), idempotencyKey: request.headers.get('idempotency-key') })
    return Response.json({ id: `re_${mails.length}` })
  }
  await run(async h => {
    const { coach, people, publish } = await studio(h, ['Ana', 'Ben', 'Cy', 'Dee', 'Eve', 'Fay'], ['Dee'])
    const { Ana, Ben, Cy, Dee, Eve, Fay } = people
    // Only the owner sets the policy; the claim window is 1 to 1440 whole minutes.
    await refused(h, 'waitlist.save', { mode: 'offer', claimMinutes: 1, lateWindow: 'promote' }, Ana.cookie, 403, 'owner_required')
    await refused(h, 'waitlist.save', { mode: 'offer', claimMinutes: 1, lateWindow: 'promote' }, coach.cookie, 403, 'owner_required')
    await refused(h, 'waitlist.save', { mode: 'offer', claimMinutes: 0, lateWindow: 'promote' }, h.owner, 400, 'invalid_claim_minutes')
    assert.equal((await form(h, 'waitlist.save', '/app/studio', { mode: 'offer', claimMinutes: '1', lateWindow: 'promote' })).status, 303)
    assert.match((await h.send('/app/studio', undefined, h.owner)).text, /A freed spot is held for the next eligible person waiting, who has 1 min to claim it/)

    const flow = await publish('Reformer Flow', at(26 * hour))
    await h.cmd('booking.book', { classId: flow.id }, Ana.cookie)
    for (const who of [Ben, Dee, Cy]) assert.equal((await h.cmd('booking.book', { classId: flow.id }, who.cookie)).status, 'waitlisted')
    // The desk adds a member to the end of a full class's waitlist, recorded as staff-made, and can remove them.
    await refused(h, 'booking.desk', { classId: flow.id, personId: Fay.id }, h.owner, 409, 'class_full')
    assert.equal((await form(h, 'booking.desk', '/app/classes', { classId: flow.id, personId: Fay.id, channel: 'phone', waitlist: 'true' })).status, 303)
    let s = await h.state()
    const fay = booking(s, flow.id, Fay.id)
    assert.deepEqual([fay.status, fay.madeBy, fay.right, fay.bookingChannel], ['waitlisted', s.actor.id, 'booking', 'phone'])
    await h.cmd('booking.cancel', { id: fay.id })
    assert.equal(booking(await h.state(), flow.id, Fay.id).cancellation, 'waitlist')

    // Ana cancels: Ben, first in line, is offered the seat; no one is booked and no credit moves.
    await h.cmd('booking.cancel', { id: booking(s, flow.id, Ana.id).id }, Ana.cookie)
    s = await h.state()
    const offer = booking(s, flow.id, Ben.id)
    assert.equal(offer.status, 'offered'); assert.equal(offer.offer.claimMinutes, 1)
    assert.ok(Math.abs(Date.parse(offer.offer.expiresAt) - Date.parse(offer.offer.sentAt) - minute) < 1000)
    assert.equal(credits(s, Ben.id), 5)
    const occupancy = s.classes.find(c => c.id === flow.id).occupancy
    assert.deepEqual([occupancy.onlineOpen, occupancy.offered], [0, 1], 'the offer holds the seat')
    assert.equal((await h.cmd('booking.book', { classId: flow.id }, Eve.cookie)).status, 'waitlisted', 'a newcomer joins the waitlist behind it')
    assert.equal(mails.length, 1)
    assert.deepEqual([mails[0].to, mails[0].idempotencyKey, mails[0].from], [['ben@studio.example'], `mail:offer:${offer.id}`, 'auth@studio.example'])
    assert.match(mails[0].subject, /^Spot offered: Reformer Flow, /)
    assert.match(mails[0].text, /Claim it in Strap by .+; after that it goes to the next person waiting\. A credit is used only when you claim it\./)
    assert.match((await h.state(Ben.cookie)).notices.map(n => n.subject).join(), /Spot offered: Reformer Flow/)
    assert.match((await h.send('/app', undefined, Ben.cookie)).text, /Spot offered[\s\S]*Claim by[\s\S]*Claim spot/)
    assert.match((await h.send(roster(flow), undefined, h.owner)).text, /Spot offered[\s\S]*Claim by .+ · Email accepted by resend; delivery not confirmed[\s\S]*Accept for member/)
    // Nobody else claims Ben's offer; an agent key cannot act at all.
    await refused(h, 'booking.offer.accept', { id: offer.id }, Cy.cookie, 403, 'forbidden')
    const key = await h.cmd('agent.create', { label: 'Planner' })
    assert.equal((await h.send('/api/strap/agent/command', { name: 'booking.offer.accept', input: { id: offer.id } }, '', { authorization: `Bearer ${key.token}` })).status, 403)

    // The offer lapses unclaimed: the minute sweep expires it, skips Dee (no credit for this class) and offers Cy.
    await new Promise(r => setTimeout(r, Date.parse(offer.offer.expiresAt) - Date.now() + 1500))
    await refused(h, 'booking.offer.accept', { id: offer.id }, Ben.cookie, 409, 'no_open_offer')
    await tick(h)
    s = await h.state()
    const lapsed = s.bookings.find(b => b.id === offer.id)
    assert.deepEqual([lapsed.status, lapsed.cancellation, lapsed.refunded, lapsed.feeCents, lapsed.cancelledByRole], ['cancelled', 'offer_expired', false, 0, 'system'])
    assert.equal(booking(s, flow.id, Dee.id).status, 'waitlisted', 'ineligible waiters keep their place')
    const next = booking(s, flow.id, Cy.id)
    assert.equal(next.status, 'offered')
    assert.deepEqual(mails.map(m => m.to[0]), ['ben@studio.example', 'cy@studio.example'])
    assert.match((await h.state(Ben.cookie)).notices.map(n => n.subject).join(), /Offer expired: Reformer Flow/)
    await tick(h)
    assert.equal(mails.length, 2, 'a sweep with nothing due changes nothing')
    assert.match((await h.send(roster(flow), undefined, h.owner)).text, /Offer expired[\s\S]*Not claimed in time/)
    if (process.env.STRAP_PROOF_DIR) await (await import('./waitlist-browser.mjs')).waitlistBrowser(h, flow, Cy)

    // Cy claims from the browser form: one seat, one credit debit, nothing for anyone else.
    assert.equal((await form(h, 'booking.offer.accept', '/app', { id: next.id }, Cy.cookie)).status, 303)
    s = await h.state()
    const seated = s.bookings.find(b => b.id === next.id)
    assert.deepEqual([seated.status, seated.offer.acceptedByRole], ['booked', 'member'])
    assert.equal(s.bookings.filter(b => b.classId === flow.id && b.status === 'booked').length, 1)
    assert.deepEqual([credits(s, Cy.id), credits(s, Ben.id), credits(s, Ana.id), credits(s, Eve.id)], [4, 5, 5, 5])
    assert.equal(s.packCreditEvents.filter(e => e.bookingId === next.id && e.type === 'reserve').length, 1)
    assert.deepEqual([booking(s, flow.id, Dee.id).status, booking(s, flow.id, Eve.id).status], ['waitlisted', 'waitlisted'])
    await refused(h, 'booking.offer.accept', { id: next.id }, Cy.cookie, 409, 'no_open_offer')
    assert.deepEqual(s.noticeDeliveries.filter(d => d.sourceKind === 'booking').map(d => [d.sourceId, d.status]), [[offer.id, 'accepted'], [next.id, 'accepted']])
  }, { auth: { MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'test-only-key' }, outbound })
})

test('MSG-004: inside the late-cancel window promotion stops: a claim offer books no one until accepted, or no one is promoted', async () => {
  await run(async h => {
    const { people, publish } = await studio(h, ['Ana', 'Ben', 'Cy', 'Dee', 'Eve', 'Fay'])
    const { Ana, Ben, Cy, Dee, Eve, Fay } = people
    await h.cmd('bookingRule.save', { cancelCutoffHours: 12, lateCancelReturnsCredit: false, lateCancelFeeCents: 1500 })
    await h.cmd('waitlist.save', { mode: 'auto', claimMinutes: 30, lateWindow: 'offer' })
    const soon = await publish('Evening Flow', at(6 * hour)), later = await publish('Weekend Flow', at(30 * hour)), last = await publish('Late Barre', at(7 * hour))
    for (const [entry, first, waiter] of [[soon, Ana, Ben], [later, Cy, Dee], [last, Eve, Fay]]) {
      await h.cmd('booking.book', { classId: entry.id }, first.cookie)
      assert.equal((await h.cmd('booking.book', { classId: entry.id }, waiter.cookie)).status, 'waitlisted')
    }
    let s = await h.state()

    // A cancellation 6 hours before start, inside the 12-hour window: Ben is offered the seat, not booked.
    await h.cmd('booking.cancel', { id: booking(s, soon.id, Ana.id).id, mode: 'late' }, Ana.cookie)
    s = await h.state()
    const offer = booking(s, soon.id, Ben.id)
    assert.deepEqual([offer.status, offer.offer.reason, credits(s, Ben.id)], ['offered', 'late_window', 5])
    assert.equal(s.bookings.filter(b => b.classId === soon.id && b.status === 'booked').length, 0)
    assert.ok(Math.abs(Date.parse(offer.offer.expiresAt) - Date.parse(offer.offer.sentAt) - 30 * minute) < 1000)
    // No mail provider: the in-app notice is the only notice, and the record says so.
    assert.deepEqual(s.noticeDeliveries.map(d => [d.sourceId, d.status]), [[offer.id, 'not_configured']])
    assert.match((await h.send(roster(soon), undefined, h.owner)).text, /Claim by .+ · late-cancel window · Email not configured; in-app notice only/)
    // The front desk (the owner until STAFF-001) accepts it on Ben's behalf: one seat, one debit, staff-made.
    assert.equal((await form(h, 'booking.offer.accept', roster(soon), { id: offer.id })).status, 303)
    s = await h.state()
    const seated = s.bookings.find(b => b.id === offer.id)
    assert.deepEqual([seated.status, seated.offer.acceptedByRole, seated.offer.staffMade, seated.offer.right, credits(s, Ben.id)], ['booked', 'owner', true, 'booking', 4])

    // Outside the window the policy applies: Dee is booked at once and told so.
    await h.cmd('booking.cancel', { id: booking(s, later.id, Cy.id).id }, Cy.cookie)
    s = await h.state()
    assert.deepEqual([booking(s, later.id, Dee.id).status, credits(s, Dee.id)], ['booked', 4])
    assert.match((await h.state(Dee.cookie)).notices.map(n => n.subject).join(), /You're booked: Weekend Flow/)

    // With promotion stopped outright, a late cancellation promotes no one and the seat stays open to booking.
    await h.cmd('waitlist.save', { mode: 'auto', claimMinutes: 30, lateWindow: 'none' })
    await h.cmd('booking.cancel', { id: booking(s, last.id, Eve.id).id, mode: 'late' }, Eve.cookie)
    await tick(h)
    s = await h.state()
    assert.deepEqual([booking(s, last.id, Fay.id).status, credits(s, Fay.id), s.classes.find(c => c.id === last.id).occupancy.onlineOpen], ['waitlisted', 5, 1])
    assert.match((await h.send('/app/studio', undefined, h.owner)).text, /Inside the late-cancel window: promote no one; the spot stays open to booking\./)
  })
})
