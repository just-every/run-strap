import assert from 'node:assert/strict'
import { Log, LogLevel } from 'miniflare'
import { run } from './harness.mjs'
import { billingSeed, acceptance } from './billing-sandbox.mjs'
import { paymentAuth, paymentEdge, signedEvent } from './payment-fixtures.mjs'
import { taxEdge } from './tax-edge.mjs'
import { taxAddress } from './tax-sandbox.mjs'
import { recoveryDiagnosticsBrowser } from './security-browser.mjs'

const api = '/api/strap/recovery-diagnostics', page = '/app/recovery-diagnostics'
export async function diagnosticRead(h, cookie = h.owner) {
  const r = await h.send(api, undefined, cookie)
  assert.equal(r.status, 200, r.text)
  assert.equal(r.headers.get('cache-control'), 'no-store')
  return r.value
}
export async function diagnosticStore(h) {
  const tables = (await h.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results
  return (await h.db.batch(tables.map(r => h.db.prepare(`SELECT * FROM ${r.name} ORDER BY rowid`)))).map(r => r.results)
}

export async function recoveryDiagnosticsCases() {
  const edge = paymentEdge(), tax = taxEdge(), logs = [], privateText = 'synthetic-strap-910-private-notes', providerText = 'synthetic-strap-911-provider-text'
  class CapturedLog extends Log { logWithLevel(_level, message) { logs.push(String(message)) } }
  let fail = false, taxStatus = 200, mailStatus = 202, mailCalls = 0
  const outbound = async request => {
    if (new URL(request.url).hostname === 'api.sendgrid.com') {
      mailCalls++
      return new Response(mailStatus === 202 ? null : providerText, {status: mailStatus, headers: {'x-message-id': providerText}})
    }
    if (new URL(request.url).pathname.startsWith('/v1/tax/')) {
      if (taxStatus !== 200) return Response.json({error:{code:providerText,message:privateText}}, {status:taxStatus,headers:{'request-id':providerText}})
      return tax.outbound(request)
    }
    if (fail) return Response.json({error: {code: providerText, message: privateText}}, {status: 403, headers: {'request-id': providerText}})
    return edge.outbound(request)
  }
  await run(async h => {
    await h.confirmSetup(h.owner)
    for (const path of [api, page]) {
      const before = await diagnosticStore(h), held = await h.send(path, undefined, h.owner)
      assert.equal(held.status, 403); assert.equal(held.headers.get('x-strap-refusal') ?? held.value.error, 'mfa_enrollment_required')
      assert.deepEqual(await diagnosticStore(h), before)
    }
    const enrolled = await h.enroll(h.owner)
    const empty = await diagnosticRead(h)
    assert.equal(empty.billing.connectionState, 'disconnected'); assert.equal(empty.mail.connectionState, 'disconnected')
    assert.equal(empty.tax.connectionState, 'disconnected'); assert.deepEqual([empty.checkouts,empty.reconciliations,empty.taxOperations],[[],[],[]])
    assert.equal(empty.billing.freshness, 'unknown'); assert.deepEqual([empty.operations, empty.exceptions, empty.notices], [[], [], []])
    await h.cmd('studio.save', {location: 'Recovery studio', timeZone: 'America/New_York'})
    const seed = await billingSeed(h, 'RecoveryMember'), instructor = await h.person('RecoveryTeacher', 'instructor')
    await h.cmd('member.note.add', {personId: seed.member.id, text: privateText, alert:false, channel:'desk'})
    const agreement = await h.cmd('billing.agreement.prepare', {...seed.prepare, documentText: privateText})
    await h.cmd('billing.agreement.accept', acceptance(agreement, seed.member.name), seed.member.cookie)
    const input = {accountId: 'synthetic-strap-10', mode: 'test', confirm: true, requestId: 'synthetic-strap-912'}
    fail = true
    const failed = await h.cmd('billing.connect', input)
    assert.equal(failed.status, 'failed'); assert.equal(failed.errorCode, 'billing_provider_refused')
    fail = false
    await h.cmd('billing.connect', {...input, requestId: 'synthetic-strap-913'})
    const checkout = await h.cmd('billing.checkout.start', {packId: seed.pack.id, confirm: true, requestId: 'synthetic-strap-914'})
    const forged = {...edge.event(checkout.providerSessionId), id: 'synthetic-strap-915'}
    const exceptionEvent = await signedEvent(h, forged)
    assert.equal(exceptionEvent.status,200,JSON.stringify(exceptionEvent));assert.equal(exceptionEvent.value.status,'exception',JSON.stringify(exceptionEvent))
    // A failed comparison and later canonical settlement retain distinct review history.
    edge.setChange(body => { body.currency = 'synthetic-strap-918' })
    await h.cmd('billing.reconcile', {id:checkout.id,requestId:'synthetic-strap-919'})
    edge.setChange(null)
    edge.complete(checkout.providerSessionId)
    await h.cmd('billing.reconcile', {id:checkout.id,requestId:'synthetic-strap-920'})
    const nativePayment = (await h.state()).payments.find(r=>r.stripeInvoiceId===checkout.id)
    assert.ok(nativePayment, 'canonical reconciliation records the actual payment')

    await h.setAuth({STRIPE_TAX_TEST_KEY:'synthetic-strap-921'})
    const taxConfig = {requestId:'synthetic-strap-922',consent:true,originAddress:taxAddress,registeredStates:['WA'],
      products:[{id:'synthetic-strap-923',label:privateText,kind:'service',sourceId:seed.pack.id,taxCode:'txcd_50021003'}],exemptions:[]}
    taxStatus = 403
    const failedTax = await h.cmd('tax.config.save',taxConfig)
    assert.equal(failedTax.status,'failed')
    taxStatus = 200
    const connectedTax = await h.cmd('tax.config.save',{...taxConfig,requestId:'synthetic-strap-924'})
    assert.equal(connectedTax.status,'succeeded')
    const taxCharge = (await h.state()).charges.find(r=>r.packId===seed.pack.id)
    const calculatedTax = await h.cmd('tax.calculate',{requestId:'synthetic-strap-925',chargeId:taxCharge.id,productId:'synthetic-strap-923',address:taxAddress})
    assert.equal(calculatedTax.status,'succeeded')
    taxStatus = 503
    const uncertainTax = await h.cmd('tax.confirm',{requestId:'synthetic-strap-926',calculationId:calculatedTax.result.id,expectedTaxCents:calculatedTax.result.taxCents,reference:'synthetic-strap-927'})
    assert.equal(uncertainTax.status,'uncertain')
    taxStatus = 200
    // The public booking door reserves and sends through the real member-mail adapter.
    await h.setAuth({MAIL_PROVIDER: 'sendgrid', MAIL_API_KEY: 'synthetic-strap-916'})
    await h.cmd('mail.connect', {})
    const start = new Date(Date.now() + 14 * 86400000)
    // Midday in the studio keeps the local class date aligned with its UTC week.
    start.setUTCHours(16,0,0,0)
    const monday = new Date(start)
    monday.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7)
    const draft = await h.cmd('classes.prepare', {week: monday.toISOString().slice(0,10), classes: [0,1,2].map(i => ({title: 'Recovery class ' + i, service: 'Fitness', room: 'Room ' + i, start: new Date(+start + i * 7200000).toISOString(), end: new Date(+start + i * 7200000 + 3600000).toISOString(), capacity: 4, instructorId: instructor.id}))})
    const classes = (await h.cmd('classes.publish', {id: draft.id})).classes
    const bookings = []
    for (const [i, status] of [202, 429, 503].entries()) {
      mailStatus = status
      bookings.push(await h.cmd('booking.book', {classId: classes[i].id}, seed.member.cookie))
    }
    assert.equal(mailCalls, 3)
    const forgedNativeId = (await h.send('/api/strap/billing',undefined,h.owner)).value.events[0].id
    let diagnostic = await diagnosticRead(h)
    assert.equal(diagnostic.billing.connectionState, 'connected'); assert.equal(diagnostic.mail.connectionState, 'connected')
    assert.equal(diagnostic.tax.connectionState,'connected')
    assert.ok(diagnostic.tax.reviewedAt); assert.equal(diagnostic.tax.providerHealth,'unknown')
    assert.equal(diagnostic.checkouts.find(r=>r.id===checkout.id).status,'paid')
    assert.equal(diagnostic.checkouts.find(r=>r.id===checkout.id).packId,seed.pack.id)
    assert.ok(diagnostic.checkouts[0].paidAt)
    assert.deepEqual(diagnostic.reconciliations.map(r=>r.status).sort(),['exception','reconciled'])
    assert.ok(diagnostic.reconciliations.every(r=>r.invoiceId===checkout.id && r.createdAt && r.connectionState==='current'))
    assert.equal(diagnostic.reconciliations.find(r=>r.status==='exception').code,'billing_checkout_amount_or_mode_mismatch')
    assert.equal(diagnostic.reconciliations.find(r=>r.status==='exception').paymentRecorded,false)
    assert.equal(diagnostic.reconciliations.find(r=>r.status==='reconciled').paymentRecorded,true)
    assert.equal(diagnostic.taxOperations.find(r=>r.id===failedTax.id).httpStatus,403)
    assert.equal(diagnostic.taxOperations.find(r=>r.id===failedTax.id).code,'tax_provider_refused')
    assert.equal(diagnostic.taxOperations.find(r=>r.id===uncertainTax.id).status,'uncertain')
    assert.equal(diagnostic.taxOperations.find(r=>r.id===uncertainTax.id).httpStatus,503)
    assert.equal(diagnostic.taxOperations.find(r=>r.id===calculatedTax.id).resultId,calculatedTax.result.id)
    assert.equal(diagnostic.taxOperations.find(r=>r.id===calculatedTax.id).targetId,taxCharge.id)
    assert.equal(diagnostic.billing.providerHealth, 'unknown')
    assert.equal(diagnostic.operations.find(r => r.id === failed.id).httpStatus, 403)
    assert.equal(diagnostic.operations.find(r => r.id === failed.id).code, 'billing_provider_refused')
    assert.ok(diagnostic.exceptions.some(r=>r.eventId === (forgedNativeId)), 'the original webhook exception remains source-linked')
    assert.deepEqual(diagnostic.notices.map(r => r.status).sort(), ['accepted', 'not_configured', 'rate_limited', 'uncertain'])
    assert.deepEqual(diagnostic.notices.filter(r=>r.sourceKind==='confirmation').map(r => r.sourceId).sort(), bookings.map(b => b.id).sort())
    for (const row of diagnostic.notices.filter(r=>r.sourceKind==='confirmation')) { assert.ok(row.createdAt); assert.ok(row.attemptedAt); assert.ok(row.finishedAt) }
    const blocked = [seed.member, instructor, await h.person('RecoveryFinance'), await h.person('RecoveryManager'), await h.person('RecoveryDesk')]
    await h.cmd('finance.grant', {id: blocked[2].id}); await h.cmd('manager.grant', {id: blocked[3].id, locationIds:['studio']})
    await h.cmd('staff.access.grant', {personId: blocked[4].id, role: 'front-desk', enabled: true, rights: {'member-record': {enabled: true, scopes: [{memberIds:[seed.member.id], locationIds:['studio'], doors:['all']}]}}})
    const agent = await h.cmd('agent.create', {label: 'Recovery preparation'})
    const form = await h.mf.dispatchFetch(h.origin+'/app/action?name=integration.create&returnTo=%2Fapp%2Fintegrations',{method:'POST',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({label:'Recovery reader','sc_roster:read':'true',location:'studio'}).toString()})
    const integration = {token:(await form.text()).match(/<p class="token">(strap_int_[0-9a-f]{64})<\/p>/)[1]}
    const freshOwner = await h.signIn(h.auth.OWNER_EMAIL)
    const before = await diagnosticStore(h), calls = edge.calls.length, taxCalls = tax.calls.length
    for (const person of blocked) for (const path of [api, page]) {
      const r = await h.send(path, undefined, person.cookie); assert.equal(r.status,403); assert.equal(r.value.error,'owner_required')
    }
    for (const path of [api, page]) {
      const r = await h.send(path, undefined, freshOwner)
      assert.equal(r.status,403); assert.equal(r.headers.get('x-strap-refusal') ?? r.value.error,'mfa_required')
      for (const token of [agent.token,integration.token]) assert.equal((await h.send(path,undefined,'',{authorization:'Bearer '+token})).status,path===page?303:401)
    }
    assert.deepEqual(await diagnosticStore(h),before,'refused diagnostics write nothing, including counters and outboxes')
    const secrets = [privateText, providerText, h.auth.STRIPE_BILLING_TEST_KEY, h.auth.MAIL_API_KEY, h.auth.STRIPE_TAX_TEST_KEY, h.auth.SESSION_SECRET, enrolled.secret].filter(Boolean)
    for (const path of [api, page]) {
      const r = await h.send(path,undefined,h.owner); assert.equal(r.status,200)
      for (const secret of [...secrets, seed.member.email]) assert.ok(!r.text.includes(secret),'diagnostics exclude planted private values')
    }
    assert.equal((await h.send(api,{name:'billing.disconnect',input:{confirm:true}},h.owner)).status,404,'diagnostic POST cannot execute an action')
    await recoveryDiagnosticsBrowser(h, {failedId:failed.id, bookingId:bookings[1].id, checkoutId:checkout.id, failedTaxId:failedTax.id, uncertainTaxId:uncertainTax.id, secrets})
    assert.deepEqual(await diagnosticStore(h),before,'repeated JSON and rendered reads preserve every table')
    assert.equal(edge.calls.length,calls); assert.equal(tax.calls.length,taxCalls); assert.equal(mailCalls,3,'reads never dispatch or retry')
    const replayBefore = await diagnosticStore(h)
    assert.equal((await signedEvent(h,forged)).value.status,'exception')
    assert.deepEqual(await diagnosticStore(h),replayBefore,'replayed capture retains the original exception without new effects')
    assert.equal(edge.calls.length,calls)
    await h.cmd('agent.revoke',{id:agent.id})
    await h.cmd('integration.revoke',{id:(await h.state()).integrations.find(r=>r.label==='Recovery reader').id})
    const revokedBefore=await diagnosticStore(h)
    for(const token of [agent.token,integration.token])assert.equal((await h.send(api,undefined,'',{authorization:'Bearer '+token})).status,401)
    assert.deepEqual(await diagnosticStore(h),revokedBefore,'revoked credentials cannot read or write diagnostic data')
    // Historical timestamps and future provider extensions stay explicitly unavailable.
    await h.db.prepare("UPDATE st_notice_deliveries SET finished_at=?,code=? WHERE source_id=?").bind(Date.now()-3*86400000,providerText,bookings[1].id).run()
    diagnostic = await diagnosticRead(h)
    assert.equal(diagnostic.notices.find(r=>r.sourceId===bookings[1].id).freshness,'stale')
    assert.equal(diagnostic.notices.find(r=>r.sourceId===bookings[1].id).code,'unknown')
    await h.setAuth({STRIPE_BILLING_TEST_KEY:'synthetic-strap-917',STRIPE_TAX_TEST_KEY:'synthetic-strap-928'})
    diagnostic = await diagnosticRead(h)
    assert.equal(diagnostic.billing.connectionState,'disconnected'); assert.ok(diagnostic.operations.every(r=>r.connectionState==='disconnected'))
    assert.equal(diagnostic.tax.connectionState,'disconnected')
    assert.ok(diagnostic.taxOperations.every(r=>r.connectionState==='disconnected'))
    assert.ok(diagnostic.checkouts.every(r=>r.connectionState==='disconnected'))
    assert.ok(diagnostic.reconciliations.every(r=>r.connectionState==='disconnected'))
    assert.equal(diagnostic.checkouts[0].status,'paid','credential rotation never changes retained payment facts')
    assert.equal(diagnostic.taxOperations.length,4)
    assert.equal(diagnostic.operations.length,2,'rotation preserves retained history')
    assert.ok(logs.length>0,'runtime logging was captured');assert.ok(!logs.join('\n').includes(providerText)); assert.ok(!logs.join('\n').includes(privateText))
    console.log('PROBE SEC-001 checkout and tax: failed comparison then canonical payment; refused tax setup then uncertain confirmation -> distinct source-linked redacted outcomes, no implicit retry')
    console.log('PROBE SEC-001 diagnostics: owner MFA GET with failed billing, an exception and three notice outcomes -> redacted source-linked history, explicit connection states and timestamps')
    console.log('PROBE SEC-001 authority: other roles, bearer credentials and an unchecked owner -> refused with unchanged database; repeated authorized reads -> zero dispatch and unchanged records')
    console.log('PROBE SEC-001 stale and rotated connection: old notice observation and changed credential -> stale and unknown detail; billing disconnected with history retained')
  }, {mfa:false,auth:paymentAuth,outbound,log:new CapturedLog(LogLevel.INFO),handleStructuredLogs:({message})=>logs.push(message)})
}
