import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'

const minute = 60_000, hour = 60 * minute
const at = offset => new Date(Math.ceil((Date.now() + offset) / minute) * minute).toISOString()
const monday = start => { const d = new Date(start); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (d.getUTCDay() + 6) % 7)).toISOString().slice(0, 10) }
// A US zone where it is not near midnight, so a class 30 minutes out is on today's studio date.
const zone = ['America/New_York', 'Pacific/Honolulu'].find(z => { const hr = Number(new Intl.DateTimeFormat('en-US', { timeZone: z, hour: 'numeric', hourCycle: 'h23' }).format(new Date())); return hr >= 2 && hr <= 21 })
const studioDay = start => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(start))
const post = (h, path, fields, cookie, extra = {}) => h.mf.dispatchFetch(h.origin + path, { method: 'POST', headers: { origin: h.origin, cookie, 'content-type': 'application/x-www-form-urlencoded', ...extra }, body: new URLSearchParams(fields), redirect: 'manual' })
const form = (h, name, back, fields, cookie = h.owner) => post(h, `/app/action?name=${name}&returnTo=${encodeURIComponent(back)}`, fields, cookie)
async function refused(h, name, input, cookie, status, code) {
  const before = (await h.state()).version
  const r = await h.send('/api/strap/command', { name, input }, cookie)
  assert.equal(r.status, status, JSON.stringify(r.value)); assert.equal(r.value.error, code)
  assert.equal((await h.state()).version, before, `${code}: no writes`)
}

test('ATT-001: members check in from their account, a paired kiosk by name, phone or scanned code, and staff at the desk, once each, with role-scoped alerts', () => run(async h => {
  await h.mf.dispatchFetch(h.origin + '/setup', { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=yes', redirect: 'manual' })
  await h.cmd('studio.save', { location: 'Main studio', timeZone: zone })
  const coach = await h.person('Maya', 'instructor'), other = await h.person('Rae', 'instructor'), m = {}
  for (const [name, full, credits, paid] of [['Ana', 'Ana Lopez', 1, false], ['Ben', 'Ben Ortiz', 5, true], ['Cy', 'Cy Park', 5, true], ['Dee', 'Dee Shah', 5, true], ['Eve', 'Eve Hall', 5, true], ['Fay', 'Fay Lopez', 5, true]]) {
    const made = await h.person(name)
    m[name] = { ...made, ...await h.cmd('person.save', { id: made.id, version: made.version, name: full, email: made.email, role: 'member', active: true }), cookie: made.cookie }
    await h.cmd('pack.approve', { id: (await h.cmd('pack.prepare', { personId: made.id, credits, amountCents: 5000, expiresAt: '2099-12-31T00:00:00Z' })).id })
    if (paid) await h.cmd('payment.record', { personId: made.id, amountCents: 5000, reference: `PACK-${name}` })
  }
  const { Ana, Ben, Cy, Dee, Eve, Fay } = m
  // The owner records Ben's mobile in his People card form; the kiosk matches its 10 digits.
  assert.equal((await form(h, 'person.save', '/app/people', { id: Ben.id, name: 'Ben Ortiz', email: Ben.email, role: 'member', active: 'true', phone: '(615) 555-0142' })).status, 303)
  await refused(h, 'person.save', { id: Cy.id, name: 'Cy Park', email: Cy.email, phone: '555-0142' }, h.owner, 400, 'invalid_phone')
  assert.equal((await h.state()).people.find(p => p.id === Ben.id).phone, '6155550142')
  assert.equal((await h.state(coach.cookie)).people.find(p => p.id === Ben.id)?.phone, undefined, 'instructors never see phones')

  const publish = async (title, start) => (await h.cmd('classes.publish', { id: (await h.cmd('classes.prepare', { week: monday(start), classes: [{ title, start, end: new Date(Date.parse(start) + 50 * minute).toISOString(), capacity: 10, instructorId: coach.id }] })).id })).classes[0]
  const entry = await publish('Reformer Flow', at(30 * minute)), later = await publish('Barre Later', at(5 * hour))
  const seat = {}
  for (const [name, who] of Object.entries(m)) if (name !== 'Fay') seat[name] = await h.cmd('booking.book', { classId: entry.id }, who.cookie)
  const benLater = await h.cmd('booking.book', { classId: later.id }, Ben.cookie)
  await h.cmd('booking.book', { classId: later.id }, Fay.cookie)
  const roll = `/app?day=${studioDay(entry.start)}&class=${entry.id}`

  // Role-scoped alerts: Ana owes for her pack and is on her last credit.
  let desk = (await h.send(roll, undefined, h.owner)).text
  assert.match(desk, /Ana Lopez[\s\S]*?Owes \$50\.00<\/span> <span class="note">Last credit/, 'the owner (front desk) sees both alerts')
  const teacher = (await h.send(roll, undefined, coach.cookie)).text
  assert.match(teacher, /Ana Lopez[\s\S]*?Last credit/)
  assert.doesNotMatch(teacher, /Owes|\$50\.00/, 'instructors see no money alerts')
  assert.deepEqual((await h.state()).bookings.find(b => b.id === seat.Ana.id).alerts.map(a => a.type), ['balance_due', 'last_credit'])
  assert.deepEqual((await h.state(coach.cookie)).bookings.find(b => b.id === seat.Ana.id).alerts.map(a => a.type), ['last_credit'])
  assert.equal((await h.state(Ana.cookie)).bookings.find(b => b.id === seat.Ana.id).alerts, undefined, 'members see no alerts')

  // Pairing: only the human owner; the one-time link pairs one device, once.
  const key = await h.cmd('agent.create', { label: 'Planner' })
  assert.equal((await h.send('/api/strap/agent/command', { name: 'kiosk.pair', input: { label: 'x' } }, '', { authorization: `Bearer ${key.token}` })).status, 403)
  assert.equal((await h.send('/api/strap/command', { name: 'kiosk.pair', input: { label: 'x' } }, coach.cookie)).status, 403)
  assert.equal((await form(h, 'kiosk.pair', '/app/studio', { label: 'Lobby tablet' })).status, 200)
  const pairing = (await h.cmd('kiosk.pair', { label: 'Front tablet' }))
  const pairPath = new URL(pairing.pairUrl).pathname + new URL(pairing.pairUrl).search
  assert.match((await h.send(pairPath)).text, /Pair this device/)
  const paired = await post(h, '/kiosk/pair', { token: new URL(pairing.pairUrl).searchParams.get('token') }, '')
  assert.equal(paired.status, 303)
  assert.match(paired.headers.get('set-cookie'), /^strap_kiosk=[\w-]{40,}; Path=\/kiosk; HttpOnly; SameSite=Strict/)
  const kiosk = paired.headers.get('set-cookie').split(';')[0]
  assert.equal((await post(h, '/kiosk/pair', { token: new URL(pairing.pairUrl).searchParams.get('token') }, '')).status, 410, 'the link pairs once')
  assert.equal((await h.send('/kiosk', undefined, '')).status, 401, 'an unpaired device gets no kiosk')
  // The kiosk is no session: no app, state or command API.
  assert.equal((await h.send('/app', undefined, kiosk)).status, 303)
  assert.equal((await h.send('/api/strap/state', undefined, kiosk)).status, 401)
  assert.equal((await h.send('/api/strap/command', { name: 'attendance.checkin', input: { id: seat.Ana.id } }, kiosk)).status, 401)
  assert.equal((await post(h, '/kiosk/lookup', { q: 'ana' }, kiosk, { origin: 'https://evil.example' })).status, 403, 'cross-site kiosk posts are refused')

  // Kiosk lookup: first name, last initial and the class only, and only for seats in an open window.
  const found = await post(h, '/kiosk/lookup', { q: 'lop' }, kiosk)
  const page = await found.text()
  assert.equal(found.status, 200)
  assert.match(page, /Ana L\.[\s\S]*Reformer Flow/)
  assert.doesNotMatch(page, /Fay|Lopez|@|\$|Owes|credit|waiver|Barre/i, 'no balances, contact details, alerts or unwindowed classes; Fay has no seat in the window')
  const nobody = await (await post(h, '/kiosk/lookup', { q: 'fay' }, kiosk)).text(), nonsense = await (await post(h, '/kiosk/lookup', { q: 'zzq' }, kiosk)).text()
  assert.equal(nobody, nonsense, 'a member with no booking in the window is not revealed')
  assert.equal((await post(h, '/kiosk/lookup', { q: 'a' }, kiosk)).status, 404, 'one letter matches no one')
  const byPhone = await (await post(h, '/kiosk/lookup', { q: '615.555.0142' }, kiosk)).text()
  assert.match(byPhone, /Ben O\.[\s\S]*Reformer Flow/); assert.doesNotMatch(byPhone, /Barre|6155550142/)
  assert.equal((await post(h, '/kiosk/lookup', { q: '555-0142' }, kiosk)).status, 404, 'a partial phone matches no one')
  const anaRow = page.match(/name="id" value="([\w-]+)"/)[1]
  assert.equal(anaRow, seat.Ana.id)
  const done = await post(h, '/kiosk/checkin', { id: anaRow }, kiosk)
  assert.equal(done.status, 200); assert.match(await done.text(), /You’re checked in, Ana L\.: Reformer Flow/)
  const again = await post(h, '/kiosk/checkin', { id: anaRow }, kiosk)
  assert.equal(again.status, 409); assert.match(await again.text(), /already checked in/)
  assert.equal((await post(h, '/kiosk/checkin', { id: benLater.id }, kiosk)).status, 409, 'a seat outside its window cannot be checked in')
  assert.match(await (await post(h, '/kiosk/lookup', { q: 'ana' }, kiosk)).text(), /Ana L\.[\s\S]*Checked in/)

  // Member mobile: own booked seat, inside its window, once.
  await refused(h, 'attendance.self', { id: seat.Cy.id }, Ben.cookie, 403, 'forbidden')
  await refused(h, 'attendance.self', { id: benLater.id }, Ben.cookie, 409, 'checkin_window_closed')
  assert.match((await h.send('/app', undefined, Cy.cookie)).text, /name=attendance\.self/)
  assert.equal((await form(h, 'attendance.self', '/app', { id: seat.Cy.id }, Cy.cookie)).status, 303)
  await refused(h, 'attendance.self', { id: seat.Cy.id }, Cy.cookie, 409, 'already_checked_in')

  // A member's own QR code, scanned at the kiosk; a rescan spends nothing.
  assert.equal((await form(h, 'checkin.code', '/app', {}, Dee.cookie)).status, 303)
  const deeHome = (await h.send('/app', undefined, Dee.cookie)).text
  const deeCode = (await h.state(Dee.cookie)).checkinCodes[0].code
  assert.match(deeCode, /^[0-9A-F]{32}$/); assert.notEqual(deeCode, Dee.id)
  assert.match(deeHome, /<svg class="qr" role="img" aria-label="Your check-in code"/)
  assert.equal((await h.state(Dee.cookie)).checkinCodes.length, 1)
  await h.cmd('checkin.code', {}, Dee.cookie)
  assert.equal((await h.state(Dee.cookie)).checkinCodes[0].code, deeCode, 'showing the code again keeps it')
  assert.deepEqual((await h.state(Cy.cookie)).checkinCodes, [], 'members see only their own code')
  const scanned = await post(h, '/kiosk/scan', { code: deeCode.match(/.{4}/g).join(' ') }, kiosk)
  assert.equal(scanned.status, 200); assert.match(await scanned.text(), /You’re checked in, Dee S\./)
  const rescan = await post(h, '/kiosk/scan', { code: deeCode }, kiosk)
  assert.equal(rescan.status, 409); assert.match(await rescan.text(), /already checked in/)
  assert.equal((await post(h, '/kiosk/scan', { code: 'F'.repeat(32) }, kiosk)).status, 404)

  // A key-tag code issued by the owner and scanned at the desk; reissuing kills the old one.
  const first = await h.cmd('checkin.rotate', { personId: Eve.id, reason:'Lost key tag' })
  const second = await h.cmd('checkin.rotate', { personId: Eve.id, reason:'Lost key tag' })
  assert.notEqual(first.code, second.code)
  assert.match((await h.send(`/app/people?person=${Eve.id}`, undefined, h.owner)).text, /Check-in code for Eve Hall/)
  await refused(h, 'attendance.scan', { code: first.code }, coach.cookie, 404, 'no_booking_found')
  await refused(h, 'attendance.scan', { code: second.code }, other.cookie, 404, 'no_booking_found')
  await refused(h, 'attendance.scan', { code: second.code }, Eve.cookie, 403, 'forbidden')
  assert.equal((await form(h, 'attendance.scan', roll, { code: second.code }, coach.cookie)).status, 303)
  await refused(h, 'attendance.scan', { code: second.code }, coach.cookie, 409, 'already_checked_in')

  // The assigned instructor's roster door; another instructor and a duplicate are refused.
  await refused(h, 'attendance.checkin', { id: seat.Ben.id }, other.cookie, 403, 'instructor_required')
  assert.equal((await form(h, 'attendance.checkin', roll, { id: seat.Ben.id }, coach.cookie)).status, 303)
  await refused(h, 'attendance.checkin', { id: seat.Ben.id }, coach.cookie, 409, 'already_checked_in')
  await refused(h, 'attendance.checkin', { id: seat.Ana.id }, h.owner, 409, 'already_checked_in')

  // Reconcile the roll: every seat checked in once, by its door, one credit each.
  const s = await h.state()
  const seats = s.bookings.filter(b => b.classId === entry.id)
  assert.deepEqual(Object.fromEntries(seats.map(b => [s.people.find(p => p.id === b.personId).name.split(' ')[0], b.checkinChannel])), { Ana: 'kiosk', Ben: 'roster', Cy: 'self', Dee: 'kiosk_scan', Eve: 'desk_scan' })
  assert.ok(seats.filter(b => b.checkinChannel.startsWith('kiosk')).every(b => b.kioskId === pairing.id))
  for (const b of seats) assert.deepEqual(s.packCreditEvents.filter(e => e.bookingId === b.id).map(e => [e.type, e.credits]), [['reserve', -1], ['consume', 0]])
  assert.deepEqual(Object.values(m).map(p => s.packs.find(x => x.personId === p.id).remaining), [0, 3, 4, 4, 4, 4])
  desk = (await h.send(roll, undefined, h.owner)).text
  assert.match(desk, /5 booked · 5 checked in · 0 no-show · 0 waiting · 0 cancelled/)
  assert.doesNotMatch(await (await post(h, '/kiosk/lookup', { q: 'ana' }, kiosk)).text(), /Owes|Last credit/, 'the kiosk shows no alerts')

  // Revoking stops the kiosk on its next request.
  assert.equal((await form(h, 'kiosk.revoke', '/app/studio', { id: pairing.id })).status, 303)
  assert.equal((await post(h, '/kiosk/lookup', { q: 'ben' }, kiosk)).status, 401)
  assert.match((await h.send('/app/studio', undefined, h.owner)).text, /Front tablet · Revoked[\s\S]*Lobby tablet · Waiting to pair/)
  if (process.env.STRAP_PROOF_DIR) await (await import('./checkin-browser.mjs')).checkinBrowser(h, roll, Dee)
}))
