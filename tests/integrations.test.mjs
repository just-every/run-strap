import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './harness.mjs'

const minute = 60_000, hour = 60 * minute
const at = hours => new Date(Math.ceil((Date.now() + hours * hour) / minute) * minute).toISOString()
const monday = start => { const d = new Date(start); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (d.getUTCDay() + 6) % 7)).toISOString().slice(0, 10) }
// The integration door is server to server: a Bearer secret and a schema version, no cookie or Origin.
async function api(h, token, path, { method = 'GET', version = '1', body } = {}) {
  const response = await h.mf.dispatchFetch(h.origin + path, { method, redirect: 'manual', headers: { host: new URL(h.origin).host, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(version ? { 'strap-schema-version': version } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const text = await response.text()
  return { status: response.status, headers: response.headers, text, value: JSON.parse(text) }
}
// Secrets are issued only in the app: the owner's Integrations form creates keys and rotates secrets.
async function inApp(h, name, fields, cookie = h.owner) {
  const response = await h.mf.dispatchFetch(h.origin + `/app/action?name=${name}&returnTo=%2Fapp%2Fintegrations`, { method: 'POST', redirect: 'manual', headers: { origin: h.origin, cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() })
  const text = await response.text()
  return { status: response.status, text, token: text.match(/<p class="token">(strap_int_[0-9a-f]{64})<\/p>/)?.[1] ?? null }
}
async function createKey(h, fields) {
  const page = await inApp(h, 'integration.create', fields)
  assert.equal(page.status, 200)
  assert.ok(page.token, 'the Integrations page shows the new secret once')
  return { ...(await h.state()).integrations.find(k => k.label === fields.label), token: page.token }
}
const keysOf = value => Array.isArray(value) ? value.flatMap(keysOf) : value && typeof value === 'object' ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]) : []

test('API-002: the owner creates a read-roster integration for the studio location, pages its roster, is refused money, contact data and writes, sets events, rotates and revokes it, and reads its failures and rate limit', () => run(async h => {
  await h.mf.dispatchFetch(h.origin + '/setup', { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=yes', redirect: 'manual' })
  await h.cmd('studio.save', { location: 'Brooklyn Studio', timeZone: 'America/New_York' })
  const coach = await h.person('Maya', 'instructor'), ana = await h.person('Ana'), ben = await h.person('Ben'), cara = await h.person('Cara')
  // Money, contact details and full names exist in the studio; roster:read must carry none of them.
  await h.cmd('person.save', { id: ana.id, name: 'Ana Lopez', email: ana.email, role: 'member', active: true, phone: '(212) 555-0142' })
  await h.cmd('person.save', { id: ben.id, name: 'Ben de la Cruz', email: ben.email, role: 'member', active: true })
  for (const member of [ana, ben, cara]) await h.cmd('pack.approve', { id: (await h.cmd('pack.prepare', { personId: member.id, credits: 4, amountCents: 8800, expiresAt: '2099-12-31T00:00:00Z' })).id })
  await h.cmd('payment.record', { personId: ana.id, amountCents: 1500, reference: 'API-002-receipt' })
  const publish = async (title, hours, capacity) => {
    const start = at(hours)
    return (await h.cmd('classes.publish', { id: (await h.cmd('classes.prepare', { week: monday(start), classes: [{ title, start, end: new Date(Date.parse(start) + 45 * minute).toISOString(), capacity, instructorId: coach.id }] })).id })).classes[0]
  }
  const first = await publish('Roster Flow One', 30, 1), second = await publish('Roster Flow Two', 54, 4), third = await publish('Roster Flow Three', 78, 4)
  await h.cmd('booking.book', { classId: first.id }, ana.cookie)
  assert.equal((await h.cmd('booking.book', { classId: first.id }, ben.cookie)).status, 'waitlisted')
  await h.cmd('booking.book', { classId: second.id }, cara.cookie)
  await h.cmd('booking.cancel', { id: (await h.cmd('booking.book', { classId: third.id }, ana.cookie)).id }, ana.cookie)

  // Only the native owner creates keys, on the Integrations page, from the fixed catalogue, for the one location.
  const agentKey = await h.cmd('agent.create', { label: 'Preparation key' })
  const fields = { label: 'Front desk display', 'sc_roster:read': 'true', location: 'studio', 'ev_booking.changed': 'true' }
  const input = { label: 'Front desk display', scopes: ['roster:read'], location: 'studio', events: ['booking.changed'] }
  assert.equal((await h.send('/api/strap/agent/command', { name: 'integration.create', input }, '', { authorization: `Bearer ${agentKey.token}` })).status, 403, 'API-002 an agent key cannot create an integration')
  const viaApi = await h.send('/api/strap/command', { name: 'integration.create', input }, h.owner)
  assert.deepEqual([viaApi.status, viaApi.value.error], [403, 'integration_secret_in_app_only'], 'API-002 the JSON API cannot create a key, even for the owner')
  for (const cookie of [ana.cookie, coach.cookie]) assert.equal((await inApp(h, 'integration.create', fields, cookie)).status, 403)
  for (const [change, error] of [[{ 'sc_roster:read': '', 'sc_money:read': 'true' }, 'scope not in catalogue'], [{ 'sc_roster:write': 'true' }, 'scope not in catalogue'], [{ 'sc_roster:read': '' }, 'scope not in catalogue'], [{ location: 'queens' }, 'unknown location'], [{ 'ev_payment.changed': 'true' }, 'event not permitted']]) {
    const refused = await inApp(h, 'integration.create', { ...fields, ...change })
    assert.ok(refused.text.includes(error) && !refused.token, error)
  }
  assert.deepEqual((await h.state()).integrations, [], 'API-002 refused creations write nothing')
  const display = await createKey(h, fields)
  assert.match(display.token, /^strap_int_[0-9a-f]{64}$/)
  assert.deepEqual([display.scopes, display.location, display.events], [['roster:read'], 'studio', [{ name: 'booking.changed', delivery: 'not_delivered' }]])
  const stored = (await h.db.prepare('SELECT token_hash FROM st_integration_secrets').all()).results
  assert.ok(stored.length === 1 && stored[0].token_hash !== display.token && /^[0-9a-f]{64}$/.test(stored[0].token_hash), 'API-002 only a hash of the secret is stored')

  // The secret opens the integration door only.
  const bearer = { authorization: `Bearer ${display.token}` }
  for (const path of ['/api/strap/state', '/api/strap/agent/context', '/api/strap/exit.json', '/app']) assert.notEqual((await h.send(path, undefined, '', bearer)).status, 200, `API-002 ${path} refuses an integration secret`)
  assert.equal((await h.send('/api/strap/command', { name: 'booking.desk', input: { classId: second.id, personId: ben.id } }, '', bearer)).status, 401)
  assert.equal((await h.send('/api/strap/agent/command', { name: 'pack.prepare', input: {} }, '', bearer)).status, 401)
  assert.deepEqual([(await api(h, '', '/api/strap/integration/roster')).value.error, (await api(h, 'strap_int_' + '0'.repeat(64), '/api/strap/integration/roster')).value.error], ['integration_credential_required', 'integration_credential_invalid'])

  // Schema versions: required, and unknown versions are refused.
  const unversioned = await api(h, display.token, '/api/strap/integration/roster', { version: '' })
  assert.deepEqual([unversioned.status, unversioned.value], [400, { error: 'schema_version_required', supported: ['1'] }])
  const future = await api(h, display.token, '/api/strap/integration/roster', { version: '2' })
  assert.deepEqual([future.status, future.value], [400, { error: 'unsupported_schema_version', supported: ['1'] }])
  const self = await api(h, display.token, '/api/strap/integration/key')
  assert.equal(self.headers.get('strap-schema-version'), '1')
  assert.deepEqual([self.value.schemaVersion, self.value.location, self.value.scopes.map(s => s.name), self.value.events, self.value.rateLimit], ['1', 'studio', ['roster:read'], [{ name: 'booking.changed', delivery: 'not_delivered' }], { requests: 60, windowSeconds: 60 }])

  // Opaque-cursor pages in class start order, with booking status and short names only.
  const pageOne = await api(h, display.token, '/api/strap/integration/roster?limit=2')
  assert.equal(pageOne.status, 200, pageOne.text)
  assert.deepEqual([pageOne.value.scope, pageOne.value.location, pageOne.value.data.map(c => c.id), pageOne.value.page.limit], ['roster:read', { id: 'studio', name: 'Brooklyn Studio' }, [first.id, second.id], 2])
  assert.match(pageOne.value.page.next, /^c1\./)
  const pageTwo = await api(h, display.token, `/api/strap/integration/roster?limit=2&cursor=${encodeURIComponent(pageOne.value.page.next)}`)
  assert.deepEqual([pageTwo.value.data.map(c => c.id), pageTwo.value.page.next], [[third.id], null])
  const all = await api(h, display.token, '/api/strap/integration/roster')
  assert.deepEqual([all.value.page.limit, all.value.data.map(c => c.id), all.value.page.next], [50, [first.id, second.id, third.id], null], 'API-002 the default page holds 50 classes')
  const roster = Object.fromEntries([...pageOne.value.data, ...pageTwo.value.data].map(c => [c.title, c.roster.map(r => [r.status, r.attendee])]))
  assert.deepEqual(roster, { 'Roster Flow One': [['booked', 'Ana L.'], ['waitlisted', 'Ben C.']], 'Roster Flow Two': [['booked', 'Cara']], 'Roster Flow Three': [['cancelled', 'Ana L.']] })
  for (const entry of all.value.data) {
    assert.deepEqual(Object.keys(entry), ['id', 'title', 'service', 'start', 'end', 'capacity', 'status', 'roster'])
    for (const row of entry.roster) assert.deepEqual(Object.keys(row), ['bookingId', 'status', 'attendee'])
  }
  assert.deepEqual(keysOf(all.value).filter(key => /cents|amount|fee|email|phone|contact|note|reason|pack|payment|balance|charge|instructor|attendance|checked|noshow/i.test(key)), [], 'API-002 roster:read carries no money, contact details or notes')
  for (const secret of ['Lopez', 'Cruz', '@', '2125550142', 'API-002-receipt', 'Maya']) assert.ok(!all.text.includes(secret), `API-002 roster:read leaks no ${secret}`)
  for (const query of ['limit=0', 'limit=101', 'limit=ten', 'limit=-1']) assert.deepEqual([(await api(h, display.token, `/api/strap/integration/roster?${query}`)).value.error], ['invalid_limit'], query)
  for (const cursor of ['abc', 'c1.' + btoa('{"x":1}'), 'c1.%%%']) assert.equal((await api(h, display.token, `/api/strap/integration/roster?cursor=${encodeURIComponent(cursor)}`)).value.error, 'invalid_cursor')

  // An erased person never appears; the roster is otherwise unchanged.
  const unused = await h.cmd('person.save', { name: 'Zed Unused', email: 'zed@studio.example', role: 'member', active: true })
  await h.cmd('person.erase', { id: unused.id })
  const afterErasure = await api(h, display.token, '/api/strap/integration/roster')
  assert.deepEqual(afterErasure.value.data, all.value.data)
  assert.ok(!/Zed|Erased/.test(afterErasure.text))

  // Financial and other data, and every write, are refused without effect.
  for (const resource of ['payments', 'balances', 'packs', 'charges', 'people']) {
    const refused = await api(h, display.token, `/api/strap/integration/${resource}`)
    assert.deepEqual([refused.status, refused.value.error, refused.value.scopes], [403, 'scope_not_granted', ['roster:read']], resource)
  }
  const before = await h.state()
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const write = await api(h, display.token, '/api/strap/integration/roster', { method, body: { name: 'booking.desk', input: { classId: second.id, personId: ben.id } } })
    assert.deepEqual([write.status, write.value.error, write.headers.get('allow')], [405, 'read_only', 'GET'], method)
  }
  assert.equal((await h.state()).version, before.version, 'API-002 refused writes change nothing')

  // Event subscriptions are limited to the key's scopes and are recorded, not delivered.
  assert.deepEqual(await h.cmd('integration.events', { id: display.id, events: ['booking.changed', 'class.changed'] }), { id: display.id, events: [{ name: 'booking.changed', delivery: 'not_delivered' }, { name: 'class.changed', delivery: 'not_delivered' }] })
  assert.equal((await h.send('/api/strap/command', { name: 'integration.events', input: { id: display.id, events: ['lead.changed'] } }, h.owner)).value.error, 'event_not_permitted')
  assert.equal((await h.send('/api/strap/command', { name: 'integration.events', input: { id: display.id, events: [] } }, ana.cookie)).status, 403)
  assert.deepEqual((await api(h, display.token, '/api/strap/integration/key')).value.events.map(e => e.name), ['booking.changed', 'class.changed'])

  // Rotation issues a new secret and stops the old one at once.
  assert.deepEqual([(await h.send('/api/strap/command', { name: 'integration.rotate', input: { id: display.id } }, h.owner)).value.error, (await api(h, display.token, '/api/strap/integration/key')).status], ['integration_secret_in_app_only', 200], 'API-002 the JSON API cannot rotate a secret')
  const rotated = await inApp(h, 'integration.rotate', { id: display.id })
  assert.ok(rotated.token && rotated.token !== display.token, 'the Integrations page shows the new secret once')
  assert.deepEqual([(await api(h, display.token, '/api/strap/integration/key')).status, (await api(h, display.token, '/api/strap/integration/key')).value.error], [401, 'integration_credential_revoked'])
  assert.equal((await api(h, rotated.token, '/api/strap/integration/key')).value.id, display.id)

  // The owner alone reads each key's usage and failures: key, method, path, status and code.
  let owned = (await h.state()).integrations.find(k => k.id === display.id)
  const outcomes = owned.requests.map(r => `${r.method} ${r.status} ${r.code ?? ''}`.trim())
  for (const expected of ['GET 200', 'GET 400 schema_version_required', 'GET 400 unsupported_schema_version', 'GET 400 invalid_limit', 'GET 400 invalid_cursor', 'GET 403 scope_not_granted', 'POST 405 read_only', 'DELETE 405 read_only', 'GET 401 integration_credential_revoked']) assert.ok(outcomes.includes(expected), `API-002 the log shows ${expected}`)
  for (const row of owned.requests) {
    assert.deepEqual(Object.keys(row), ['integrationId', 'at', 'method', 'route', 'status', 'code'])
    assert.ok(row.route.startsWith('/api/strap/integration/') && !row.route.includes('?'), row.route)
  }
  for (const secret of [ana.id, ben.id, cara.id, 'Ana', 'Lopez', display.token, rotated.token]) assert.ok(!JSON.stringify(owned).includes(secret), 'API-002 the log holds no member data or secrets')
  assert.equal(owned.lastUsedAt, owned.requests[0].at)
  for (const cookie of [ana.cookie, coach.cookie]) assert.deepEqual((await h.state(cookie)).integrations, [])
  assert.deepEqual((await h.send('/api/strap/agent/context', undefined, '', { authorization: `Bearer ${agentKey.token}` })).value.integrations, [])
  assert.equal((await h.send('/app/integrations', undefined, ana.cookie)).status, 403)

  // 60 counted requests per key in any rolling 60 seconds, then 429 with Retry-After; other keys are unaffected.
  const probe = await createKey(h, { label: 'Rate probe', 'sc_roster:read': 'true', location: 'studio' })
  for (let i = 0; i < 60; i++) assert.equal((await api(h, probe.token, '/api/strap/integration/key')).status, 200, `request ${i + 1}`)
  const limited = await api(h, probe.token, '/api/strap/integration/roster')
  const retry = Number(limited.headers.get('retry-after'))
  assert.deepEqual([limited.status, limited.value.error, limited.value.requests, limited.value.windowSeconds, limited.value.retryAfterSeconds], [429, 'rate_limited', 60, 60, retry])
  assert.ok(retry >= 1 && retry <= 60, `Retry-After ${retry}`)
  assert.equal((await api(h, rotated.token, '/api/strap/integration/key')).status, 200, 'API-002 the limit is per key')
  for (let i = 0; i < 44; i++) assert.equal((await api(h, probe.token, '/api/strap/integration/key')).status, 429)
  const probeLog = (await h.state()).integrations.find(k => k.id === probe.id).requests
  assert.deepEqual([probeLog.length, probeLog.filter(r => r.status === 429).length, probeLog.filter(r => r.status === 200).length], [100, 45, 55], 'API-002 the log keeps the newest 100 requests per key')

  // Revocation stops every secret of the key; a revoked key cannot be rotated or resubscribed.
  assert.deepEqual(await h.cmd('integration.revoke', { id: display.id }), { id: display.id, revoked: true })
  assert.equal((await api(h, rotated.token, '/api/strap/integration/roster')).value.error, 'integration_credential_revoked')
  assert.ok((await inApp(h, 'integration.rotate', { id: display.id })).text.includes('integration revoked'))
  assert.equal((await h.send('/api/strap/command', { name: 'integration.events', input: { id: display.id, events: [] } }, h.owner)).status, 409)
  owned = (await h.state()).integrations.find(k => k.id === display.id)
  assert.ok(owned.revokedAt)
  assert.deepEqual([owned.requests[0].status, owned.requests[0].code, owned.requests[0].route], [401, 'integration_credential_revoked', '/api/strap/integration/roster'])
  const page = await h.send('/app/integrations', undefined, h.owner)
  assert.match(page.text, /Front desk display[\s\S]*Revoked[\s\S]*Usage and failures for Front desk display/)
  assert.ok(!page.text.includes(display.token) && !page.text.includes(rotated.token), 'API-002 secrets are shown only once')
  if (process.env.STRAP_PROOF_DIR) await (await import('./integrations-browser.mjs')).integrationsBrowser(h, { api, member: ana })
}))

test('API-002: attendance requires a new explicit scope, exposes only current booked-seat booleans, and inherits the integration fences', () => run(async h => {
  await h.mf.dispatchFetch(h.origin + '/setup', { method: 'POST', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=yes', redirect: 'manual' })
  await h.cmd('studio.save', { location: 'Brooklyn Studio', timeZone: 'America/New_York' })
  await h.cmd('bookingRule.save', { service: 'Reformer', noShowFeeCents: 2000, noShowGraceMinutes: 0 })
  const coach = await h.person('Maya', 'instructor'), members = {}
  for (const name of ['Ana', 'Ben', 'Cy', 'Dee', 'Eve']) {
    members[name] = await h.person(name)
    await h.cmd('pack.approve', { id: (await h.cmd('pack.prepare', { personId: members[name].id, credits: 8, amountCents: 10000, expiresAt: '2099-12-31T00:00:00Z' })).id })
  }
  const publish = async (title, hours, capacity) => {
    const start = at(hours)
    return (await h.cmd('classes.publish', { id: (await h.cmd('classes.prepare', { week: monday(start), classes: [{ title, service: 'Reformer', start, end: new Date(Date.parse(start) + 45 * minute).toISOString(), capacity, instructorId: coach.id }] })).id })).classes[0]
  }
  const first = await publish('Attendance Flow', 30, 5), second = await publish('Pending Flow', 54, 1), third = await publish('Cancelled Flow', 78, 4), seats = {}
  for (const [name, member] of Object.entries(members)) seats[name] = await h.cmd('booking.book', { classId: first.id }, member.cookie)
  await h.cmd('waitlist.save', { mode: 'offer', claimMinutes: 60, lateWindow: 'promote' })
  const cancelled = await h.cmd('booking.book', { classId: second.id }, members.Ana.cookie)
  const offered = await h.cmd('booking.book', { classId: second.id }, members.Ben.cookie)
  const waiting = await h.cmd('booking.book', { classId: second.id }, members.Cy.cookie)
  await h.cmd('booking.cancel', { id: cancelled.id }, members.Ana.cookie)
  const cancelledThird = await h.cmd('booking.book', { classId: third.id }, members.Ana.cookie)
  await h.cmd('booking.cancel', { id: cancelledThird.id }, members.Ana.cookie)
  assert.deepEqual((await h.state()).bookings.filter(b => [cancelled.id, offered.id, waiting.id, cancelledThird.id].includes(b.id)).map(b => b.status).sort(), ['cancelled', 'cancelled', 'offered', 'waitlisted'])

  // Move the class behind the clock; all attendance outcomes are recorded through HTTP.
  await h.db.prepare("UPDATE st_records SET data=json_set(data,'$.start',?,'$.end',?) WHERE id=?").bind(new Date(Date.now() - 30 * minute).toISOString(), new Date(Date.now() + 15 * minute).toISOString(), first.id).run()
  await h.cmd('attendance.checkin', { id: seats.Ana.id }, coach.cookie)
  for (const name of ['Ben', 'Cy', 'Dee']) await h.cmd('attendance.noshow', { id: seats[name].id }, coach.cookie)
  await h.cmd('attendance.correct', { id: seats.Cy.id, outcome: 'excused', reason: 'Private correction reason' })
  await h.cmd('attendance.correct', { id: seats.Dee.id, outcome: 'attended', reason: 'Private paper roster note' })
  assert.ok((await h.state()).charges.some(c => c.reason === 'no_show_fee' && c.amountCents === 2000), 'money exists behind the boolean projection')

  const roster = await createKey(h, { label: 'Existing roster consent', 'sc_roster:read': 'true', location: 'studio' })
  const deniedEvent = await inApp(h, 'integration.create', { label: 'Unconsented attendance event', 'sc_roster:read': 'true', 'ev_attendance.changed': 'true', location: 'studio' })
  assert.ok(deniedEvent.text.includes('event not permitted') && !deniedEvent.token)
  const refused = await api(h, roster.token, '/api/strap/integration/attendance')
  assert.deepEqual([refused.status, refused.value], [403, { error: 'scope_not_granted', scopes: ['roster:read'] }])
  const beforeRotation = await api(h, roster.token, '/api/strap/integration/roster')
  assert.deepEqual(keysOf(beforeRotation.value).filter(key => /attendance|attended|checked|noshow/i.test(key)), [], 'roster consent still carries no attendance')

  // Extra scope fields on later lifecycle forms never widen the original grant.
  await h.cmd('integration.events', { id: roster.id, scopes: ['roster:read', 'attendance:read'], events: ['booking.changed'] })
  const eventInjection = await inApp(h, 'integration.events', { id: roster.id, 'sc_attendance:read': 'true', 'ev_attendance.changed': 'true' })
  assert.ok(eventInjection.text.includes('event not permitted'))
  const rotatedRoster = await inApp(h, 'integration.rotate', { id: roster.id, 'sc_attendance:read': 'true', scopes: 'attendance:read' })
  assert.ok(rotatedRoster.token && rotatedRoster.token !== roster.token)
  assert.deepEqual((await api(h, rotatedRoster.token, '/api/strap/integration/key')).value.scopes.map(s => s.name), ['roster:read'])
  assert.equal((await api(h, rotatedRoster.token, '/api/strap/integration/attendance')).status, 403)
  assert.deepEqual((await api(h, rotatedRoster.token, '/api/strap/integration/roster')).value.data, beforeRotation.value.data)

  const both = await createKey(h, { label: 'Consented attendance display', 'sc_roster:read': 'true', 'sc_attendance:read': 'true', 'ev_attendance.changed': 'true', location: 'studio' })
  assert.deepEqual(both.scopes, ['roster:read', 'attendance:read'])
  assert.deepEqual(both.events, [{ name: 'attendance.changed', delivery: 'not_delivered' }])
  const pageOne = await api(h, both.token, '/api/strap/integration/attendance?limit=2')
  assert.equal(pageOne.status, 200, pageOne.text)
  assert.deepEqual([pageOne.value.schemaVersion, pageOne.value.scope, pageOne.value.location, pageOne.value.data.map(c => c.id), pageOne.value.page.limit], ['1', 'attendance:read', { id: 'studio', name: 'Brooklyn Studio' }, [first.id, second.id], 2])
  const rosterPage = await api(h, both.token, '/api/strap/integration/roster?limit=2')
  assert.equal(pageOne.value.page.next, rosterPage.value.page.next, 'both resources page the same classes')
  const pageTwo = await api(h, both.token, `/api/strap/integration/attendance?limit=2&cursor=${encodeURIComponent(rosterPage.value.page.next)}`)
  assert.deepEqual([pageTwo.value.data, pageTwo.value.page.next], [[{ id: third.id, attendance: [] }], null])
  const attendance = await api(h, both.token, '/api/strap/integration/attendance')
  assert.deepEqual(attendance.value, {
    schemaVersion: '1', scope: 'attendance:read', location: { id: 'studio', name: 'Brooklyn Studio' },
    data: [{ id: first.id, attendance: Object.entries(seats).map(([name, seat]) => ({ bookingId: seat.id, attended: ['Ana', 'Dee'].includes(name) })) }, { id: second.id, attendance: [] }, { id: third.id, attendance: [] }],
    page: { limit: 50, next: null },
  }, 'check-in and corrected attendance are true; no-show, excused and unrecorded are indistinguishable false; other booking states are omitted')
  for (const entry of attendance.value.data) {
    assert.deepEqual(Object.keys(entry), ['id', 'attendance'], 'attendance carries no class names, times or instructor data')
    for (const booking of entry.attendance) assert.deepEqual(Object.keys(booking), ['bookingId', 'attended'], 'bookings carry no names, money, reasons, actors or attendance history')
  }
  for (const hidden of [...Object.keys(members), coach.name, 'Private correction reason', 'Private paper roster note', 'no_show', 'excused', cancelled.id, offered.id, waiting.id, cancelledThird.id]) assert.ok(!attendance.text.includes(hidden), `attendance omits ${hidden}`)
  const combinedRoster = await api(h, both.token, '/api/strap/integration/roster')
  assert.deepEqual(keysOf(combinedRoster.value).filter(key => /attendance|attended|checked|noshow/i.test(key)), [], 'even a combined key receives attendance only from its separate resource')
  for (const query of ['limit=0', 'limit=101', 'limit=bad', 'cursor=bad']) assert.equal((await api(h, both.token, `/api/strap/integration/attendance?${query}`)).value.error, query.startsWith('limit') ? 'invalid_limit' : 'invalid_cursor')

  const unused = await h.cmd('person.save', { name: 'Unused Identity', email: 'unused@studio.example', role: 'member', active: true })
  await h.cmd('person.erase', { id: unused.id })
  // SEC-003 will add used-member erasure. Exercise its read fence with a retained booked record now.
  await h.db.prepare('UPDATE st_people SET erased_at=?,active=0 WHERE id=?').bind(Date.now(), members.Eve.id).run()
  const erased = await api(h, both.token, '/api/strap/integration/attendance')
  assert.deepEqual(erased.value.data[0].attendance, attendance.value.data[0].attendance.filter(b => b.bookingId !== seats.Eve.id))
  assert.ok(!erased.text.includes(seats.Eve.id) && !erased.text.includes(unused.id))
  assert.ok(!(await api(h, both.token, '/api/strap/integration/roster')).text.includes(seats.Eve.id))

  const attendanceOnly = await createKey(h, { label: 'Attendance only', 'sc_attendance:read': 'true', 'ev_attendance.changed': 'true', location: 'studio' })
  assert.equal((await api(h, attendanceOnly.token, '/api/strap/integration/attendance')).status, 200)
  assert.equal((await api(h, attendanceOnly.token, '/api/strap/integration/roster')).status, 403)
  assert.equal((await h.send('/api/strap/command', { name: 'integration.events', input: { id: attendanceOnly.id, events: ['booking.changed'] } }, h.owner)).value.error, 'event_not_permitted')
  assert.deepEqual((await api(h, attendanceOnly.token, '/api/strap/integration/key')).value.events, [{ name: 'attendance.changed', delivery: 'not_delivered' }])

  // The established check order applies to attendance too: secret, limit, method, version, scope.
  assert.equal((await api(h, '', '/api/strap/integration/attendance', { method: 'POST', version: '' })).status, 401)
  assert.equal((await api(h, rotatedRoster.token, '/api/strap/integration/attendance', { method: 'POST', version: '' })).status, 405)
  assert.equal((await api(h, rotatedRoster.token, '/api/strap/integration/attendance', { version: '' })).value.error, 'schema_version_required')
  assert.equal((await api(h, rotatedRoster.token, '/api/strap/integration/attendance', { version: '2' })).value.error, 'unsupported_schema_version')
  const rate = await createKey(h, { label: 'Shared endpoint rate', 'sc_roster:read': 'true', 'sc_attendance:read': 'true', location: 'studio' })
  for (let n = 0; n < 60; n++) assert.equal((await api(h, rate.token, `/api/strap/integration/${['key', 'roster', 'attendance'][n % 3]}`)).status, 200)
  const limited = await api(h, rate.token, '/api/strap/integration/attendance', { method: 'POST', version: '' })
  assert.deepEqual([limited.status, limited.value.error], [429, 'rate_limited'], 'one rate budget covers all resources and precedes method/version checks')
  assert.ok(Number(limited.headers.get('retry-after')) >= 1 && Number(limited.headers.get('retry-after')) <= 60)
  assert.equal((await api(h, both.token, '/api/strap/integration/attendance')).status, 200, 'another key retains its own budget')

  const rotated = await inApp(h, 'integration.rotate', { id: both.id, 'sc_money:read': 'true', 'sc_roster:write': 'true' })
  assert.ok(rotated.token && rotated.token !== both.token)
  assert.equal((await api(h, both.token, '/api/strap/integration/attendance')).value.error, 'integration_credential_revoked')
  assert.deepEqual((await api(h, rotated.token, '/api/strap/integration/attendance')).value.data, erased.value.data)
  assert.deepEqual((await api(h, rotated.token, '/api/strap/integration/key')).value.scopes.map(s => s.name), ['roster:read', 'attendance:read'])
  await h.cmd('integration.revoke', { id: both.id })
  assert.equal((await api(h, rotated.token, '/api/strap/integration/attendance')).value.error, 'integration_credential_revoked')
  const owned = (await h.state()).integrations.find(k => k.id === both.id)
  assert.ok(owned.requests.some(r => r.route === '/api/strap/integration/attendance' && r.status === 200))
  assert.deepEqual([owned.requests[0].route, owned.requests[0].status, owned.requests[0].code], ['/api/strap/integration/attendance', 401, 'integration_credential_revoked'])
  for (const row of owned.requests) assert.deepEqual(Object.keys(row), ['integrationId', 'at', 'method', 'route', 'status', 'code'])
  for (const secret of [both.token, rotated.token, ...Object.values(seats).map(b => b.id), 'Private correction reason']) assert.ok(!JSON.stringify(owned).includes(secret), 'attendance log contains neither member outcomes nor secrets')
  assert.deepEqual((await h.state(members.Ana.cookie)).integrations, [])
  assert.deepEqual((await h.state(coach.cookie)).integrations, [])

  // The owner transfers authority through native account doors; existing keys stop.
  const confirmNativeMail = async (email, cookie = '') => {
    const mail = (await h.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence DESC').all()).results.map(r => JSON.parse(r.message)).find(m => m.to.includes(email))
    const token = new URL(mail.text.match(/http:\/\/[^\s]+\/auth\/confirm\?token=[^\s]+/)[0]).searchParams.get('token')
    assert.equal((await h.send('/auth/confirm', { token }, cookie)).status, 303)
  }
  assert.equal((await h.send('/auth/step-up', { action: 'owner:transfer' }, h.owner)).status, 202)
  await confirmNativeMail(h.auth.OWNER_EMAIL, h.owner)
  const successor = 'successor@studio.example'
  assert.equal((await h.send('/auth/invite', { email: successor, displayName: 'Successor Owner', role: 'owner' }, h.owner)).status, 202)
  await confirmNativeMail(successor)
  const originalOwner = (await h.send('/auth/session', undefined, h.owner)).value.operator
  assert.equal((await h.send('/auth/operator/role', { operatorId: originalOwner.id, role: 'member' }, h.owner)).status, 200)
  const accessChanged = await api(h, attendanceOnly.token, '/api/strap/integration/attendance', { method: 'POST', version: '' })
  assert.deepEqual([accessChanged.status, accessChanged.value.error], [401, 'integration_credential_revoked'])
}))
