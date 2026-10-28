import type { Transaction } from '../domain/store';
import { humanOwner, id, insist, integer, list, now, person, record, text } from '../domain/types';
import { invoiceCharges, lineAllocations } from './invoice-sources';

export function allocateInvoiceReceipt(tx:Transaction,input:Record<string,unknown>) {
  humanOwner(tx.who);
  const pack=record(tx.state,input.packId,'pack');person(tx.state,pack.personId);
  const payment=record(tx.state,input.paymentId,'payment'),charge=record(tx.state,input.chargeId,'charge'),amountCents=integer(input.amountCents,'amountCents',1,100_000_000),requestId=text(input.requestId,'requestId',100);
  const reference='invoice:'+tx.who.id+':'+requestId,prior=list(tx.state,'contractPrepayment').find(a=>a.reference===reference);
  if(prior){insist(prior.packId===pack.id && prior.paymentId===payment.id && prior.chargeId===charge.id && prior.amountCents===amountCents,'invoice_allocation_changed',409);return prior;}
  insist(!list(tx.state,'stripeInvoice').some(i=>i.packId===pack.id),'invoice_collection_already_reserved',409);
  insist(invoiceCharges(tx.state,pack.id).some(c=>c.id===charge.id) && charge.personId===payment.personId && payment.amountCents>0 && !payment.collection && (!payment.chargeId || payment.chargeId===charge.id),'invoice_receipt_source_mismatch',409);
  const allocations=list(tx.state,'contractPrepayment');
  insist(allocations.filter(a=>a.paymentId===payment.id).reduce((n,a)=>n+a.amountCents,0)+amountCents<=payment.amountCents,'receipt_overallocated',409);
  insist(lineAllocations(tx.state,pack.id).filter(a=>a.chargeId===charge.id).reduce((n,a)=>n+a.amountCents,0)+amountCents<=charge.amountCents,'charge_overallocated',409);
  const saved={id:id(),personId:pack.personId,payerId:payment.personId,packId:pack.id,paymentId:payment.id,chargeId:charge.id,amountCents,reference,requestId,createdAt:now(),createdBy:tx.who.id};
  tx.put('contractPrepayment',saved);return saved;
}
