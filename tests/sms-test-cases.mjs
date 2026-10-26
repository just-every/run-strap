import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { run } from './harness.mjs'

export async function signedSmsCallback(h, path, fields, { token = h.auth.TWILIO_TEST_AUTH_TOKEN, forged = false, mutate = false } = {}) {
  const url = h.origin + path
  const signed = url + Object.keys(fields).sort().map(key => key + fields[key]).join('')
  const signature = createHmac('sha1', token).update(signed).digest('base64')
  const form = new URLSearchParams(fields)
  if (mutate) form.set('FutureField', 'changed after signing')
  return h.mf.dispatchFetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': forged ? 'synthetic-strap-invalid' : signature }, body: form.toString() })
}

export async function smsTestCases() {
  const sent = []
  await run(async h => {
    await h.confirmSetup(h.owner)
    await h.cmd('studio.save', { location: 'Brooklyn Studio', timeZone: 'America/New_York' })
    const member = await h.person('Ana'), coach = await h.person('Maya', 'instructor')
    const refuse = async (name, input, cookie = h.owner, status = 403) => {
      const version = (await h.state()).version, count = sent.length
      const result = await h.send('/api/strap/command', { name, input }, cookie)
      assert.equal(result.status, status, result.text)
      assert.equal((await h.state()).version, version)
      assert.equal(sent.length, count)
    }
    const input = { requestId: 'synthetic-strap-submit', body: 'Brooklyn Studio connection check.' }
    await refuse('sms.test.send', input, h.owner, 409)
    for (const cookie of [member.cookie, coach.cookie]) {
      await refuse('sms.test.connect', { confirm: true }, cookie)
      assert.equal((await h.state(cookie)).smsTest, null)
    }
    await refuse('sms.test.connect', { confirm: false }, h.owner, 400)
    if (process.env.STRAP_PROOF_DIR) await (await import('./sms-test-browser.mjs')).smsTestBrowser(h, 'connect')
    await h.cmd('sms.test.connect', { confirm: true })
    const submitted = await h.cmd('sms.test.send', input)
    assert.equal(submitted.status, 'submitted')
    assert.equal(submitted.providerStatus, 'queued')
    assert.equal(submitted.segments, '2')
    assert.equal(submitted.price, '-0.01500')
    assert.equal(submitted.priceUnit, 'USD')
    assert.deepEqual(await h.cmd('sms.test.send', input), submitted)
    assert.equal(sent.length, 1)
    const racingInput = { requestId: 'synthetic-strap-race', body: 'Concurrent connection check.' }, countBeforeRace = sent.length
    const raced = await Promise.all([h.send('/api/strap/command', { name: 'sms.test.send', input: racingInput }, h.owner), h.send('/api/strap/command', { name: 'sms.test.send', input: racingInput }, h.owner)])
    assert.ok(raced.some(result => result.status === 200))
    assert.ok(raced.every(result => result.status === 200 || result.status === 409))
    assert.equal(sent.length, countBeforeRace + 1, 'concurrent claims submit at most once')
    await refuse('sms.test.send', { ...input, body: 'Changed message' }, h.owner, 409)
    const callback = (path, fields, options) => signedSmsCallback(h, '/api/strap/sms/test/' + path, { AccountSid: h.auth.TWILIO_TEST_ACCOUNT_SID, ...fields }, options)
    const status = { MessageSid: submitted.providerMessageId, MessageStatus: 'delivered', NumSegments: '2', FutureField: 'signed extra value', Price: '-999.00' }
    for (const options of [{ forged: true }, { mutate: true }]) {
      const version = (await h.state()).version
      assert.equal((await callback('status', status, options)).status, 403)
      assert.equal((await h.state()).version, version)
    }
    for (const [fields, expected] of [[{ ...status, AccountSid: 'synthetic-strap-foreign' }, 403], [{ ...status, MessageSid: 'synthetic-strap-unknown' }, 404]]) {
      const version = (await h.state()).version
      assert.equal((await callback('status', fields)).status, expected)
      assert.equal((await h.state()).version, version)
    }
    assert.equal((await callback('status', status)).status, 200)
    const version = (await h.state()).version
    assert.equal((await callback('status', status)).status, 200)
    assert.equal((await h.state()).version, version, 'callback replay does not write')
    assert.equal((await callback('status', { ...status, MessageStatus: 'sent' })).status, 200)
    const delivered = (await h.state()).smsTest.submissions.find(row => row.id === submitted.id)
    assert.equal(delivered.status, 'delivered', 'late sent callback cannot regress a terminal observation')
    assert.equal(delivered.price, '-0.01500', 'callback fields do not invent resource price evidence')
    const inbound = { From: '+15005550006', To: '+15005550006', Body: 'Connection reply check.', MessageSid: 'synthetic-strap-inbound', NumSegments: '1' }
    assert.equal((await callback('inbound', inbound)).status, 200)
    const inboundVersion = (await h.state()).version
    assert.equal((await callback('inbound', inbound)).status, 200)
    assert.equal((await h.state()).version, inboundVersion)
    assert.equal((await callback('inbound', { ...inbound, Body: 'Changed reply' })).status, 409)
    assert.equal((await h.state()).version, inboundVersion)
    assert.equal((await h.state()).smsTest.inbound[0].provenance, 'synthetic-signed-callback')
    for (const [body, expected] of [['Your booking details are ready.', 'rejected'], ['Your class time has changed.', 'uncertain'], ['Your studio update is ready.', 'submitted']]) {
      const value = { requestId: body, body }, result = await h.cmd('sms.test.send', value), count = sent.length
      assert.equal(result.status, expected)
      assert.deepEqual(await h.cmd('sms.test.send', value), result)
      assert.equal(sent.length, count, 'failures and ambiguous outcomes are never retried')
      if (body === 'Your studio update is ready.') { assert.equal(result.price, null); assert.equal(result.segments, null) }
    }
    const failed = (await h.state()).smsTest.submissions.find(row => row.sourceId === 'Your studio update is ready.')
    assert.equal((await callback('status', { MessageSid: failed.providerMessageId, MessageStatus: 'undelivered', ErrorCode: '30003' })).status, 200)
    assert.equal((await h.state()).smsTest.submissions.find(row => row.id === failed.id).errorCode, '30003')
    const portable = (await h.send('/api/strap/exit.json', undefined, h.owner)).value
    assert.equal('st_sms_connections' in portable.tables, false)
    for (const kind of ['smsTestSubmission', 'smsTestConnectionEvent', 'smsTestStatus', 'smsTestInbound']) assert.ok(portable.tables.st_records.some(row => row.kind === kind))
    if (process.env.STRAP_PROOF_DIR) await (await import('./sms-test-browser.mjs')).smsTestBrowser(h)
    await h.setAuth({ TWILIO_TEST_AUTH_TOKEN: 'synthetic-strap-rotated' })
    await refuse('sms.test.send', { requestId: 'synthetic-strap-new', body: 'New connection check' }, h.owner, 409)
    assert.equal((await h.state()).smsTest.connected, false)
    const before = (await h.state()).version
    assert.equal((await callback('status', status)).status, 409)
    assert.equal((await h.state()).version, before)
    await h.setAuth({ TWILIO_TEST_ACCOUNT_SID: '', TWILIO_TEST_AUTH_TOKEN: '' })
    assert.equal((await h.state()).smsTest.configured, false)
    if (process.env.STRAP_PROOF_DIR) await (await import('./sms-test-browser.mjs')).smsTestBrowser(h, 'unconfigured')
  }, { auth: { TWILIO_TEST_ACCOUNT_SID: 'synthetic-strap-1', TWILIO_TEST_AUTH_TOKEN: 'synthetic-strap-2' }, outbound: async request => {
    assert.equal(request.url, 'https://api.twilio.com/2010-04-01/Accounts/synthetic-strap-1/Messages.json')
    assert.equal(request.method, 'POST')
    assert.equal(request.headers.get('authorization'), 'Basic ' + Buffer.from('synthetic-strap-1:synthetic-strap-2').toString('base64'))
    const form = new URLSearchParams(await request.text())
    assert.equal(form.get('From'), '+15005550006'); assert.equal(form.get('To'), '+15005550006')
    sent.push(form.get('Body'))
    if (form.get('Body') === 'Your booking details are ready.') return Response.json({ code: 21608 }, { status: 400 })
    if (form.get('Body') === 'Your class time has changed.') throw new Error('synthetic-strap-edge')
    return Response.json({ sid: 'synthetic-strap-message-' + sent.length, status: 'queued', num_segments: sent.length === 1 ? '2' : null, price: sent.length === 1 ? '-0.01500' : null, price_unit: 'usd' }, { status: 201 })
  } })
  await run(async h => {
    await h.confirmSetup(h.owner)
    assert.equal((await h.state()).smsTest, null, 'connection data stays hidden before factor enrollment')
    const studio = await h.send('/app/studio', undefined, h.owner)
    assert.equal(studio.status, 200, 'ordinary studio settings remain available before factor enrollment')
    const result = await h.send('/api/strap/command', { name: 'sms.test.connect', input: { confirm: true } }, h.owner)
    assert.equal(result.status, 403); assert.equal(result.value.error, 'mfa_enrollment_required')
  }, { mfa: false, auth: { TWILIO_TEST_ACCOUNT_SID: 'synthetic-strap-1', TWILIO_TEST_AUTH_TOKEN: 'synthetic-strap-2' } })
}
