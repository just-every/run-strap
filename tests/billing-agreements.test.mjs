import { billingBrowser } from './billing-browser.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentAuth, paymentEdge, paymentSeed, billingView, connectPayment, signedEvent } from './payment-fixtures.mjs';
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
    const desk=await h.person('CollectionDesk');
    const grant=async(rights,memberIds=[seed.member.id],locationIds=['studio'])=>h.cmd('staff.access.grant',{personId:desk.id,role:'front-desk',enabled:true,rights:Object.fromEntries(rights.map(right=>[right,{enabled:true,scopes:[{memberIds,locationIds,doors:['all']}]}]))});
    const launch={personId:seed.member.id,locationId:'studio',requestId:'synthetic-strap-collection',channel:'phone'};
    const deny=async(name,input,cookie=desk.cookie)=>{const v=(await h.state()).version,c=edge.calls.length;const r=await h.send('/api/strap/command',{name,input},cookie);assert.equal(r.status,403,r.text);assert.equal((await h.state()).version,v);assert.equal(edge.calls.length,c);};
    await grant(['member-record','collection']);await deny('billing.setup.start.launch',launch);
    await grant(['member-record']);await h.enroll(desk.cookie);
    await deny('billing.setup.start.launch',launch);
    await grant(['member-record','collection'],[seed.outsider.id]);await deny('billing.setup.start.launch',launch);
    await h.cmd('studio.save',{location:'Brooklyn',timeZone:'America/New_York'});
    const west=await h.cmd('location.save',{name:'Collection West',timeZone:'America/Los_Angeles'});
    await grant(['member-record','collection'],[seed.member.id],[west.id]);await deny('billing.setup.start.launch',{...launch,id:agreement.id});
    await grant(['member-record','collection']);
    const beforeLaunch=(await h.send('/api/strap/billing',undefined,seed.member.cookie)).value,launchCalls=edge.calls.length;
    const opened=await h.cmd('billing.setup.start.launch',launch,desk.cookie);
    assert.equal(opened.status,'member_action_required');assert.equal(new URL(opened.url,h.origin).pathname,'/signin');
    assert.deepEqual(await h.cmd('billing.setup.start.launch',launch,desk.cookie),opened);
    const afterLaunch=(await h.send('/api/strap/billing',undefined,seed.member.cookie)).value;
    for(const k of ['agreements','mandates','methods','setups','operations'])assert.deepEqual(afterLaunch[k],beforeLaunch[k]);assert.equal(edge.calls.length,launchCalls);
    const audit=(await h.state()).staffActions.filter(a=>a.requestId===launch.requestId);assert.equal(audit.length,1);assert.deepEqual([audit[0].actorId,audit[0].personId,audit[0].right,audit[0].channel],[(await h.state(desk.cookie)).actor.id,seed.member.id,'collection','phone']);
    await deny('billing.setup.start',{...start,replaceMethodId:method.result.id},desk.cookie);
    for(const path of ['/api/strap/billing','/api/strap/billing/agreement.json?id='+agreement.id,'/api/strap/billing/agreement.html?id='+agreement.id])assert.equal((await h.send(path,undefined,desk.cookie)).status,403);
    await grant(['member-record']);await deny('billing.setup.start.launch',launch);await deny('billing.setup.start.launch',{...launch,id:agreement.id,requestId:'synthetic-strap-revoked'});
    await grant(['member-record','collection']);
    for(const role of ['manager','finance']) {
      const colleague=await h.person('Collection'+role);
      const scope={enabled:true,scopes:[{memberIds:[seed.member.id],locationIds:['studio',west.id],doors:['all']}]};
      await h.cmd('staff.access.grant',{personId:colleague.id,role,enabled:true,rights:{collection:scope}});await h.enroll(colleague.cookie);
      const input={...launch,id:agreement.id,requestId:'synthetic-strap-'+role};
      const opened=await h.cmd('billing.setup.start.launch',input,colleague.cookie);assert.equal(opened.status,'member_action_required');assert.equal((await h.state()).staffActions.find(a=>a.requestId===input.requestId).actorRole,role);
      await h.cmd('staff.access.grant',{personId:colleague.id,role,enabled:true,rights:{}});await deny('billing.setup.start.launch',input,colleague.cookie);
    }
    const replace={id:agreement.id,replaceMethodId:method.result.id,confirmReplacement:true,requestId:'synthetic-strap-401'};
    const unchanged=await h.state();
    for(const [input,cookie,status] of [[replace,desk.cookie,403],[{...replace,confirmReplacement:false},seed.member.cookie,409],[{...replace,replaceMethodId:'synthetic-strap-other'},seed.member.cookie,409]]){
      const calls=edge.calls.length;await h.cmd('billing.setup.start',input,cookie,status);assert.equal(edge.calls.length,calls);assert.equal((await h.state()).version,unchanged.version);
    }
    const replacement=await billingSucceeded(h,'billing.setup.start',replace,seed.member.cookie);
    assert.equal(replacement.result.replacesMethodId,method.result.id);
    assert.equal(replacement.result.previousMethodId,method.result.id);
    await h.cmd('billing.setup.start',{...replace,requestId:'synthetic-strap-parallel-replacement'},seed.member.cookie,409);
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
    await billingSucceeded(h,'billing.setup.complete',{...complete,requestId:'synthetic-strap-old-setup-replay'},seed.member.cookie);
    assert.equal((await h.send('/api/strap/billing',undefined,seed.member.cookie)).value.mandates[0].methodId,replaced.result.id,'old setup cannot replace the current method');
    if(process.env.STRAP_PROOF_DIR)await (await import('./collection-browser.mjs')).collectionBrowser(h,edge,{seed,agreement,desk});
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

test('Merchant readiness, hosted plan payment and signed reconciliation retain history through rotation, missing events and replay',{timeout:180000},async()=>{
  const edge=paymentEdge();let onAccount=null;
  await run(async h=>{
    const view=()=>billingView(h),posts=()=>edge.calls.filter(c=>c.method==='POST').length;
    const refuse=async(name,input,cookie,status=403)=>{const before=(await h.state()).version,calls=edge.calls.length;await h.cmd(name,input,cookie,status);assert.equal((await h.state()).version,before);assert.equal(edge.calls.length,calls);};
    await refuse('billing.connect',{accountId:'synthetic-strap-10',mode:'test',confirm:true,requestId:'synthetic-strap-1'},h.owner);
    await h.enroll(h.owner);
    const seed=await paymentSeed(h);
    const start={packId:seed.pack.id,requestId:'synthetic-strap-checkout',confirm:true};
    edge.setReady(false);assert.equal((await connectPayment(h)).result.ready,false);
    await refuse('billing.checkout.start',start,h.owner,409);
    edge.setReady(true);assert.equal((await connectPayment(h,'synthetic-strap-ready')).result.ready,true);
    const connected=(await view()).connection;assert.equal(connected.accountId,'synthetic-strap-10');assert.equal(connected.review.webhookConfigured,true);
    for(const cookie of [seed.member.cookie,seed.other.cookie])for(const [name,input] of [['billing.connect',{accountId:'synthetic-strap-10',mode:'test',confirm:true,requestId:'synthetic-strap-denied'}],['billing.disconnect',{confirm:true}],['billing.checkout.start',start],['billing.reconcile',{id:'synthetic-strap-none',requestId:'synthetic-strap-none'}]])await refuse(name,input,cookie);
    await refuse('billing.checkout.start',{...start,confirm:false},h.owner,400);
    const checkout=await h.cmd('billing.checkout.start',start);
    assert.equal(checkout.status,'open');assert.equal(new URL(checkout.launchURL).hostname,'checkout.stripe.com');
    assert.equal(checkout.amountCents,5000);assert.deepEqual(checkout.chargeIds,(await h.state()).charges.filter(c=>c.packId===seed.pack.id).map(c=>c.id).sort());
    const postCount=posts();assert.ok(postCount>0);
    for(const requestId of [start.requestId,'synthetic-strap-other-request'])assert.equal((await h.cmd('billing.checkout.start',{...start,requestId})).id,checkout.id);
    assert.equal(posts(),postCount);assert.equal((await view()).invoices.length,1);assert.equal((await h.state()).payments.length,0);
    const before=await h.state(),older=edge.event(checkout.providerSessionId,'checkout.session.completed','old');
    const version=before.version;
    for(const options of [{signature:'0'.repeat(64)},{stamp:1}])assert.equal((await signedEvent(h,older,options)).status,400);
    assert.equal((await signedEvent(h,{...older,account:'synthetic-strap-foreign'})).status,403);
    assert.equal((await h.state()).version,version);assert.equal((await view()).events.length,0);
    const forged={...older,id:'synthetic-strap-forged'};
    assert.equal((await signedEvent(h,forged)).value.status,'exception');
    assert.deepEqual((await view()).exceptions.map(e=>e.code),['billing_webhook_provider_unavailable']);
    const paid=edge.complete(checkout.providerSessionId),success=edge.event(paid.id),invoiceEvent=edge.event(paid.id,'invoice.paid'),intentEvent=edge.event(paid.id,'payment_intent.succeeded');
    assert.equal((await signedEvent(h,success)).status,200);
    let current=await view(),financial=await h.state();
    assert.equal(current.invoices[0].status,'paid');assert.equal(current.invoices[0].balanceCents,0);assert.equal(current.invoices[0].access,5);
    assert.equal(financial.payments.length,1);assert.equal(financial.payments[0].amountCents,5000);assert.equal(financial.payments[0].accountId,connected.accountId);assert.equal(financial.payments[0].paymentIntentId,paid.payment_intent.id);assert.equal(current.invoices[0].providerInvoiceId,paid.invoice.id);
    assert.deepEqual(financial.packs,before.packs,'payment observation cannot manufacture or revoke access');assert.deepEqual(financial.charges,before.charges);
    const receivedCalls=edge.calls.length;
    assert.equal((await signedEvent(h,success)).status,200);assert.equal(edge.calls.length,receivedCalls);
    for(const event of [older,invoiceEvent,intentEvent])assert.equal((await signedEvent(h,event)).status,200);
    assert.equal((await h.state()).payments.length,1);assert.equal(posts(),postCount);
    assert.equal((await signedEvent(h,{...success,data:{object:{...success.data.object,id:'synthetic-strap-changed'}}})).status,409);
    const comparison=(await view()).reconciliations.find(r=>r.paymentRecorded);
    assert.equal(comparison.native.balanceBeforeCents,5000);assert.equal(comparison.native.balanceAfterCents,0);assert.equal(comparison.native.balanceMatches,true);assert.equal(comparison.native.accessBefore.remaining,5);assert.equal(comparison.native.accessAfter.remaining,5);assert.equal(comparison.native.accessMatches,true);
    const memberView=await billingView(h,seed.member.cookie),otherView=await billingView(h,seed.other.cookie);
    assert.deepEqual(memberView.invoices.map(i=>i.id),[checkout.id]);assert.deepEqual(otherView.invoices,[]);assert.deepEqual(otherView.events,[]);assert.deepEqual(otherView.exceptions,[]);
    assert.equal(JSON.stringify(current).includes('synthetic-strap-901'),false);assert.equal(JSON.stringify(current).includes('synthetic-strap-902'),false);assert.equal(JSON.stringify(current).includes('checkout.stripe.com'),false);
    const omitted=await paymentSeed(h,'OmittedMember'),missing=await h.cmd('billing.checkout.start',{...start,packId:omitted.pack.id,requestId:'synthetic-strap-missing'});edge.complete(missing.providerSessionId);
    assert.equal((await h.state()).payments.length,1,'omitted callbacks leave settlement unclaimed');
    await h.cmd('billing.reconcile',{id:missing.id,requestId:'synthetic-strap-reconcile'});
    assert.deepEqual((await view()).invoices.map(i=>[i.status,i.balanceCents,i.access]),[['paid',0,5],['paid',0,5]]);
    await h.cmd('billing.reconcile',{id:missing.id,requestId:'synthetic-strap-reconcile'});assert.equal((await h.state()).payments.length,2);
    const bad=await paymentSeed(h,'MismatchMember'),pending=await h.cmd('billing.checkout.start',{...start,packId:bad.pack.id,requestId:'synthetic-strap-mismatch'});edge.complete(pending.providerSessionId);
    const malformed=[
      b=>b.amount_total=1,b=>b.livemode=true,b=>b.metadata.strapInvoiceId='synthetic-strap-other',
      b=>b.payment_intent.amount_received=1,b=>b.payment_intent.status='processing',b=>b.payment_intent.latest_charge.amount_refunded=1,b=>b.payment_intent.latest_charge.disputed=true,b=>b.invoice.amount_paid=1,b=>b.invoice.status='open',b=>b.invoice=null,
    ];
    for(const [i,change] of malformed.entries()){
      edge.setChange(change);await h.cmd('billing.reconcile',{id:pending.id,requestId:'synthetic-strap-mismatch-'+i});
      current=await view();assert.equal(current.invoices.find(i=>i.id===pending.id).status,'open');assert.equal((await h.state()).payments.length,2);assert.ok(current.exceptions.some(e=>e.invoiceId===pending.id&&e.status==='open'));
    }
    edge.setChange(null);await h.cmd('billing.reconcile',{id:pending.id,requestId:'synthetic-strap-correct'});assert.equal((await h.state()).payments.length,3);
    current=await view();const exceptionCount=current.exceptions.length;assert.ok(current.exceptions.filter(e=>e.invoiceId===pending.id).every(e=>e.status==='resolved'));assert.ok(current.exceptions.some(e=>e.eventId&&e.status==='open'),'unmatched event evidence is retained');
    edge.setChange(b=>{b.status='open';b.payment_status='unpaid';b.payment_intent=null;});
    await h.cmd('billing.reconcile',{id:pending.id,requestId:'synthetic-strap-regression'});assert.equal((await view()).invoices.find(i=>i.id===pending.id).status,'paid');assert.equal((await h.state()).payments.length,3);assert.ok((await view()).exceptions.length>exceptionCount);
    edge.setChange(null);
    const uncertain=await paymentSeed(h,'UncertainPaymentMember');edge.setFailCreate(true);
    const lost=await h.cmd('billing.checkout.start',{...start,packId:uncertain.pack.id,requestId:'synthetic-strap-lost'});assert.equal(lost.status,'uncertain');
    const uncertainPosts=posts();await h.cmd('billing.checkout.start',{...start,packId:uncertain.pack.id,requestId:'synthetic-strap-lost-new'});assert.equal(posts(),uncertainPosts);
    edge.setFailCreate(false);await h.cmd('billing.reconcile',{id:lost.id,requestId:'synthetic-strap-discover'});const found=(await view()).invoices.find(i=>i.id===lost.id);assert.ok(found.providerSessionId);edge.complete(found.providerSessionId);
    await h.cmd('billing.reconcile',{id:lost.id,requestId:'synthetic-strap-found'});assert.equal((await h.state()).payments.length,4);
    const retainedPayments=(await h.state()).payments;
    await h.setAuth({STRIPE_BILLING_TEST_KEY:'synthetic-strap-904',STRIPE_BILLING_WEBHOOK_SECRET:'synthetic-strap-905'});
    assert.equal((await view()).connected,false);const callCount=edge.calls.length;await h.cmd('billing.reconcile',{id:checkout.id,requestId:'synthetic-strap-before-review'},h.owner,409);assert.equal(edge.calls.length,callCount);
    await connectPayment(h,'synthetic-strap-rotate');assert.equal((await view()).connection.connectionId,connected.connectionId);assert.deepEqual((await h.state()).payments,retainedPayments);assert.equal((await view()).invoices[0].accountId,connected.accountId);
    assert.equal((await signedEvent(h,success)).status,400,'revoked signing credential is refused');
    await h.cmd('billing.connect',{accountId:'synthetic-strap-foreign',mode:'test',confirm:true,requestId:'synthetic-strap-replace'},h.owner,409);
    const bundle=(await h.send('/api/strap/exit.json',undefined,h.owner)).value;
    const records=bundle.tables.st_records.map(r=>({kind:r.kind,data:JSON.parse(r.data)}));
    assert.deepEqual(records.filter(r=>r.kind==='stripeInvoice').map(r=>r.data.id).sort(),(await view()).invoices.map(i=>i.id).sort());assert.equal(records.filter(r=>r.kind==='stripeEvent').length,(await view()).events.length);assert.equal(records.filter(r=>r.kind==='billingException').length,(await view()).exceptions.length);assert.ok(!bundle.manifest.schema.some(t=>t.name==='st_payment_connections'));
    if(process.env.STRAP_PROOF_DIR)await(await import('./payments-browser.mjs')).paymentsBrowser(h,{seed,checkout,edge});
    await h.cmd('billing.disconnect',{confirm:true});assert.equal((await view()).connected,false);assert.deepEqual((await h.state()).payments,retainedPayments);
    assert.equal((await signedEvent(h,success,{secret:'synthetic-strap-905'})).status,409);
    await h.cmd('billing.reconcile',{id:checkout.id,requestId:'synthetic-strap-disconnected'},h.owner,409);
    onAccount=async()=>{onAccount=null;await h.cmd('billing.disconnect',{confirm:true});};
    const superseded=await connectPayment(h,'synthetic-strap-inflight');
    assert.equal(superseded.status,'uncertain');assert.equal(superseded.errorCode,'billing_connection_review_superseded');assert.equal((await view()).connected,false,'disconnect invalidates an earlier in-flight review');
    await connectPayment(h,'synthetic-strap-after-disconnect');
    const receipt=await paymentSeed(h,'ReceiptAlreadyMember');await h.cmd('payment.record',{personId:receipt.member.id,amountCents:100,reference:'synthetic-strap-existing-receipt'});
    await refuse('billing.checkout.start',{...start,packId:receipt.pack.id,requestId:'synthetic-strap-already'},h.owner,409);
    const erased=await h.cmd('person.save',{name:'Unused erased person',email:crypto.randomUUID()+'@'+['invalid','local'].join('.'),role:'member',active:true});
    await h.cmd('person.erase',{id:erased.id});
    const unmatched={id:'synthetic-strap-erased-event',object:'event',type:'invoice.paid',livemode:false,created:Math.floor(Date.now()/1000),data:{object:{id:'synthetic-strap-erased-invoice',object:'invoice',metadata:{strapInvoiceId:erased.id}}}};edge.events.set(unmatched.id,unmatched);
    assert.equal((await signedEvent(h,unmatched,{secret:'synthetic-strap-905'})).value.status,'exception');assert.equal((await h.state()).people.some(p=>p.id===erased.id),false);assert.equal((await view()).invoices.some(i=>i.personId===erased.id),false);

  },{auth:paymentAuth,outbound:async request=>{const response=await edge.outbound(request);if(new URL(request.url).pathname==='/v1/account'&&onAccount)await onAccount();return response;},mfa:false});
});


test('Itemized invoices reconcile mixed tenders, line refunds, private copies and audited receipt resends',{timeout:180000},async()=>{
  const {invoiceEdge}=await import('./invoice-edge.mjs'),{invoiceJourney}=await import('./invoice-journey.mjs'),edge=invoiceEdge();
  await run(h=>invoiceJourney(h,edge),{auth:{STRIPE_BILLING_TEST_KEY:'synthetic-strap-901',STRIPE_BILLING_WEBHOOK_SECRET:'synthetic-strap-902',STRIPE_TAX_TEST_KEY:'synthetic-strap-tax'},outbound:edge.outbound});
});
