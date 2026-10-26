import assert from 'node:assert/strict'
import { run } from './harness.mjs'
import { signedSmsCallback } from './sms-test-cases.mjs'

// Held credentials arrive only through the fleet injector. No account identifier,
// authorization header or provider response body is printed or written to disk.
const account = process.env.TWILIO_TEST_ACCOUNT_SID, token = process.env.TWILIO_TEST_AUTH_TOKEN
assert.ok(account && token, 'Twilio TEST credentials must be injected')
let requests = 0
await run(async h => {
  await h.confirmSetup(h.owner)
  await h.cmd('studio.save', { location: 'Brooklyn Studio', timeZone: 'America/New_York' })
  await h.cmd('sms.test.connect', { confirm: true })
  const input = { requestId: 'synthetic-strap-sandbox', body: 'Strap TEST connection check. No handset delivery.' }
  const value = await h.cmd('sms.test.send', input)
  assert.equal(value.status, 'submitted', 'Twilio TEST must accept the actual message POST')
  assert.deepEqual(await h.cmd('sms.test.send', input), value)
  assert.equal(requests, 1)
  const fields = { AccountSid: account, MessageSid: value.providerMessageId, MessageStatus: 'delivered' }
  const before = (await h.state()).version
  assert.equal((await signedSmsCallback(h, '/api/strap/sms/test/status', fields, { forged: true })).status, 403)
  assert.equal((await h.state()).version, before)
  assert.equal((await signedSmsCallback(h, '/api/strap/sms/test/status', fields)).status, 200)
  assert.equal((await signedSmsCallback(h, '/api/strap/sms/test/inbound', { AccountSid: account, MessageSid: 'synthetic-strap-sandbox-inbound', From: '+15005550006', To: '+15005550006', Body: 'Synthetic reply check.', NumSegments: '1' })).status, 200)
  const current = (await h.state()).smsTest
  assert.equal(current.statuses[0].provenance, 'synthetic-signed-callback')
  assert.equal(current.inbound[0].provenance, 'synthetic-signed-callback')
  console.log(JSON.stringify({ provider: 'Twilio TEST', actualPostStatus: 201, submissions: requests, replaySubmissions: 0,
    segments: value.segments, price: value.price, priceUnit: value.priceUnit, forgedStatusRejected: true,
    statusAndInbound: 'synthetic signed callbacks only', realHandsetDelivery: false, realReply: false }))
}, { auth: { TWILIO_TEST_ACCOUNT_SID: account, TWILIO_TEST_AUTH_TOKEN: token }, outbound: async request => {
  const url = new URL(request.url)
  assert.ok(url.origin === 'https://api.twilio.com' && url.pathname === '/2010-04-01/Accounts/' + encodeURIComponent(account) + '/Messages.json' && request.method === 'POST', 'Only the Twilio TEST message creation endpoint is allowed')
  const form = new URLSearchParams(await request.clone().text())
  assert.ok(form.get('From') === '+15005550006' && form.get('To') === '+15005550006', 'Only the magic test phone is allowed')
  requests++
  return fetch(request.url, { method: request.method, headers: Object.fromEntries(request.headers), body: await request.text() })
} })
