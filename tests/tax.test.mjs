import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './harness.mjs';
import { taxEdge as edge } from './tax-edge.mjs';
import { taxAddress, serviceAddress, taxSeed, taxInvoice, succeeded, assertTaxFiling } from './tax-sandbox.mjs';


test('Owner tax treatment preserves real sale prices, exact retail and service provider evidence, partial-return tax credits and filing references once through HTTP',{timeout:120000},async()=>{
  const e = edge();
  await run(async h=>{
    const seed = await taxSeed(h);
    await succeeded(h,'tax.config.save',seed.config);
    const original = (await h.state()).charges.find(c=>c.id === seed.sale.chargeId);
    const retail = await taxInvoice(h,seed.sale.chargeId,'mat',taxAddress,'retail');
    const partlyClassified = (await h.send('/api/strap/reports/finance',undefined,h.owner)).value;
    assert.equal(partlyClassified.knownTaxCents,400); assert.equal(partlyClassified.taxCents,null);
    assert.ok(partlyClassified.unavailableTaxChargeIds.includes(seed.serviceCharge.id));
    const service = await taxInvoice(h,seed.serviceCharge.id,'fitness-class',serviceAddress,'class');
    assert.equal(retail.invoice.result.taxCents,400); assert.equal(service.invoice.result.taxCents,0);
    assert.deepEqual((await h.state()).charges.find(c=>c.id === original.id),original);
    const paymentsBefore = (await h.state()).payments.length;
    const returned = await h.cmd('retail.return',{saleId:seed.sale.id,quantity:1,restock:false,reason:'Damaged mat partial return',requestId:'partial-return'});
    const refund = {requestId:'partial-tax',invoiceId:retail.invoice.result.id,retailReturnId:returned.id,expectedTaxCents:200,reference:'-1+2',reason:'Tax follows partial original-price return'};
    const reverse = await succeeded(h,'tax.refund',refund), count = e.calls.length;
    assert.equal(reverse.result.priceCents,-2000); assert.equal(reverse.result.taxCents,-200);
    assert.deepEqual(await h.cmd('tax.refund',refund),reverse); assert.equal(e.calls.length,count);
    const state = await h.state();
    assert.equal(state.payments.length,paymentsBefore+1,'Only the existing native retail return creates a payment record');
    const taxCharges = state.charges.filter(c=>c.taxInvoiceId === retail.invoice.result.id);
    assert.deepEqual(taxCharges.map(c=>c.amountCents),[400,-200]);
    assert.ok(taxCharges.every(c=>c.parentChargeId === original.id));
    assert.equal(taxCharges[1].refundChargeId,returned.chargeId);
    const filing = await h.send('/api/strap/tax/filing.csv',undefined,h.owner);
    assert.equal(filing.status,200);
    for (const op of [retail.invoice,service.invoice,reverse]) assert.ok(filing.text.includes(op.result.providerTransactionId));
    assert.ok(filing.text.includes('"-2000","-200"'));
    assert.ok(filing.text.includes("\"'-1+2\""),'spreadsheet formula references remain inert while signed money stays numeric');
    await assertTaxFiling(h,[{...retail.invoice,priceCents:4000,taxCents:400},{...service.invoice,priceCents:3000,taxCents:0},
      {...reverse,invoice:retail.invoice.result,priceCents:-2000,taxCents:-200}]);
    const unchangedReturn=await h.cmd('retail.return',{saleId:seed.sale.id,quantity:1,restock:false,reason:'Damaged mat partial return',requestId:'partial-return'});
    assert.deepEqual(unchangedReturn,returned);
    const tax = (await h.send('/api/strap/tax',undefined,h.owner)).value;
    assert.equal(tax.invoices.length,2); assert.equal(tax.reversals.length,1); assert.equal(tax.connected,true);
    assert.ok(!JSON.stringify(tax).includes('synthetic-strap-999'));
    const before = e.calls.length;
    assert.equal((await h.send('/api/strap/command',{name:'tax.refund',input:{...refund,requestId:'duplicate-tax-return',reference:'synthetic-strap-212'}},h.owner)).status,409);
    assert.equal(e.calls.length,before);
    const finance = (await h.send('/api/strap/reports/finance',undefined,h.owner)).value;
    assert.equal(finance.knownTaxCents,200); assert.equal(finance.taxCents,200);
    assert.equal(finance.closing.taxLiabilityCents,200);
    assert.equal(finance.closing.reconciliationDifferenceCents,0);
    assert.equal(finance.closing.serviceInvoiceCents,5000);
    assert.equal(finance.closing.earnedCents,2000);
    assert.equal(finance.closing.deferredCents,3000);
    for (const charge of state.charges.filter(c=>c.taxInvoiceId)) {
      const row = finance.rows.find(r=>r.id === charge.id);
      assert.equal(row.earnedCents,0); assert.equal(row.deferredCents,0); assert.equal(row.unclassifiedCents,0);
    }
    const credit = await succeeded(h,'tax.refund',{requestId:'tax-only',invoiceId:retail.invoice.result.id,taxOnly:true,taxCreditCents:50,refundBusinessReference:'synthetic-strap-213',expectedTaxCents:50,reference:'synthetic-strap-214',reason:'Explicit tax-only original refund adjustment'});
    assert.equal(credit.result.priceCents,0); assert.equal(credit.result.taxCents,-50);
    assert.equal((await h.state()).payments.length,state.payments.length);
    const finalFinance = (await h.send('/api/strap/reports/finance',undefined,h.owner)).value;
    assert.equal(finalFinance.knownTaxCents,150); assert.equal(finalFinance.taxCents,150); assert.equal(finalFinance.closing.taxLiabilityCents,150);
    assert.equal(finalFinance.closing.reconciliationDifferenceCents,0);
    if(process.env.STRAP_PROOF_DIR)await(await import('./tax-browser.mjs')).taxBrowser(h,seed,process.env.STRAP_TAX_WIDTHS?.split(',').map(Number));
  },{auth:{STRIPE_TAX_TEST_KEY:'synthetic-strap-999'},outbound:e.outbound});
});

test('Owner MFA and exact tax approvals deny unclassified prices, unauthorized actors, stale previews and automatic replay after uncertain provider or credential change',{timeout:120000},async()=>{
  const e = edge();
  await run(async h=>{
    await h.confirmSetup(h.owner);
    assert.equal((await h.send('/api/strap/command',{name:'tax.config.save',input:{}},h.owner)).status,403);
    for (const path of ['/api/strap/tax','/api/strap/tax/filing.csv']) assert.equal((await h.send(path,undefined,h.owner)).status,403);
    await h.enroll(h.owner);
    const seed = await taxSeed(h);
    const key = await h.cmd('agent.create',{label:'Synthetic tax denial'});
    for (const cookie of [seed.member.cookie,'']) {
      for(const name of ['tax.config.save','tax.calculate','tax.confirm','tax.refund']) {
        const r = await h.send('/api/strap/command',{name,input:seed.config},cookie); assert.ok([401,403].includes(r.status),'unauthorized '+name);
      }
      assert.ok([401,403].includes((await h.send('/api/strap/tax',undefined,cookie)).status));
      assert.ok([401,403].includes((await h.send('/api/strap/tax/filing.csv',undefined,cookie)).status));
    }
    for(const name of ['tax.config.save','tax.calculate','tax.confirm','tax.refund'])assert.equal((await h.send('/api/strap/agent/command',{name,input:seed.config},'',{authorization:'Bearer '+key.token})).status,403);
    await h.cmd('agent.revoke',{id:key.id});
    assert.equal((await h.send('/api/strap/agent/command',{name:'tax.config.save',input:seed.config},'',{authorization:'Bearer '+key.token})).status,401);
    assert.equal(e.calls.length,0);
    e.setLive(true);
    const live = await h.cmd('tax.config.save',{...seed.config,requestId:'reject-live-settings'});
    assert.equal(live.status,'failed');
    assert.ok(e.calls.every(call=>call.method === 'GET'));
    e.setLive(false);
    await succeeded(h,'tax.config.save',seed.config);
    const base = {requestId:'preview',chargeId:seed.sale.chargeId,productId:'mat',address:taxAddress};
    for (const input of [{...base,productId:'missing'},{...base,address:{...taxAddress,country:'GB'}},{...base,address:{...taxAddress,state:'NY'}},{...base,chargeId:'missing'}]) {
      assert.ok((await h.send('/api/strap/command',{name:'tax.calculate',input},h.owner)).status >= 400);
    }
    const exempt = await succeeded(h,'tax.calculate',{...base,requestId:'exempt',exemptionId:'synthetic-exemption'});
    assert.equal(exempt.result.taxCents,0);
    const preview = await succeeded(h,'tax.calculate',base);
    const confirm = {requestId:'confirm',calculationId:preview.result.id,expectedTaxCents:400,reference:'synthetic-strap-220'};
    assert.equal((await h.send('/api/strap/command',{name:'tax.confirm',input:{...confirm,expectedTaxCents:401}},h.owner)).status,409);
    await succeeded(h,'tax.config.save',{...seed.config,requestId:'changed-config',products:seed.config.products.map(p=>({...p,label:p.label+' reviewed'}))});
    assert.equal((await h.send('/api/strap/command',{name:'tax.confirm',input:confirm},h.owner)).status,409);
    const current = await succeeded(h,'tax.calculate',{...base,requestId:'current'});
    const uncertainInput = {...confirm,calculationId:current.result.id,requestId:'uncertain'};
    e.setUncertain(true);
    const uncertain = await h.cmd('tax.confirm',uncertainInput); assert.equal(uncertain.status,'uncertain');
    const calls = e.calls.length, state = await h.state();
    assert.deepEqual(await h.cmd('tax.confirm',uncertainInput),uncertain); assert.equal(e.calls.length,calls);
    assert.equal((await h.send('/api/strap/command',{name:'tax.confirm',input:{...uncertainInput,requestId:'retry-forbidden',reference:'synthetic-strap-221'}},h.owner)).status,409);
    assert.equal((await h.state()).charges.filter(c=>c.reason === 'sales_tax').length,0);
    assert.equal((await h.state()).version,state.version);
    await h.setAuth({STRIPE_TAX_TEST_KEY:'synthetic-strap-998'});
    assert.equal((await h.send('/api/strap/tax',undefined,h.owner)).value.connected,false);
    assert.equal((await h.send('/api/strap/command',{name:'tax.calculate',input:{...base,requestId:'rotated-connection'}},h.owner)).status,409);
    assert.equal(e.calls.length,calls);
    await succeeded(h,'tax.config.save',{...seed.config,requestId:'rotated-reconnect'});
    assert.equal((await h.send('/api/strap/tax',undefined,h.owner)).value.connected,true);
    const unused=await h.cmd('person.save',{name:'Synthetic unused tax identity',email:seed.member.email.replace(/^[^@]+/,'synthetic-strap-230'),role:'member',active:false});
    await h.cmd('person.erase',{id:unused.id});
    const priorCalls=e.calls.length,priorVersion=(await h.state()).version;
    const erased=await h.send('/api/strap/command',{name:'tax.config.save',input:{...seed.config,requestId:'erased-exemption',exemptions:[{id:'erased',personId:unused.id,reference:'synthetic-strap-230',reason:'Erased identities never regain tax authority'}]}},h.owner);
    assert.equal(erased.status,404);
    assert.equal(e.calls.length,priorCalls);assert.equal((await h.state()).version,priorVersion);
    const signedOut=await h.mf.dispatchFetch(h.origin+'/app/action?name=session.signout',{method:'POST',redirect:'manual',headers:{origin:h.origin,cookie:h.owner,'content-type':'application/x-www-form-urlencoded'},body:''});
    assert.equal(signedOut.status,303);
    for(const path of ['/api/strap/tax','/api/strap/tax/filing.csv'])assert.equal((await h.send(path,undefined,h.owner)).status,401);
    assert.equal((await h.send('/api/strap/command',{name:'tax.confirm',input:uncertainInput},h.owner)).status,401);
    assert.equal(e.calls.length,priorCalls);
  },{mfa:false,auth:{STRIPE_TAX_TEST_KEY:'synthetic-strap-999'},outbound:e.outbound});
});
