import assert from 'node:assert/strict';
import { connectPayment } from './payment-fixtures.mjs';
import { taxInvoice } from './tax-sandbox.mjs';

export const invoiceView=async(h,cookie=h.owner)=>(await h.send('/api/strap/invoices',undefined,cookie)).value;
export async function invoiceSeed(h,name='InvoiceMember') {
  await h.confirmSetup(h.owner);
  await h.cmd('studio.save',{location:'Brooklyn',legalName:'Larkhill Movement LLC',timeZone:'America/New_York',phone:'7185550100',address:{line1:'100 Movement Street',city:'Brooklyn',region:'NY',postalCode:'11201',country:'US'},receiptDetails:'Please retain this itemized receipt.'});
  const member=await h.person(name),other=await h.person(name+'Other');
  const pack=await h.cmd('pack.approve',{id:(await h.cmd('pack.prepare',{personId:member.id,credits:10,amountCents:10000,initiationFeeCents:1000,expiresAt:'2099-12-31T00:00:00Z'})).id});
  const charges=(await h.state()).charges.filter(c=>c.packId===pack.id),line=charges.find(c=>!c.reason),fee=charges.find(c=>c.reason==='initiation_fee');
  return {member,other,pack,line,fee};
}
export async function invoiceJourney(h,edge) {
  const seed=await invoiceSeed(h),{member,other,pack,line,fee}=seed;
  await connectPayment(h);
  const address={line1:'100 Fitness Avenue',city:'Seattle',state:'WA',postalCode:'98104',country:'US'};
  const config={requestId:'synthetic-strap-tax-config',consent:true,originAddress:address,registeredStates:['WA'],products:[{id:'invoice-pack',kind:'service',sourceId:pack.id,label:'Fitness pack',taxCode:'txcd_50021003'}],exemptions:[]};
  await h.cmd('tax.config.save',config);
  const tax=await taxInvoice(h,line.id,'invoice-pack',address,'invoice');assert.equal(tax.invoice.result.taxCents,0);
  const feeTax=await taxInvoice(h,fee.id,'invoice-pack',address,'invoice-fee');assert.equal(feeTax.invoice.result.taxCents,0);
  let invoice=(await invoiceView(h)).invoices[0];assert.equal(invoice.status,'invoiced');assert.equal(invoice.totalCents,11000);assert.equal(invoice.taxStatus,'retained_provider_evidence');assert.equal(invoice.taxCents,0);assert.equal(invoice.discountCents,0);
  assert.deepEqual(invoice.lines.map(l=>[l.id,l.amountCents]),[[line.id,10000],[fee.id,1000],[tax.invoice.result.taxChargeId,0],[feeTax.invoice.result.taxChargeId,0]]);
  const external=await h.cmd('payment.record',{personId:member.id,amountCents:4000,reference:'synthetic-strap-external'});
  await h.cmd('billing.checkout.start',{packId:pack.id,confirm:true,requestId:'synthetic-strap-unallocated'},h.owner,409);
  const allocate={packId:pack.id,paymentId:external.id,chargeId:line.id,amountCents:4000,requestId:'synthetic-strap-allocate'};
  const allocation=await h.cmd('billing.receipt.allocate',allocate);assert.deepEqual(await h.cmd('billing.receipt.allocate',allocate),allocation);
  await h.cmd('billing.receipt.allocate',{...allocate,requestId:'synthetic-strap-overallocate',amountCents:1},h.owner,409);
  const checkout=await h.cmd('billing.checkout.start',{packId:pack.id,confirm:true,requestId:'synthetic-strap-mixed'});assert.equal(checkout.amountCents,7000);assert.equal(checkout.originalAmountCents,11000);
  invoice=(await invoiceView(h)).invoices[0];assert.equal(invoice.status,'pending');assert.equal(invoice.balanceCents,7000);assert.equal(invoice.receipts[0].status,'externally recorded');
  edge.complete(checkout.providerSessionId);await h.cmd('billing.reconcile',{id:checkout.id,requestId:'synthetic-strap-reconcile'});
  invoice=(await invoiceView(h)).invoices[0];assert.deepEqual([invoice.paidCents,invoice.totalCents,invoice.balanceCents,invoice.status],[11000,11000,0,'collected']);
  assert.deepEqual(invoice.receipts.map(r=>[r.amountCents,r.tender,r.status]),[[4000,'external','externally recorded'],[7000,'stripe-test-card','collected']]);
  assert.deepEqual(invoice.receipts[1].allocations.map(a=>[a.lineId,a.amountCents]),[[fee.id,1000],[line.id,6000]].sort((a,b)=>a[0].localeCompare(b[0])));
  const stripeReceipt=invoice.receipts.find(r=>r.tender==='stripe-test-card');
  const before=(await h.state()).version;
  for(const [name,input] of [['billing.receipt.allocate',allocate],['billing.line.refund',{packId:pack.id,lineId:fee.id,amountCents:1000,confirm:true,reason:'Requested line refund',requestId:'synthetic-strap-refund'}]])await h.cmd(name,input,member.cookie,403);
  assert.equal((await h.state()).version,before);
  const refund={packId:pack.id,lineId:fee.id,amountCents:1000,confirm:true,reason:'Member requested the initiation line refund',requestId:'synthetic-strap-refund'};
  edge.setRefundStatus('pending');const pending=await h.cmd('billing.line.refund',refund);assert.equal(pending.status,'pending');assert.equal((await invoiceView(h)).invoices[0].refundedCents,0);
  assert.deepEqual(await h.cmd('billing.line.refund',refund),pending);assert.equal(edge.refunds.size,1);
  await h.cmd('billing.line.refund',{...refund,amountCents:1,requestId:'synthetic-strap-second-refund'},h.owner,409);
  edge.refunds.get(pending.providerRefundId).status='succeeded';const refunded=await h.cmd('billing.refund.reconcile',{id:pending.id,requestId:'synthetic-strap-refund-check'});assert.equal(refunded.status,'succeeded');
  await h.cmd('billing.refund.reconcile',{id:pending.id,requestId:'synthetic-strap-refund-check'});
  invoice=(await invoiceView(h)).invoices[0];assert.deepEqual([invoice.totalCents,invoice.paidCents,invoice.refundedCents,invoice.balanceCents,invoice.status],[11000,11000,1000,0,'refunded']);
  assert.equal((await h.state()).payments.filter(p=>p.invoiceRefundId===pending.id).length,1);assert.equal(invoice.lines.find(l=>l.id===fee.id).refundedCents,1000);
  const own=(await invoiceView(h,member.cookie)).invoices;assert.deepEqual(own.map(i=>i.id),[pack.id]);assert.deepEqual((await invoiceView(h,other.cookie)).invoices,[]);
  for(const path of ['/api/strap/invoice.html?id='+pack.id,'/api/strap/receipt.html?id='+stripeReceipt.id+'&packId='+pack.id]) {
    const copy=await h.send(path,undefined,member.cookie);assert.equal(copy.status,200);assert.match(copy.headers.get('content-disposition'),/attachment/);assert.ok(copy.text.includes('Larkhill Movement LLC'));assert.ok(copy.text.includes('One-time initiation fee'));assert.ok(copy.text.includes('$110.00'));assert.ok(copy.text.includes('$10.00'));assert.ok(copy.text.includes('$0.00'));assert.equal((await h.send(path,undefined,other.cookie)).status,404);assert.equal((await h.send(path)).status,401);
  }
  await h.setAuth({MAIL_PROVIDER:'sendgrid',MAIL_FROM:['receipts','studio.example'].join('@'),MAIL_API_KEY:'synthetic-strap-mail'});await h.cmd('mail.connect',{});
  const send={packId:pack.id,receiptId:stripeReceipt.id,requestId:'synthetic-strap-own-copy'};
  const delivered=await h.cmd('billing.receipt.send',send,member.cookie);assert.equal(delivered.status,'accepted');assert.equal(edge.mail.length,1);assert.deepEqual(edge.mail[0].personalizations[0].to,[{email:member.email}]);assert.ok(edge.mail[0].content.some(p=>p.value.includes('Stripe') || p.value.includes('stripe-test-card')));
  assert.deepEqual(await h.cmd('billing.receipt.send',send,member.cookie),delivered);assert.equal(edge.mail.length,1);
  await h.cmd('billing.receipt.send',{...send,requestId:'synthetic-strap-override',email:other.email},member.cookie,400);await h.cmd('billing.receipt.send',send,other.cookie,404);assert.equal(edge.mail.length,1);
  const desk=await h.person('InvoiceDesk');await h.enroll(desk.cookie);
  const grant=rights=>h.cmd('staff.access.grant',{personId:desk.id,role:'front-desk',enabled:true,rights:Object.fromEntries(rights.map(right=>[right,{enabled:true,scopes:[{memberIds:[member.id],locationIds:['studio'],doors:['all']}]}]))});
  const staffSend={...send,requestId:'synthetic-strap-staff-copy',requested:true,channel:'phone'};
  await grant(['member-record']);await h.cmd('billing.receipt.send.staff',staffSend,desk.cookie,403);
  await grant(['sale']);const staff=await h.cmd('billing.receipt.send.staff',staffSend,desk.cookie);assert.equal(staff.status,'accepted');assert.equal(edge.mail.length,2);assert.deepEqual(edge.mail[1].personalizations[0].to,[{email:member.email}]);
  await h.cmd('billing.receipt.send.staff',staffSend,desk.cookie);assert.equal(edge.mail.length,2);
  const audit=(await h.state()).staffActions.filter(a=>a.command==='billing.receipt.send.staff' && a.requestId===staffSend.requestId);assert.equal(audit.length,1);assert.deepEqual([audit[0].staffMade,audit[0].right,audit[0].actorRole,audit[0].channel,audit[0].personId],[true,'sale','front-desk','phone',member.id]);assert.ok(audit[0].before&&audit[0].after);
  assert.equal((await h.send('/api/strap/invoice.html?id='+pack.id,undefined,desk.cookie)).status,200);
  if(process.env.STRAP_BILLING_BROWSER==='1' || process.env.STRAP_PROOF_DIR)await(await import('./invoice-browser.mjs')).invoiceBrowser(h,{...seed,desk,stripeReceipt,pending,staffSend});
  await grant(['member-record']);await h.cmd('billing.receipt.send.staff',staffSend,desk.cookie,403);assert.equal((await h.send('/api/strap/invoice.html?id='+pack.id,undefined,desk.cookie)).status,403);assert.equal(edge.mail.length>=2,true);
  edge.setMailStatus(503);const uncertain=await h.cmd('billing.receipt.send',{...send,requestId:'synthetic-strap-uncertain-copy'},member.cookie);assert.equal(uncertain.status,'uncertain');const n=edge.mail.length;await h.cmd('billing.receipt.send',{...send,requestId:'synthetic-strap-uncertain-copy'},member.cookie);assert.equal(edge.mail.length,n);
  const portable=(await h.send('/api/strap/exit.json',undefined,h.owner)).value;assert.ok(!('st_invoice_dispatches' in portable.tables));const retained=portable.tables.st_records.map(r=>({kind:r.kind,data:JSON.parse(r.data)}));assert.equal(retained.filter(r=>r.kind==='invoiceRefund').length,1);assert.ok(retained.some(r=>r.kind==='invoiceDelivery'));assert.ok(retained.some(r=>r.kind==='contractPrepayment' && r.data.paymentId===external.id));
  await h.setAuth({MAIL_API_KEY:'synthetic-strap-rotated'});await h.cmd('billing.receipt.send',{...send,requestId:'synthetic-strap-stale-mail'},member.cookie,409);assert.equal(edge.mail.length,n);await h.cmd('mail.connect',{});
  await h.cmd('person.save',{id:member.id,name:member.name,email:member.email,role:'member',active:false});await h.cmd('billing.receipt.send',send,member.cookie,403);assert.equal(edge.mail.length,n);
}
