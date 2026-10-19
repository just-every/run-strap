import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'

export async function capacityStudio(h) {
  await h.mf.dispatchFetch(h.origin + '/setup', { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=yes', redirect: 'manual' })
  await h.cmd('studio.save', { location: 'Portland Studio', timeZone: 'America/Los_Angeles' })
  const coach = await h.person('Maya', 'instructor'), members = []
  for (const name of ['Avery','Blake','Cameron','Drew','Ellis','Finley','Gray','Harper','Indigo','Jordan','Kai','Logan','Morgan','Noor','Parker']) {
    const member = await h.person(name)
    const draft = await h.cmd('pack.prepare', { personId: member.id, credits: 3, amountCents: 7500, expiresAt: '2099-12-31T00:00:00Z' })
    await h.cmd('pack.approve', { id: draft.id }); members.push(member)
  }
  const day = new Date(Date.now() + 14 * 86400_000)
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7)
  const week = day.toISOString().slice(0, 10)
  const classes = [0, 1].map((n) => ({ title: n ? 'Evening Mat' : 'Mat Basics', service: 'Mat', room: 'Sun room', start: week + `T${n ? '20' : '18'}:00:00Z`, end: week + `T${n ? '21' : '19'}:00:00Z`, capacity: 12, onlineCapacity: 10, instructorId: coach.id }))
  await h.cmd('classes.prepare', { week, classes: [{ ...classes[0], onlineCapacity: 13 }] }, h.owner, 400)
  const draft = await h.cmd('classes.prepare', { week, classes })
  await h.cmd('classes.publish', { id: draft.id })
  return { coach, members, classes: draft.classes, week }
}

test('SCHED-011: online ten, two desk-held seats, truthful occupancy and pool-aware FIFO promotion', () => run(async h => {
  const { coach, members, classes } = await capacityStudio(h), entry = classes[0], booked = []
  for (const member of members.slice(0, 10)) booked.push(await h.cmd('booking.book', { classId: entry.id }, member.cookie))
  let s = await h.state(members[10].cookie)
  assert.equal(s.classes[0].occupancy.onlineOpen, 0)
  assert.equal(s.classes[0].occupancy.heldOpen, 2)
  assert.equal(s.bookings.length, 0, 'counts do not expose other members records')
  let page = await h.send('/app', undefined, members[10].cookie)
  assert.match(page.text, /Full/); assert.match(page.text, /Join waitlist/)
  const waiters = []
  for (const member of members.slice(10, 12)) waiters.push(await h.cmd('booking.book', { classId: entry.id }, member.cookie))
  assert.ok(waiters.every(b => b.status === 'waitlisted'))
  for (const cookie of [members[12].cookie, coach.cookie]) await h.cmd('booking.desk', { classId: entry.id, personId: members[12].id }, cookie, 403)
  const key = await h.cmd('agent.create', { label: 'Planner' })
  assert.equal((await h.send('/api/strap/agent/command', { name: 'booking.desk', input: { classId: entry.id, personId: members[12].id } }, '', { authorization: `Bearer ${key.token}` })).status, 403)
  const desk = await h.cmd('booking.desk', { classId: entry.id, personId: members[12].id, channel: 'phone' })
  const walkin = await h.cmd('booking.desk', { classId: entry.id, personId: members[13].id, channel: 'desk' })
  assert.equal(desk.capacityPool, 'held'); assert.equal(walkin.capacityPool, 'held')
  assert.equal(desk.madeBy, (await h.state()).actor.id)
  const before = await h.state()
  await h.cmd('booking.desk', { classId: entry.id, personId: members[14].id }, h.owner, 409)
  await h.cmd('booking.desk', { classId: entry.id, personId: members[12].id }, h.owner, 409)
  assert.deepEqual((await h.state()).packs, before.packs)
  page = await h.send('/app/classes', undefined, h.owner)
  assert.match(page.text, /10 \/ 10 online · 2 \/ 2 desk-held/)
  await h.cmd('booking.cancel', { id: desk.id, cancelReason: 'Other' })
  s = await h.state()
  assert.equal(s.bookings.find(b => b.id === waiters[0].id).status, 'waitlisted', 'desk cancellation preserves held allocation')
  assert.equal(s.classes[0].occupancy.onlineOpen, 0)
  assert.equal(s.classes[0].occupancy.heldOpen, 1)
  await h.cmd('booking.cancel', { id: booked[0].id }, members[0].cookie)
  s = await h.state()
  assert.equal(s.bookings.find(b => b.id === waiters[0].id).status, 'booked')
  assert.equal(s.bookings.find(b => b.id === waiters[1].id).status, 'waitlisted')
  assert.equal(s.packs.find(p => p.personId === members[0].id).remaining, 3)
  assert.equal(s.packs.find(p => p.personId === members[10].id).remaining, 2)
  assert.equal(s.packCreditEvents.filter(e => e.bookingId === waiters[0].id && e.type === 'reserve').length, 1)
  await h.cmd('booking.cancel', { id: booked[0].id }, members[0].cookie, 409)
  assert.equal((await h.state()).classes[0].occupancy.booked, 11)
  const form = await h.mf.dispatchFetch(h.origin + '/app/action?name=booking.desk&returnTo=%2Fapp', { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ classId: entry.id, personId: members[14].id, channel: 'desk' }), redirect: 'manual' })
  assert.equal(form.status, 303)
  assert.equal((await h.state()).classes[0].occupancy.booked, 12)
  if (process.env.STRAP_PROOF_DIR) await (await import('./capacity-browser.mjs')).capacityBrowser(h, members, classes)
}))

test('SCHED-011: concurrent desk/online requests share total fence and desk may use spare online allocation', () => run(async h => {
  const { members, classes } = await capacityStudio(h), entry = classes[1]
  // Held seats are filled first; subsequent desk bookings use available online seats.
  const bookings = []
  for (const member of members.slice(0, 11)) bookings.push(await h.cmd('booking.desk', { classId: entry.id, personId: member.id }))
  assert.equal(bookings.filter(b => b.capacityPool === 'held').length, 2)
  assert.equal(bookings.filter(b => b.capacityPool === 'online').length, 9)
  const race = await Promise.all([
    h.send('/api/strap/command', { name: 'booking.book', input: { classId: entry.id } }, members[11].cookie),
    h.send('/api/strap/command', { name: 'booking.desk', input: { classId: entry.id, personId: members[12].id } }, h.owner),
  ])
  assert.equal(race.filter(r => r.status === 200).length, 1)
  assert.equal(race.filter(r => r.status === 409).length, 1)
  const s = await h.state(), occupancy = s.classes.find(c => c.id === entry.id).occupancy
  assert.equal(occupancy.booked, 12); assert.equal(occupancy.onlineBooked, 10)
  assert.ok(s.packs.every(p => p.remaining >= 0))
}))
