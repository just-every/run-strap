import assert from 'node:assert/strict';
import { paymentEdge } from './payment-fixtures.mjs';
import { taxEdge } from './tax-edge.mjs';

export function invoiceEdge() {
  const payment=paymentEdge(),tax=taxEdge(),refunds=new Map(),mail=[];let refundStatus='succeeded',mailStatus=202,refundUnknown=false;
  const outbound=async request=>{
    const url=new URL(request.url);
    if(url.origin==='https://api.sendgrid.com') {
      assert.equal(url.pathname,'/v3/mail/send');mail.push(await request.json());return new Response(null,{status:mailStatus,headers:{'x-message-id':'synthetic-strap-mail-'+mail.length}});
    }
    if(url.pathname.startsWith('/v1/tax/'))return tax.outbound(request);
    if(url.pathname==='/v1/refunds' && request.method==='POST') {
      const form=new URLSearchParams(await request.text()),charge=form.get('charge'),session=[...payment.sessions.values()].find(s=>s.payment_intent?.latest_charge.id===charge);assert.ok(session);
      const body={id:'synthetic-strap-refund-'+refunds.size,object:'refund',amount:Number(form.get('amount')),currency:'usd',charge,payment_intent:session.payment_intent.id,status:refundStatus,metadata:{strapRefundId:form.get('metadata[strapRefundId]')}};
      refunds.set(body.id,body);if(refundUnknown)throw Error('Synthetic unknown refund response');return Response.json(body);
    }
    if(url.pathname==='/v1/refunds')return Response.json({object:'list',data:[...refunds.values()],has_more:false});
    if(url.pathname.startsWith('/v1/refunds/'))return Response.json(refunds.get(url.pathname.split('/').at(-1)));
    return payment.outbound(request);
  };
  return {...payment,outbound,tax,mail,refunds,setRefundStatus:value=>{refundStatus=value},setMailStatus:value=>{mailStatus=value},setRefundUnknown:value=>{refundUnknown=value}};
}
