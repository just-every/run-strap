import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { run } from './harness.mjs';
import { execFileSync } from 'node:child_process';

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
  const provider = op.providerResponse?.body;
  const evidence = provider ? Object.fromEntries(['object','id','livemode','currency','type','tax_date','tax_breakdown','line_items','reversal','reference'].filter(field=>field in provider).map(field=>[field,provider[field]])) : null;
  assert.equal(op.status,'succeeded',JSON.stringify({name,status:op.status,errorCode:op.errorCode,providerCode:provider?.error?.code ?? null,evidence}));
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

// Read the filing download independently; quoted references can contain commas and newlines.
export async function filingRows(h,query='') {
  const response = await h.send('/api/strap/tax/filing.csv'+query,undefined,h.owner);
  assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'no-store');
  assert.match(response.headers.get('content-disposition'),/attachment/);
  const rows=[], row=[]; let value='',quoted=false;
  for(let i=0;i<response.text.length;i++) {
    const c=response.text[i];
    if(c==='"') {if(quoted && response.text[i+1]==='"') {value+='"';i++;} else quoted=!quoted;}
    else if(!quoted && (c===',' || c==='\n')) {row.push(value);value='';if(c==='\n'){rows.push(row.splice(0));}}
    else if(c!=='\r' || quoted)value+=c;
  }
  assert.equal(quoted,false); assert.equal(value,''); assert.equal(row.length,0);
  const [fields,...records]=rows;
  return records.map(record=>Object.fromEntries(fields.map((key,i)=>[key,record[i]])));
}
export async function assertTaxFiling(h,entries) {
  assert.ok(entries.length>0);
  const rows=await filingRows(h);
  assert.deepEqual(rows.map(row=>row.id).sort(),entries.map(entry=>entry.result.id).sort(),'filing contains exactly the retained invoices and reversals');
  for(const {result:r,invoice=r,priceCents,taxCents} of entries) {
    const expected={id:r.id,kind:r.invoiceId ? 'reversal' : 'invoice',createdAt:r.createdAt,mode:'test',currency:'usd',
      originalChargeId:invoice.originalChargeId,originalChargeFingerprint:invoice.originalChargeFingerprint,calculationId:invoice.providerCalculationId,
      transactionId:r.providerTransactionId,originalTransactionId:r.invoiceId ? invoice.providerTransactionId : '',reference:r.reference,
      priceCents,taxCents,productId:invoice.product.id,taxCode:invoice.product.taxCode,refundChargeId:r.refundChargeId ?? '',
      refundBusinessReference:r.refundBusinessReference ?? '',personId:invoice.personId,locationId:invoice.locationId,chargeId:r.taxChargeId};
    const exported=rows.find(row=>row.id===r.id);
    for(const [field,value] of Object.entries(expected)) {
      const plain=String(value),safe=typeof value==='string' && /^[=+\-@\t\r]/.test(plain) ? "'"+plain : plain;
      assert.equal(exported[field],safe,'filing preserves '+field+' for '+expected.kind);
    }
    assert.equal(Object.keys(exported).length,Object.keys(expected).length);
    const charge=(await h.state()).charges.find(charge=>charge.id===r.taxChargeId);
    assert.equal(charge.amountCents,taxCents,'signed invoice tax agrees with the ledger');
    assert.equal(charge.parentChargeId,invoice.originalChargeId,'tax keeps its original sale relationship');
  }
  assert.deepEqual(await filingRows(h,'?locationId=synthetic-strap-unmatched'),[],'filing excludes another location');
  return rows;
}

async function sandbox() {
  const key = process.env.STRAP_STRIPE_TEST_KEY;
  assert.ok(key && /^(?:sk|rk)_test_/.test(key),'Held Stripe TEST secret required through the environment helper');
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'','sandbox proof requires a clean committed tree');
  const sourcePaths=['src/strap/tax','src/strap/finance-tax.ts','tests/tax-sandbox.mjs','tests/tax.test.mjs'];
  const sourceTree=execFileSync('git',['ls-tree','-r',head,'--',...sourcePaths],{encoding:'utf8'}).trim();
  const edge = [],responses=[];
  await run(async h=>{
    const seed = await taxSeed(h);
    const configured=await succeeded(h,'tax.config.save',seed.config);
    assert.deepEqual(configured.result.registeredStates,['WA','CA']);
    const exempt=await succeeded(h,'tax.calculate',{requestId:'sandbox-exempt',chargeId:seed.sale.chargeId,productId:'mat',address:taxAddress,exemptionId:'synthetic-exemption'});
    assert.equal(exempt.result.taxCents,0);assert.equal(exempt.result.exemption.reference,'synthetic-strap-205');
    const retail = await taxInvoice(h,seed.sale.chargeId,'mat',taxAddress,'retail');
    assert.equal(retail.calculation.result.providerCalculation.line_items.data[0].quantity,seed.sale.quantity);
    assert.equal(retail.invoice.result.providerTransaction.line_items.data[0].quantity,seed.sale.quantity);
    assert.ok(retail.invoice.result.taxCents > 0,'The synthetic retail sale must be taxable');
    const taxReceipt=await h.cmd('tax.payment.record',{requestId:'sandbox-tax-receipt',invoiceId:retail.invoice.result.id,amountCents:retail.invoice.result.taxCents,reference:'synthetic-strap-sandbox-tax-receipt',reason:'Synthetic owner bookkeeping only; no processor payment observed'});
    assert.equal(taxReceipt.amountCents,retail.invoice.result.taxCents);
    assert.equal(taxReceipt.providerTransactionId,retail.invoice.result.providerTransactionId);
    const service = await taxInvoice(h,seed.serviceCharge.id,'fitness-class',serviceAddress,'class');
    assert.notEqual(retail.calculation.result.product.taxCode,service.calculation.result.product.taxCode);
    const returned = await h.cmd('retail.return',{saleId:seed.sale.id,quantity:1,restock:true,reason:'Synthetic partial retail return',requestId:'tax-return'});
    const expectedTaxCents = Math.round(retail.invoice.result.taxCents/2);
    const refundInput = {requestId:'tax-refund',invoiceId:retail.invoice.result.id,retailReturnId:returned.id,expectedTaxCents,reference:'strap-test-refund-'+crypto.randomUUID(),reason:'Synthetic partial retail return'};
    const reversal = await succeeded(h,'tax.refund',refundInput);
    assert.deepEqual(await h.cmd('tax.refund',refundInput),reversal);
    assert.equal(reversal.result.taxCents,-expectedTaxCents);
    const taxPayoutInput={requestId:'sandbox-tax-payout',invoiceId:retail.invoice.result.id,reversalId:reversal.result.id,amountCents:expectedTaxCents,reference:'synthetic-strap-sandbox-tax-payout',reason:'Synthetic owner bookkeeping only; no processor payout observed'};
    const taxPayout=await h.cmd('tax.payment.record',taxPayoutInput);
    assert.equal(taxPayout.amountCents,-expectedTaxCents);
    assert.equal(taxPayout.providerTransactionId,reversal.result.providerTransactionId);
    assert.deepEqual(await h.cmd('tax.payment.record',taxPayoutInput),taxPayout);
    assert.equal(reversal.result.providerReversal.line_items.data[0].amount_tax,reversal.result.taxCents);
    assert.equal(service.invoice.result.priceCents,3000);
    assert.equal(service.invoice.result.taxCents,service.calculation.result.providerCalculation.tax_amount_exclusive);
    assert.equal(reversal.result.priceCents,-2000);
    const filing=await assertTaxFiling(h,[{...retail.invoice,priceCents:4000,taxCents:retail.invoice.result.taxCents},
      {...service.invoice,priceCents:3000,taxCents:service.invoice.result.taxCents},
      {...reversal,invoice:retail.invoice.result,priceCents:-2000,taxCents:-expectedTaxCents}]);
    for(const operation of [exempt,retail.calculation,retail.invoice,service.calculation,service.invoice,reversal]) {
      const received=responses.find(response=>response.requestId===operation.providerResponse.requestId);
      assert.ok(received); assert.deepEqual(operation.providerResponse.body,received.body,'retained evidence is the actual provider response');
    }
    const state=await h.state();
    assert.equal(state.payments.find(payment=>payment.id===seed.sale.paymentId).amountCents,4000,'native sale records its original external tender');
    assert.equal(state.payments.find(payment=>payment.id===returned.paymentId).amountCents,-2000,'native partial return refunds original price once');
    assert.equal(state.payments.length,4,'only two original-price tenders and two explicitly recorded tax tenders exist');
    assert.deepEqual(await h.cmd('retail.return',{saleId:seed.sale.id,quantity:1,restock:true,reason:'Synthetic partial retail return',requestId:'tax-return'}),returned);
    assert.equal((await h.state()).payments.length,4);
    const posts = edge.filter(request=>request.method === 'POST');
    assert.deepEqual(posts.map(request=>request.path),['/v1/tax/calculations','/v1/tax/calculations','/v1/tax/transactions/create_from_calculation','/v1/tax/calculations','/v1/tax/transactions/create_from_calculation','/v1/tax/transactions/create_reversal']);
    console.log(JSON.stringify({head,cleanTree:true,sourceTree,nativeBookkeeping:{receiptCents:taxReceipt.amountCents,refundCents:taxPayout.amountCents,processorSettlementVerified:false},filingRows:filing,at:new Date().toISOString(),provider:'Stripe Tax TEST',accountSettingsWritten:false,registrationsWritten:false,
      edge,exemption:{calculationId:exempt.result.providerCalculationId,priceCents:4000,taxCents:exempt.result.taxCents},retail:{calculationId:retail.calculation.result.providerCalculationId,transactionId:retail.invoice.result.providerTransactionId,priceCents:4000,taxCents:retail.invoice.result.taxCents},
      service:{calculationId:service.calculation.result.providerCalculationId,transactionId:service.invoice.result.providerTransactionId,priceCents:3000,taxCents:service.invoice.result.taxCents},
      reversal:{transactionId:reversal.result.providerTransactionId,originalTransactionId:reversal.result.providerOriginalTransactionId,priceCents:reversal.result.priceCents,taxCents:reversal.result.taxCents},replayProviderPosts:posts.length-6,filing:'Evidence CSV only; no filing or payment collected'}));
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
    const body=await response.text();
    responses.push({requestId:response.headers.get('request-id'),body:JSON.parse(body)});
    return new Response(body,{status:response.status,headers:{'content-type':'application/json','request-id':response.headers.get('request-id') ?? ''}});
  }});
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await sandbox();
