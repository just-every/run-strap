import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { billingEdge } from './billing-sandbox.mjs';

export const paymentAuth={STRIPE_BILLING_TEST_KEY:'synthetic-strap-901',STRIPE_BILLING_WEBHOOK_SECRET:'synthetic-strap-902'};
export function paymentEdge() {
  const setup=billingEdge(),sessions=new Map(),events=new Map(),calls=[];
  let ready=true,accountId='synthetic-strap-10',failCreate=false,change=null;
  const outbound=async request=>{
    const u=new URL(request.url),form=new URLSearchParams(await request.clone().text());
    calls.push({method:request.method,path:u.pathname,form,key:request.headers.get('idempotency-key')});
    const json=body=>Response.json(body,{headers:{'request-id':'synthetic-strap-'+calls.length}});
    if(u.pathname==='/v1/account')return json({id:accountId,object:'account',charges_enabled:ready,payouts_enabled:ready,details_submitted:ready,capabilities:{card_payments:ready?'active':'inactive'}});
    if(u.pathname==='/v1/checkout/sessions' && request.method==='POST' && form.get('mode')==='payment') {
      const id='synthetic-strap-session-'+calls.length,invoiceId=form.get('metadata[strapInvoiceId]');
      assert.ok(invoiceId);assert.equal(form.get('payment_intent_data[metadata][strapInvoiceId]'),invoiceId);assert.equal(form.get('invoice_creation[invoice_data][metadata][strapInvoiceId]'),invoiceId);assert.equal(form.get('invoice_creation[enabled]'),'true');
      const s={id,object:'checkout.session',mode:'payment',payment_method_types:['card'],livemode:false,status:'open',payment_status:'unpaid',amount_total:Number(form.get('line_items[0][price_data][unit_amount]')),currency:'usd',metadata:{strapInvoiceId:invoiceId},client_reference_id:invoiceId,payment_intent:null,invoice:null,url:'https://checkout.stripe.com/c/synthetic-strap-903'};
      sessions.set(id,s);
      if(failCreate)throw new Error('Synthetic interrupted provider response');
      return json(s);
    }
    if(u.pathname==='/v1/checkout/sessions' && request.method==='GET')return json({object:'list',data:[...sessions.values()],has_more:false});
    if(u.pathname.startsWith('/v1/checkout/sessions/')) {
      const s=sessions.get(decodeURIComponent(u.pathname.split('/').at(-1)));
      if(s){const b=structuredClone(s);if(change)change(b);return json(b);}
    }
    if(u.pathname.startsWith('/v1/events/')) {
      const e=events.get(decodeURIComponent(u.pathname.split('/').at(-1)));
      return e?json(e):Response.json({error:{code:'resource_missing'}},{status:404});
    }
    return setup.outbound(request);
  };
  const complete=id=>{
    const s=sessions.get(id);assert.ok(s);
    s.status='complete';s.payment_status='paid';
    s.payment_intent={id:'synthetic-strap-intent-'+id,object:'payment_intent',livemode:false,status:'succeeded',amount:s.amount_total,amount_received:s.amount_total,currency:'usd',metadata:s.metadata,latest_charge:{id:'synthetic-strap-charge-'+id,object:'charge',livemode:false,paid:true,captured:true,refunded:false,payment_method_details:{type:'card'},status:'succeeded',amount:s.amount_total,amount_captured:s.amount_total,amount_refunded:0,disputed:false,currency:'usd',payment_intent:'synthetic-strap-intent-'+id}};
    s.invoice={id:'synthetic-strap-invoice-'+id,object:'invoice',livemode:false,status:'paid',amount_paid:s.amount_total,amount_due:s.amount_total,amount_remaining:0,currency:'usd',metadata:s.metadata};
    return s;
  };
  const event=(sessionId,type='checkout.session.completed',suffix=events.size)=>{
    const s=sessions.get(sessionId),object=type.startsWith('payment_intent.')?s.payment_intent:type.startsWith('invoice.')?s.invoice:s;
    assert.ok(object);const e={id:'synthetic-strap-event-'+suffix,object:'event',type,created:Math.floor(Date.now()/1000)-(Number.isFinite(Number(suffix))?Number(suffix):0),livemode:false,data:{object:structuredClone(object)}};
    events.set(e.id,e);return e;
  };
  return {...setup,outbound,calls,sessions,events,complete,event,setReady:v=>ready=v,setAccount:v=>accountId=v,setFailCreate:v=>failCreate=v,setChange:v=>change=v};
}
export async function signedEvent(h,event,{secret=paymentAuth.STRIPE_BILLING_WEBHOOK_SECRET,stamp=Math.floor(Date.now()/1000),signature,raw=JSON.stringify(event)}={}) {
  const sig=signature ?? createHmac('sha256',secret).update(stamp+'.'+raw).digest('hex');
  const r=await h.mf.dispatchFetch(h.origin+'/api/strap/billing/webhook',{method:'POST',headers:{host:new URL(h.origin).host,'content-type':'application/json','stripe-signature':'t='+stamp+',v1='+sig},body:raw});
  return {status:r.status,value:await r.json()};
}
export async function paymentSeed(h,name='PaymentMember') {
  await h.confirmSetup(h.owner);
  const member=await h.person(name),other=await h.person(name+'Other');
  const draft=await h.cmd('pack.prepare',{personId:member.id,credits:5,amountCents:5000,eligibleServices:['Fitness'],expiresAt:new Date(Date.now()+30*86400000).toISOString()});
  const pack=await h.cmd('pack.approve',{id:draft.id});
  return {member,other,pack};
}
export const billingView=async(h,cookie=h.owner)=>(await h.send('/api/strap/billing',undefined,cookie)).value;
export const connectPayment=(h,requestId='synthetic-strap-connect',accountId='synthetic-strap-10')=>h.cmd('billing.connect',{accountId,mode:'test',confirm:true,requestId});
