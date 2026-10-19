import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'

const week = () => {
  const day = new Date(Date.now() + 14 * 86400_000)
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7)
  return day.toISOString().slice(0, 10)
}
const setup = h => h.mf.dispatchFetch(h.origin + '/setup', { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=yes', redirect: 'manual' })

test('PLAN-003: restricted packs retain immutable reserve, consume, restore and reasoned adjustment history through expiration', () => run(async h => {
  assert.equal((await setup(h)).status, 303)
  await h.cmd('studio.save', { location: 'East Nashville', timeZone: 'America/Chicago' })
  const alex = await h.person('Alex'), sam = await h.person('Sam'), coach = await h.person('Priya', 'instructor')
  const monday = week(), classes = await h.cmd('classes.prepare', { week: monday, classes: [
    { title: 'Mat Basics', service: 'Mat', start: monday + 'T10:00:00Z', end: monday + 'T11:00:00Z', capacity: 1, instructorId: coach.id },
    { title: 'Reformer Flow', service: 'Reformer', start: monday + 'T12:00:00Z', end: monday + 'T13:00:00Z', capacity: 1, instructorId: coach.id },
    { title: 'Evening Mat', service: 'MAT', start: monday + 'T14:00:00Z', end: monday + 'T15:00:00Z', capacity: 1, instructorId: coach.id },
  ] })
  await h.cmd('classes.publish', { id: classes.id })
  const grant = async (personId, credits, eligibleServices) => {
    const draft = await h.cmd('pack.prepare', { personId, credits, amountCents: 15000, eligibleServices, expiresAt: '2099-12-01T00:00:00Z' })
    return h.cmd('pack.approve', { id: draft.id })
  }
  const draft = await h.cmd('pack.prepare', { personId: alex.id, credits: 3, amountCents: 15000, eligibleServices: [' Mat  ', 'mat'], expiresAt: '2099-12-01T00:00:00Z' })
  assert.equal((await h.state()).packs.length, 0)
  assert.deepEqual(draft.eligibleServices, ['Mat'])
  const approved = await h.cmd('pack.approve', { id: draft.id })
  const alexPack = async () => (await h.state()).packs.find(p => p.id === approved.id)
  const history = async () => (await h.state()).packCreditEvents.filter(e => e.packId === approved.id)
  const originalGrant = (await history())[0]
  assert.equal((await alexPack()).summary.remaining, 3)
  await h.cmd('booking.book', { classId: classes.classes[1].id }, alex.cookie, 409)
  assert.equal((await history()).length, 1)
  const booked = await h.cmd('booking.book', { classId: classes.classes[0].id }, alex.cookie)
  assert.equal((await alexPack()).summary.reserved, 1)
  assert.equal((await alexPack()).summary.remaining, 2)
  await h.cmd('attendance.checkin', { id: booked.id }, coach.cookie)
  assert.equal((await alexPack()).summary.reserved, 0)
  assert.equal((await alexPack()).summary.consumed, 1)
  const reformerPack = await grant(sam.id, 5, ['Reformer'])
  const waiter = await h.cmd('booking.book', { classId: classes.classes[0].id }, sam.cookie)
  await h.cmd('booking.cancel', { id: booked.id }, alex.cookie)
  let state = await h.state()
  assert.equal(state.bookings.find(b => b.id === waiter.id).status, 'waitlisted')
  assert.equal(state.packs.find(p => p.id === reformerPack.id).remaining, 5)
  assert.equal((await alexPack()).summary.restored, 1)
  assert.equal((await alexPack()).summary.consumed, 0)
  const matPack = await grant(sam.id, 1, ['mat'])
  state = await h.state()
  assert.equal(state.bookings.find(b => b.id === waiter.id).status, 'booked')
  assert.equal(state.packs.find(p => p.id === matPack.id).remaining, 0)
  assert.equal(state.packs.find(p => p.id === reformerPack.id).remaining, 5)
  const second = await h.cmd('booking.book', { classId: classes.classes[2].id }, alex.cookie)
  let p = await alexPack()
  const adjustment = { id: p.id, creditsDelta: 2, reason: 'Courtesy credits for studio closure', requestId: 'closure-credit', revision: p.summary.revision }
  const event = await h.cmd('pack.adjust', adjustment)
  const count = (await history()).length
  assert.equal((await h.cmd('pack.adjust', adjustment)).id, event.id)
  assert.equal((await history()).length, count)
  await h.cmd('pack.adjust', { ...adjustment, reason: 'Changed meaning' }, h.owner, 409)
  await h.cmd('pack.adjust', { ...adjustment, requestId: 'stale-change' }, h.owner, 409)
  p = await alexPack()
  assert.equal(p.remaining, 4)
  assert.equal(p.credits, 3)
  assert.equal(p.amountCents, 15000)
  await h.cmd('pack.adjust', { ...adjustment, revision: p.summary.revision, requestId: 'missing-reason', reason: '' }, h.owner, 400)
  await h.cmd('pack.adjust', { ...adjustment, revision: p.summary.revision, requestId: 'too-many', creditsDelta: -5 }, h.owner, 409)
  for (const cookie of [alex.cookie, coach.cookie]) await h.cmd('pack.adjust', { ...adjustment, revision: p.summary.revision, requestId: 'not-owner' }, cookie, 403)
  await h.cmd('booking.cancel', { id: second.id }, alex.cookie)
  const beforeExpiry = await history()
  p = await alexPack()
  await h.cmd('pack.adjust', { id: p.id, creditsDelta: 0, reason: 'Owner-approved early expiration', requestId: 'expire-pack', revision: p.summary.revision, expiresAt: '2000-01-01T00:00:00Z' })
  p = await alexPack()
  assert.equal(p.summary.remaining, 0)
  assert.equal(p.summary.expired, 5)
  assert.equal(p.summary.reserved, 0)
  assert.equal(p.summary.restored, 2)
  await h.cmd('booking.book', { classId: classes.classes[2].id }, alex.cookie, 409)
  const events = await history()
  assert.deepEqual(events.slice(0, beforeExpiry.length), beforeExpiry)
  assert.deepEqual(events[0], originalGrant)
  for (const type of ['grant', 'reserve', 'consume', 'restore', 'adjust']) assert.ok(events.some(e => e.type === type && e.actorId && e.createdAt))
  const casey = await h.person('Casey')
  const shortDraft = await h.cmd('pack.prepare', { personId: casey.id, credits: 1, amountCents: 3000, eligibleServices: ['Mat'], expiresAt: new Date(Date.parse(monday + 'T00:00:00Z') - 86400_000).toISOString() })
  const shortPack = await h.cmd('pack.approve', { id: shortDraft.id })
  await h.cmd('booking.book', { classId: classes.classes[2].id }, casey.cookie, 409)
  assert.equal((await h.state()).packs.find(p => p.id === shortPack.id).summary.expired, 0, 'valid now cannot reserve a class after expiration')
  assert.deepEqual((await h.state(alex.cookie)).packCreditEvents, events)
  assert.ok(!(await h.state(sam.cookie)).packCreditEvents.some(e => e.packId === p.id))
  for (const cookie of [h.owner, alex.cookie]) {
    const page = await h.send('/app/packs', undefined, cookie)
    assert.equal(page.status, 200)
    assert.match(page.text, /5 expired/)
    assert.match(page.text, /Courtesy credits for studio closure/)
    assert.match(page.text, /America\/Chicago/)
    assert.ok(page.text.includes('datetime="2000-01-01T00:00:00.000Z"'))
  }
}))

test('PLAN-003: public forms preserve service review and inclusive local dates, and record exact reasoned expiration once', () => run(async h => {
  assert.equal((await setup(h)).status, 303)
  await h.cmd('studio.save', { location: 'Brooklyn', timeZone: 'America/New_York' })
  const alex = await h.person('Alex')
  const form = async (name, input) => {
    const response = await h.mf.dispatchFetch(h.origin + `/app/action?name=${name}&returnTo=%2Fapp%2Fpacks`, { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(input).toString(), redirect: 'manual' })
    return { status: response.status, text: await response.text() }
  }
  assert.equal((await form('pack.prepare', { personId: alex.id, credits: '3', amount: '150.00', eligibleServices: 'Mat\n mat ', expiresOn: '2099-12-31' })).status, 303)
  const draft = (await h.state()).drafts.find(d => d.type === 'pack')
  assert.equal(draft.amountCents, 15000)
  assert.deepEqual(draft.eligibleServices, ['Mat'])
  assert.equal(draft.expiresAt, '2100-01-01T05:00:00.000Z')
  const review = await h.send('/app/packs', undefined, h.owner)
  assert.match(review.text, /Eligible services/)
  assert.match(review.text, /America\/New_York/)
  assert.equal((await form('pack.approve', { id: draft.id })).status, 303)
  const p = (await h.state()).packs[0]
  const coach = await h.person('Priya', 'instructor'), monday = week()
  const timetable = await h.cmd('classes.prepare', { week: monday, classes: [{ title: 'Mat', start: monday + 'T10:00:00Z', end: monday + 'T11:00:00Z', capacity: 1, instructorId: coach.id }] })
  await h.cmd('classes.publish', { id: timetable.id })
  const booking = await h.cmd('booking.book', { classId: timetable.classes[0].id }, alex.cookie)
  const revision = (await h.state()).packs[0].summary.revision
  const input = { id: p.id, creditsDelta: '0', reason: 'Approved early close', requestId: 'form-expiration', revision: String(revision), expiresDate: '2000-01-01', expiresTime: '12:34:56' }
  assert.equal((await form('pack.adjust', input)).status, 303)
  assert.equal((await form('pack.adjust', input)).status, 303)
  const state = await h.state(alex.cookie)
  assert.equal(state.packs[0].expiresAt, '2000-01-01T17:34:56.000Z')
  assert.equal(state.packs[0].summary.expired, 2)
  assert.equal(state.packs[0].summary.reserved, 1)
  assert.equal(state.bookings.find(b => b.id === booking.id).status, 'booked')
  assert.equal(state.packCreditEvents.filter(e => e.type === 'adjust').length, 1)
  const page = await h.send('/app/packs', undefined, alex.cookie)
  assert.match(page.text, /12:34:56 PM GMT-05:00/)
  assert.match(page.text, /Approved early close/)
}))
