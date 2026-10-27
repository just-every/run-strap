import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'

const minute = 60_000, hour = 60 * minute
const at = hours => new Date(Math.ceil((Date.now() + hours * hour) / minute) * minute).toISOString()
const monday = start => { const d = new Date(start); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (d.getUTCDay() + 6) % 7)).toISOString().slice(0, 10) }
const send = (h, name, input, cookie = h.owner) => h.send('/api/strap/command', { name, input }, cookie)
async function refused(h, name, input, cookie, status, code) {
  const before = (await h.state()).version, r = await send(h, name, input, cookie)
  assert.equal(r.status, status, `${name}: ${JSON.stringify(r.value)}`); if (code) assert.equal(r.value.error, code, name)
  assert.equal((await h.state()).version, before, `${name}: no writes`)
}

test('MEM-002: a household with two children and a payer, guardian-booked classes charged to the payer, a removed guardian losing access, a desk-added child and a payer change that waits for the payer', () => run(async h => {
  await h.mf.dispatchFetch(h.origin + '/setup', { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=yes', redirect: 'manual' })
  await h.cmd('studio.save', { location: 'Nashville', timeZone: 'America/Chicago' })
  const coach = await h.person('Maya', 'instructor'), priya = await h.person('Priya'), sam = await h.person('Sam'), leo = await h.person('Leo'), quinn = await h.person('Quinn')
  const publish = async (title, offset, capacity = 6) => { const start = at(offset); return (await h.cmd('classes.publish', { id: (await h.cmd('classes.prepare', { week: monday(start), classes: [{ title, start, end: new Date(Date.parse(start) + 50 * minute).toISOString(), capacity, instructorId: coach.id }] })).id })).classes[0] }
  const [flow, mat] = [await publish('Family Flow', 30), await publish('Family Mat', 54)]
  await h.cmd('waiver.publish', { text: 'Participants join at their own risk.' })

  // Staff set up the household: guardians need recorded evidence and are never shared across households.
  const home = await h.cmd('household.save', { name: 'Okafor family' })
  await refused(h, 'household.save', { name: 'Nope' }, priya.cookie, 403, 'owner_required')
  await refused(h, 'household.guardian.link', { id: home.id, guardianId: priya.id }, h.owner, 400, 'invalid_evidenceReference')
  await h.cmd('household.guardian.link', { id: home.id, guardianId: priya.id, evidenceReference: 'synthetic-strap-101' })
  const mia = await h.cmd('household.participant.add', { id: home.id, name: 'Mia Okafor' }), noah = await h.cmd('household.participant.add', { id: home.id, name: 'Noah Okafor' })
  const kids = (await h.state()).households[0].participants
  assert.deepEqual(kids.map(k => k.name), ['Mia Okafor', 'Noah Okafor'])
  const [miaId, noahId] = kids.map(k => k.id)
  const other = await h.cmd('household.save', { name: 'Quinn family' })
  await h.cmd('household.guardian.link', { id: other.id, guardianId: quinn.id, evidenceReference: 'synthetic-strap-102' })
  const zed = (await h.cmd('household.participant.add', { id: other.id, name: 'Zed Quinn' })).participantIds[0]
  await refused(h, 'household.guardian.link', { id: other.id, guardianId: priya.id, evidenceReference: 'synthetic-strap-103' }, h.owner, 409, 'person_in_another_household')
  await refused(h, 'household.participant.add', { id: other.id, personId: miaId }, h.owner, 409, 'person_in_another_household')

  // The payer is proposed by staff and becomes the payer only when they accept, signed in.
  await h.cmd('household.payer.propose', { id: home.id, payerId: leo.id })
  assert.equal((await h.state()).households[0].payer, null, 'nothing changes before the payer accepts')
  await refused(h, 'household.payer.accept', { id: home.id }, priya.cookie, 404, 'household_not_found')
  await refused(h, 'household.payer.accept', { id: home.id }, h.owner, 403, 'member_required')
  assert.match((await h.state(leo.cookie)).households[0].pendingPayer.name, /Leo/)
  await h.cmd('household.payer.accept', { id: home.id }, leo.cookie)
  const payerHome = (await h.state(leo.cookie)).households[0]
  assert.deepEqual([payerHome.role, payerHome.payer.name, payerHome.contacts], ['payer', 'Leo', []])

  // Plans for the children are charged to the payer; the children's own balances stay empty.
  for (const id of [miaId, noahId]) await h.cmd('pack.approve', { id: (await h.cmd('pack.prepare', { personId: id, credits: 5, amountCents: 8000, expiresAt: '2099-12-31T00:00:00Z' })).id })
  let owner = await h.state()
  assert.deepEqual(owner.balances.filter(b => b.balanceCents).map(b => [b.personId, b.balanceCents]), [[leo.id, 16000]])
  assert.ok(owner.charges.filter(c => c.personId === leo.id).every(c => [miaId, noahId].includes(c.forPersonId)))

  // The guardian signs for each child and books each one; nobody else's child is reachable.
  await refused(h, 'booking.book', { classId: flow.id, participantId: miaId }, priya.cookie, 409, 'waiver_acknowledgement_required')
  const waiver = (await h.state()).waiver
  for (const id of [miaId, noahId]) await h.cmd('waiver.acknowledge', { id: waiver.id, participantId: id }, priya.cookie)
  const [miaSeat, noahSeat] = [await h.cmd('booking.book', { classId: flow.id, participantId: miaId }, priya.cookie), await h.cmd('booking.book', { classId: mat.id, participantId: noahId }, priya.cookie)]
  assert.deepEqual([miaSeat.status, miaSeat.personId, miaSeat.bookedBy], ['booked', miaId, priya.id])
  assert.deepEqual((await h.state()).acknowledgements.filter(a => a.signedBy === priya.id).map(a => a.personId).sort(), [miaId, noahId].sort())
  await refused(h, 'booking.book', { classId: flow.id, participantId: zed }, priya.cookie, 404, 'person_not_found')
  await refused(h, 'booking.book', { classId: flow.id, participantId: miaId }, sam.cookie, 404, 'person_not_found')
  await refused(h, 'booking.cancel', { id: miaSeat.id }, quinn.cookie, 403)
  const guardian = await h.state(priya.cookie)
  assert.deepEqual(guardian.bookings.map(b => b.personId).sort(), [miaId, noahId].sort(), 'the guardian reads only their participants’ bookings')
  assert.ok(guardian.people.every(p => p.id === priya.id || [miaId, noahId].includes(p.id)), 'no other household member is exposed')
  const payer = await h.state(leo.cookie)
  assert.deepEqual([payer.bookings.length, payer.packs.length, payer.charges.length, payer.households[0].contacts.length], [0, 0, 2, 0], 'a payer sees charges on their own balance, never a participant’s bookings or plans')
  assert.equal((await h.state(quinn.cookie)).households.length, 1, 'another household sees only its own')

  // A guardian's cancellation is theirs to make; removing the guardian ends access with the next request.
  await h.cmd('household.guardian.link', { id: home.id, guardianId: sam.id, evidenceReference: 'synthetic-strap-104' })
  assert.equal((await h.cmd('booking.cancel', { id: noahSeat.id }, sam.cookie)).status, 'cancelled')
  await h.cmd('household.guardian.remove', { id: home.id, guardianId: sam.id, reason: 'Moved out' })
  await refused(h, 'booking.book', { classId: mat.id, participantId: noahId }, sam.cookie, 404, 'person_not_found')
  const lost = await h.state(sam.cookie)
  assert.deepEqual([lost.bookings.length, lost.households.length, lost.people.filter(p => p.id !== sam.id).length], [0, 0, 0], 'the removed guardian’s next request loses the child')

  // Front desk adds a third child and changes the payer to the second guardian; each is a staff-made entry, and the payer change waits for Sam.
  await h.cmd('household.guardian.link', { id: home.id, guardianId: sam.id, evidenceReference: 'synthetic-strap-105' })
  const third = await h.cmd('household.participant.add', { id: home.id, name: 'Ola Okafor', channel: 'desk', requestId: 'synthetic-strap-ola' })
  await h.cmd('household.contact.save', { id: home.id, name: 'Aunt Ada', phone: '(615) 555-0142', relationship: 'Aunt', permissions: ['pickup'] })
  await h.cmd('household.payer.propose', { id: home.id, payerId: sam.id, channel: 'desk', requestId: 'synthetic-strap-sam' })
  assert.equal((await h.state()).households[0].payer.name, 'Leo', 'the current payer stays responsible until the new payer accepts')
  assert.equal((await h.state()).households[0].pendingPayer.name, 'Sam')
  owner = await h.state()
  const entries = owner.staffActions.filter(a => a.command?.startsWith('household.'))
  for (const command of ['household.participant.add', 'household.payer.propose']) {
    const entry = entries.find(a => a.command === command && a.channel === 'desk')
    assert.deepEqual([entry.actorRole, entry.right, entry.staffMade], ['owner', 'member-record', true], command)
    assert.ok(entry.before && entry.after, `${command}: before and after retained`)
  }
  if (process.env.STRAP_PROOF_DIR || process.env.CI) await (await import('./households-browser.mjs')).householdsBrowser(h, { priya, sam, miaId, noahId, mat, flow, home })
  else await h.cmd('household.payer.accept', { id: home.id }, sam.cookie)
  owner = await h.state()
  assert.deepEqual([owner.households[0].payer.name, owner.households[0].pendingPayer, owner.householdPayerChanges.map(c => [c.fromPayerId, c.toPayerId, c.storedMethod])], ['Sam', null, [[null, leo.id, null], [leo.id, sam.id, null]]])
  assert.equal((await h.state(sam.cookie)).households[0].contacts[0].name, 'Aunt Ada', 'a guardian reads the permissioned contacts; the earlier payer no longer reads this household’s payer view')
  assert.deepEqual((await h.state(leo.cookie)).households.map(x => x.role), [], 'the replaced payer leaves the household view')
  assert.ok(third.participantIds.length === 3)
}))

test('PLAN-009: household tuition, exact payer consent, installment receipts, attendance and previewed phone withdrawal reconcile with scoped rights',async()=>{
  await (await import('./courses-clock.mjs')).coursesClock()
})
