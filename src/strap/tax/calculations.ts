import { insist, integer, now, record, text, type RecordData } from '../domain/types';
import type { Transaction } from '../domain/store';
import { address, canonical, chargeSource, fingerprint, only, providerLine, unlockedCharge, type Json } from './model';
import { addressForm } from './provider';

export async function calculationRequest(tx: Transaction, config: RecordData, input: Json) {
  only(input,['requestId','chargeId','productId','address','exemptionId']);
  const product = config.products.find((p: Json)=>p.id === input.productId);
  insist(product,'tax_product_classification_required');
  const {charge,source} = chargeSource(tx.state,input.chargeId,product);
  unlockedCharge(tx.state,charge.id);
  const customerAddress = address(input.address);
  insist(config.registeredStates.includes(customerAddress.state),'tax_registration_not_configured',409);
  const exemption = input.exemptionId ? config.exemptions.find((e: Json)=>e.id === input.exemptionId && e.personId === charge.personId) : null;
  insist(!input.exemptionId || exemption,'tax_exemption_not_configured',409);
  const taxDate = Math.floor(Date.parse(charge.createdAt)/1000);
  insist(Number.isSafeInteger(taxDate) && taxDate <= Math.floor(Date.now()/1000) && Date.now()/1000-taxDate < 31*86400,'tax_original_date_outside_provider_window',409);
  const quantity = product.kind === 'retail' ? integer(source.quantity,'tax_original_quantity',1,10000) : 1;
  const facts = {taxDate,quantity,originalCharge:charge,originalChargeFingerprint:await fingerprint(charge),originalSource:source,product,customerAddress,exemption:exemption ?? null,originAddress:config.originAddress,configFingerprint:await fingerprint(config),connectionHash:config.connectionHash};
  const form = new URLSearchParams({currency:'usd',tax_date:String(taxDate),'customer_details[address_source]':'shipping','customer_details[taxability_override]':exemption ? 'customer_exempt' : 'none',
    'line_items[0][amount]':String(charge.amountCents),'line_items[0][quantity]':String(quantity),'line_items[0][reference]':charge.id,'line_items[0][tax_code]':product.taxCode,'line_items[0][tax_behavior]':'exclusive','expand[0]':'line_items'});
  addressForm(form,'customer_details[address]',customerAddress);
  addressForm(form,'ship_from_details[address]',config.originAddress);
  return {facts,form,targetId:charge.id};
}
function sameLine(line: Json, facts: Json) {
  insist(line.quantity === facts.quantity && line.amount === facts.originalCharge.amountCents && line.reference === facts.originalCharge.id && line.tax_code === facts.product.taxCode && line.amount_tax >= 0,'tax_provider_calculation_mismatch',502);
}
export function saveCalculation(tx: Transaction, operation: RecordData, facts: Json, body: Json) {
  const line = providerLine(body,'calculation'); sameLine(line,facts);
  insist(body.tax_date === facts.taxDate,'tax_provider_sale_date_mismatch',502);
  insist(body.customer_details?.address?.country === 'US' && body.customer_details.address.state === facts.customerAddress.state,'tax_provider_address_mismatch',502);
  insist(!facts.exemption || line.amount_tax === 0,'tax_provider_exemption_mismatch',502);
  const breakdown = body.tax_breakdown;
  insist(Array.isArray(breakdown) && breakdown.length > 0 && breakdown.every((row: Json)=>typeof row.taxability_reason === 'string' && row.taxability_reason !== 'not_supported' && (row.taxability_reason !== 'not_collecting' || facts.product.taxCode === 'txcd_00000000')),'tax_provider_taxability_unavailable',502);
  insist(body.tax_amount_exclusive === line.amount_tax && body.tax_amount_inclusive === 0 && body.amount_total === line.amount + line.amount_tax && Number.isSafeInteger(body.expires_at) && body.expires_at * 1000 > Date.now(),'tax_provider_total_invalid',502);
  const saved = {id:crypto.randomUUID(),operationId:operation.id,mode:'test',currency:'usd',taxBehavior:'exclusive',...facts,originalChargeId:facts.originalCharge.id,personId:facts.originalCharge.personId,priceCents:line.amount,taxCents:line.amount_tax,totalCents:body.amount_total,providerCalculationId:body.id,providerCalculation:body,expiresAt:new Date(body.expires_at * 1000).toISOString(),createdAt:now(),actorId:operation.actorId};
  tx.put('taxCalculation',saved); return saved;
}
export async function confirmationRequest(tx: Transaction, config: RecordData, input: Json) {
  only(input,['requestId','calculationId','expectedTaxCents','reference']);
  const calculation = record(tx.state,input.calculationId,'taxCalculation');
  unlockedCharge(tx.state,calculation.originalChargeId);
  insist(calculation.configFingerprint === await fingerprint(config) && calculation.connectionHash === config.connectionHash,'tax_configuration_changed',409);
  const charge = record(tx.state,calculation.originalChargeId,'charge');
  insist(calculation.originalChargeFingerprint === await fingerprint(charge),'tax_original_charge_changed',409);
  insist(calculation.expiresAt > now(),'tax_calculation_expired',409);
  tx.future(calculation.expiresAt);
  insist(integer(input.expectedTaxCents,'expected_tax_cents',0,100_000_000) === calculation.taxCents,'tax_preview_changed',409);
  const reference = text(input.reference,'tax_reference',160);
  const form = new URLSearchParams({calculation:calculation.providerCalculationId,reference,'expand[0]':'line_items'});
  return {facts:{calculation,reference},form,targetId:charge.id};
}
export function saveInvoice(tx: Transaction, operation: RecordData, facts: Json, body: Json) {
  const calculation = facts.calculation, line = providerLine(body,'transaction');
  sameLine(line,calculation);
  insist(body.type === 'transaction' && body.reference === facts.reference && line.amount_tax === calculation.taxCents,'tax_provider_invoice_mismatch',502);
  const charge = record(tx.state,calculation.originalChargeId,'charge');
  insist(canonical(charge) === canonical(calculation.originalCharge),'tax_original_charge_changed',409);
  const saved = {id:crypto.randomUUID(),mode:'test',currency:'usd',taxBehavior:'exclusive',connectionHash:calculation.connectionHash,calculationId:calculation.id,providerCalculationId:calculation.providerCalculationId,providerTransactionId:body.id,providerLineItemId:line.id,providerTransaction:body,reference:facts.reference,operationId:operation.id,
    originalChargeId:charge.id,originalChargeFingerprint:calculation.originalChargeFingerprint,originalCharge:calculation.originalCharge,personId:charge.personId,locationId:charge.locationId ?? calculation.originalSource.locationId ?? 'studio',product:calculation.product,exemption:calculation.exemption,customerAddress:calculation.customerAddress,quantity:calculation.quantity,priceCents:line.amount,taxCents:line.amount_tax,totalCents:line.amount + line.amount_tax,taxChargeId:crypto.randomUUID(),createdAt:now(),actorId:operation.actorId};
  tx.put('taxInvoice',saved);
  tx.put('charge',{id:saved.taxChargeId,personId:charge.personId,locationId:saved.locationId,parentChargeId:charge.id,taxSourceChargeId:charge.id,taxInvoiceId:saved.id,amountCents:saved.taxCents,reason:'sales_tax',mode:'test',createdAt:saved.createdAt});
  return saved;
}
