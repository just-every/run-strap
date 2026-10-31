import assert from 'node:assert/strict';
import { run } from './harness.mjs';
import { paymentEdge,paymentAuth,paymentSeed,connectPayment } from './payment-fixtures.mjs';
import { privacyDecision,verifiedPrivacyRequest } from './privacy-journey.mjs';
import { payoutsBrowser } from './payout-reconciliation-browser.mjs';

export const reportPath='/api/strap/billing/payouts.json';
export const readPayouts=async(h,cookie=h.owner)=>{const r=await h.send(reportPath,undefined,cookie);assert.equal(r.status,200,r.text);return r.value;};
export function reconciliationEdge() {
  const edge=paymentEdge(),reads=[];let change=null,onRead=null;
  const transactions=()=>[...edge.sessions.values()].filter(s=>s.payment_intent).map((s,i)=>({id:'synthetic-strap-balance-'+s.id,object:'balance_transaction',source:s.payment_intent.latest_charge.id,currency:'usd',amount:s.amount_total,fee:175+i*25,net:s.amount_total-175-i*25,type:'charge',status:i?'pending':'available',created:1800000000,available_on:1800086400}));
  const payout=()=>({id:'synthetic-strap-payout-1',object:'payout',livemode:false,currency:'usd',amount:9625,status:'in_transit',automatic:true,balance_transaction:'synthetic-strap-payout-balance',created:1800000000,arrival_date:1800172800,destination:{secretSentinel:'synthetic-strap-private-bank'}});
  const outbound=async request=>{
    const u=new URL(request.url);
    if(['/v1/payouts','/v1/balance_transactions'].includes(u.pathname)||u.pathname.startsWith('/v1/charges/')){
      assert.equal(request.method,'GET','reconciliation can never create a charge or payout');reads.push({method:request.method,path:u.pathname,query:u.search});
      if(onRead)await onRead(request);
      let body;
      if(u.pathname==='/v1/payouts')body={object:'list',data:[payout()],has_more:false};
      else if(u.pathname==='/v1/balance_transactions') {assert.equal(u.searchParams.get('payout'),'synthetic-strap-payout-1');body={object:'list',data:transactions(),has_more:false};}
      else {
        const s=[...edge.sessions.values()].find(s=>s.payment_intent?.latest_charge.id===decodeURIComponent(u.pathname.split('/').at(-1)));assert.ok(s,'canonical charge source exists');
        body={...structuredClone(s.payment_intent.latest_charge),balance_transaction:transactions().find(t=>t.source===s.payment_intent.latest_charge.id),secretSentinel:'synthetic-strap-private-charge'};
      }
      const response=change?await change({request,u,body}):null;
      return response??Response.json(body);
    }
    return edge.outbound(request);
  };
  return {...edge,outbound,reads,transactions,setReconciliationChange:f=>change=f,setReconciliationRead:f=>onRead=f};
}
export async function seedReconciliation(h,edge) {
  await connectPayment(h);
  const seeds=[];
  for(const name of ['PayoutMember','PayoutOther']) {
    const seed=await paymentSeed(h,name),checkout=await h.cmd('billing.checkout.start',{packId:seed.pack.id,requestId:'synthetic-strap-'+name,confirm:true});
    edge.complete(checkout.providerSessionId);await h.cmd('billing.reconcile',{id:checkout.id,requestId:'synthetic-strap-'+name+'-paid'});seeds.push({...seed,checkout});
  }
  return seeds;
}
export async function payoutReconciliationCases() {
  const edge=reconciliationEdge();
  await run(async h=>{
    await h.confirmSetup(h.owner);
    for(const door of ['/app/payouts',reportPath,'/api/strap/billing/payouts.csv']) {const r=await h.send(door,undefined,h.owner);assert.equal(r.status,403);assert.equal(door.startsWith('/app')?r.headers.get('x-strap-refusal'):r.value.error,'mfa_enrollment_required');}
    assert.equal((await h.cmd('billing.payouts.refresh',{confirm:true,requestId:'synthetic-strap-pre-factor'},h.owner,403)).error,'mfa_enrollment_required');
    await h.enroll(h.owner);
    const seeds=await seedReconciliation(h,edge),financial=await h.state(),postCount=edge.calls.filter(c=>c.method==='POST').length;
    const before=await readPayouts(h);assert.equal(before.totals.feeCents,null);assert.equal(before.cards.length,2);
    const input={confirm:true,requestId:'synthetic-strap-refresh-1'};
    const refreshed=await h.cmd('billing.payouts.refresh',input);assert.equal(refreshed.status,'observed');
    let report=await readPayouts(h);
    assert.deepEqual([report.totals.grossCents,report.totals.feeCents,report.totals.netCents],[10000,375,9625]);
    assert.deepEqual(report.cards.map(c=>c.providerStatus).sort(),['available','pending']);
    assert.ok(report.cards.every(c=>c.observedAt && c.providerCreatedAt && c.availableAt && c.accountId==='synthetic-strap-10'));
    for(const seed of seeds) {const card=report.cards.find(c=>c.invoiceId===seed.checkout.id);assert.equal(card.providerChargeId,edge.sessions.get(seed.checkout.providerSessionId).payment_intent.latest_charge.id);assert.equal(card.grossCents,5000);assert.ok(card.paymentId);}
    assert.deepEqual([report.payouts[0].amountCents,report.payouts[0].mappedNetCents,report.payouts[0].providerDifferenceCents,report.payouts[0].bankDepositConfirmed,report.payouts[0].depositStatus],[9625,9625,0,false,'unmatched']);
    assert.equal(report.bankDepositConfirmation,'unavailable');assert.doesNotMatch(JSON.stringify(report),/synthetic-strap-private/);
    const version=(await h.state()).version,readCount=edge.reads.length,calls=edge.calls.length;
    assert.deepEqual(await h.cmd('billing.payouts.refresh',input),refreshed);assert.equal(edge.reads.length,readCount);assert.equal((await h.state()).version,version);
    for(const path of ['/app/payouts',reportPath,'/api/strap/billing/payouts.csv'])assert.equal((await h.send(path,undefined,h.owner)).status,200);
    assert.equal(edge.reads.length,readCount);assert.equal(edge.calls.length,calls);assert.equal((await h.state()).version,version,'page and downloads are pure');
    await payoutsBrowser(h,report);
    const unverified=await h.signIn(h.auth.OWNER_EMAIL);assert.equal((await h.send(reportPath,undefined,unverified)).value.error,'mfa_required');await h.cmd('billing.payouts.refresh',input,unverified,403);
    const denied=async cookie=>{const version=(await h.state()).version,n=edge.reads.length,m=edge.calls.length;for(const door of ['/app/payouts',reportPath,'/api/strap/billing/payouts.csv'])assert.equal((await h.send(door,undefined,cookie)).status,403);await h.cmd('billing.payouts.refresh',input,cookie,403);assert.equal((await h.state()).version,version);assert.equal(edge.reads.length,n);assert.equal(edge.calls.length,m);};
    await denied(seeds[0].member.cookie);
    for(const role of ['finance','manager','front-desk','instructor']) {
      const actor=await h.person('Payout'+role.replace('-',''),role==='instructor'?'instructor':'member');
      await h.cmd('staff.access.grant',{personId:actor.id,role,enabled:true,rights:{}});await h.enroll(actor.cookie);await denied(actor.cookie);
    }
    const agent=await h.cmd('agent.create',{label:'Synthetic payout preparation'});
    const agentResponse=await h.send('/api/strap/agent/command',{name:'billing.payouts.refresh',input},'',{authorization:'Bearer '+agent.token});assert.equal(agentResponse.status,403);
    edge.setAccount('synthetic-strap-foreign');const foreignVersion=(await h.state()).version;
    assert.equal((await h.cmd('billing.payouts.refresh',{...input,requestId:'synthetic-strap-foreign'},h.owner,409)).error,'payout_merchant_mismatch');assert.equal((await h.state()).version,foreignVersion);edge.setAccount('synthetic-strap-10');
    edge.setReconciliationChange(({u,body})=>{
      if(u.pathname==='/v1/payouts') {
        if(!u.searchParams.has('starting_after'))body.has_more=true;
        else {assert.equal(u.searchParams.get('starting_after'),'synthetic-strap-payout-1');body.data=[{...body.data[0],id:'synthetic-strap-payout-2',automatic:false,status:'pending',balance_transaction:null,amount:1200}];}
      }
    });
    assert.equal((await h.cmd('billing.payouts.refresh',{...input,requestId:'synthetic-strap-paged'})).status,'observed');
    report=await readPayouts(h);assert.equal(report.payouts.length,2);assert.equal(report.payouts.find(p=>p.providerPayoutId==='synthetic-strap-payout-2').mappingError,'payout_membership_unavailable');
    edge.setReconciliationChange(null);
    edge.setReconciliationChange(({u,body})=>{if(u.pathname.startsWith('/v1/charges/')&&body.balance_transaction.fee===200)body.balance_transaction.currency='cad';});
    await h.cmd('billing.payouts.refresh',{...input,requestId:'synthetic-strap-currencies'});
    report=await readPayouts(h);assert.equal(report.totals.currency,null);assert.equal(report.totals.grossCents,null);assert.equal(report.totals.observedNetCents,null);
    assert.deepEqual(report.totals.byCurrency,[{currency:'cad',grossCents:5000,feeCents:200,netCents:4800,cardCount:1},{currency:'usd',grossCents:5000,feeCents:175,netCents:4825,cardCount:1}]);
    assert.ok(report.cards.every(c=>c.sourceCurrency==='usd'&&c.sourceAmountCents===5000));
    assert.equal(report.payouts.find(p=>p.providerPayoutId==='synthetic-strap-payout-1').providerDifferenceCents,null);
    assert.equal(report.payouts.find(p=>p.providerPayoutId==='synthetic-strap-payout-1').unmappedTransactionCount,1);
    edge.setReconciliationChange(null);
    console.log('PROBE BILL-011 currencies: USD original charges with CAD and USD settlement observations -> separate currency totals; no combined net or cross-currency payout match.');
    const faulty=[
      ['missing-fee',({u,body})=>{if(u.pathname.startsWith('/v1/charges/'))delete body.balance_transaction.fee;}],
      ['wrong-source',({u,body})=>{if(u.pathname.startsWith('/v1/charges/'))body.balance_transaction.source='synthetic-strap-foreign-charge';}],
      ['refunded',({u,body})=>{if(u.pathname.startsWith('/v1/charges/'))body.amount_refunded=100;}],
      ['refused',({u})=>u.pathname.startsWith('/v1/charges/')?Response.json({error:{code:'synthetic-strap-private-error'}},{status:403}):null],
      ['payout-refused',({u})=>u.pathname==='/v1/payouts'?Response.json({error:{code:'synthetic-strap-private-error'}},{status:403}):null],
      ['pagination',({u,body})=>{if(u.pathname==='/v1/payouts'){body.has_more=true;body.data=[];}}],
    ];
    for(const [name,change] of faulty) {
      edge.setReconciliationChange(change);
      const r=await h.cmd('billing.payouts.refresh',{...input,requestId:'synthetic-strap-'+name});assert.equal(r.status,'incomplete');
      report=await readPayouts(h);
      if(['pagination','payout-refused'].includes(name)){assert.equal(report.latest.payoutError,name==='pagination'?'payout_pagination_incomplete':'payout_provider_read_unavailable');assert.equal(report.payouts[0].stale,true);}
      else {assert.equal(report.totals.feeCents,null);assert.equal(report.totals.netCents,null);assert.equal(report.cards.filter(c=>c.status==='unresolved').length,2);}
      assert.doesNotMatch(JSON.stringify(report),/synthetic-strap-private/);
    }
    edge.setReconciliationChange(null);
    let release,entered;const gate=new Promise(r=>release=r),arrived=new Promise(r=>entered=r);let wait=true;
    edge.setReconciliationRead(async()=>{if(wait){wait=false;entered();await gate;}});
    const concurrent={...input,requestId:'synthetic-strap-concurrent'},pending=h.cmd('billing.payouts.refresh',concurrent);await arrived;
    const count=edge.reads.length;assert.equal((await h.cmd('billing.payouts.refresh',concurrent)).status,'refreshing');assert.equal(edge.reads.length,count);release();assert.equal((await pending).status,'observed');edge.setReconciliationRead(null);
    edge.setReconciliationRead(async()=>edge.setAccount('synthetic-strap-foreign'));
    const retainedCards=(await readPayouts(h)).cards.map(c=>c.id);
    await h.cmd('billing.payouts.refresh',{...input,requestId:'synthetic-strap-changed-merchant'},h.owner,409);
    edge.setReconciliationRead(null);edge.setAccount('synthetic-strap-10');
    assert.deepEqual((await readPayouts(h)).cards.map(c=>c.id),retainedCards,'merchant changing during a read cannot retain observations');
    const after=await h.state();for(const key of ['charges','payments','packs'])assert.deepEqual(after[key],financial[key]);assert.equal(edge.calls.filter(c=>c.method==='POST').length,postCount);
    const erase=await verifiedPrivacyRequest(h,seeds[0].member,'erasure','-payout');
    const review=await h.cmd('privacy.erase.prepare',{id:erase.id,...privacyDecision});
    await h.cmd('privacy.erase.confirm',{id:review.id,confirm:true});
    const erasedReport=await readPayouts(h);assert.equal(erasedReport.cards.length,1);assert.ok(!JSON.stringify(erasedReport).includes(seeds[0].member.email));
    await h.cmd('billing.payouts.refresh',{...input,requestId:'synthetic-strap-after-erasure'});
    assert.equal((await readPayouts(h)).cards.length,1);await h.cmd('billing.reconcile',{id:seeds[0].checkout.id,requestId:'synthetic-strap-erased-replay'},h.owner,404);
    await h.cmd('billing.payouts.refresh',input);assert.equal((await readPayouts(h)).cards.length,1,'captured refresh cannot resurrect an erased source');
    console.log('PROBE BILL-011 erasure: verified member erasure and captured refresh replay -> retired observation withheld, canonical charge replay refused, no identity resurrection.');
    await h.cmd('billing.disconnect',{confirm:true});
    report=await readPayouts(h);assert.equal(report.connected,false);assert.equal(report.cards.length,1);const n=edge.reads.length;
    await h.cmd('billing.payouts.refresh',input,h.owner,409);assert.equal(edge.reads.length,n);
    console.log('PROBE BILL-011 source fees: two paid TEST card receipts -> gross 10000, fees 375, net 9625 cents with original charge and invoice links; pending retained.');
    console.log('PROBE BILL-011 payouts: observed payout 9625 cents -> source net 9625, difference 0; bank deposit unmatched and confirmation unavailable.');
    console.log('PROBE BILL-011 reads: page, JSON and CSV -> matching observations, zero writes and zero provider requests; 1440 and 390 browser proof.');
    console.log('PROBE BILL-011 refresh: replay and concurrent refresh -> one reservation and no repeated provider reads; missing fees, changed sources, refund and refused reads stay unresolved; incomplete pagination stays visible.');
    console.log('PROBE BILL-011 authority: owner without factor, unverified session, member, finance, manager, front desk, instructor, agent and foreign merchant -> refused without financial changes; disconnect prevents refresh.');
  },{mfa:false,auth:paymentAuth,outbound:edge.outbound});
  const revokedEdge=reconciliationEdge();
  await run(async h=>{
    await seedReconciliation(h,revokedEdge);
    revokedEdge.setReconciliationRead(async()=>{assert.equal((await h.send('/app/action?name=session.signout',{},h.owner)).status,303);revokedEdge.setReconciliationRead(null);});
    const response=await h.send('/api/strap/command',{name:'billing.payouts.refresh',input:{confirm:true,requestId:'synthetic-strap-revoked-session'}},h.owner);
    assert.equal(response.status,401);assert.equal(response.value.error,'owner_session_required');
    assert.equal((await h.db.prepare("SELECT count(*) AS n FROM st_records WHERE kind IN ('cardBalanceObservation','payoutObservation')").first()).n,0);
    assert.equal((await h.send(reportPath,undefined,h.owner)).status,401);
    console.log('PROBE BILL-011 session revocation: sign out while provider read is in flight -> 401, zero observations committed and subsequent reads refused.');
  },{auth:paymentAuth,outbound:revokedEdge.outbound});
}
