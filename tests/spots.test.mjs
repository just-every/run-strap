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

test('SCHED-007: members pick a free reformer, one booking owns each spot, and front desk moves a spot with a staff-made record', () => run(async h => {
  await h.mf.dispatchFetch(h.origin + '/setup', { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=yes', redirect: 'manual' })
  await h.cmd('studio.save', { location: 'Nashville', timeZone: 'America/Chicago' })
  const coach = await h.person('Maya', 'instructor'), people = {}
  for (const name of ['Ana', 'Ben', 'Cy', 'Dee', 'Eve']) {
    people[name] = await h.person(name)
    await h.cmd('pack.approve', { id: (await h.cmd('pack.prepare', { personId: people[name].id, credits: 5, amountCents: 10000, expiresAt: '2099-12-31T00:00:00Z' })).id })
  }
  const { Ana, Ben, Cy, Dee, Eve } = people
  await refused(h, 'spots.save', { room: 'Reformer Room', spots: ['Reformer 1'] }, coach.cookie, 403, 'owner_required')
  await refused(h, 'spots.save', { room: 'Reformer Room', spots: ['Reformer 1', 'reformer  1'] }, h.owner, 400, 'duplicate_spot')
  assert.equal((await form(h, 'spots.save', '/app/studio', { room: 'Reformer Room', spots: 'Reformer 1\r\nReformer 2\r\nReformer 3\r\nReformer 4\r\nReformer 5', disabled: 'Reformer 5' })).status, 303)
  assert.match((await h.send('/app/studio', undefined, h.owner)).text, /Reformer Room[\s\S]*Reformer 1, Reformer 2, Reformer 3, Reformer 4, Reformer 5[\s\S]*Reformer 5/)
  const publish = async (title, start) => (await h.cmd('classes.publish', { id: (await h.cmd('classes.prepare', { week: monday(start), classes: [{ title, service: 'Reformer', room: 'Reformer Room', start, end: new Date(Date.parse(start) + 50 * minute).toISOString(), capacity: 10, instructorId: coach.id }] })).id })).classes[0]
  const entry = await publish('Reformer Flow', at(26 * hour)), later = await publish('Reformer Later', at(50 * hour))
  let s = await h.state(Ana.cookie), c = s.classes.find(x => x.id === entry.id)
  assert.equal(c.occupancy.total, 4, 'seats are the enabled spots, not the capacity of 10')
  assert.deepEqual(c.spots.map(x => x.state), ['free', 'free', 'free', 'free', 'disabled'])
  assert.match((await h.send('/app', undefined, Ana.cookie)).text, /<option value="Reformer 5" disabled>Reformer 5 \(out of service\)<\/option>/)

  // Ana picks Reformer 2 from the list; disabled, unknown and taken spots are refused.
  assert.equal((await form(h, 'booking.book', '/app', { classId: entry.id, spot: 'Reformer 2' }, Ana.cookie)).status, 303)
  await refused(h, 'booking.book', { classId: entry.id, spot: 'Reformer 5' }, Dee.cookie, 409, 'spot_disabled')
  await refused(h, 'booking.book', { classId: entry.id, spot: 'Reformer 9' }, Dee.cookie, 404, 'spot_not_found')
  await refused(h, 'booking.book', { classId: entry.id, spot: 'reformer 2' }, Dee.cookie, 409, 'spot_taken')
  // Two members race for Reformer 3: exactly one owns it.
  const race = await Promise.all([Ben, Cy].map(who => h.send('/api/strap/command', { name: 'booking.book', input: { classId: entry.id, spot: 'Reformer 3' } }, who.cookie)))
  assert.deepEqual(race.map(r => r.status).sort(), [200, 409], JSON.stringify(race.map(r => r.value)))
  const loser = race[0].status === 200 ? Cy : Ben, winner = loser === Cy ? Ben : Cy
  const fallback = await h.cmd('booking.book', { classId: entry.id }, loser.cookie)
  assert.equal(fallback.spot, 'Reformer 1', 'no named spot takes the first free one in room order')
  s = await h.state()
  assert.deepEqual(s.bookings.filter(b => b.classId === entry.id && b.status === 'booked').map(b => [b.spot, b.personId]).sort(), [['Reformer 1', loser.id], ['Reformer 2', Ana.id], ['Reformer 3', winner.id]])

  // Ana moves herself to a free spot; nobody else can move her booking.
  const ana = s.bookings.find(b => b.personId === Ana.id)
  await refused(h, 'booking.spot', { id: ana.id, spot: 'Reformer 4' }, Dee.cookie, 403, 'forbidden')
  await refused(h, 'booking.spot', { id: ana.id, spot: 'Reformer 4' }, coach.cookie, 403, 'forbidden')
  const key = await h.cmd('agent.create', { label: 'Planner' })
  assert.equal((await h.send('/api/strap/agent/command', { name: 'booking.spot', input: { id: ana.id, spot: 'Reformer 4' } }, '', { authorization: `Bearer ${key.token}` })).status, 403)
  await refused(h, 'booking.spot', { id: ana.id, spot: 'Reformer 3' }, Ana.cookie, 409, 'spot_taken')
  assert.equal((await form(h, 'booking.spot', '/app', { id: ana.id, spot: 'Reformer 4' }, Ana.cookie)).status, 303)
  // Front desk (the owner until STAFF-001) moves the loser from the roster.
  const back = `/app?day=${studioDay(entry.start)}&class=${entry.id}`
  assert.match((await h.send(back, undefined, h.owner)).text, new RegExp(`Move spot for ${loser.name}`))
  const deskMove = s.bookings.find(b => b.personId === loser.id && b.classId === entry.id)
  assert.equal((await form(h, 'booking.spot', back, { id: deskMove.id, spot: 'Reformer 2', channel: 'phone' })).status, 303)
  s = await h.state()
  const moved = s.bookings.find(b => b.id === deskMove.id)
  assert.equal(moved.spot, 'Reformer 2')
  assert.deepEqual(moved.spotHistory.map(m => [m.from, m.to, m.staffMade, m.byRole, m.right, m.channel]), [['Reformer 1', 'Reformer 2', true, 'owner', 'booking', 'phone']], 'one staff-made move record')
  assert.deepEqual(s.bookings.find(b => b.id === ana.id).spotHistory.map(m => [m.from, m.to, m.staffMade]), [['Reformer 2', 'Reformer 4', false]])
  // The instructor's roster shows every assignment once.
  const roster = (await h.send(back, undefined, coach.cookie)).text
  assert.match(roster, new RegExp(`Spots: Reformer 1 free · Reformer 2 ${loser.name} · Reformer 3 ${winner.name} · Reformer 4 Ana · Reformer 5 out of service`))
  assert.doesNotMatch(roster, /Move spot for/, 'instructors cannot move spots')
  assert.doesNotMatch((await h.send('/app', undefined, Dee.cookie)).text, new RegExp(`\\b(${loser.name}|${winner.name})\\b`), 'members see taken spots, not who holds them')

  // A spot in use for an upcoming class cannot be taken out of service.
  await refused(h, 'spots.save', { room: 'Reformer Room', spots: ['Reformer 1', 'Reformer 2', 'Reformer 3', 'Reformer 4', 'Reformer 5'], disabled: ['Reformer 2'] }, h.owner, 409, 'spot_in_use_move_first')
  // The last seat, then the waitlist; a cancellation seats the first waiter on the freed spot.
  assert.equal((await h.cmd('booking.book', { classId: entry.id }, Dee.cookie)).spot, 'Reformer 1')
  const waiting = await h.cmd('booking.book', { classId: entry.id }, Eve.cookie)
  assert.deepEqual([waiting.status, waiting.spot], ['waitlisted', undefined])
  await h.cmd('booking.cancel', { id: ana.id }, Ana.cookie)
  s = await h.state()
  assert.deepEqual([s.bookings.find(b => b.id === waiting.id).status, s.bookings.find(b => b.id === waiting.id).spot], ['booked', 'Reformer 4'])
  assert.equal(new Set(s.bookings.filter(b => b.classId === entry.id && b.status === 'booked').map(b => b.spot)).size, 4)
  // Front desk assigns a spot when booking a member at the desk.
  assert.equal((await h.cmd('booking.desk', { classId: later.id, personId: Dee.id, spot: 'Reformer 4' })).spot, 'Reformer 4')
  await refused(h, 'booking.desk', { classId: later.id, personId: Eve.id, spot: 'Reformer 4' }, h.owner, 409, 'spot_taken')
  if (process.env.STRAP_PROOF_DIR) await (await import('./spots-browser.mjs')).spotsBrowser(h, later, Ana, coach)
}))
