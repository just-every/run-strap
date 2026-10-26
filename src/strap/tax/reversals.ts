import { insist, integer, list, now, record, text, type RecordData } from '../domain/types';
import type { Transaction } from '../domain/store';
import { canonical, fingerprint, only, providerLine, type Json } from './model';

/** Native retail has already credited the price. This door credits only its tax. */
export async function reversalRequest(tx: Transaction, input: Json) {
  only(input,['requestId','invoiceId','retailReturnId','taxOnly','taxCreditCents','refundBusinessReference','expectedTaxCents','reference','reason']);
  const invoice = record(tx.state,input.invoiceId,'taxInvoice');
  const reversalRows = list(tx.state,'taxReversal').filter(r=>r.invoiceId === invoice.id);
  const reserved = list(tx.state,'taxOperation').filter(r=>r.type === 'refund' && r.invoiceId === invoice.id && ['pending','uncertain'].includes(r.status));
  insist(reserved.length === 0,'tax_refund_pending',409);
  const refundedTax = -reversalRows.reduce((sum,r)=>sum+r.taxCents,0);
  let priceCreditCents = 0, taxCreditCents: number, refundCharge: RecordData | null = null, retailReturn: RecordData | null = null;
  let refundBusinessReference: string;
  if (input.taxOnly === true) {
    insist(input.retailReturnId === undefined,'tax_refund_source_ambiguous');
    taxCreditCents = integer(input.taxCreditCents,'tax_credit_cents',1,invoice.taxCents);
    refundBusinessReference = text(input.refundBusinessReference,'refund_business_reference',160);
    insist(!reversalRows.some(r=>r.refundBusinessReference === refundBusinessReference),'tax_refund_business_reference_used',409);
  } else {
    insist(input.taxOnly === undefined && input.taxCreditCents === undefined && input.refundBusinessReference === undefined,'tax_refund_source_ambiguous');
    retailReturn = record(tx.state,input.retailReturnId,'retailReturn');
    refundCharge = record(tx.state,retailReturn.chargeId,'charge');
    insist(invoice.originalCharge.retailSaleId === retailReturn.saleId && refundCharge.retailReturnId === retailReturn.id && refundCharge.reversesChargeId === invoice.originalChargeId && refundCharge.amountCents === -retailReturn.amountCents,'tax_refund_original_charge_mismatch',409);
    insist(!reversalRows.some(r=>r.retailReturnId === retailReturn!.id),'tax_return_already_reversed',409);
    priceCreditCents = integer(retailReturn.amountCents,'tax_refunded_price',1,invoice.priceCents);
    const previousPrice = -reversalRows.reduce((sum,r)=>sum+r.priceCents,0);
    insist(previousPrice + priceCreditCents <= invoice.priceCents,'tax_refund_price_exceeded',409);
    // Cumulative half-up allocation preserves the last cent over partial returns.
    const cumulative = Number((BigInt(invoice.taxCents) * BigInt(previousPrice + priceCreditCents) * 2n + BigInt(invoice.priceCents)) / (2n * BigInt(invoice.priceCents)));
    const priorPriceTax = Number((BigInt(invoice.taxCents) * BigInt(previousPrice) * 2n + BigInt(invoice.priceCents)) / (2n * BigInt(invoice.priceCents)));
    taxCreditCents = cumulative - priorPriceTax;
    refundBusinessReference = retailReturn.id;
  }
  insist(taxCreditCents + refundedTax <= invoice.taxCents,'tax_already_reversed',409);
  insist(integer(input.expectedTaxCents,'expected_tax_cents',0,invoice.taxCents) === taxCreditCents,'tax_refund_preview_changed',409);
  insist(priceCreditCents > 0 || taxCreditCents > 0,'tax_refund_requires_value');
  const reference = text(input.reference,'tax_reversal_reference',160), reason = text(input.reason,'tax_refund_reason',1000);
  const form = new URLSearchParams({mode:'partial',original_transaction:invoice.providerTransactionId,reference,'line_items[0][original_line_item]':invoice.providerLineItemId,'line_items[0][reference]':refundBusinessReference,'line_items[0][amount]':String(-priceCreditCents),'line_items[0][amount_tax]':String(-taxCreditCents),'expand[0]':'line_items'});
  return {facts:{invoice,priceCreditCents,taxCreditCents,reference,reason,refundBusinessReference,refundCharge,retailReturn,taxOnly:input.taxOnly === true,refundFingerprint:await fingerprint({refundCharge,retailReturn})},form,targetId:refundBusinessReference,invoiceId:invoice.id};
}
export function saveReversal(tx: Transaction, operation: RecordData, facts: Json, body: Json) {
  const line = providerLine(body,'transaction'), invoice = facts.invoice;
  insist(body.type === 'reversal' && body.reference === facts.reference && body.reversal?.original_transaction === invoice.providerTransactionId && line.amount === -facts.priceCreditCents && line.amount_tax === -facts.taxCreditCents && line.reference === facts.refundBusinessReference && line.reversal?.original_line_item === invoice.providerLineItemId,'tax_provider_reversal_mismatch',502);
  if (facts.refundCharge) insist(canonical(record(tx.state,facts.refundCharge.id,'charge')) === canonical(facts.refundCharge),'tax_refund_charge_changed',409);
  const saved = {id:crypto.randomUUID(),invoiceId:invoice.id,originalChargeId:invoice.originalChargeId,originalChargeFingerprint:invoice.originalChargeFingerprint,personId:invoice.personId,locationId:invoice.locationId,retailReturnId:facts.retailReturn?.id ?? null,refundChargeId:facts.refundCharge?.id ?? null,refundFingerprint:facts.refundFingerprint,refundBusinessReference:facts.refundBusinessReference,taxOnly:facts.taxOnly,reason:facts.reason,reference:facts.reference,mode:'test',currency:'usd',priceCents:line.amount,taxCents:line.amount_tax,providerTransactionId:body.id,providerOriginalTransactionId:invoice.providerTransactionId,providerReversal:body,taxChargeId:crypto.randomUUID(),operationId:operation.id,actorId:operation.actorId,createdAt:now()};
  tx.put('taxReversal',saved);
  tx.put('charge',{id:saved.taxChargeId,personId:invoice.personId,locationId:invoice.locationId,parentChargeId:invoice.originalChargeId,taxSourceChargeId:invoice.originalChargeId,taxInvoiceId:invoice.id,taxReversalId:saved.id,reversesChargeId:invoice.taxChargeId,refundChargeId:saved.refundChargeId,amountCents:saved.taxCents,reason:'sales_tax_reversal',mode:'test',createdAt:saved.createdAt});
  return saved;
}
