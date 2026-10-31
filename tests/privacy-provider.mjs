import assert from 'node:assert/strict'
import {run} from './harness.mjs'
import {billingSeed,acceptance,billingSucceeded} from './billing-sandbox.mjs'
import {paymentEdge,paymentAuth,connectPayment,signedEvent,billingView} from './payment-fixtures.mjs'
import {privacyDecision,verifiedPrivacyRequest} from './privacy-journey.mjs'

/** Only the remote provider edge is simulated; sign-in, consent, billing and erasure use native HTTP. */
export async function privacyProvider() {
  const edge=paymentEdge()
  await run(async h=>{
    const seed=await billingSeed(h,'Syntheticprivacymethod'),agreement=await h.cmd('billing.agreement.prepare',seed.prepare)
    await h.cmd('billing.agreement.accept',acceptance(agreement,seed.member.name),seed.member.cookie)
    await connectPayment(h)
    const setup=await billingSucceeded(h,'billing.setup.start',{id:agreement.id,requestId:'synthetic-strap-private-method-start'},seed.member.cookie)
    edge.setComplete(true)
    const finish={id:agreement.id,setupId:setup.result.id,requestId:'synthetic-strap-private-method-complete'}
    const method=(await billingSucceeded(h,'billing.setup.complete',finish,seed.member.cookie)).result
    assert.equal((await billingView(h)).methods.find(r=>r.id===method.id).available,true)
    const checkout=await h.cmd('billing.checkout.start',{packId:seed.pack.id,requestId:'synthetic-strap-private-checkout',confirm:true})
    const request=await verifiedPrivacyRequest(h,seed.member,'erasure','-provider')
    const before=(await h.state()).version
    assert.equal((await h.cmd('privacy.erase.prepare',{id:request.id,...privacyDecision,obligations:'retain'},h.owner,409)).error,'privacy_resolve_pending_provider_work_first')
    assert.equal((await h.state()).version,before)
    edge.complete(checkout.providerSessionId)
    const paid=edge.event(checkout.providerSessionId,'checkout.session.completed','privacy-paid')
    assert.equal((await signedEvent(h,paid)).value.status,'processed')
    const linked=(await billingView(h)).invoices.find(r=>r.id===checkout.id)
    assert.equal(linked.status,'paid')
    const nativeOperator=await h.db.prepare('SELECT id FROM oa_operators WHERE email=?').bind(seed.member.email).first()
    const nativeSession=await h.db.prepare('SELECT id FROM oa_sessions WHERE operator_id=?').bind(nativeOperator.id).first()
    // Existing provider identity metadata is installed as a fixture; erasure and credential replay use the ordinary doors.
    await h.db.batch([
      h.db.prepare('INSERT INTO oa_external_identities(issuer,subject,operator_id) VALUES(?,?,?)').bind('https://synthetic-strap.invalid','synthetic-strap-provider-subject',nativeOperator.id),
      h.db.prepare('INSERT INTO oa_provider_sessions(session_id,issuer,subject,sid,generation) VALUES(?,?,?,?,?)').bind(nativeSession.id,'https://synthetic-strap.invalid','synthetic-strap-provider-subject','synthetic-strap-provider-session',1),
      h.db.prepare('INSERT INTO oa_provider_session_pins(session_id,provider_id,issuer,client_id,linked_at) VALUES(?,?,?,?,?)').bind(nativeSession.id,'synthetic-strap-provider','https://synthetic-strap.invalid','synthetic-strap-client',Date.now()),
    ])
    const access=await verifiedPrivacyRequest(h,seed.member,'access','-provider')
    const accessCopy=await h.cmd('privacy.export',{id:access.id})
    assert.ok(accessCopy.records.some(r=>r.kind==='payment'&&r.data.amountCents===8000))
    assert.equal(accessCopy.records.find(r=>r.kind==='billingAgreement').data.signature.signerName,seed.member.name)
    const paths=(value,needle,path='')=>typeof value==='string'&&value.includes(needle)?[path]:value&&typeof value==='object'?Object.entries(value).flatMap(([key,entry])=>paths(entry,needle,path+'.'+key)):[]
    for(const value of [method.paymentMethodId,method.setupIntentId,checkout.providerSessionId]) {
      assert.equal(typeof value,'string');assert.deepEqual(paths(accessCopy,value),[],'the access copy has billing evidence without reusable provider credentials')
    }
    const review=await h.cmd('privacy.erase.prepare',{id:request.id,...privacyDecision,documents:'retain'})
    const providerCalls=edge.calls.length
    await h.cmd('privacy.erase.confirm',{id:review.id,confirm:true})
    assert.equal(edge.calls.length,providerCalls,'native erasure never pretends to delete external provider data')
    const snapshot=await billingView(h),state=await h.state(),retained=state.privacy.retained.find(r=>r.personId===seed.member.id)
    assert.equal(snapshot.methods.find(r=>r.id===method.id).available,false)
    assert.equal(snapshot.mandates.find(r=>r.agreementId===agreement.id).status,'revoked')
    assert.equal(state.recurring.terms.find(r=>r.id===seed.terms.id).status,'stopped')
    const privateCopy=await h.cmd('privacy.retained',{id:retained.id})
    assert.equal(privateCopy.content.agreement.signature.signerName,seed.member.name)
    assert.equal(privateCopy.content.agreement.documentHash,agreement.documentHash)
    assert.equal((await h.send('/api/strap/billing/agreement.json?id='+agreement.id,undefined,h.owner)).status,404)
    const payment=state.payments.find(r=>r.personId===seed.member.id)
    assert.equal(payment.amountCents,8000);assert.equal(state.charges.filter(r=>r.personId===seed.member.id).reduce((n,r)=>n+r.amountCents,0),8000)
    for(const table of ['oa_external_identities','oa_provider_sessions','oa_provider_session_pins'])assert.equal((await h.db.prepare('SELECT count(*) AS n FROM '+table).first()).n,0)
    for(const value of [method.paymentMethodId,method.setupIntentId,seed.member.email])assert.ok(!JSON.stringify(snapshot).includes(value),'normal billing reads omit erased provider tokens and identity')
    await h.cmd('billing.setup.complete',finish,seed.member.cookie,401)
    await h.cmd('billing.reconcile',{id:checkout.id,requestId:'synthetic-strap-private-late-reconcile'},h.owner,404)
    const amounts=state.payments.map(p=>[p.id,p.amountCents])
    assert.equal((await signedEvent(h,paid)).value.status,'processed')
    const late=edge.event(checkout.providerSessionId,'invoice.paid','privacy-late')
    assert.equal((await signedEvent(h,late)).value.status,'exception')
    const after=await h.state();assert.deepEqual(after.payments.map(p=>[p.id,p.amountCents]),amounts);assert.ok(!after.people.some(p=>p.id===seed.member.id))
    for(const path of ['/app/packs','/app/renewals','/app/studio']) {
      const page=await h.send(path,undefined,h.owner);assert.equal(page.status,200,'ordinary billing pages remain usable after erasure')
      assert.ok(!page.text.includes(seed.member.email))
    }
    const beforeDiagnostics=(await h.state()).version,diagnosticCalls=edge.calls.length
    for(const path of ['/api/strap/recovery-diagnostics','/app/recovery-diagnostics']) {
      const diagnostics=await h.send(path,undefined,h.owner)
      assert.equal(diagnostics.status,200)
      for(const value of [seed.member.name,seed.member.email,method.paymentMethodId,method.setupIntentId,checkout.providerSessionId])assert.ok(!diagnostics.text.includes(value),'recovery diagnostics never expose erased identity or provider credentials')
      const refused=await h.send(path,undefined,seed.member.cookie)
      assert.equal(refused.status,path.startsWith('/app/')?303:401,'an erased session cannot use recovery diagnostics')
      if(path.startsWith('/app/'))assert.equal(new URL(refused.headers.get('location'),h.origin).pathname,'/signin')
    }
    assert.equal((await h.state()).version,beforeDiagnostics);assert.equal(edge.calls.length,diagnosticCalls)
    assert.ok(!(await h.state()).people.some(p=>p.id===seed.member.id),'diagnostic reads and replay never resurrect the erased member')
    console.log('PROBE SEC-001 erasure: retained paid invoice after erasure and webhook replay -> no erased identity or reusable provider values in owner diagnostics, erased session refused, unchanged records and no dispatch')
    const exit=await h.send('/api/strap/exit.json',undefined,h.owner)
    assert.equal(exit.status,200)
    for(const value of [method.paymentMethodId,method.setupIntentId,'synthetic-strap-provider-subject','synthetic-strap-provider-session'])assert.ok(!exit.text.includes(value),'full exit omits retired provider credentials')
  },{auth:paymentAuth,outbound:edge.outbound})
}
