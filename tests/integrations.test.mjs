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

  // Only the native owner creates keys, from the fixed catalogue, for the one location.
  const agentKey = await h.cmd('agent.create', { label: 'Preparation key' })
  const valid = { label: 'Front desk display', scopes: ['roster:read'], location: 'studio', events: ['booking.changed'] }
  assert.equal((await h.send('/api/strap/agent/command', { name: 'integration.create', input: valid }, '', { authorization: `Bearer ${agentKey.token}` })).status, 403, 'API-002 an agent key cannot create an integration')
  for (const cookie of [ana.cookie, coach.cookie]) assert.equal((await h.send('/api/strap/command', { name: 'integration.create', input: valid }, cookie)).status, 403)
  for (const [input, error] of [[{ ...valid, scopes: ['money:read'] }, 'scope_not_in_catalogue'], [{ ...valid, scopes: ['roster:read', 'roster:write'] }, 'scope_not_in_catalogue'], [{ ...valid, scopes: [] }, 'scope_not_in_catalogue'], [{ ...valid, location: 'queens' }, 'unknown_location'], [{ ...valid, events: ['payment.changed'] }, 'event_not_permitted']]) {
    const refused = await h.send('/api/strap/command', { name: 'integration.create', input }, h.owner)
    assert.deepEqual([refused.status, refused.value.error], [400, error])
  }
  assert.deepEqual((await h.state()).integrations, [], 'API-002 refused creations write nothing')
  const display = await h.cmd('integration.create', valid)
  assert.match(display.token, /^strap_int_[0-9a-f]{64}$/)
  assert.deepEqual([display.scopes, display.location, display.events], [['roster:read'], 'studio', [{ name: 'booking.changed', delivery: 'not_delivered' }]])
  const stored = (await h.db.prepare('SELECT token_hash FROM st_integration_secrets').all()).results
  assert.ok(stored.length === 1 && stored[0].token_hash !== display.token && /^[0-9a-f]{64}$/.test(stored[0].token_hash), 'API-002 only a hash of the secret is stored')
  // The browser form creates the same kind of key and shows its secret once.
  const viaForm = await h.mf.dispatchFetch(h.origin + '/app/action?name=integration.create&returnTo=%2Fapp%2Fintegrations', { method: 'POST', redirect: 'manual', headers: { origin: h.origin, cookie: h.owner, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ label: 'Form display', 'sc_roster:read': 'true', location: 'studio', 'ev_class.changed': 'true' }).toString() })
  const formPage = await viaForm.text()
  assert.equal(viaForm.status, 200)
  assert.match(formPage, /Save your integration secret[\s\S]*strap_int_[0-9a-f]{64}/)
  assert.deepEqual((await h.state()).integrations.find(k => k.label === 'Form display').events, [{ name: 'class.changed', delivery: 'not_delivered' }])

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
  const roster = Object.fromEntries([...pageOne.value.data, ...pageTwo.value.data].map(c => [c.title, c.roster.map(r => [r.status, r.attendance, r.attendee])]))
  assert.deepEqual(roster, { 'Roster Flow One': [['booked', null, 'Ana L.'], ['waitlisted', null, 'Ben C.']], 'Roster Flow Two': [['booked', null, 'Cara']], 'Roster Flow Three': [['cancelled', null, 'Ana L.']] })
  for (const entry of all.value.data) {
    assert.deepEqual(Object.keys(entry), ['id', 'title', 'service', 'start', 'end', 'capacity', 'status', 'roster'])
    for (const row of entry.roster) assert.deepEqual(Object.keys(row), ['bookingId', 'status', 'attendance', 'attendee'])
  }
  assert.deepEqual(keysOf(all.value).filter(key => /cents|amount|fee|email|phone|contact|note|reason|pack|payment|balance|charge|instructor/i.test(key)), [], 'API-002 roster:read carries no money, contact details or notes')
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
  const rotated = await h.cmd('integration.rotate', { id: display.id })
  assert.notEqual(rotated.token, display.token)
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
  const probe = await h.cmd('integration.create', { label: 'Rate probe', scopes: ['roster:read'], location: 'studio' })
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
  for (const name of ['integration.rotate', 'integration.events']) assert.deepEqual([(await h.send('/api/strap/command', { name, input: { id: display.id, events: [] } }, h.owner)).status], [409], name)
  owned = (await h.state()).integrations.find(k => k.id === display.id)
  assert.ok(owned.revokedAt)
  assert.deepEqual([owned.requests[0].status, owned.requests[0].code, owned.requests[0].route], [401, 'integration_credential_revoked', '/api/strap/integration/roster'])
  const page = await h.send('/app/integrations', undefined, h.owner)
  assert.match(page.text, /Front desk display[\s\S]*Revoked[\s\S]*Usage and failures for Front desk display/)
  assert.ok(!page.text.includes(display.token) && !page.text.includes(rotated.token), 'API-002 secrets are shown only once')
  if (process.env.STRAP_PROOF_DIR) await (await import('./integrations-browser.mjs')).integrationsBrowser(h, { api, member: ana })
}))
