import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chromium } from '@playwright/test';
import { run } from './harness.mjs';
import { invoiceSeed,invoiceView } from './invoice-journey.mjs';
import { taxInvoice } from './tax-sandbox.mjs';

const key=process.env.STRAP_STRIPE_TEST_KEY,mailKey=process.env.STRAP_MAIL_KEY,from=process.env.STRAP_MAIL_FROM;
assert.ok(key && mailKey && from,'Held TEST billing and controlled mail credentials must be injected');
const recipient=from.includes('<')?from.slice(from.lastIndexOf('<')+1,from.lastIndexOf('>')):from;
const signing=randomBytes(32).toString('hex'),edge=[];
async function provider(path) {
  const r=await fetch('https://api.stripe.com/v1'+path,{headers:{authorization:'Bearer '+key,'Stripe-Version':'2025-06-30.basil'},redirect:'manual'});assert.equal(r.status,200,'Stripe sandbox read');return r.json();
}
async function delivered(delivery) {
  const query=new URLSearchParams({limit:'10',query:'(unique_args[\'rer_delivery_id\']="'+delivery.id+'")'});
  for(let attempt=0;attempt<30;attempt++) {
    const r=await fetch('https://api.sendgrid.com/v3/messages?'+query,{headers:{authorization:'Bearer '+mailKey},redirect:'manual'});assert.equal(r.status,200,'Controlled mail activity read');
    const body=await r.json();assert.ok(Array.isArray(body.messages));
    const found=body.messages.filter(m=>m.to_email===recipient && m.msg_id?.startsWith(delivery.providerMessageId));
    assert.ok(found.length<=1,'one activity identity for the one-recipient application send');
    if(found[0]?.status==='delivered')return {messageId:found[0].msg_id,status:found[0].status,recipientOnFile:true};
    if(found[0]?.status==='not_delivered')throw Error('Controlled receipt was not delivered');
    await new Promise(resolve=>setTimeout(resolve,10000));
  }
  throw Error('Controlled delivery activity is not yet available');
}
const account=await provider('/account');
await run(async h=>{
  const seed=await invoiceSeed(h,'SandboxInvoiceMember',recipient),{member,pack,line,fee}=seed;
  const connected=await h.cmd('billing.connect',{accountId:account.id,mode:'test',confirm:true,requestId:'synthetic-strap-live-connect'});assert.equal(connected.result.ready,true);
  const address={line1:'920 5th Ave',city:'Seattle',state:'WA',postalCode:'98104',country:'US'};
  await h.cmd('tax.config.save',{requestId:'synthetic-strap-live-tax',consent:true,originAddress:address,registeredStates:['WA'],products:[{id:'invoice-fitness',kind:'service',sourceId:pack.id,label:'Fitness class pack and initiation',taxCode:'txcd_50021003'}],exemptions:[]});
  const taxes=[];for(const charge of [line,fee])taxes.push((await taxInvoice(h,charge.id,'invoice-fitness',address,'live-'+charge.id)).invoice.result);
  assert.ok(taxes.every(t=>t.taxCents===0),'provider confirms this controlled fitness classification');
  const external=await h.cmd('payment.record',{personId:member.id,amountCents:4000,reference:'synthetic-strap-live-external'});
  await h.cmd('billing.receipt.allocate',{packId:pack.id,paymentId:external.id,chargeId:line.id,amountCents:4000,requestId:'synthetic-strap-live-allocation'});
  const checkout=await h.cmd('billing.checkout.start',{packId:pack.id,requestId:'synthetic-strap-live-checkout',confirm:true});assert.equal(checkout.amountCents,7000);assert.equal(checkout.status,'open');
  const browser=await chromium.launch({headless:true,executablePath:process.env.STRAP_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']});
  try {
    const context=await browser.newContext({viewport:{width:390,height:1000}});
    try {
      const page=await context.newPage();page.setDefaultTimeout(45000);await page.goto(checkout.launchURL);
      const fill=async(selector,value,required=true)=>{for(const frame of page.frames()){const input=frame.locator(selector).first();if(await input.count()&&await input.isVisible()){await input.fill(value);return;}}if(required)throw Error('Controlled hosted field unavailable: '+selector);};
      await page.locator('#email,input[name="email"]').first().waitFor({state:'visible'});await fill('#email,input[name="email"]',recipient);
      await fill('#cardNumber,input[name="cardNumber"]','4242424242424242');await fill('#cardExpiry,input[name="cardExpiry"]','12/34');await fill('#cardCvc,input[name="cardCvc"]','123');await fill('#billingName,input[name="billingName"]',member.name,false);
      const country=page.locator('#billingCountry,select[name="billingCountry"]').first();if(await country.count()&&await country.isVisible())await country.selectOption('US');await fill('#billingPostalCode,input[name="billingPostalCode"]','98104',false);
      const link=page.locator('#enableStripePass');if(await link.count()&&await link.isVisible()&&await link.isChecked())await link.uncheck();await page.locator('button[type="submit"]').click();await page.waitForURL(url=>url.origin===h.origin,{waitUntil:'commit',timeout:60000});
    }finally{await context.close();}
  }finally{await browser.close();}
  let session;for(let observation=0;observation<30;observation++){session=await provider('/checkout/sessions/'+checkout.providerSessionId+'?expand[]=payment_intent.latest_charge&expand[]=invoice');if(session.invoice?.status==='paid')break;await new Promise(resolve=>setTimeout(resolve,1000));}
  assert.equal(session.invoice?.status,'paid');assert.equal(session.payment_intent.amount_received,7000);await h.cmd('billing.reconcile',{id:checkout.id,requestId:'synthetic-strap-live-reconcile'});
  let invoice=(await invoiceView(h,member.cookie)).invoices[0];assert.deepEqual([invoice.totalCents,invoice.paidCents,invoice.balanceCents],[11000,11000,0]);
  const refund=await h.cmd('billing.line.refund',{packId:pack.id,lineId:fee.id,amountCents:1000,reason:'Controlled original initiation-line refund',requestId:'synthetic-strap-live-refund',confirm:true});
  let final=refund;for(let observation=0;observation<10 && final.status!=='succeeded';observation++){await new Promise(resolve=>setTimeout(resolve,1000));final=await h.cmd('billing.refund.reconcile',{id:refund.id,requestId:'synthetic-strap-live-refund-check'});}assert.equal(final.status,'succeeded');
  invoice=(await invoiceView(h,member.cookie)).invoices[0];assert.deepEqual([invoice.refundedCents,invoice.balanceCents],[1000,0]);
  await h.setAuth({MAIL_PROVIDER:'sendgrid',MAIL_API_KEY:mailKey,MAIL_FROM:from});await h.cmd('mail.connect',{});
  const receipt=invoice.receipts.find(r=>r.tender==='stripe-test-card'),own={packId:pack.id,receiptId:receipt.id,requestId:'synthetic-strap-live-member-copy'};
  const memberCopy=await h.cmd('billing.receipt.send',own,member.cookie);assert.equal(memberCopy.status,'accepted');
  const desk=await h.person('SandboxInvoiceDesk');await h.cmd('staff.access.grant',{personId:desk.id,role:'front-desk',enabled:true,rights:{sale:{enabled:true,scopes:[{memberIds:[member.id],locationIds:['studio'],doors:['all']}]}}});await h.enroll(desk.cookie);
  const resend={...own,requestId:'synthetic-strap-live-staff-copy',requested:true,channel:'phone'},staffCopy=await h.cmd('billing.receipt.send.staff',resend,desk.cookie);assert.equal(staffCopy.status,'accepted');await h.cmd('billing.receipt.send.staff',resend,desk.cookie);
  const deliveries=[];for(const d of [memberCopy,staffCopy])deliveries.push(await delivered(d));
  for(const path of ['/api/strap/invoice.html?id='+pack.id,'/api/strap/receipt.html?id='+receipt.id+'&packId='+pack.id]){const copy=await h.send(path,undefined,member.cookie);assert.equal(copy.status,200);assert.ok(copy.text.includes('$110.00'));assert.ok(copy.text.includes('$70.00'));assert.ok(copy.text.includes('$10.00'));}
  console.log(JSON.stringify({candidateSHA:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),provider:'Stripe TEST and configured Base SendGrid',packId:pack.id,sessionId:checkout.providerSessionId,providerInvoiceId:session.invoice.id,paymentIntentId:session.payment_intent.id,chargeId:session.payment_intent.latest_charge.id,externalRecordedCents:4000,stripeCollectedCents:7000,originalInvoiceCents:11000,providerRefundId:final.providerRefundId,refundedCents:1000,balanceCents:0,taxTransactions:taxes.map(t=>({id:t.providerTransactionId,taxCents:t.taxCents})),deliveries,staffAudit:(await h.state()).staffActions.filter(a=>a.command==='billing.receipt.send.staff').map(a=>({actorRole:a.actorRole,right:a.right,channel:a.channel,staffMade:a.staffMade})),edge}));
},{auth:{STRIPE_BILLING_TEST_KEY:key,STRIPE_BILLING_WEBHOOK_SECRET:signing,STRIPE_TAX_TEST_KEY:key},outbound:async request=>{
  const u=new URL(request.url);assert.ok(u.origin==='https://api.stripe.com' || u.origin==='https://api.sendgrid.com','only controlled provider edges');
  const response=await fetch(request.url,{method:request.method,headers:request.headers,...(request.method==='POST'?{body:await request.text()}:{}),redirect:'manual'});edge.push({method:request.method,path:u.pathname,status:response.status,requestId:response.headers.get('request-id')});return new Response(await response.text(),{status:response.status,headers:response.headers});
}});
