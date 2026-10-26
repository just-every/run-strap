import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { run } from './harness.mjs';

export async function billingSeed(h,name='AgreementMember') {
  await h.confirmSetup(h.owner);
  const member=await h.person(name), outsider=await h.person(name+'Other');
  const draft=await h.cmd('pack.prepare',{personId:member.id,credits:4,amountCents:8000,expiresAt:new Date(Date.now()+30*86400000).toISOString(),eligibleServices:['Fitness']});
  const pack=await h.cmd('pack.approve',{id:draft.id});
  const preview=await h.cmd('plan.recurring.prepare',{packId:pack.id,intervalMonths:1,requestId:'synthetic-strap-1-'+name});
  const terms=await h.cmd('plan.recurring.accept',{id:preview.id,key:preview.key},member.cookie);
  const prepare={termsId:terms.id,requestId:'synthetic-strap-2-'+name,adultVerified:true,adultEvidenceReference:'synthetic-strap-3',title:'Monthly fitness agreement',documentText:'Four Fitness classes in each agreed calendar-month term. Original cancellation rights and amounts remain as agreed.'};
  return {member,outsider,pack,terms,prepare};
}
export const acceptance=(agreement,signerName='AgreementMember')=>({id:agreement.id,documentHash:agreement.documentHash,financialHash:agreement.financialHash,signerName,confirm:true,authorizeRecurring:true,adultConfirmed:true});
export async function billingSucceeded(h,name,input,cookie=h.owner) {
  const result=await h.cmd(name,input,cookie);
  assert.equal(result.status,'succeeded',JSON.stringify({name,status:result.status,errorCode:result.errorCode}));
  assert.ok(result.result);return result;
}

export function billingEdge() {
  const calls=[],sessions=new Map();let complete=false,uncertain=false,live=false;
  const outbound=async request=>{
    const url=new URL(request.url),form=new URLSearchParams(await request.text());
    calls.push({method:request.method,path:url.pathname,form});
    const json=body=>Response.json(body,{headers:{'request-id':'synthetic-strap-'+calls.length}});
    if(url.pathname === '/v1/account')return json({id:'synthetic-strap-10',object:'account'});
    if(url.pathname === '/v1/checkout/sessions') {
      if(uncertain)return new Response('',{status:503});
      assert.equal(form.get('mode'),'setup');assert.equal(form.get('currency'),'usd');assert.equal(form.get('payment_method_types[0]'),'card');
      const metadata=Object.fromEntries(['agreementId','mandateId','operationId'].map(k=>[k,form.get('metadata['+k+']')]));
      const s={id:'synthetic-strap-'+(100+calls.length),object:'checkout.session',livemode:live,mode:'setup',status:'open',expires_at:Math.floor(Date.now()/1000)+3600,client_reference_id:form.get('client_reference_id'),metadata,url:'https://checkout.stripe.com/c/synthetic-strap-100'};
      sessions.set(s.id,s);return json(s);
    }
    const s=sessions.get(decodeURIComponent(url.pathname.split('/').at(-1)));assert.ok(s);
    return json({...s,status:complete?'complete':'open',setup_intent:complete?{id:'synthetic-strap-200',object:'setup_intent',status:'succeeded',livemode:live,usage:'off_session',metadata:s.metadata,customer:null,payment_method:{id:'synthetic-strap-201',object:'payment_method',livemode:live,type:'card',card:{brand:'visa',last4:'4242',exp_month:12,exp_year:2030,fingerprint:'must-not-be-retained'},billing_details:{name:'must-not-be-retained'}}}:null});
  };
  return {calls,outbound,setComplete:v=>complete=v,setUncertain:v=>uncertain=v,setLive:v=>live=v};
}

async function sandbox() {
  const key=process.env.STRAP_STRIPE_TEST_KEY;
  assert.ok(key && /^(?:sk|rk)_test_/.test(key),'Held Stripe TEST key required through the environment helper');
  const accountResponse=await fetch('https://api.stripe.com/v1/account',{headers:{authorization:'Bearer '+key},redirect:'manual'});
  assert.equal(accountResponse.status,200);const account=await accountResponse.json(),edge=[];
  await run(async h=>{
    const seed=await billingSeed(h);
    const connection=await billingSucceeded(h,'billing.connect',{accountId:account.id,mode:'test',confirm:true,requestId:'synthetic-strap-10'});
    const agreement=await h.cmd('billing.agreement.prepare',seed.prepare);
    await h.cmd('billing.agreement.accept',acceptance(agreement),seed.member.cookie);
    const input={id:agreement.id,requestId:'synthetic-strap-11'};
    const setup=await billingSucceeded(h,'billing.setup.start',input,seed.member.cookie);
    assert.equal(new URL(setup.launchURL).hostname,'checkout.stripe.com');
    const before=edge.filter(e=>e.method === 'POST').length;
    const replay=await h.cmd('billing.setup.start',input,seed.member.cookie);assert.equal(replay.result.id,setup.result.id);assert.ok(!replay.launchURL);assert.equal(edge.filter(e=>e.method === 'POST').length,before);
    const incomplete=await h.cmd('billing.setup.complete',{id:agreement.id,setupId:setup.result.id,requestId:'synthetic-strap-12'},seed.member.cookie);
    assert.equal(incomplete.status,'incomplete');
    const state=(await h.send('/api/strap/billing',undefined,seed.member.cookie)).value;
    assert.equal(state.methods.length,0);assert.equal(state.mandates[0].methodAuthorized,false);
    await h.cmd('billing.mandate.revoke',{id:agreement.id},seed.member.cookie);
    assert.equal((await h.send('/api/strap/command',{name:'billing.setup.complete',input:{id:agreement.id,setupId:setup.result.id,requestId:'synthetic-strap-13'}},seed.member.cookie)).status,409);
    console.log(JSON.stringify({at:new Date().toISOString(),provider:'Stripe TEST',accountId:connection.result.accountId,sessionId:setup.result.providerSessionId,agreementId:agreement.id,originalAgreementHash:agreement.originalAgreementHash,documentHash:agreement.documentHash,edge,hostedSetupCreated:true,memberCompletedHostedSetup:false,storedMethodAuthorized:false,paymentsCollected:0,replayProviderPosts:0,revocationRefusedNextRequest:true,scope:'Signed-agreement and hosted setup foundation; real member hosted completion and recurring collection remain unproved'}));
  },{auth:{STRIPE_BILLING_TEST_KEY:key},outbound:async request=>{
    const url=new URL(request.url);assert.equal(url.origin,'https://api.stripe.com');
    assert.ok(url.pathname === '/v1/account' || url.pathname.startsWith('/v1/checkout/sessions'));
    const response=await fetch(request.url,{method:request.method,headers:{authorization:request.headers.get('authorization'),'content-type':'application/x-www-form-urlencoded','Stripe-Version':request.headers.get('stripe-version'),...(request.headers.get('idempotency-key')?{'Idempotency-Key':request.headers.get('idempotency-key')}:{})},...(request.method === 'POST'?{body:await request.text()}:{}),redirect:'manual'});
    edge.push({method:request.method,path:url.pathname,status:response.status,requestId:response.headers.get('request-id')});
    return new Response(await response.text(),{status:response.status,headers:{'content-type':'application/json','request-id':response.headers.get('request-id')??''}});
  }});
}
if(import.meta.url === pathToFileURL(process.argv[1]??'').href)await sandbox();
