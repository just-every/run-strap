import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { run } from './harness.mjs'

// Future ISO week keeps the actual time-bound booking rules meaningful.
export function week() {
  const day = new Date(Date.now() + 14 * 86400_000)
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7)
  return day.toISOString().slice(0, 10)
}
const expiry = () => new Date(Date.now() + 90 * 86400_000).toISOString()
async function pack(h, personId, credits = 5, amountCents = 12000) {
  const draft = await h.cmd('pack.prepare', { personId, credits, amountCents, expiresAt: expiry() })
  return h.cmd('pack.approve', { id: draft.id })
}
async function timetable(h, instructorId, capacity = 1) {
  const monday = week(), draft = await h.cmd('classes.prepare', { week: monday, classes: [{ title: 'Morning Pilates', start: monday + 'T22:00:00Z', end: monday + 'T23:00:00Z', capacity, instructorId }] })
  await h.cmd('classes.publish', { id: draft.id })
  return (await h.state()).classes[0]
}

test('native invitations, role isolation, CSRF, input validation and immediate revocation', () => run(async h => {
  const alex = await h.person('Alex'), sam = await h.person('Sam')
  await h.state('', 401)
  assert.equal((await h.send('/app/mail', undefined, alex.cookie)).status, 404)
  const setup = await h.mf.dispatchFetch(h.origin + '/setup', {method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
  assert.equal(setup.status,303)
  assert.equal((await h.send('/app/mail', undefined, h.owner)).status, 404)
  assert.deepEqual((await h.state(alex.cookie)).people.map(p => p.id), [alex.id])
  await h.cmd('person.save', { name: 'No' }, alex.cookie, 403)
  await h.cmd('pack.approve', { id: 'none' }, alex.cookie, 403)
  const cross = await h.send('/api/strap/command', { name: 'person.erase', input: { id: alex.id } }, h.owner, { origin: 'https://evil.example' })
  assert.equal(cross.status, 403)
  await h.cmd('person.save', { id: alex.id, name: 'Alex', email: alex.email, role: 'member', active: false })
  await h.state(alex.cookie, 403)
  await h.cmd('person.erase', { id: sam.id }, h.owner, 409)
  const malformed = await h.mf.dispatchFetch(h.origin + '/api/strap/command', { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/json' }, body: '{' })
  assert.equal(malformed.status, 400)
}))

test('published week, atomic credit booking, FIFO waitlist promotion and attendance', () => run(async h => {
  const alex = await h.person('Alex'), sam = await h.person('Sam'), coach = await h.person('Priya', 'instructor'), other = await h.person('Taylor', 'instructor')
  await pack(h, alex.id); await pack(h, sam.id)
  const session = await timetable(h, coach.id)
  const booked = await h.cmd('booking.book', { classId: session.id }, alex.cookie)
  const waiting = await h.cmd('booking.book', { classId: session.id }, sam.cookie)
  let s = await h.state()
  assert.equal(s.bookings.find(b => b.id === waiting.id).status, 'waitlisted')
  assert.equal(s.packs.find(p => p.personId === alex.id).remaining, 4)
  assert.equal(s.packs.find(p => p.personId === sam.id).remaining, 5)
  await h.cmd('booking.cancel', { id: booked.id }, sam.cookie, 403)
  await h.cmd('booking.cancel', { id: booked.id }, alex.cookie)
  s = await h.state()
  assert.equal(s.bookings.find(b => b.id === waiting.id).status, 'booked')
  assert.equal(s.packs.find(p => p.personId === alex.id).remaining, 5)
  assert.equal(s.packs.find(p => p.personId === sam.id).remaining, 4)
  await h.cmd('attendance.checkin', { id: waiting.id }, other.cookie, 403)
  await h.cmd('attendance.checkin', { id: waiting.id }, sam.cookie, 403)
  await h.cmd('attendance.checkin', { id: waiting.id }, coach.cookie)
  const before = (await h.state()).packs.find(p => p.personId === sam.id).remaining
  await h.cmd('attendance.checkin', { id: waiting.id }, coach.cookie, 409)
  assert.equal((await h.state()).packs.find(p => p.personId === sam.id).remaining, before)
}))

test('capacity and credit cannot be overspent by concurrent public requests', () => run(async h => {
  const alex = await h.person('Alex'), coach = await h.person('Priya', 'instructor')
  await pack(h, alex.id, 1)
  const session = await timetable(h, coach.id)
  const results = await Promise.all([1, 2].map(() => h.send('/api/strap/command', { name: 'booking.book', input: { classId: session.id } }, alex.cookie)))
  assert.ok(results.some(r => r.status === 200))
  const s = await h.state()
  assert.equal(s.bookings.filter(b => b.status === 'booked').length, 1)
  assert.equal(s.packs.find(p => p.personId === alex.id).remaining, 0)
}))

test('approved pack charges and once-only external payment references keep balances', () => run(async h => {
  const alex = await h.person('Alex')
  const draft = await h.cmd('pack.prepare', { personId: alex.id, credits: 10, amountCents: 20000, expiresAt: expiry() })
  assert.equal((await h.state()).packs.length, 0)
  await h.cmd('pack.approve', { id: draft.id })
  await h.cmd('pack.approve', { id: draft.id }, h.owner, 409)
  await h.cmd('payment.record', { personId: alex.id, amountCents: 7500, reference: 'Processor-1001' })
  await h.cmd('payment.record', { personId: alex.id, amountCents: 7500, reference: 'Processor-1001' }, h.owner, 409)
  await h.cmd('payment.record', { personId: alex.id, amountCents: -1, reference: 'bad' }, h.owner, 400)
  const s = await h.state()
  assert.equal(s.payments.length, 1)
  assert.equal(s.balances.find(p => p.personId === alex.id).balanceCents, 12500)
  assert.ok(s.approvals.some(a => a.draftId === draft.id))
}))

test('waiver acknowledgements bind exact immutable versions before booking', () => run(async h => {
  const alex = await h.person('Alex'), coach = await h.person('Priya', 'instructor')
  await pack(h, alex.id)
  const session = await timetable(h, coach.id)
  const old = await h.cmd('waiver.publish', { text: 'Studio safety briefing version one.' })
  await h.cmd('booking.book', { classId: session.id }, alex.cookie, 409)
  await h.cmd('waiver.acknowledge', { id: old.id }, alex.cookie)
  const current = await h.cmd('waiver.publish', { text: 'Studio safety briefing version two.' })
  await h.cmd('waiver.acknowledge', { id: old.id }, alex.cookie, 409)
  await h.cmd('booking.book', { classId: session.id }, alex.cookie, 409)
  await h.cmd('waiver.acknowledge', { id: current.id }, alex.cookie)
  await h.cmd('booking.book', { classId: session.id }, alex.cookie)
}))

test('agent prepares exact work, native owner approves, agent cannot approve or use human door', () => run(async h => {
  const alex = await h.person('Alex'), key = await h.cmd('agent.create', { label: 'Studio assistant' }), headers = { authorization: `Bearer ${key.token}` }
  const agent = (name, input) => h.send('/api/strap/agent/command', { name, input }, '', headers)
  const draft = await agent('pack.prepare', { personId: alex.id, credits: 5, amountCents: 10000, expiresAt: expiry() })
  assert.equal(draft.status, 200)
  assert.equal((await agent('pack.approve', { id: draft.value.id })).status, 403)
  assert.equal((await h.send('/api/strap/command', { name: 'pack.approve', input: { id: draft.value.id } }, '', headers)).status, 401)
  await h.cmd('pack.approve', { id: draft.value.id })
  const reminder = await agent('reminder.prepare', { personId: alex.id })
  assert.equal(reminder.status, 200)
  const approved = await h.cmd('reminder.approve', { id: reminder.value.id })
  assert.ok(JSON.stringify(approved).includes('100'))
  const download = await h.send('/api/strap/reminders/'+reminder.value.id+'.txt',undefined,h.owner)
  assert.equal(download.status,200); assert.equal(download.text,approved.text)
  assert.equal((await h.send('/api/strap/reminders/'+reminder.value.id+'.txt',undefined,alex.cookie)).status,403)
  await h.cmd('agent.revoke', { id: key.id })
  assert.equal((await agent('reminder.prepare', { personId: alex.id })).status, 401)
}))

test('Mindbody documented-shape CSV previews, journals originals, applies exact review and preserves edits on undo', () => run(async h => {
  const csv = await readFile('tests/fixtures/members.csv', 'utf8')
  const preview = await h.cmd('import.preview', { csv })
  assert.equal((await h.state()).people.length, 0)
  await h.cmd('import.apply', { csv: csv.replace('Alex', 'Alec'), fingerprint: preview.fingerprint }, h.owner, 409)
  const applied = await h.cmd('import.apply', { csv, fingerprint: preview.fingerprint })
  let job = applied.job
  while (job.state === 'applying') job = (await h.cmd('import.resume', { jobId: job.id })).job
  assert.equal(job.state, 'completed')
  const people = (await h.state()).people
  assert.ok(people.length > 1); assert.ok(people.every(p => !p.active))
  const journal = await h.cmd('import.journal', { jobId: job.id }); assert.ok(journal.originals.length)
  await h.cmd('person.save', { id: people[0].id, name: 'Edited by owner', email: people[0].email, role: 'member', active: false })
  await h.cmd('import.undo', { jobId: job.id })
  const after = (await h.state()).people
  assert.equal(after.length, 1); assert.equal(after[0].name, 'Edited by owner')
}))

test('unused identity erasure clears PII and blocks recreation or CSV reimport', () => run(async h => {
  const p = { name: 'Never joined', email: 'unused@studio.example', role: 'member', active: false }
  const person = await h.cmd('person.save', p)
  await h.cmd('person.erase', { id: person.id })
  assert.ok(!JSON.stringify(await h.state()).includes(p.email))
  await h.cmd('person.save', p, h.owner, 409)
  const csv = 'MemberId,FirstName,LastName,Email\nunused,Never,Joined,unused@studio.example\n'
  const preview = await h.cmd('import.preview', { csv })
  await h.cmd('import.apply', { csv, fingerprint: preview.fingerprint }, h.owner, 409)
}))

test('browser forms take dollars, calendar dates and wall times on the studio clock', () => run(async h => {
  const form = async (name, fields, back = '/app') => {
    const r = await h.mf.dispatchFetch(`${h.origin}/app/action?name=${name}&returnTo=${encodeURIComponent(back)}`, { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(), redirect: 'manual' })
    return { status: r.status, text: await r.text() }
  }
  await h.mf.dispatchFetch(h.origin + '/setup', { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=yes', redirect: 'manual' })
  const chicago = (iso, options) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', ...options }).format(new Date(iso))
  const coach = await h.cmd('person.save', { name: 'Dana Reyes', email: 'dana@studio.example', role: 'instructor', active: true })
  const alex = await h.cmd('person.save', { name: 'Alex Rivera', email: 'alex@studio.example', role: 'member', active: true })
  assert.match((await form('classes.prepare', { week: week(), rows: '1', c0_title: 'Reformer Flow', c0_day: '1', c0_time: '06:00', c0_minutes: '50', c0_capacity: '12', c0_instructorId: coach.id })).text, /time zone/)
  assert.equal((await form('studio.save', { location: 'East Nashville', timeZone: 'America/Chicago' })).status, 303)
  assert.equal((await form('classes.prepare', { week: week(), rows: '2', c0_title: 'Reformer Flow', c0_room: 'Reformer room', c0_day: '1', c0_time: '06:00', c0_minutes: '50', c0_capacity: '12', c0_instructorId: coach.id, c1_title: '' }, '/app/classes')).status, 303)
  const draft = (await h.state()).drafts.find(d => d.type === 'classes')
  assert.equal(draft.classes.length, 1)
  const [entry] = draft.classes
  assert.equal(chicago(entry.start, { weekday: 'short', hour: 'numeric', minute: '2-digit' }), 'Tue 6:00 AM')
  assert.equal(Date.parse(entry.end) - Date.parse(entry.start), 50 * 60_000)
  assert.equal((await form('classes.publish', { id: draft.id }, '/app/classes')).status, 303)
  const day = new Date(Date.parse(week() + 'T12:00:00Z') + 86400_000).toISOString().slice(0, 10)
  const today = await h.send(`/app?day=${day}`, undefined, h.owner)
  assert.match(today.text, /6:00 am/); assert.match(today.text, /Reformer Flow/); assert.doesNotMatch(today.text, /UTC/)
  const expires = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10)
  assert.equal((await form('pack.prepare', { personId: alex.id, credits: '10', amount: '$189.00', expiresOn: expires }, '/app/packs')).status, 303)
  const pack = (await h.state()).drafts.find(d => d.type === 'pack')
  assert.equal(pack.amountCents, 18900)
  const boundary = new Date(Date.parse(expires + 'T12:00:00Z') + 86400_000).toISOString().slice(0, 10)
  assert.equal(chicago(pack.expiresAt, { year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }), `${boundary.slice(5, 7)}/${boundary.slice(8, 10)}/${boundary.slice(0, 4)}, 00:00`)
  assert.match((await form('payment.record', { personId: alex.id, amount: '1,2x', reference: 'SQ-1' }, '/app/packs')).text, /in dollars/)
  assert.equal((await form('payment.record', { personId: alex.id, amount: '75', reference: 'SQ-1' }, '/app/packs')).status, 303)
  assert.equal((await h.state()).payments[0].amountCents, 7500)
}))

test('SCHED-003: instructor, room and named equipment conflicts include buffers, normalized identity and exact UTC boundaries', () => run(async h => {
  const coach = await h.cmd('person.save', { name: 'Priya', email: 'priya@studio.example', role: 'instructor', active: true })
  const other = await h.cmd('person.save', { name: 'Taylor', email: 'taylor@studio.example', role: 'instructor', active: true })
  const monday = week(), at = (hour, minute = 0) => `${monday}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`
  const entry = (title, start, end, extra = {}) => ({ title, start, end, capacity: 10, instructorId: other.id, ...extra })
  const prepare = classes => h.cmd('classes.prepare', { week: monday, classes })
  const first = await prepare([entry('Published reformer class', at(10), at(11), { instructorId: coach.id, room: ' Main   Studio ', equipment: [' Reformer   2 ', 'Shared   Tower', 'shared tower'], bufferBeforeMinutes: 10, bufferAfterMinutes: 15 })])
  await h.cmd('classes.publish', { id: first.id })
  const published = (await h.state()).classes[0]
  assert.equal(published.room, 'Main Studio')
  assert.equal(published.equipment.length, 2)
  for (const [label, resource] of [
    ['instructor', { instructorId: coach.id }], ['room', { room: 'mAIN\t studio' }],
    ['reformer', { equipment: ['reformer 2'] }], ['shared equipment', { equipment: ['SHARED tower'] }],
  ]) {
    // Both sides are buffered for every allocation, including a candidate's prep/cleanup.
    for (const [start, end, buffer] of [
      [at(10, 15), at(10, 45), {}], [at(11, 14), at(12), {}], [at(9), at(9, 51), {}],
      [at(11, 20), at(12), { bufferBeforeMinutes: 6 }], [at(9), at(9, 45), { bufferAfterMinutes: 6 }],
    ]) {
      const before = await h.state()
      const refused = await h.cmd('classes.prepare', { week: monday, classes: [entry(`Conflicting ${label}`, start, end, { ...resource, ...buffer }), entry('Must not partially save', at(18), at(19))] }, h.owner, 409)
      assert.match(refused.error, /Published reformer class/)
      assert.ok(refused.error.includes(published.id))
      assert.match(refused.error, /09:50:00.000Z.*11:15:00.000Z/)
      const after = await h.state()
      assert.equal(after.version, before.version)
      assert.equal(after.drafts.length, before.drafts.length)
    }
    // Exact contact at either buffered boundary is available, also with ISO offsets.
    const boundary = await prepare([entry(`Boundary ${label}`, at(8), at(9, 45), { ...resource, bufferAfterMinutes: 5 }), entry(`After ${label}`, `${monday}T12:20:00+01:00`, at(13), { ...resource, bufferBeforeMinutes: 5 })])
    assert.equal(boundary.classes.length, 2)
  }
  // Conflicts within one proposed week are refused before any draft exists.
  for (const resource of [{ instructorId: coach.id }, { room: 'Side Room' }, { equipment: ['Reformer 7'] }]) {
    const left = entry('First proposed class', at(15), at(16), { ...resource, instructorId: coach.id })
    const right = entry('Second proposed class', at(15, 30), at(16, 30), resource)
    const before = (await h.state()).drafts.length
    const refused = await h.cmd('classes.prepare', { week: monday, classes: [left, right] }, h.owner, 409)
    assert.match(refused.error, /First proposed class.*Second proposed class/)
    assert.equal((await h.state()).drafts.length, before)
  }
  for (const invalid of [{ bufferBeforeMinutes: -1 }, { bufferAfterMinutes: 1.5 }, { equipment: 'Reformer 2' }, { room: 42 }]) {
    await h.cmd('classes.prepare', { week: monday, classes: [entry('Invalid allocation', at(20), at(21), invalid)] }, h.owner, 400)
  }
}))

test('SCHED-003: owner availability forms block stale drafts, protect published allocations and keep private reasons from members and instructors', () => run(async h => {
  const setup = await h.mf.dispatchFetch(h.origin + '/setup', { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=yes', redirect: 'manual' })
  assert.equal(setup.status, 303)
  const coach = await h.person('Priya', 'instructor'), member = await h.person('Alex')
  const monday = week()
  await h.cmd('studio.save', { location: 'Chicago', timeZone: 'America/Chicago' })
  const form = async (name, fields) => {
    const response = await h.mf.dispatchFetch(`${h.origin}/app/action?name=${name}&returnTo=%2Fapp%2Fclasses`, { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(), redirect: 'manual' })
    return { status: response.status, text: await response.text() }
  }
  // The existing class-week form sends structured resources and preparation buffers.
  assert.equal((await form('classes.prepare', { week: monday, rows: '1', c0_title: 'Future review', c0_room: 'Main Room', c0_equipment: 'Reformer 2\n Shared Tower ', c0_bufferBeforeMinutes: '10', c0_bufferAfterMinutes: '15', c0_day: '0', c0_time: '09:00', c0_minutes: '50', c0_capacity: '10', c0_instructorId: coach.id })).status, 303)
  const draft = (await h.state()).drafts.find(d => d.type === 'classes'), session = draft.classes[0]
  assert.equal(session.title, 'Future review')
  assert.equal(session.room, 'Main Room')
  assert.deepEqual(session.equipment, ['Reformer 2', 'Shared Tower'])
  assert.equal(session.bufferBeforeMinutes, 10)
  assert.equal(session.bufferAfterMinutes, 15)
  const secret = 'Private medical time off <not public>'
  for (const [kind, resourceId] of [['instructor', coach.id], ['room', ' MAIN   room '], ['equipment', ' reformer  2 ']]) {
    const fields = { resourceKind: kind, resourceId, instructorId: coach.id, startDate: monday, startTime: '08:55', endDate: monday, endTime: '09:00', reason: secret }
    const before = await h.state()
    assert.equal((await form('scheduling.unavailable.save', fields)).status, 303)
    const unavailable = (await h.state()).unavailability.find(r => r.status === 'active')
    assert.equal(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(new Date(unavailable.start)), '8:55 AM')
    assert.equal((await h.state()).classes.length, 0)
    let page = await h.send('/app/classes', undefined, h.owner)
    assert.match(page.text, /Resolve these scheduling conflicts before publication/)
    assert.ok(page.text.includes(unavailable.id))
    assert.match(page.text, /Private medical time off &lt;not public&gt;/)
    const refused = await h.cmd('classes.publish', { id: draft.id }, h.owner, 409)
    assert.ok(refused.error.includes(unavailable.id))
    assert.equal((await h.state()).approvals.length, before.approvals.length)
    assert.equal((await h.state()).drafts.find(d => d.id === draft.id).status, 'draft')
    assert.match((await form('classes.publish', { id: draft.id })).text, /Scheduling conflict/)
    await h.cmd('classes.prepare', { week: monday, classes: [{ ...session, title: 'Also unavailable' }] }, h.owner, 409)
    for (const cookie of [member.cookie, coach.cookie]) {
      const privateState = await h.state(cookie)
      assert.deepEqual(privateState.unavailability, [])
      assert.ok(!JSON.stringify(privateState).includes(secret))
      assert.ok(!(await h.send('/app/classes', undefined, cookie)).text.includes('Private medical'))
      await h.cmd('scheduling.unavailable.save', { resourceKind: kind, resourceId, start: unavailable.start, end: unavailable.end, reason: 'Unauthorized' }, cookie, 403)
      await h.cmd('scheduling.unavailable.remove', { id: unavailable.id }, cookie, 403)
    }
    const changed = await h.cmd('scheduling.unavailable.save', { id: unavailable.id, resourceKind: kind, resourceId, start: new Date(Date.parse(session.end) + 60 * 60_000).toISOString(), end: new Date(Date.parse(session.end) + 120 * 60_000).toISOString(), reason: 'Changed unavailable time' })
    assert.equal(changed.id, unavailable.id)
    assert.doesNotMatch((await h.send('/app/classes', undefined, h.owner)).text, /Resolve these scheduling conflicts before publication/)
    await h.cmd('scheduling.unavailable.save', { id: unavailable.id, resourceKind: kind, resourceId, start: unavailable.start, end: unavailable.end, reason: secret })
    assert.match((await h.send('/app/classes', undefined, h.owner)).text, /Resolve these scheduling conflicts before publication/)
    assert.equal((await form('scheduling.unavailable.remove', { id: unavailable.id })).status, 303)
    page = await h.send('/app/classes', undefined, h.owner)
    assert.doesNotMatch(page.text, /Resolve these scheduling conflicts before publication/)
  }
  assert.equal((await form('classes.publish', { id: draft.id })).status, 303)
  const published = (await h.state()).classes[0]
  for (const [resourceKind, resourceId] of [['instructor', coach.id], ['room', 'MAIN room'], ['equipment', 'REFORMER 2']]) {
    const before = (await h.state()).unavailability.length
    const rejected = await h.cmd('scheduling.unavailable.save', { resourceKind, resourceId, start: new Date(Date.parse(session.end) + 14 * 60_000).toISOString(), end: new Date(Date.parse(session.end) + 20 * 60_000).toISOString(), reason: 'Cannot invalidate class cleanup' }, h.owner, 409)
    assert.ok(rejected.error.includes(published.id))
    assert.equal((await h.state()).unavailability.length, before)
    // An exception touching the exact cleanup boundary does not block the class.
    await h.cmd('scheduling.unavailable.save', { resourceKind, resourceId, start: new Date(Date.parse(session.end) + 15 * 60_000).toISOString(), end: new Date(Date.parse(session.end) + 20 * 60_000).toISOString(), reason: 'After cleanup' })
  }
  const privateException = await h.cmd('scheduling.unavailable.save', { resourceKind: 'instructor', resourceId: coach.id, start: monday + 'T20:00:00Z', end: monday + 'T21:00:00Z', reason: secret })
  const key = await h.cmd('agent.create', { label: 'Preparation only' }), headers = { authorization: `Bearer ${key.token}` }
  assert.equal((await h.send('/api/strap/agent/command', { name: 'scheduling.unavailable.save', input: {} }, '', headers)).status, 403)
  const context = await h.send('/api/strap/agent/context', undefined, '', headers)
  assert.equal(context.status, 200)
  assert.deepEqual(context.value.unavailability, [])
  assert.ok(!context.text.includes(secret))
  const agentConflict = await h.send('/api/strap/agent/command', { name: 'classes.prepare', input: { week: monday, classes: [{ title: 'Unavailable agent proposal', start: monday + 'T20:10:00Z', end: monday + 'T20:30:00Z', capacity: 10, instructorId: coach.id }] } }, '', headers)
  assert.equal(agentConflict.status, 409)
  assert.ok(agentConflict.text.includes(privateException.id))
  assert.ok(!agentConflict.text.includes(secret))
}))

test('SCHED-003: concurrent publication commits one complete allocation and displays the conflicting records before retry', () => run(async h => {
  const setup = await h.mf.dispatchFetch(h.origin + '/setup', { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=yes', redirect: 'manual' })
  assert.equal(setup.status, 303)
  const coach = await h.cmd('person.save', { name: 'Priya', email: 'priya@studio.example', role: 'instructor', active: true })
  const other = await h.cmd('person.save', { name: 'Taylor', email: 'taylor@studio.example', role: 'instructor', active: true })
  const monday = week(), at = hour => `${monday}T${String(hour).padStart(2, '0')}:00:00Z`
  for (const [index, kind] of ['instructor', 'room', 'equipment'].entries()) {
    const hour = 1 + index * 4, shared = kind === 'instructor' ? {} : kind === 'room' ? { room: 'Shared Studio' } : { equipment: ['Reformer 3', 'Shared Chair'] }
    const make = (label, instructorId) => h.cmd('classes.prepare', { week: monday, classes: [
      { title: `${kind} ${label} allocation`, start: at(hour), end: at(hour + 1), capacity: 10, instructorId, ...shared },
      { title: `${kind} ${label} extra`, start: at(hour + 2), end: at(hour + 3), capacity: 10, instructorId, room: `${kind} ${label} exclusive` },
    ] })
    const left = await make('left', coach.id), right = await make('right', kind === 'instructor' ? coach.id : other.id)
    const before = await h.state()
    const outcomes = await Promise.all([left, right].map(d => h.send('/api/strap/command', { name: 'classes.publish', input: { id: d.id } }, h.owner)))
    assert.deepEqual(outcomes.map(r => r.status).sort(), [200, 409])
    const winner = [left, right][outcomes.findIndex(r => r.status === 200)], loser = winner.id === left.id ? right : left
    const state = await h.state()
    assert.equal(state.classes.length, before.classes.length + 2)
    assert.equal(state.approvals.length, before.approvals.length + 1)
    assert.equal(state.classes.filter(c => c.draftId === winner.id).length, 2)
    assert.equal(state.classes.filter(c => c.draftId === loser.id).length, 0)
    assert.equal(state.drafts.find(d => d.id === loser.id).status, 'draft')
    const page = await h.send('/app/classes', undefined, h.owner)
    assert.match(page.text, /Resolve these scheduling conflicts before publication/)
    assert.ok(page.text.includes(winner.classes[0].id))
    assert.ok(page.text.includes(winner.classes[0].title))
    assert.match(page.text, /Occupied interval/)
    const retry = await h.cmd('classes.publish', { id: loser.id }, h.owner, 409)
    assert.ok(retry.error.includes(winner.classes[0].id))
    assert.equal((await h.state()).classes.length, state.classes.length)
    assert.equal((await h.state()).approvals.length, state.approvals.length)
  }
}))


test('Private appointment offers retain overlapping alternatives and recheck live resources without reservations or money', () => run(async h => {
  await h.cmd('studio.save',{location:'Park Slope',timeZone:'America/New_York'});
  const coach = await h.person('Priya','instructor'), member = await h.person('Alex');
  const monday = week(), at = (hour,minute=0) => `${monday}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00Z`;
  const input = {service:'Private Mat',start:at(10),durationMinutes:60,instructorId:coach.id,room:' Main   Studio ',equipment:[' Tower ','tower'],bufferAfterMinutes:15,requestId:'synthetic-strap-appointment-1'};
  const left = await h.cmd('appointment.offer.save',input);
  const right = await h.cmd('appointment.offer.save',{...input,start:at(10,30),requestId:'synthetic-strap-appointment-2'});
  assert.deepEqual([left.end,left.room,left.equipment,left.capacity,left.locationId,left.timeZone],[at(11).replace('Z','.000Z'),'Main Studio',['tower'],1,'studio','America/New_York']);
  assert.equal((await h.cmd('appointment.offer.save',input)).id,left.id);
  await h.cmd('appointment.offer.save',{...input,durationMinutes:30},h.owner,409);
  for (const offer of [left,right]) {
    const preview = await h.cmd('appointment.offer.preview',{id:offer.id});
    assert.deepEqual([preview.available,preview.reserved,preview.paymentCollected,preview.bookingAvailable],[true,false,false,false]);
  }
  const unavailable = await h.cmd('scheduling.unavailable.save',{resourceKind:'instructor',resourceId:coach.id,start:at(11,10),end:at(12),reason:'Private absence'});
  let preview = await h.cmd('appointment.offer.preview',{id:left.id});
  assert.equal(preview.available,false,'cleanup buffer blocks the offer');
  assert.equal(preview.blockers.find(b=>b.id===unavailable.id).reason,'Private absence');
  const conflictedInput = {...input,requestId:'synthetic-strap-appointment-conflict'};
  const conflicted = await h.cmd('appointment.offer.save',conflictedInput);
  assert.equal(conflicted.availabilityAtCreation.blockers.find(b=>b.id===unavailable.id).reason,'Private absence');

  await h.cmd('scheduling.unavailable.remove',{id:unavailable.id});
  assert.equal((await h.cmd('appointment.offer.preview',{id:left.id})).available,true);
  const retained = await h.cmd('appointment.offer.preview',{id:conflicted.id});
  assert.equal(retained.available,true);
  assert.equal(retained.offer.availabilityAtCreation.blockers.find(b=>b.id===unavailable.id).reason,'Private absence','original conflict reason survives exception removal');
  assert.deepEqual(await h.cmd('appointment.offer.save',conflictedInput),conflicted,'replay preserves the original review');

  const draft = await h.cmd('classes.prepare',{week:monday,classes:[{title:'Allocated class',start:at(10,15),end:at(11,15),capacity:4,instructorId:coach.id,room:'MAIN studio'}]});
  await h.cmd('classes.publish',{id:draft.id});
  preview = await h.cmd('appointment.offer.preview',{id:right.id});
  assert.equal(preview.available,false,'a later publication invalidates prior availability');
  assert.ok(preview.blockers.some(b=>b.id===draft.classes[0].id && b.resource.kind==='room'));
  const overnight = await h.cmd('appointment.offer.save',{...input,start:at(2),requestId:'synthetic-strap-appointment-3'});
  assert.equal(overnight.localDate,new Date(Date.parse(monday+'T12:00:00Z')-86400_000).toISOString().slice(0,10),'offer date follows its location clock');
  const closure = await h.cmd('closure.prepare',{scope:'location',start:at(2),end:at(3),reason:'Private studio closure'});
  await h.cmd('closure.confirm',{id:closure.id,impact:closure.impact.key});
  assert.ok((await h.cmd('appointment.offer.preview',{id:overnight.id})).blockers.some(b=>b.kind==='location_closed' && b.id===closure.id));
  const snapshot = (await h.db.prepare('SELECT id,kind,data FROM st_records ORDER BY id').all()).results;
  for (const cookie of [member.cookie,coach.cookie,'']) {
    for (const [name,fields] of [['appointment.offer.save',input],['appointment.offer.preview',{id:left.id}]]) {
      await h.cmd(name,fields,cookie,cookie ? 403 : 401);
    }
  }
  const key = await h.cmd('agent.create',{label:'Appointment preparation denied'});
  for (const name of ['appointment.offer.save','appointment.offer.preview']) {
    assert.equal((await h.send('/api/strap/agent/command',{name,input:{id:left.id}},'',{authorization:`Bearer ${key.token}`})).status,403);
  }
  assert.deepEqual((await h.db.prepare('SELECT id,kind,data FROM st_records ORDER BY id').all()).results,snapshot,'denials never change product records');
  const state = await h.state();
  assert.equal(state.bookings.length,0);
  assert.equal(state.charges.length,0);
  assert.equal(state.payments.length,0);
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM st_notice_deliveries').first()).n,0);
  assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM st_records WHERE kind='appointmentOffer'").first()).n,4);
  assert.ok(!(await h.state(member.cookie)).classes.some(c=>c.id===left.id),'private offers are not published classes');

  const p = await pack(h,member.id,10);
  const change = await h.cmd('plan.change.prepare',{packId:p.id,mode:'now',effectiveAt:new Date(Date.now()+86400_000).toISOString().replace(/\.\d{3}Z$/,'.000Z'),credits:12,amountCents:15000,requestId:'synthetic-strap-due-change'});
  await h.cmd('plan.change.accept',{id:change.id,key:change.key},member.cookie);
  // Move the approved record across its due boundary; no production clock override.
  await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.effectiveAt',?) WHERE id=?").bind(new Date(Date.now()-86400_000).toISOString(),change.id).run();
  const rows = async () => (await h.db.prepare("SELECT id,kind,data FROM st_records WHERE kind NOT IN ('appointmentOffer','appointmentSeriesOffer') ORDER BY id").all()).results;
  const pending = await rows(), outbox = await h.db.prepare('SELECT COUNT(*) AS n FROM rer_mail_development_outbox').first();
  const single = await h.cmd('appointment.offer.save',{...input,requestId:'synthetic-strap-no-effects'});
  await h.cmd('appointment.offer.preview',{id:single.id});
  await h.cmd('appointment.offer.save',{...input,requestId:'synthetic-strap-no-effects'});
  const seriesInput={...input,startDate:monday,endDate:monday,time:'09:00',minutes:60,requestId:'synthetic-strap-series-no-effects'};
  const series=await h.cmd('appointment.series.offer.save',seriesInput);
  await h.cmd('appointment.series.offer.preview',{id:series.id});
  await h.cmd('appointment.series.offer.save',seriesInput);
  assert.deepEqual(await rows(),pending,'save, read and replay do not execute due billing or entitlement work');
  assert.deepEqual(await h.db.prepare('SELECT COUNT(*) AS n FROM rer_mail_development_outbox').first(),outbox);
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM st_notice_deliveries').first()).n,0);

}));
