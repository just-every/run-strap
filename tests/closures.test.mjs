import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'

const minute = 60_000, hour = 60 * minute
const at = offset => new Date(Math.ceil((Date.now() + offset) / minute) * minute).toISOString()
const monday = start => { const d = new Date(start); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (d.getUTCDay() + 6) % 7)).toISOString().slice(0, 10) }
const local = (value, zone = 'America/Chicago') => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(value)).map(x => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` } }
const form = (h, name, back, fields, cookie = h.owner) => h.mf.dispatchFetch(h.origin + `/app/action?name=${name}&returnTo=${encodeURIComponent(back)}`, { method: 'POST', headers: { origin: h.origin, cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields), redirect: 'manual' })
async function refused(h, name, input, cookie, status, code) {
  const before = (await h.state()).version
  const r = await h.send('/api/strap/command', { name, input }, cookie)
  assert.equal(r.status, status, JSON.stringify(r.value)); assert.equal(r.value.error, code)
  assert.equal((await h.state()).version, before, `${code}: no writes`)
}
async function studio(h, names) {
  await h.mf.dispatchFetch(h.origin + '/setup', { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=yes', redirect: 'manual' })
  await h.cmd('studio.save', { location: 'Nashville', timeZone: 'America/Chicago' })
  const coach = await h.person('Maya', 'instructor'), people = {}
  for (const name of names) {
    people[name] = await h.person(name)
    await h.cmd('pack.approve', { id: (await h.cmd('pack.prepare', { personId: people[name].id, credits: 5, amountCents: 10000, expiresAt: '2099-12-31T00:00:00Z' })).id })
  }
  const publish = async (title, start, room, capacity = 5) => (await h.cmd('classes.publish', { id: (await h.cmd('classes.prepare', { week: monday(start), classes: [{ title, start, end: new Date(Date.parse(start) + 50 * minute).toISOString(), capacity, room, instructorId: coach.id }] })).id })).classes[0]
  return { coach, people, publish }
}

test('SCHED-008: closing a room cancels its classes once from an exact impact preview: credits back, waitlists closed, one notice per booking and one provider email per member', async () => {
  const mails = []
  // The real Resend adapter; only its HTTPS endpoint is faked, refusing Cy's address.
  const outbound = async request => {
    assert.equal(request.url, 'https://api.resend.com/emails', 'no other network destination')
    const message = { ...await request.json(), idempotencyKey: request.headers.get('idempotency-key') }
    if (message.idempotencyKey?.startsWith('mail:confirmation:')) return Response.json({ id: message.idempotencyKey })
    mails.push(message)
    return message.to.includes('cy@studio.example') ? Response.json({ name: 'validation_error' }, { status: 422 }) : Response.json({ id: `re_${mails.length}` })
  }
  await run(async h => {
    const { coach, people, publish } = await studio(h, ['Ana', 'Ben', 'Cy', 'Dee', 'Eve'])
    const { Ana, Ben, Cy, Dee, Eve } = people
    const flow = await publish('Reformer Flow', at(26 * hour), 'Reformer room', 2), later = await publish('Reformer Later', at(28 * hour), 'Reformer room')
    const elsewhere = await publish('Mat Flow', at(27 * hour), 'Mat room'), after = await publish('Reformer Next Week', at(8 * 24 * hour), 'Reformer room')
    for (const who of [Ana, Ben, Cy, Dee]) await h.cmd('booking.book', { classId: flow.id }, who.cookie)
    await h.cmd('booking.book', { classId: later.id }, Ben.cookie)
    await h.cmd('booking.book', { classId: elsewhere.id }, Ana.cookie)
    await h.cmd('booking.book', { classId: after.id }, Dee.cookie)
    const from = local(Date.parse(flow.start) - hour), until = local(Date.parse(later.end) + hour)
    const closure = { scope: 'room', room: 'reformer  ROOM', startDate: from.date, startTime: from.time, endDate: until.date, endTime: until.time, reason: 'Burst pipe' }

    // Only the owner (manager until STAFF-001) prepares or confirms; an agent key cannot.
    await refused(h, 'closure.prepare', { scope: 'class', classId: flow.id, reason: 'x' }, coach.cookie, 403, 'owner_required')
    await refused(h, 'closure.prepare', { scope: 'class', classId: flow.id, reason: 'x' }, Ana.cookie, 403, 'owner_required')
    const key = await h.cmd('agent.create', { label: 'Planner' })
    assert.equal((await h.send('/api/strap/agent/command', { name: 'closure.prepare', input: { scope: 'class', classId: flow.id, reason: 'x' } }, '', { authorization: `Bearer ${key.token}` })).status, 403)
    await refused(h, 'closure.prepare', { scope: 'class', classId: flow.id }, h.owner, 400, 'invalid_reason')

    // The preview changes nothing and names every member and effect.
    const before = await h.state()
    assert.equal((await form(h, 'closure.prepare', '/app/classes', closure)).status, 303)
    let s = await h.state()
    const draft = s.closures.find(c => c.status === 'draft')
    assert.deepEqual(draft.impact.classes.map(c => c.classId), [flow.id, later.id], 'the room, inside the interval only, any spelling')
    assert.deepEqual([draft.impact.members, draft.impact.creditsReturned, draft.impact.waitlistClosed, draft.impact.moneyMoved], [4, 3, 2, 0])
    assert.deepEqual(s.packs.map(p => p.remaining), before.packs.map(p => p.remaining))
    assert.equal(s.classes.find(c => c.id === flow.id).status, 'published')
    const preview = (await h.send('/app/classes', undefined, h.owner)).text
    assert.match(preview, /Room reformer ROOM, [^<]+: Burst pipe[\s\S]*2 classes cancelled · 4 members notified · 3 credits returned · 2 waitlist spots closed · no money moves/)
    assert.match(preview, /Ana: credit returns to their pack[\s\S]*Cy: waitlist spot closes, no credit used/)
    assert.match(preview, /one email to each member through the studio’s mail provider/)

    // A booking after the preview makes it stale: the owner must preview again.
    await h.cmd('booking.book', { classId: later.id }, Eve.cookie)
    await refused(h, 'closure.confirm', { id: draft.id, impact: draft.impact.key }, h.owner, 409, 'closure_impact_changed')
    assert.match((await h.send('/app/classes', undefined, h.owner)).text, /Bookings changed since this preview\. Preview the impact again before confirming\./)
    assert.equal((await form(h, 'closure.prepare', '/app/classes', closure)).status, 303)
    const fresh = (await h.state()).closures.find(c => c.status === 'draft' && c.id !== draft.id)
    assert.equal(fresh.impact.members, 5)
    await refused(h, 'closure.confirm', { id: fresh.id, impact: fresh.impact.key }, coach.cookie, 403, 'owner_required')

    // Submitted twice at once and once more: every effect happens once.
    const ledger = (await h.state()).packCreditEvents.length
    const confirm = () => form(h, 'closure.confirm', '/app/classes', { id: fresh.id, impact: fresh.impact.key })
    await Promise.all([confirm(), confirm()])
    assert.equal((await confirm()).status, 303)
    s = await h.state()
    assert.equal(s.closures.find(c => c.id === fresh.id).status, 'applied')
    assert.deepEqual([flow, later].map(c => [s.classes.find(x => x.id === c.id).status, s.classes.find(x => x.id === c.id).cancelReason]), [['cancelled', 'Burst pipe'], ['cancelled', 'Burst pipe']])
    assert.deepEqual([elsewhere, after].map(c => s.classes.find(x => x.id === c.id).status), ['published', 'published'], 'other rooms and later dates stay')
    const hit = s.bookings.filter(b => b.classId === flow.id || b.classId === later.id)
    assert.deepEqual(hit.map(b => [b.status, b.cancellation, b.refunded]).sort(), [['cancelled', 'class_cancelled', true], ['cancelled', 'class_cancelled', true], ['cancelled', 'class_cancelled', true], ['cancelled', 'class_cancelled', true], ['cancelled', 'waitlist_closed', false], ['cancelled', 'waitlist_closed', false]])
    const restores = s.packCreditEvents.slice(ledger)
    assert.deepEqual(restores.map(e => [e.type, e.credits, e.reason]), Array(4).fill(['restore', 1, 'class_cancelled']), 'four credits back, once')
    assert.deepEqual([Ana, Ben, Cy, Dee, Eve].map(p => s.packs.find(x => x.personId === p.id).remaining), [4, 5, 5, 4, 5])
    assert.equal(s.charges.filter(c => c.bookingId && hit.some(b => b.id === c.bookingId)).length, 0, 'no fee, no money moved')

    // One in-app notice per booking; one provider email per member, its own idempotency key.
    assert.equal(mails.length, 5)
    assert.deepEqual(mails.map(m => m.to[0]).sort(), ['ana', 'ben', 'cy', 'dee', 'eve'].map(n => `${n}@studio.example`))
    assert.ok(mails.every(m => m.from === 'auth@studio.example' && m.idempotencyKey === `mail:${fresh.id}:${s.people.find(p => p.email === m.to[0]).id}`))
    const benMail = mails.find(m => m.to[0] === 'ben@studio.example')
    assert.equal(benMail.subject, 'Cancelled: 2 of your classes')
    assert.match(benMail.text, /Reformer Flow on .+ is cancelled\. Reason: Burst pipe\. Your class credit is back in your pack\.\n\nReformer Later on/)
    assert.match(mails.find(m => m.to[0] === 'cy@studio.example').text, /Your waitlist spot is closed; no credit was used\./)
    const deliveries = (await h.state()).noticeDeliveries.filter(d => d.sourceKind === 'closure')
    assert.deepEqual(deliveries.map(d => d.status).sort(), ['accepted', 'accepted', 'accepted', 'accepted', 'rejected'])
    const done = (await h.send('/app/classes', undefined, h.owner)).text
    assert.match(done, /Ana: credit returns to their pack · in-app notice · Email accepted by resend; delivery not confirmed/)
    assert.match(done, /Cy: waitlist spot closes, no credit used · in-app notice · Email refused by resend \(provider rejected\)/)
    const benNotices = (await h.state(Ben.cookie)).notices.filter(n => n.closureId === fresh.id)
    assert.deepEqual(benNotices.map(n => n.bookingId).sort(), hit.filter(b => b.personId === Ben.id).map(b => b.id).sort())
    assert.deepEqual((await h.state(Ana.cookie)).notices.filter(n => n.closureId === fresh.id).map(n => n.subject), [`Cancelled: Reformer Flow, ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(flow.start))}`])
    const anaHome = (await h.send('/app', undefined, Ana.cookie)).text
    assert.match(anaHome, /Notices[\s\S]*Cancelled: Reformer Flow[\s\S]*Reason: Burst pipe/)
    assert.match(anaHome, /Class cancelled/)
    await refused(h, 'notice.dismiss', { id: benNotices[0].id }, Ana.cookie, 403, 'forbidden')
    assert.equal((await form(h, 'notice.dismiss', '/app', { id: (await h.state(Ana.cookie)).notices.find(n => n.closureId === fresh.id).id }, Ana.cookie)).status, 303)
    assert.doesNotMatch((await h.send('/app', undefined, Ana.cookie)).text, /Reason: Burst pipe/)

    if (process.env.STRAP_PROOF_DIR) await (await import('./closures-browser.mjs')).closuresBrowser(h, Ben)
    // Closed waitlists stay closed and the room is blocked for the interval.
    await refused(h, 'booking.book', { classId: flow.id }, Cy.cookie, 409, 'class_cancelled')
    await refused(h, 'booking.desk', { classId: later.id, personId: Cy.id }, h.owner, 409, 'class_cancelled')
    const blocked = await h.send('/api/strap/command', { name: 'classes.prepare', input: { week: monday(flow.start), classes: [{ title: 'Pop-up', start: flow.start, end: flow.end, capacity: 3, room: 'Reformer room', instructorId: coach.id }] } }, h.owner)
    assert.equal(blocked.status, 409); assert.match(blocked.value.error, /room Reformer room: Closed: Burst pipe/)
    assert.equal(mails.length, 5, 'nothing more was sent')
  }, { auth: { MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'test-only-key' }, outbound })

  // Without a configured provider: the preview says so, and members get the in-app notice only.
  await run(async h => {
    const { coach, people, publish } = await studio(h, ['Gil'])
    const entry = await publish('Barre', at(30 * hour), 'Studio B')
    await h.cmd('booking.book', { classId: entry.id }, people.Gil.cookie)
    const draft = await h.cmd('closure.prepare', { scope: 'class', classId: entry.id, reason: 'Instructor ill' })
    assert.match((await h.send('/app/classes', undefined, h.owner)).text, /Notices: an in-app notice to each member; email not configured; members see an in-app notice only\./)
    await h.cmd('closure.confirm', { id: draft.id, impact: draft.impact.key })
    const s = await h.state()
    assert.deepEqual(s.noticeDeliveries.filter(d => d.sourceKind === 'closure').map(d => d.status), ['not_configured'])
    assert.match((await h.send('/app/classes', undefined, h.owner)).text, /Gil: credit returns to their pack · in-app notice · Email not configured; in-app notice only/)
    assert.equal((await h.state(people.Gil.cookie)).notices.filter(n => n.closureId === draft.id).length, 1)
    // A location closure blocks every new class in its interval.
    const start = at(50 * hour), end = at(53 * hour)
    const shut = await h.cmd('closure.prepare', { scope: 'location', start, end, reason: 'Holiday' })
    await h.cmd('closure.confirm', { id: shut.id, impact: shut.impact.key })
    const refusedClass = await h.send('/api/strap/command', { name: 'classes.prepare', input: { week: monday(at(51 * hour)), classes: [{ title: 'Holiday Flow', start: at(51 * hour), end: at(52 * hour), capacity: 3, instructorId: coach.id }] } }, h.owner)
    assert.equal(refusedClass.status, 409); assert.match(refusedClass.value.error, /Location closed .*: Holiday/)
  })
})
