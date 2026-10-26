import { billingBrowser } from './billing-browser.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { run } from './harness.mjs';
import { acceptance, billingEdge, billingSeed, billingSucceeded } from './billing-sandbox.mjs';

test('Personal membership signatures bind immutable originals and separate payment consent; staff and household status confer no financial signing power',{timeout:120000},async()=>{
  const edge=billingEdge();
  await run(async h=>{
    await h.confirmSetup(h.owner);
    await h.cmd('billing.connect',{accountId:'synthetic-strap-10',mode:'test',confirm:true,requestId:'synthetic-strap-10'},h.owner,403);
    await h.cmd('billing.agreement.prepare',{},h.owner,403);
    assert.equal(edge.calls.length,0);await h.enroll(h.owner);
    const seed=await billingSeed(h);
    const unsignedPack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:seed.outsider.id,credits:2,amountCents:4000,expiresAt:'2099-12-31T00:00:00Z'})).id});
    const proposal=await h.cmd('plan.recurring.prepare',{packId:unsignedPack.id,intervalMonths:1,requestId:'synthetic-strap-80'});
    const before=await h.state();
    const refuse=async(name,input,cookie,status,code)=>{
      const version=(await h.state()).version,count=edge.calls.length;
      const response=await h.send('/api/strap/command',{name,input},cookie);
      assert.equal(response.status,status,JSON.stringify(response.value));assert.equal(response.value.error,code);
      assert.equal((await h.state()).version,version,'refused financial act writes nothing');assert.equal(edge.calls.length,count);
    };
    await refuse('billing.agreement.prepare',{...seed.prepare,adultVerified:false},h.owner,400,'adult_eligibility_verification_required');
    await refuse('billing.agreement.prepare',{...seed.prepare,adultEvidenceReference:''},h.owner,400,'invalid_adultEvidenceReference');
    await refuse('billing.agreement.prepare',{...seed.prepare,termsId:proposal.id},h.owner,409,'accepted_recurring_terms_required');
    const agreement=await h.cmd('billing.agreement.prepare',seed.prepare);
    assert.equal(agreement.originalAgreementHash.length,64);assert.equal(agreement.documentHash.length,64);
    assert.equal(agreement.documentHash,createHash('sha256').update(agreement.documentText).digest('hex'));
    assert.equal(agreement.financialTerms.amountCents,8000);assert.equal(agreement.financialTerms.intervalMonths,1);
    assert.equal(agreement.financialTerms.originalAgreementHash,agreement.originalAgreementHash);
    assert.equal(agreement.financialTerms.firstDueAt,seed.terms.nextRenewalAt);
    const acceptedPack=before.packs.find(p=>p.id===seed.terms.currentPackId);
    assert.deepEqual(agreement.financialTerms.servicePeriod,{startAt:acceptedPack.termStartAt ?? acceptedPack.createdAt,endAt:acceptedPack.expiresAt});
    assert.deepEqual(await h.cmd('billing.agreement.prepare',seed.prepare),agreement);
    for(const cookie of [h.owner,seed.outsider.cookie])await h.cmd('billing.agreement.accept',acceptance(agreement),cookie,403);
    for(const field of ['documentHash','financialHash'])await refuse('billing.agreement.accept',{...acceptance(agreement),[field]:'synthetic-strap-81'},seed.member.cookie,409,'document_changed');
    for(const field of ['confirm','authorizeRecurring','adultConfirmed']){
      await refuse('billing.agreement.accept',{...acceptance(agreement),[field]:false},seed.member.cookie,400,'separate_signature_and_payment_confirmation_required');
      const untouched=(await h.send('/api/strap/billing',undefined,seed.member.cookie)).value;
      assert.equal(untouched.agreements[0].signature,null);assert.equal(untouched.mandates.length,0);
    }
    const signed=await h.cmd('billing.agreement.accept',acceptance(agreement),seed.member.cookie);
    assert.equal(signed.signature.actorId,(await h.state(seed.member.cookie)).actor.id);
    assert.equal(signed.signature.signerPersonId,seed.member.id);assert.equal(signed.signature.signerName,seed.member.name);
    assert.equal(signed.signature.documentText,agreement.documentText);assert.equal(signed.signature.channel,'member-account');
    assert.deepEqual(await h.cmd('billing.agreement.accept',acceptance(agreement),seed.member.cookie),signed);
    const evidence=await h.send('/api/strap/billing/agreement.json?id='+agreement.id,undefined,seed.member.cookie);
    assert.equal(evidence.status,200);assert.equal(evidence.value.agreement.signature.documentHash,agreement.documentHash);
    assert.equal(evidence.value.agreement.originalAgreementHash,agreement.originalAgreementHash);
    assert.equal((await h.send('/api/strap/billing/agreement.json?id='+agreement.id,undefined,seed.outsider.cookie)).status,404);
    const copy=await h.send('/api/strap/billing/agreement.html?id='+agreement.id,undefined,seed.member.cookie);
    assert.equal(copy.status,200);assert.ok(copy.text.includes('Exact document'));assert.ok(copy.text.includes(agreement.documentHash));assert.ok(copy.text.includes(seed.member.name));assert.ok(copy.text.includes('Separate recurring-payment terms'));assert.ok(!copy.text.includes('<script'));
    assert.equal((await h.send('/api/strap/billing/agreement.html?id='+agreement.id,undefined,seed.outsider.cookie)).status,404);
    const state=(await h.send('/api/strap/billing',undefined,seed.member.cookie)).value;
    assert.equal(state.mandates.length,1);assert.equal(state.mandates[0].methodAuthorized,false);assert.equal(state.methods.length,0);
    assert.equal((await h.send('/api/strap/billing',undefined,seed.outsider.cookie)).value.agreements.length,0);
    const after=await h.state();assert.deepEqual(after.packs,before.packs);assert.deepEqual(after.charges,before.charges);assert.deepEqual(after.payments,before.payments);
    const launch=after.staffActions.filter(a=>a.command === 'billing.agreement.prepare' && a.after.id === agreement.id);
    assert.equal(launch.length,1);assert.equal(launch[0].right,'membership-sale');assert.equal(launch[0].staffMade,true);assert.equal(launch[0].after.sellingStaffId,before.actor.id);
    assert.equal(edge.calls.length,0);
    await h.cmd('billing.mandate.revoke',{id:agreement.id},seed.member.cookie);
    await h.cmd('billing.agreement.accept',acceptance(agreement),seed.member.cookie,409);
    const revoked=(await h.send('/api/strap/billing',undefined,seed.member.cookie)).value;
    assert.equal(revoked.mandates[0].status,'revoked');assert.equal(revoked.agreements[0].signature.documentHash,agreement.documentHash);
    const dependent=await billingSeed(h,'DependentMember');
    const preparedDependent=await h.cmd('billing.agreement.prepare',dependent.prepare);
    const authority=await h.cmd('contract.authority.save',{personId:dependent.member.id,delegateId:dependent.outsider.id,kind:'minor-guardian',adultOn:'2099-01-01',evidenceReference:'synthetic-strap-82'});
    await refuse('billing.agreement.prepare',{...dependent.prepare,requestId:'synthetic-strap-83'},h.owner,409,'adult_financial_authority_required');
    await refuse('billing.agreement.accept',acceptance(preparedDependent,dependent.member.name),dependent.member.cookie,409,'adult_financial_authority_required');
    await h.cmd('contract.authority.revoke',{id:authority.id,reason:'Synthetic authority ended'});
    const household=await h.cmd('household.save',{name:'Synthetic household'});
    await h.cmd('household.guardian.link',{id:household.id,guardianId:seed.outsider.id,evidenceReference:'synthetic-strap-50'});
    await h.cmd('household.participant.add',{id:household.id,personId:seed.member.id});
    await h.cmd('billing.agreement.prepare',{...seed.prepare,requestId:'synthetic-strap-51'},h.owner,409);
  },{mfa:false,auth:{STRIPE_BILLING_TEST_KEY:'synthetic-strap-999'},outbound:edge.outbound});
});

test('Stripe-hosted method setup uses durable once-only reservations, exact member consent, masked evidence and immediate revocation and reconnect fences',{timeout:120000},async()=>{
  const edge=billingEdge();let mismatch=null;
  const outbound=async request=>{
    const response=await edge.outbound(request);
    if(!mismatch || !new URL(request.url).pathname.startsWith('/v1/checkout/sessions/'))return response;
    const body=await response.json();mismatch(body);
    return Response.json(body,{status:response.status,headers:response.headers});
  };
  await run(async h=>{
    const seed=await billingSeed(h);
    await billingSucceeded(h,'billing.connect',{accountId:'synthetic-strap-10',mode:'test',confirm:true,requestId:'synthetic-strap-10'});
    const agreement=await h.cmd('billing.agreement.prepare',seed.prepare);
    const start={id:agreement.id,requestId:'synthetic-strap-20'};
    await h.cmd('billing.setup.start',start,seed.member.cookie,409);
    await h.cmd('billing.agreement.accept',acceptance(agreement),seed.member.cookie);
    for(const cookie of [h.owner,seed.outsider.cookie])await h.cmd('billing.setup.start',start,cookie,403);
    const setup=await billingSucceeded(h,'billing.setup.start',start,seed.member.cookie),calls=edge.calls.length;
    assert.equal(new URL(setup.launchURL).hostname,'checkout.stripe.com');
    const replay=await h.cmd('billing.setup.start',start,seed.member.cookie);assert.equal(replay.result.id,setup.result.id);assert.ok(!replay.launchURL);assert.equal(edge.calls.length,calls);
    const complete={id:agreement.id,setupId:setup.result.id,requestId:'synthetic-strap-21'};
    assert.equal((await h.cmd('billing.setup.complete',complete,seed.member.cookie)).status,'incomplete');
    edge.setComplete(true);
    const mismatches=[
      ['session live mode',b=>b.livemode=true,'billing_provider_mode_mismatch'],
      ['session mode',b=>b.mode='payment','billing_provider_mode_mismatch'],
      ['session reference',b=>b.client_reference_id='synthetic-strap-84','billing_provider_source_mismatch'],
      ...['agreementId','mandateId','operationId'].map(key=>['session '+key,b=>b.metadata={...b.metadata,[key]:'synthetic-strap-85'},'billing_provider_source_mismatch']),
      ['intent live mode',b=>b.setup_intent.livemode=true,'billing_setup_authorization_incomplete'],
      ['intent status',b=>b.setup_intent.status='requires_action','billing_setup_authorization_incomplete'],
      ['intent usage',b=>b.setup_intent.usage='on_session','billing_setup_authorization_incomplete'],
      ...['agreementId','mandateId','operationId'].map(key=>['intent '+key,b=>b.setup_intent.metadata={...b.setup_intent.metadata,[key]:'synthetic-strap-86'},'billing_provider_source_mismatch']),
      ['method live mode',b=>b.setup_intent.payment_method.livemode=true,'billing_saved_card_required'],
    ];
    for(const [i,[label,change,errorCode]] of mismatches.entries()){
      mismatch=change;
      const rejected=await h.cmd('billing.setup.complete',{...complete,requestId:'synthetic-strap-'+(200+i)},seed.member.cookie);
      assert.equal(rejected.status,'uncertain',label);assert.equal(rejected.errorCode,errorCode,label);assert.equal(rejected.result,null,label);
      const rejectedState=(await h.send('/api/strap/billing',undefined,seed.member.cookie)).value;
      assert.equal(rejectedState.methods.length,0,label);assert.equal(rejectedState.mandates[0].methodAuthorized,false,label);assert.equal(rejectedState.setups[0].status,'awaiting-member',label);
    }
    mismatch=null;
    const method=await billingSucceeded(h,'billing.setup.complete',{...complete,requestId:'synthetic-strap-22'},seed.member.cookie);
    assert.equal(method.result.last4,'4242');assert.equal(method.result.authorizedBy,agreement.signature?.actorId ?? method.actorId);
    const state=(await h.send('/api/strap/billing',undefined,seed.member.cookie)).value;
    assert.equal(state.methods.length,1);assert.equal(state.methods[0].available,true);assert.equal(state.mandates[0].methodAuthorized,true);
    assert.ok(!JSON.stringify(state).includes('must-not-be-retained'));assert.ok(!JSON.stringify(state).includes('checkout.stripe.com'));
    assert.equal((await h.send('/api/strap/billing',undefined,seed.outsider.cookie)).value.methods.length,0);
    const before=await h.state();
    await h.setAuth({STRIPE_BILLING_TEST_KEY:'synthetic-strap-998'});
    assert.equal((await h.send('/api/strap/billing',undefined,seed.member.cookie)).value.methods[0].available,false);
    const count=edge.calls.length;
    await h.cmd('billing.setup.complete',{...complete,requestId:'synthetic-strap-23'},seed.member.cookie,409);assert.equal(edge.calls.length,count);
    await h.setAuth({STRIPE_BILLING_TEST_KEY:'synthetic-strap-999'});
    const historical=(await h.send('/api/strap/billing',undefined,seed.member.cookie)).value;
    await h.cmd('billing.mandate.revoke',{id:agreement.id},seed.member.cookie);
    const revoked=(await h.send('/api/strap/billing',undefined,seed.member.cookie)).value;
    assert.equal(revoked.methods[0].available,false);assert.deepEqual(revoked.agreements[0].signature,historical.agreements[0].signature);
    assert.deepEqual(revoked.mandates[0].financialTerms,historical.mandates[0].financialTerms);assert.equal(revoked.mandates[0].status,'revoked');
    const revokedVersion=(await h.state()).version,revokedCalls=edge.calls.length;
    for(const [name,input] of [['billing.setup.start',{...start,requestId:'synthetic-strap-87'}],['billing.setup.start',start],['billing.setup.complete',{...complete,requestId:'synthetic-strap-88'}],['billing.setup.complete',{...complete,requestId:'synthetic-strap-22'}]]){
      const refused=await h.send('/api/strap/command',{name,input},seed.member.cookie);
      assert.equal(refused.status,409);assert.equal(refused.value.error,'payment_mandate_required');
      assert.equal(edge.calls.length,revokedCalls,'revocation blocks the next provider use, including replay');assert.equal((await h.state()).version,revokedVersion);
    }
    const after=await h.state();assert.deepEqual(after.packs,before.packs);assert.deepEqual(after.recurring.terms,before.recurring.terms);assert.deepEqual(after.charges,before.charges);assert.deepEqual(after.payments,before.payments);
    await h.setAuth({STRIPE_BILLING_TEST_KEY:'synthetic-strap-999'});
    const second=await billingSeed(h,'UncertainMember');
    const pendingAgreement=await h.cmd('billing.agreement.prepare',second.prepare);
    await h.cmd('billing.agreement.accept',acceptance(pendingAgreement,second.member.name),second.member.cookie);
    edge.setUncertain(true);
    const pendingInput={id:pendingAgreement.id,requestId:'synthetic-strap-70'};
    const uncertain=await h.cmd('billing.setup.start',pendingInput,second.member.cookie);assert.equal(uncertain.status,'uncertain');
    const attempts=edge.calls.length;
    assert.deepEqual(await h.cmd('billing.setup.start',pendingInput,second.member.cookie),uncertain);
    await h.cmd('billing.setup.start',{...pendingInput,requestId:'synthetic-strap-71'},second.member.cookie,409);
    assert.equal(edge.calls.length,attempts);
    if(process.env.STRAP_BILLING_BROWSER === '1' || process.env.STRAP_PROOF_DIR)await billingBrowser(h,edge);
  },{auth:{STRIPE_BILLING_TEST_KEY:'synthetic-strap-999'},outbound});
});
