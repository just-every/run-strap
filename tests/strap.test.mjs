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
  assert.equal((await h.send('/app/mail', undefined, alex.cookie)).status, 403)
  const setup = await h.mf.dispatchFetch(h.origin + '/setup', {method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:'confirm=yes',redirect:'manual'})
  assert.equal(setup.status,303)
  const mailbox = await h.send('/app/mail', undefined, h.owner)
  assert.equal(mailbox.status,200)
  assert.ok(mailbox.text.includes(alex.email))
  assert.equal((await h.state(alex.cookie)).developmentMail.length, 0)
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
