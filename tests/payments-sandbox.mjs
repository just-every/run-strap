import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir,readFile } from 'node:fs/promises';
import { join,extname } from 'node:path';
import { chromium } from '@playwright/test';
import { run } from './harness.mjs';
import { paymentSeed,billingView,signedEvent } from './payment-fixtures.mjs';

const key=process.env.STRAP_STRIPE_TEST_KEY;
assert.ok(key,'A held Stripe TEST credential is required through the injector');
const signing=randomBytes(32).toString('hex'),edge=[],started=Math.floor(Date.now()/1000)-60;
async function provider(path) {
  const r=await fetch('https://api.stripe.com/v1'+path,{headers:{authorization:'Bearer '+key,'Stripe-Version':'2025-06-30.basil'},redirect:'manual'});
  assert.equal(r.status,200,'Stripe read '+path.split('?')[0]);return r.json();
}
const account=await provider('/account');
assert.equal(account.charges_enabled,true);assert.equal(account.payouts_enabled,true);assert.equal(account.details_submitted,true);assert.equal(account.capabilities.card_payments,'active');
await run(async h=>{
  const seed=await paymentSeed(h,'SandboxFitnessMember');
  const connected=await h.cmd('billing.connect',{accountId:account.id,mode:'test',confirm:true,requestId:'synthetic-strap-live-connect'});
  assert.equal(connected.result.ready,true);
  const checkout=await h.cmd('billing.checkout.start',{packId:seed.pack.id,requestId:'synthetic-strap-live-checkout',confirm:true});
  assert.equal(checkout.status,'open');assert.equal(checkout.amountCents,5000);
  const browser=await chromium.launch({headless:true,executablePath:process.env.STRAP_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']});
  try {
    const context=await browser.newContext({viewport:{width:390,height:1000}});
    try {
      await context.route(h.origin+'/**',async route=>{
        const path=new URL(route.request().url()).pathname,types={'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'};
        if(!path.includes('..')&&types[extname(path)])return route.fulfill({body:await readFile(join(process.cwd(),'public',path)),contentType:types[extname(path)]});return route.continue();
      });
      const at=h.owner.indexOf('=');await context.addCookies([{name:h.owner.slice(0,at),value:h.owner.slice(at+1),url:h.origin}]);
      const page=await context.newPage();page.setDefaultTimeout(45000);await page.goto(checkout.launchURL);
      const fill=async(selector,value,required=true)=>{
        for(const frame of page.frames()) {const input=frame.locator(selector).first();if(await input.count()&&await input.isVisible()){await input.fill(value);return;}}
        if(required)throw new Error('Hosted test field unavailable: '+selector);
      };
      await page.locator('#email, input[name="email"]').first().waitFor({state:'visible'});
      await fill('#email, input[name="email"]',seed.member.email);
      await fill('#cardNumber, input[name="cardNumber"]','4242424242424242');await fill('#cardExpiry, input[name="cardExpiry"]','12/34');await fill('#cardCvc, input[name="cardCvc"]','123');
      await fill('#billingName, input[name="billingName"]',seed.member.name,false);
      const country=page.locator('#billingCountry, select[name="billingCountry"]').first();if(await country.count()&&await country.isVisible())await country.selectOption('US');
      await fill('#billingPostalCode, input[name="billingPostalCode"]','98104',false);
      const link=page.locator('#enableStripePass');if(await link.count()&&await link.isVisible()&&await link.isChecked())await link.uncheck();
      await page.locator('button[type="submit"]').click();
      await page.waitForURL(url=>url.origin===h.origin,{waitUntil:'commit',timeout:60000});
      assert.equal((await billingView(h)).invoices[0].status,'open','omitted callbacks cannot invent payment');assert.equal((await h.state()).payments.length,0);
      await h.cmd('billing.reconcile',{id:checkout.id,requestId:'synthetic-strap-live-reconcile'});
      const paid=(await billingView(h)).invoices[0];assert.equal(paid.status,'paid');assert.equal(paid.balanceCents,0);assert.equal(paid.access,5);
      const providerSession=await provider('/checkout/sessions/'+checkout.providerSessionId+'?expand[]=payment_intent.latest_charge&expand[]=invoice');
      assert.equal(providerSession.payment_intent.amount_received,5000);assert.equal(providerSession.invoice.amount_paid,5000);assert.equal(providerSession.payment_intent.latest_charge.paid,true);
      const events=(await provider('/events?limit=100&created[gte]='+started)).data.filter(e=>[checkout.providerSessionId,paid.paymentIntentId,paid.providerInvoiceId].includes(e.data?.object?.id)&&['checkout.session.completed','payment_intent.succeeded','invoice.paid','invoice.payment_succeeded'].includes(e.type)).sort((a,b)=>b.created-a.created);
      assert.ok(events.some(e=>e.type==='checkout.session.completed'));assert.ok(events.some(e=>e.type==='payment_intent.succeeded'));assert.ok(events.some(e=>e.type.startsWith('invoice.')));
      for(const event of [...events,...events.reverse()])assert.equal((await signedEvent(h,event,{secret:signing})).status,200);
      assert.equal((await signedEvent(h,events[0],{secret:signing,signature:'0'.repeat(64)})).status,400);
      assert.equal((await signedEvent(h,{...events[0],account:'synthetic-strap-foreign'},{secret:signing})).status,403);
      const financial=await h.state();assert.equal(financial.payments.length,1);assert.equal(financial.payments[0].amountCents,5000);assert.equal(financial.payments[0].accountId,account.id);
      const rotated=randomBytes(32).toString('hex');await h.setAuth({STRIPE_BILLING_WEBHOOK_SECRET:rotated});assert.equal((await billingView(h)).connected,false);
      await h.cmd('billing.connect',{accountId:account.id,mode:'test',confirm:true,requestId:'synthetic-strap-live-rotate'});
      const reviewed=await billingView(h);assert.equal(reviewed.connection.connectionId,connected.result.connectionId);assert.equal(reviewed.invoices[0].paymentIntentId,paid.paymentIntentId);assert.deepEqual((await h.state()).payments,financial.payments);
      assert.equal((await signedEvent(h,events[0],{secret:signing})).status,400);
      if(process.env.STRAP_PROOF_DIR) {
        await mkdir(process.env.STRAP_PROOF_DIR,{recursive:true});
        for(const width of [1440,390])for(const [path,selector,name] of [['/app/studio#payment-connection','#payment-connection','connection'],['/app/packs#payments','#payments','payment']]) {
          await page.setViewportSize({width,height:1000});await page.goto(h.origin+path);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          await page.locator(selector).screenshot({path:join(process.env.STRAP_PROOF_DIR,'BILL-real-'+name+'-'+width+'.png')});
        }
      }
      const summary=await billingView(h);
      console.log(JSON.stringify({candidateSHA:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),provider:'Stripe TEST',accountId:account.id,ready:true,sessionId:checkout.providerSessionId,invoiceId:paid.providerInvoiceId,paymentIntentId:paid.paymentIntentId,chargeId:providerSession.payment_intent.latest_charge.id,amountPaid:providerSession.invoice.amount_paid,nativePayments:financial.payments.length,balanceCents:paid.balanceCents,credits:paid.access,realEventIds:events.map(e=>e.id),signedReplay:'controlled replay of real Stripe events, not external endpoint delivery',signingCredentialRotated:true,merchantHistoryRetained:true,oldSigningCredentialRefused:true,reconciliations:summary.reconciliations.map(r=>({status:r.status,provider:r.provider,native:r.native})),exceptions:summary.exceptions.map(e=>({code:e.code,status:e.status})),edge}));
    } finally {await context.close();}
  } finally {await browser.close();}
},{auth:{STRIPE_BILLING_TEST_KEY:key,STRIPE_BILLING_WEBHOOK_SECRET:signing},outbound:async request=>{
  const u=new URL(request.url);assert.equal(u.origin,'https://api.stripe.com');assert.ok(['/v1/account','/v1/checkout/sessions','/v1/events'].some(p=>u.pathname===p||u.pathname.startsWith(p+'/')));
  const response=await fetch(request.url,{method:request.method,headers:request.headers,...(request.method==='POST'?{body:await request.text()}:{}),redirect:'manual'});
  edge.push({method:request.method,path:u.pathname,status:response.status,requestId:response.headers.get('request-id')});
  return new Response(await response.text(),{status:response.status,headers:{'content-type':'application/json','request-id':response.headers.get('request-id')??''}});
}});
