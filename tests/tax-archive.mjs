import assert from 'node:assert/strict';
import { taxSeed, taxInvoice, taxAddress, serviceAddress, succeeded, assertTaxFiling } from './tax-sandbox.mjs';

export async function seedTaxArchive(h) {
  const seed=await taxSeed(h);
  await succeeded(h,'tax.config.save',seed.config);
  const retail=await taxInvoice(h,seed.sale.chargeId,'mat',taxAddress,'archive-retail');
  const service=await taxInvoice(h,seed.serviceCharge.id,'fitness-class',serviceAddress,'archive-service');
  const receiptInput={requestId:'archive-tax-receipt',invoiceId:retail.invoice.result.id,amountCents:400,reference:'synthetic-strap-archive-tax-receipt',reason:'Owner records a synthetic external tax receipt'};
  const receipt=await h.cmd('tax.payment.record',receiptInput);
  assert.equal(receipt.amountCents,400);
  const returned=await h.cmd('retail.return',{saleId:seed.sale.id,quantity:1,restock:true,reason:'Archived original partial tax return',requestId:'archive-tax-return'});
  const reversal=await succeeded(h,'tax.refund',{invoiceId:retail.invoice.result.id,retailReturnId:returned.id,expectedTaxCents:200,reference:'synthetic-strap-archive-tax-reversal',reason:'Original tax follows the retained return',requestId:'archive-tax-reversal'});
  const refundPayment=await h.cmd('tax.payment.record',{requestId:'archive-tax-payout',invoiceId:retail.invoice.result.id,reversalId:reversal.result.id,amountCents:200,reference:'synthetic-strap-archive-tax-payout',reason:'Owner records a synthetic external tax refund'});
  assert.equal(refundPayment.amountCents,-200);
  const rows=await assertTaxFiling(h,[{...retail.invoice,priceCents:4000,taxCents:400},{...service.invoice,priceCents:3000,taxCents:0},
    {...reversal,invoice:retail.invoice.result,priceCents:-2000,taxCents:-200}]);
  const snapshot=(await h.send('/api/strap/tax',undefined,h.owner)).value;
  assert.equal(snapshot.connected,true);
  const local=await h.db.prepare("SELECT connection_hash FROM st_tax_connections WHERE id='tax'").first();
  assert.ok(local.connection_hash);
  return {snapshot,rows,seed,receiptInput,receipt,connectionHash:local.connection_hash};
}
export function assertPortableTax(bundle,proof) {
  const records=bundle.tables.st_records.map(row=>({kind:row.kind,data:JSON.parse(row.data)}));
  for(const [field,kind] of [['calculations','taxCalculation'],['invoices','taxInvoice'],['reversals','taxReversal'],['operations','taxOperation'],['payments','payment']]) {
    const retained=records.filter(record=>record.kind===kind && (kind!=='payment' || record.data.taxInvoiceId)).map(record=>record.data);
    const expected=proof.snapshot[field];
    assert.equal(retained.length,expected.length,'portable tax inventory retains '+kind);
    for(const value of expected) {
      const row=retained.find(row=>row.id===value.id); assert.ok(row);
      for(const [key,fieldValue] of Object.entries(value))assert.deepEqual(row[key],fieldValue,'portable tax evidence retains '+key);
    }
  }
  for(const invoice of proof.snapshot.invoices) {
    const original=records.find(record=>record.kind==='charge' && record.data.id===invoice.originalChargeId)?.data;
    assert.deepEqual(original,invoice.originalCharge,'portable tax retains the unchanged original sale');
    assert.equal(records.find(record=>record.kind==='charge' && record.data.id===invoice.taxChargeId)?.data.amountCents,invoice.taxCents);
  }
  const reversal=proof.snapshot.reversals[0],returned=records.find(record=>record.kind==='retailReturn' && record.data.id===reversal.retailReturnId)?.data;
  assert.ok(returned);assert.equal(returned.chargeId,reversal.refundChargeId);
  assert.equal(records.find(record=>record.kind==='charge' && record.data.id===reversal.taxChargeId)?.data.amountCents,-200);
}
export async function assertRestoredTax(h,owner,proof,edge) {
  const response=await h.send('/api/strap/tax',undefined,owner);
  assert.equal(response.status,200);assert.equal(response.value.connected,false,'same-origin native restore never restores tax execution authority');
  const ordered=value=>Array.isArray(value) ? [...value].sort((a,b)=>a.id.localeCompare(b.id)) : value;
  for(const field of ['config','calculations','invoices','reversals','operations','payments'])assert.deepEqual(ordered(response.value[field]),ordered(proof.snapshot[field]),'native restore retains exact '+field);
  const filing=await h.send('/api/strap/tax/filing.csv',undefined,owner);
  assert.equal(filing.status,200);
  for(const row of proof.rows)assert.ok(filing.text.includes(row.transactionId),'restored filing retains each original provider reference');
  const before=edge.calls.length,version=(await h.state(owner)).version;
  const refused=await h.send('/api/strap/command',{name:'tax.calculate',input:{requestId:'archive-tax-disconnected',chargeId:proof.seed.sale.chargeId,productId:'mat',address:taxAddress}},owner);
  assert.equal(refused.status,409);assert.equal(refused.value.error,'tax_connection_review_required');
  const paymentRefused=await h.send('/api/strap/command',{name:'tax.payment.record',input:{...proof.receiptInput,requestId:'archive-tax-new-receipt',reference:'synthetic-strap-restored-tax-receipt'}},owner);
  assert.equal(paymentRefused.status,409);assert.equal(paymentRefused.value.error,'tax_connection_review_required');
  assert.deepEqual(await h.cmd('tax.payment.record',proof.receiptInput,owner),proof.receipt,'restored receipt replay reads retained history without a new money movement');
  assert.equal(edge.calls.length,before);assert.equal((await h.state(owner)).version,version);
}
