import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { run } from './harness.mjs';

export const taxAddress = {line1:'920 5th Ave',city:'Seattle',state:'WA',postalCode:'98104',country:'US'};
export const serviceAddress = {line1:'354 Oyster Point Blvd',city:'South San Francisco',state:'CA',postalCode:'94080',country:'US'};
export async function taxSeed(h) {
  await h.confirmSetup(h.owner);
  await h.cmd('studio.save',{location:'Seattle',timeZone:'America/Los_Angeles'});
  const member = await h.person('TaxShopper');
  const supplier = await h.cmd('retail.supplier.add',{name:'Synthetic Tax Studio',reference:'synthetic-strap-201',requestId:'tax-supplier'});
  const sku = await h.cmd('retail.sku.add',{supplierId:supplier.id,sku:'SYNTHETIC-MAT',barcode:'synthetic-strap-202',name:'Exercise mat',variant:'Blue',priceCents:2000,lowStock:1,requestId:'tax-sku'});
  await h.cmd('retail.receive',{skuId:sku.id,quantity:10,reference:'synthetic-strap-203',requestId:'tax-stock'});
  const sale = await h.cmd('retail.sell',{personId:member.id,skuId:sku.id,quantity:2,expectedCents:4000,tender:'external',reference:'synthetic-strap-204',requestId:'tax-sale'});
  const draft = await h.cmd('pack.prepare',{personId:member.id,credits:1,amountCents:3000,expiresAt:new Date(Date.now()+86400000*30).toISOString(),eligibleServices:['Fitness class']});
  const approved = await h.cmd('pack.approve',{id:draft.id});
  const state = await h.state(), serviceCharge = state.charges.find(c=>c.packId === approved.id && c.amountCents === 3000);
  assert.ok(serviceCharge);
  const config = {requestId:'tax-config',consent:true,originAddress:taxAddress,registeredStates:['WA','CA'],products:[{id:'mat',label:'Exercise mat',kind:'retail',sourceId:sku.id,taxCode:'txcd_99999999'},
    {id:'fitness-class',label:'Fitness class',kind:'service',sourceId:approved.id,taxCode:'txcd_50021003'}],exemptions:[{id:'synthetic-exemption',personId:member.id,reference:'synthetic-strap-205',reason:'Synthetic exemption certificate, owner reviewed'}]};
  return {member,sku,sale,serviceCharge,config};
}
export async function succeeded(h,name,input) {
  const op = await h.cmd(name,input);
  assert.equal(op.status,'succeeded',JSON.stringify({name,status:op.status,errorCode:op.errorCode,provider:op.providerResponse?.body?.error ?? null}));
  assert.ok(op.result); return op;
}
export async function taxInvoice(h,chargeId,productId,address,requestId) {
  const calculation = await succeeded(h,'tax.calculate',{requestId:requestId+'-calculate',chargeId,productId,address});
  const confirmInput = {requestId:requestId+'-confirm',calculationId:calculation.result.id,expectedTaxCents:calculation.result.taxCents,reference:'strap-test-'+crypto.randomUUID()};
  const invoice = await succeeded(h,'tax.confirm',confirmInput);
  assert.deepEqual(await h.cmd('tax.confirm',confirmInput),invoice);
  assert.equal(invoice.result.taxCents,calculation.result.providerCalculation.tax_amount_exclusive);
  assert.equal(invoice.result.providerTransaction.line_items.data[0].amount_tax,invoice.result.taxCents);
  return {calculation,invoice};
}

async function sandbox() {
  const key = process.env.STRAP_STRIPE_TEST_KEY;
  assert.ok(key && /^(?:sk|rk)_test_/.test(key),'Held Stripe TEST secret required through the environment helper');
  const edge = [];
  await run(async h=>{
    const seed = await taxSeed(h);
    await succeeded(h,'tax.config.save',seed.config);
    const retail = await taxInvoice(h,seed.sale.chargeId,'mat',taxAddress,'retail');
    assert.ok(retail.invoice.result.taxCents > 0,'The synthetic retail sale must be taxable');
    const service = await taxInvoice(h,seed.serviceCharge.id,'fitness-class',serviceAddress,'class');
    assert.notEqual(retail.calculation.result.product.taxCode,service.calculation.result.product.taxCode);
    const returned = await h.cmd('retail.return',{saleId:seed.sale.id,quantity:1,restock:true,reason:'Synthetic partial retail return',requestId:'tax-return'});
    const expectedTaxCents = Math.round(retail.invoice.result.taxCents/2);
    const refundInput = {requestId:'tax-refund',invoiceId:retail.invoice.result.id,retailReturnId:returned.id,expectedTaxCents,reference:'strap-test-refund-'+crypto.randomUUID(),reason:'Synthetic partial retail return'};
    const reversal = await succeeded(h,'tax.refund',refundInput);
    assert.deepEqual(await h.cmd('tax.refund',refundInput),reversal);
    assert.equal(reversal.result.taxCents,-expectedTaxCents);
    assert.equal(reversal.result.providerReversal.line_items.data[0].amount_tax,reversal.result.taxCents);
    const filing = await h.send('/api/strap/tax/filing.csv',undefined,h.owner);
    assert.equal(filing.status,200);
    for (const op of [retail.invoice,service.invoice,reversal]) assert.ok(filing.text.includes(op.result.providerTransactionId));
    console.log(JSON.stringify({at:new Date().toISOString(),provider:'Stripe Tax TEST',accountSettingsWritten:false,registrationsWritten:false,
      edge,retail:{calculationId:retail.calculation.result.providerCalculationId,transactionId:retail.invoice.result.providerTransactionId,priceCents:4000,taxCents:retail.invoice.result.taxCents},
      service:{calculationId:service.calculation.result.providerCalculationId,transactionId:service.invoice.result.providerTransactionId,priceCents:3000,taxCents:service.invoice.result.taxCents},
      reversal:{transactionId:reversal.result.providerTransactionId,originalTransactionId:reversal.result.providerOriginalTransactionId,priceCents:reversal.result.priceCents,taxCents:reversal.result.taxCents},replayProviderPosts:0,filing:'Evidence CSV only; no filing or payment collected'}));
  },{auth:{STRIPE_TAX_TEST_KEY:key},outbound:async request=>{
    const url = new URL(request.url);
    assert.equal(url.origin,'https://api.stripe.com');
    assert.ok((request.method === 'GET' && ['/v1/tax/settings','/v1/tax/registrations'].includes(url.pathname)) || (request.method === 'POST' && ['/v1/tax/calculations','/v1/tax/transactions/create_from_calculation','/v1/tax/transactions/create_reversal'].includes(url.pathname)),'Only approved tax records and read-only readiness endpoints');
    let response;
    try { response = await fetch(request.url,{method:request.method,headers:{authorization:request.headers.get('authorization'),'content-type':request.headers.get('content-type') ?? 'application/x-www-form-urlencoded','Stripe-Version':request.headers.get('stripe-version'),...(request.headers.get('idempotency-key') ? {'Idempotency-Key':request.headers.get('idempotency-key')} : {})},...(request.method === 'POST' ? {body:await request.text()} : {}),redirect:'error'}); } catch(error) {
      console.log(JSON.stringify({edgeErrorName:error.name,edgeErrorCode:error.cause?.code ?? error.code ?? null,path:url.pathname}));
      throw error;
    }
    edge.push({path:url.pathname,method:request.method,status:response.status,requestId:response.headers.get('request-id')});
    return new Response(await response.text(),{status:response.status,headers:{'content-type':'application/json','request-id':response.headers.get('request-id') ?? ''}});
  }});
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await sandbox();
