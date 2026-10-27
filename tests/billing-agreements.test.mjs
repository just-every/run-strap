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
    await h.cmd('studio.save',{location:'Austin',timeZone:'America/Chicago'});
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
    {
    // Delegated staff may launch the personal act within the original sale scope.
    const desk=await h.person('BillingDesk'), finance=await h.person('BillingFinance');
    const west=await h.cmd('location.save',{name:'Billing West',timeZone:'America/Los_Angeles'});
    const grant=async(actor,role,right,memberIds=[seed.member.id],locationIds=['studio'])=>h.cmd('staff.access.grant',{personId:actor.id,role,enabled:true,rights:{[right]:{enabled:true,scopes:[{memberIds,locationIds,doors:['all']}]}}});
    const prepare={...seed.prepare,requestId:'synthetic-strap-300'};
    const launchInput={id:agreement.id,requestId:'synthetic-strap-301',channel:'phone'};
    await grant(desk,'front-desk','member-record');
    await refuse('billing.setup.start.launch',launchInput,desk.cookie,403,'mfa_enrollment_required');
    await h.enroll(desk.cookie);
    await refuse('billing.agreement.prepare',prepare,desk.cookie,403,'staff_right_required');
    await refuse('billing.setup.start.launch',launchInput,desk.cookie,403,'staff_right_required');
    await grant(desk,'front-desk','collection',[seed.outsider.id]);
    await refuse('billing.setup.start.launch',launchInput,desk.cookie,403,'staff_scope_required');
    await grant(desk,'front-desk','collection',[seed.member.id],[west.id]);
    await refuse('billing.setup.start.launch',launchInput,desk.cookie,403,'staff_scope_required');
    await grant(desk,'front-desk','collection');
    const personalBefore=(await h.send('/api/strap/billing',undefined,seed.member.cookie)).value;
    const launch=await h.cmd('billing.setup.start.launch',launchInput,desk.cookie);
    assert.equal(launch.status,'member_action_required');assert.equal(launch.personId,seed.member.id);
    assert.deepEqual(await h.cmd('billing.setup.start.launch',launchInput,desk.cookie),launch);
    const action=(await h.state()).staffActions.filter(a=>a.requestId===launchInput.requestId);
    assert.equal(action.length,1);assert.deepEqual([action[0].right,action[0].actorRole,action[0].channel,action[0].personId],['collection','front-desk','phone',seed.member.id]);
    const personalAfter=(await h.send('/api/strap/billing',undefined,seed.member.cookie)).value;
    for(const key of ['agreements','mandates','methods','setups','operations'])assert.deepEqual(personalAfter[key],personalBefore[key]);
    await refuse('billing.setup.start',{id:agreement.id,requestId:'synthetic-strap-302'},desk.cookie,403,'member_record_right_required');
    assert.equal((await h.send('/api/strap/billing/agreement.json?id='+agreement.id,undefined,desk.cookie)).status,403);
    await grant(desk,'front-desk','member-record');
    await refuse('billing.setup.start.launch',launchInput,desk.cookie,403,'staff_right_required');
    await grant(finance,'finance','collection');await h.enroll(finance.cookie);
    const financeLaunch=await h.cmd('billing.setup.start.launch',{...launchInput,requestId:'synthetic-strap-303'},finance.cookie);
    assert.equal(financeLaunch.personId,seed.member.id);assert.equal(financeLaunch.status,'member_action_required');
    assert.equal((await h.send('/api/strap/billing',undefined,finance.cookie)).status,403);
    await grant(finance,'finance','collection',[seed.outsider.id]);
    await refuse('billing.setup.start.launch',{...launchInput,requestId:'synthetic-strap-303'},finance.cookie,403,'staff_scope_required');
    const delegated=await billingSeed(h,'DelegatedAgreement');
    const delegatedPrepare={...delegated.prepare,requestId:'synthetic-strap-304'};
    await grant(desk,'front-desk','membership-sale',[seed.member.id]);
    await refuse('billing.agreement.prepare',delegatedPrepare,desk.cookie,403,'staff_scope_required');
    await grant(desk,'front-desk','membership-sale',[delegated.member.id],[west.id]);
    await refuse('billing.agreement.prepare',delegatedPrepare,desk.cookie,403,'staff_scope_required');
    await grant(desk,'front-desk','membership-sale',[delegated.member.id]);
    const staffAgreement=await h.cmd('billing.agreement.prepare',delegatedPrepare,desk.cookie);
    const staffActor=(await h.state(desk.cookie)).actor;
    assert.equal(staffAgreement.sellingStaffId,staffActor.id);assert.equal(staffAgreement.signature,null);
    assert.deepEqual(await h.cmd('billing.agreement.prepare',delegatedPrepare,desk.cookie),staffAgreement);
    await refuse('billing.agreement.accept',acceptance(staffAgreement,delegated.member.name),desk.cookie,403,'member_record_right_required');
    const personallySigned=await h.cmd('billing.agreement.accept',acceptance(staffAgreement,delegated.member.name),delegated.member.cookie);
    assert.equal(personallySigned.signature.actorId,(await h.state(delegated.member.cookie)).actor.id);
    assert.notEqual(personallySigned.signature.actorId,staffActor.id);
    const staffEvents=(await h.state()).staffActions.filter(a=>a.command==='billing.agreement.prepare'&&a.after.id===staffAgreement.id);
    assert.equal(staffEvents.length,1);assert.equal(staffEvents[0].actorRole,'front-desk');assert.equal(staffEvents[0].right,'membership-sale');
    await grant(desk,'front-desk','member-record',[delegated.member.id]);
    await refuse('billing.agreement.prepare',delegatedPrepare,desk.cookie,403,'staff_right_required');
    // The same billing authority is exercised for each role at both locations.
    for(const site of ['East','West'])for(const role of ['manager','front-desk','finance','instructor']){
      await run(async h=>{
      await h.confirmSetup(h.owner);await h.cmd('studio.save',{location:'Austin',timeZone:'America/Chicago'});
      const west=await h.cmd('location.save',{name:'Matrix West',timeZone:'America/Los_Angeles'}),locationId=site==='East'?'studio':west.id;
      const refuse=async(name,input,cookie,status,code)=>{const version=(await h.state()).version,r=await h.send('/api/strap/command',{name,input},cookie);assert.equal(r.status,status,JSON.stringify(r.value));assert.equal(r.value.error,code);assert.equal((await h.state()).version,version);};
      const suffix=site+role.replace('-',''), actor=await h.person('Matrix'+suffix,role==='instructor'?'instructor':'member');
      const target=await billingSeed(h,'Target'+suffix,locationId);
      const permitsSale=['manager','front-desk'].includes(role),permitsCollection=['manager','front-desk','finance'].includes(role);
      const names=[...(permitsSale?['membership-sale']:[]),...(permitsCollection?['collection']:[])];
      const scoped=async(locations,enabled=true)=>h.cmd('staff.access.grant',{personId:actor.id,role,enabled,rights:Object.fromEntries(names.map(right=>[right,{enabled:true,scopes:[{memberIds:[target.member.id],locationIds:locations,doors:['all']}]}]))});
      await scoped([locationId]);await h.enroll(actor.cookie);
      const prepare={...target.prepare,requestId:'synthetic-strap-matrix-'+suffix};
      const agreement=await h.cmd('billing.agreement.prepare',prepare,permitsSale?actor.cookie:h.owner);
      if(!permitsSale)await refuse('billing.agreement.prepare',prepare,actor.cookie,403,role==='finance'?'finance_reports_only':'staff_right_required');
      else {
        assert.equal(agreement.sellingStaffId,(await h.state(actor.cookie)).actor.id);
        await scoped([locationId==='studio'?west.id:'studio']);
        await refuse('billing.agreement.prepare',prepare,actor.cookie,403,'staff_scope_required');
        await scoped([locationId]);
      }
      await h.cmd('billing.agreement.accept',acceptance(agreement,target.member.name),target.member.cookie);
      const input={id:agreement.id,requestId:'synthetic-strap-matrix-launch-'+suffix,channel:'desk'};
      assert.equal((await h.send('/api/strap/billing/agreement.json?id='+agreement.id,undefined,actor.cookie)).status,role==='instructor'?404:403,role+' cannot read completed agreement evidence');
      if(permitsCollection){
        const opened=await h.cmd('billing.setup.start.launch',input,actor.cookie);assert.equal(opened.personId,target.member.id);
        const events=(await h.state()).staffActions.filter(a=>a.requestId===input.requestId);
        assert.equal(events.length,1);assert.equal(events[0].actorRole,role);assert.equal(events[0].right,'collection');
        await scoped([locationId==='studio'?west.id:'studio']);
        await refuse('billing.setup.start.launch',input,actor.cookie,403,'staff_scope_required');
        await scoped([locationId],false);
        const revision=(await h.state()).version;
        assert.equal((await h.send('/api/strap/command',{name:'billing.setup.start.launch',input},actor.cookie)).status,403);
        assert.equal((await h.state()).version,revision);
      } else await refuse('billing.setup.start.launch',input,actor.cookie,403,'staff_right_required');
      });
    }
    assert.equal(edge.calls.length,0,'staff launch never calls a provider or supplies member authorization');
    }
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
    // Collection staff opens the handoff; only the member replaces the method.
    const desk=await h.person('ReplaceDesk');
    const grant=async right=>h.cmd('staff.access.grant',{personId:desk.id,role:'front-desk',enabled:true,rights:{[right]:{enabled:true,scopes:[{memberIds:[seed.member.id],locationIds:['studio'],doors:['all']}]}}});
    await grant('collection');await h.enroll(desk.cookie);
    const handoffInput={id:agreement.id,requestId:'synthetic-strap-400',channel:'desk'};
    const handoff=await h.cmd('billing.setup.start.launch',handoffInput,desk.cookie);
    assert.equal(handoff.status,'member_action_required');
    const replace={id:agreement.id,replaceMethodId:method.result.id,confirmReplacement:true,requestId:'synthetic-strap-401'};
    const unchanged=await h.state();
    for(const [input,cookie,status] of [[replace,desk.cookie,403],[{...replace,confirmReplacement:false},seed.member.cookie,409],[{...replace,replaceMethodId:'synthetic-strap-other'},seed.member.cookie,409]]){
      const calls=edge.calls.length;await h.cmd('billing.setup.start',input,cookie,status);assert.equal(edge.calls.length,calls);assert.equal((await h.state()).version,unchanged.version);
    }
    await grant('member-record');await h.cmd('billing.setup.start.launch',handoffInput,desk.cookie,403);
    const replacement=await billingSucceeded(h,'billing.setup.start',replace,seed.member.cookie);
    assert.equal(replacement.result.replacesMethodId,method.result.id);
    assert.deepEqual((await h.send('/api/strap/billing',undefined,seed.member.cookie)).value.methods,state.methods,'pending replacement leaves the current method available');
    edge.setComplete(false);
    const replacementComplete={id:agreement.id,setupId:replacement.result.id,requestId:'synthetic-strap-402'};
    assert.equal((await h.cmd('billing.setup.complete',replacementComplete,seed.member.cookie)).status,'incomplete');
    edge.setComplete(true);edge.setCard('5556');
    const replaced=await billingSucceeded(h,'billing.setup.complete',{...replacementComplete,requestId:'synthetic-strap-403'},seed.member.cookie);
    assert.equal(replaced.result.last4,'5556');assert.equal(replaced.result.replacesMethodId,method.result.id);
    const replacementState=(await h.send('/api/strap/billing',undefined,seed.member.cookie)).value;
    assert.deepEqual(replacementState.methods.filter(m=>m.available).map(m=>[m.id,m.last4]),[[replaced.result.id,'5556']]);
    assert.deepEqual((await h.send('/api/strap/billing',undefined,h.owner)).value.methods,replacementState.methods);
    assert.equal(JSON.stringify(replacementState).includes('must-not-be-retained'),false);
    assert.equal((await h.send('/api/strap/billing',undefined,seed.outsider.cookie)).value.methods.length,0);
    const previous=replacementState.methods.find(m=>m.id===method.result.id);
    assert.equal(previous.status,'superseded');assert.equal(previous.supersededBy,replaced.result.id);assert.equal(previous.last4,'4242');
    assert.deepEqual(replacementState.agreements[0].signature,state.agreements[0].signature);assert.deepEqual(replacementState.mandates[0].financialTerms,state.mandates[0].financialTerms);
    const replacementCalls=edge.calls.length;
    assert.deepEqual(await h.cmd('billing.setup.complete',{...replacementComplete,requestId:'synthetic-strap-403'},seed.member.cookie),replaced);
    await h.cmd('billing.setup.start',replace,seed.member.cookie);assert.equal(edge.calls.length,replacementCalls);
    assert.deepEqual((await h.send('/api/strap/billing',undefined,seed.member.cookie)).value.methods,replacementState.methods);
    assert.deepEqual((await h.state()).charges,unchanged.charges);assert.deepEqual((await h.state()).payments,unchanged.payments);
    edge.setCard('4242');
    const before=await h.state();
    await h.setAuth({STRIPE_BILLING_TEST_KEY:'synthetic-strap-998'});
    assert.equal((await h.send('/api/strap/billing',undefined,seed.member.cookie)).value.methods.some(m=>m.available),false);
    const count=edge.calls.length;
    await h.cmd('billing.setup.complete',{...complete,requestId:'synthetic-strap-23'},seed.member.cookie,409);assert.equal(edge.calls.length,count);
    await h.setAuth({STRIPE_BILLING_TEST_KEY:'synthetic-strap-999'});
    const historical=(await h.send('/api/strap/billing',undefined,seed.member.cookie)).value;
    await h.cmd('billing.mandate.revoke',{id:agreement.id},seed.member.cookie);
    const revoked=(await h.send('/api/strap/billing',undefined,seed.member.cookie)).value;
    assert.equal(revoked.methods.some(m=>m.available),false);assert.deepEqual(revoked.agreements[0].signature,historical.agreements[0].signature);
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
