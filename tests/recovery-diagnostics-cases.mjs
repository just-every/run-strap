import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Log, LogLevel } from 'miniflare'
import { run } from './harness.mjs'
import { totp } from './mfa-helpers.mjs'
import { billingSeed, acceptance } from './billing-sandbox.mjs'
import { paymentAuth, paymentEdge, signedEvent } from './payment-fixtures.mjs'
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
  const rows = await h.db.batch(tables.map(r => h.db.prepare(`SELECT * FROM ${r.name} ORDER BY rowid`)))
  return Object.fromEntries(tables.map((r, i) => [r.name, rows[i].results]))
}
/** The security page's own verify form, posted with any returnTo page. */
const verifyForm = (h, back, code, cookie) => h.mf.dispatchFetch(h.origin+'/app/action?name=mfa.verify&returnTo='+encodeURIComponent(back), {
  method:'POST', redirect:'manual', headers:{origin:h.origin,cookie,'content-type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({code}).toString(),
})
const heading = html => html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]

export async function recoveryDiagnosticsCases() {
  const edge = paymentEdge(), logs = [], privateText = 'synthetic-strap-910-private-notes', providerText = 'synthetic-strap-911-provider-text'
  class CapturedLog extends Log { logWithLevel(_level, message) { logs.push(String(message)) } }
  let fail = false, mailStatus = 202, mailCalls = 0
  const outbound = async request => {
    if (new URL(request.url).hostname === 'api.sendgrid.com') {
      mailCalls++
      return new Response(mailStatus === 202 ? null : providerText, {status: mailStatus, headers: {'x-message-id': providerText}})
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
    const enrollmentForm = await verifyForm(h, page, '', h.owner)
    assert.equal(enrollmentForm.status,403,'returnTo cannot bypass required enrollment')
    assert.equal(enrollmentForm.headers.get('x-strap-refusal'),'mfa_enrollment_required')
    await enrollmentForm.text()
    const enrolled = await h.enroll(h.owner)
    const empty = await diagnosticRead(h)
    assert.equal(empty.billing.connectionState, 'disconnected'); assert.equal(empty.mail.connectionState, 'disconnected')
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
    let diagnostic = await diagnosticRead(h)
    assert.equal(diagnostic.billing.connectionState, 'connected'); assert.equal(diagnostic.mail.connectionState, 'connected')
    assert.equal(diagnostic.billing.providerHealth, 'unknown')
    assert.equal(diagnostic.operations.find(r => r.id === failed.id).httpStatus, 403)
    assert.equal(diagnostic.operations.find(r => r.id === failed.id).code, 'billing_provider_refused')
    assert.equal(diagnostic.exceptions[0].eventId, (await h.send('/api/strap/billing',undefined,h.owner)).value.events[0].id)
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
    const before = await diagnosticStore(h), calls = edge.calls.length
    for (const person of blocked) for (const path of [api, page]) {
      const r = await h.send(path, undefined, person.cookie); assert.equal(r.status,403); assert.equal(r.value.error,'owner_required')
    }
    for (const path of [api, page]) {
      const r = await h.send(path, undefined, freshOwner)
      assert.equal(r.status,403); assert.equal(r.headers.get('x-strap-refusal') ?? r.value.error,'mfa_required')
      for (const token of [agent.token,integration.token]) assert.equal((await h.send(path,undefined,'',{authorization:'Bearer '+token})).status,path===page?303:401)
    }
    // SEC-004 (ct 31 Oct): a form's returnTo page renders only once that page's own guard passes. The walk covers
    // every page of the route table in src/strap/http.ts, so a page added there is walked too.
    const routes = [...(await readFile('src/strap/http.ts','utf8')).match(/const pages = new Set\(\[([^\]]+)\]\)/)[1].matchAll(/'([^']+)'/g)].map(m => m[1])
    const gated = []
    for (const route of routes) {
      const r = await h.send(route, undefined, freshOwner)
      if (r.status === 403 && r.headers.get('x-strap-refusal') === 'mfa_required') gated.push(route)
    }
    assert.ok(gated.includes(page) && gated.includes('/app/revenue'))
    assert.deepEqual(routes.filter(route => !gated.includes(route)), ['/app/security'], 'every page but the factor prompt holds an unchecked owner')
    const seeded = [failed.id, bookings[1].id, seed.member.name, seed.member.email, instructor.name, 'Recovery class 0']
    const heldForm = async (route, code) => {
      const r = await verifyForm(h, route, code, freshOwner), text = await r.text()
      assert.equal(r.status, 403, `${route}: ${code ? 'a wrong' : 'an empty'} code cannot render the page`)
      assert.equal(r.headers.get('x-strap-refusal'), 'mfa_required', route)
      assert.match(text, /name=mfa\.verify&amp;returnTo=/, route + ' shows the factor prompt')
      for (const value of seeded) assert.ok(!text.includes(value), `${route} withholds ${value}`)
      const direct = await h.send(route, undefined, freshOwner)
      assert.equal(direct.status, 403, route); assert.equal(direct.headers.get('x-strap-refusal'), 'mfa_required', route)
    }
    for (const route of gated) await heldForm(route, '')
    console.log('PROBE SEC-004 returnTo empty: unchecked owner POST empty mfa.verify for each of '+gated.length+' gated route-table pages -> HTTP 403 mfa_required factor prompt, no page data, direct GET still 403')
    assert.deepEqual(await diagnosticStore(h),before,'refused diagnostics and returnTo pages write nothing, including counters and outboxes')
    const secrets = [privateText, providerText, h.auth.STRIPE_BILLING_TEST_KEY, h.auth.MAIL_API_KEY, h.auth.SESSION_SECRET, enrolled.secret].filter(Boolean)
    for (const path of [api, page]) {
      const r = await h.send(path,undefined,h.owner); assert.equal(r.status,200)
      for (const secret of [...secrets, seed.member.email]) assert.ok(!r.text.includes(secret),'diagnostics exclude planted private values')
    }
    assert.equal((await h.send(api,{name:'billing.disconnect',input:{confirm:true}},h.owner)).status,404,'diagnostic POST cannot execute an action')
    await recoveryDiagnosticsBrowser(h, {failedId:failed.id, bookingId:bookings[1].id, secrets})
    assert.deepEqual(await diagnosticStore(h),before,'repeated JSON and rendered reads preserve every table')
    assert.equal(edge.calls.length,calls); assert.equal(mailCalls,3,'reads never dispatch or retry')
    // Wrong codes reach the same render point. Each writes only the designed refusal; a recovery-code step-up on the
    // checked owner session clears the five-refusal pause between batches, so every cell runs the real code check.
    let wrong = 0
    while ([-2,-1,0,1,2].some(k => totp(enrolled.secret,k) === String(wrong).padStart(6,'0'))) wrong++
    const codes = [...enrolled.recoveryCodes]
    for (let i = 0; i < gated.length; i += 4) {
      if (i) await h.cmd('mfa.verify', {code: codes.shift()}, h.owner)
      const batch = gated.slice(i, i + 4), store = await diagnosticStore(h), dispatched = edge.calls.length + mailCalls
      for (const route of batch) await heldForm(route, String(wrong).padStart(6,'0'))
      const after = await diagnosticStore(h), refusals = after.st_security_audit.splice(store.st_security_audit.length)
      assert.deepEqual(after, store, 'a wrong code changes no studio record')
      assert.deepEqual(refusals.map(r => r.action), batch.map(() => 'mfa.refused'), 'each wrong code records only its refusal')
      assert.equal(edge.calls.length + mailCalls, dispatched, 'a wrong code dispatches nothing')
    }
    console.log('PROBE SEC-004 returnTo wrong: unchecked owner POST wrong mfa.verify for each of '+gated.length+' gated route-table pages -> HTTP 403 mfa_required factor prompt, only an mfa.refused audit row, zero dispatch')
    // The same owner presents a factor and lands; then every gated page renders through that point as its direct GET does.
    const landed = await verifyForm(h, '/app/revenue', codes.shift(), freshOwner)
    assert.equal(landed.status, 303); assert.equal(landed.headers.get('location'), '/app/revenue')
    assert.match((await h.send('/app/revenue', undefined, freshOwner)).text, new RegExp(seed.member.name), 'the checked owner reads the revenue ledger')
    for (const route of gated) {
      const direct = await h.send(route, undefined, freshOwner), r = await verifyForm(h, route, '', freshOwner), text = await r.text()
      assert.equal(r.status, direct.status, route); assert.equal(r.headers.get('x-strap-refusal'), null, route)
      assert.equal(heading(text), heading(direct.text), route)
    }
    console.log('PROBE SEC-004 returnTo verified: owner presents a recovery code with returnTo revenue -> 303 to the page with its ledger; each gated page then renders through the returnTo point with the status and heading of its direct GET')
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
    await h.setAuth({STRIPE_BILLING_TEST_KEY:'synthetic-strap-917'})
    diagnostic = await diagnosticRead(h)
    assert.equal(diagnostic.billing.connectionState,'disconnected'); assert.ok(diagnostic.operations.every(r=>r.connectionState==='disconnected'))
    assert.equal(diagnostic.operations.length,2,'rotation preserves retained history')
    assert.ok(logs.length>0,'runtime logging was captured');assert.ok(!logs.join('\n').includes(providerText)); assert.ok(!logs.join('\n').includes(privateText))
    console.log('PROBE SEC-001 diagnostics: owner MFA GET with failed billing, an exception and three notice outcomes -> redacted source-linked history, explicit connection states and timestamps')
    console.log('PROBE SEC-001 authority: other roles, bearer credentials and an unchecked owner -> refused with unchanged database; repeated authorized reads -> zero dispatch and unchanged records')
    console.log('PROBE SEC-001 stale and rotated connection: old notice observation and changed credential -> stale and unknown detail; billing disconnected with history retained')
  }, {mfa:false,auth:paymentAuth,outbound,log:new CapturedLog(LogLevel.INFO)})
}
