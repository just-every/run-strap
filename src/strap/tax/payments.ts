import { insist, integer, list, now, record, text, type RecordData } from '../domain/types';
import type { Transaction } from '../domain/store';
import { connected, fingerprint, only, type Json, type TaxBindings } from './model';

/** Record an externally received or returned tax amount against retained evidence.
 * This records the owner's receipt; it never collects or refunds at a processor. */
export async function recordTaxPayment(env: TaxBindings, tx: Transaction, input: Json) {
  only(input,['requestId','invoiceId','reversalId','amountCents','reference','reason']);
  const requestId=text(input.requestId,'requestId',100), basis=await fingerprint(input);
  const id='tax-payment:'+await fingerprint({actorId:tx.who.id,requestId});
  const previous=tx.state.records.get(id);
  if(previous) {
    insist(previous.kind==='payment' && previous.data.requestFingerprint===basis,'tax_payment_request_changed',409);
    return previous.data;
  }
  const config=await connected(env,tx.state), invoice=record(tx.state,input.invoiceId,'taxInvoice');
  insist(invoice.connectionHash===config.connectionHash,'tax_invoice_connection_changed',409);
  const reversal=input.reversalId===undefined ? null : record(tx.state,input.reversalId,'taxReversal');
  insist(!reversal || reversal.invoiceId===invoice.id,'tax_payment_original_invoice_mismatch',409);
  const amount=integer(input.amountCents,'tax_payment_amount',1,100_000_000);
  const reference=text(input.reference,'payment_reference',160),reason=text(input.reason,'payment_reason',1000);
  insist(!list(tx.state,'payment').some(p=>p.reference===reference),'payment_reference_used',409);
  const payments=list(tx.state,'payment').filter(p=>p.taxInvoiceId===invoice.id);
  if(reversal) {
    const returned=-payments.filter(p=>p.taxReversalId===reversal.id).reduce((sum,p)=>sum+p.amountCents,0);
    insist(amount+returned<=-reversal.taxCents,'tax_refund_payment_exceeded',409);
    const received=payments.reduce((sum,p)=>sum+p.amountCents,0);
    insist(amount<=received,'tax_refund_payment_not_received',409);
  } else {
    const received=payments.filter(p=>!p.taxReversalId).reduce((sum,p)=>sum+p.amountCents,0);
    const credited=-list(tx.state,'taxReversal').filter(r=>r.invoiceId===invoice.id).reduce((sum,r)=>sum+r.taxCents,0);
    const refunded=-payments.filter(p=>p.taxReversalId).reduce((sum,p)=>sum+p.amountCents,0);
    insist(amount+received<=invoice.taxCents-credited+refunded,'tax_receipt_payment_exceeded',409);
  }
  const saved: RecordData={id,requestId,requestFingerprint:basis,personId:invoice.personId,locationId:invoice.locationId,
    chargeId:reversal?.taxChargeId ?? invoice.taxChargeId,taxInvoiceId:invoice.id,taxReversalId:reversal?.id ?? null,
    originalChargeId:invoice.originalChargeId,providerTransactionId:reversal?.providerTransactionId ?? invoice.providerTransactionId,
    amountCents:reversal ? -amount : amount,reference,reason,tender:'external',mode:'test',recordedBy:tx.who.id,createdAt:now()};
  tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_tax_connections WHERE id='tax' AND connection_hash=?) THEN 1 ELSE 0 END",config.connectionHash));
  tx.put('payment',saved);await tx.commit();return saved;
}
