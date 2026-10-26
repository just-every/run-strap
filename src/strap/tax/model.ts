import { insist, integer, list, record, text, type RecordData, type State } from '../domain/types';
import { sha256Hex } from '../security/crypto';

export interface TaxBindings { DB: D1Database; AUTH_ORIGIN: string; RER_DEMO?: string; STRIPE_TAX_TEST_KEY?: string }
export type Json = Record<string, any>;
export const configId = 'stripe-tax-test-config';
export const states = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));
export function only(input: Json, fields: string[]) {
  insist(Object.keys(input).every(k => fields.includes(k)), 'tax_unknown_field');
}
export function object(input: unknown, field: string): Json {
  insist(input && typeof input === 'object' && !Array.isArray(input), 'invalid_' + field);
  return input as Json;
}
export function address(input: unknown) {
  const a = object(input, 'tax_address');
  only(a, ['line1','line2','city','state','postalCode','country']);
  insist(a.country === 'US' && states.has(a.state), 'tax_us_address_required');
  const postalCode = text(a.postalCode,'postal_code',10);
  insist(/^\d{5}(?:-\d{4})?$/.test(postalCode),'invalid_postal_code');
  return {line1:text(a.line1,'address_line1',160),...(a.line2 ? {line2:text(a.line2,'address_line2',160)} : {}),city:text(a.city,'address_city',100),state:a.state as string,postalCode,country:'US'};
}
export const canonical = (value: any): string => JSON.stringify(sort(value));
function sort(value: any): any {
  return Array.isArray(value) ? value.map(sort) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,sort(value[k])])) : value;
}
export const fingerprint = (value: any) => sha256Hex(canonical(value));
export async function identity(env: TaxBindings) {
  insist(env.STRIPE_TAX_TEST_KEY && env.RER_DEMO !== '1','stripe_tax_test_not_configured',409);
  return sha256Hex('strap-stripe-tax-test\n' + env.AUTH_ORIGIN + '\n' + env.STRIPE_TAX_TEST_KEY);
}
export async function connected(env: TaxBindings, state: State) {
  const config = record(state,configId,'taxConfig');
  const local = await env.DB.prepare("SELECT connection_hash FROM st_tax_connections WHERE id='tax'").first<{connection_hash:string}>();
  insist(local?.connection_hash === config.connectionHash && config.connectionHash === await identity(env),'tax_connection_review_required',409);
  return config;
}
export function chargeSource(state: State, chargeId: unknown, product: Json) {
  const charge = record(state,chargeId,'charge');
  integer(charge.amountCents,'tax_original_price',1,100_000_000);
  insist(!charge.taxInvoiceId && !charge.taxReversalId && !charge.reversesChargeId,'tax_original_sale_charge_required');
  if (product.kind === 'retail') {
    const sale = record(state,charge.retailSaleId,'retailSale');
    insist(sale.chargeId === charge.id && sale.skuId === product.sourceId && sale.amountCents === charge.amountCents,'tax_product_charge_mismatch',409);
    return {charge,source:sale};
  }
  const pack = record(state,charge.packId,'pack');
  insist(product.kind === 'service' && product.sourceId === pack.id && charge.reason === undefined && charge.kind === undefined && !charge.recurringInvoiceId && charge.amountCents === pack.purchaseAmountCents,'tax_original_service_charge_required',409);
  return {charge,source:pack};
}
export function unlockedCharge(state: State, chargeId: string) {
  insist(!list(state,'taxInvoice').some(r=>r.originalChargeId === chargeId),'tax_charge_already_invoiced',409);
  insist(!list(state,'taxOperation').some(r=>r.type === 'confirm' && r.targetId === chargeId && ['pending','uncertain','succeeded'].includes(r.status)),'tax_charge_confirmation_pending',409);
}
export function providerLine(body: Json, type: 'calculation'|'transaction') {
  insist(body.object === 'tax.' + type && body.livemode === false && body.currency === 'usd' && typeof body.id === 'string','tax_provider_mode_or_currency_mismatch',502);
  const rows = body.line_items;
  insist(rows && rows.has_more === false && Array.isArray(rows.data) && rows.data.length === 1,'tax_provider_line_items_invalid',502);
  const line = rows.data[0];
  insist(typeof line.id === 'string' && Number.isSafeInteger(line.amount) && Number.isSafeInteger(line.amount_tax) && line.livemode === false && line.tax_behavior === 'exclusive','tax_provider_line_invalid',502);
  return line as Json;
}
export const operations = (state: State, type: string, targetId: string) => list(state,'taxOperation').filter(r=>r.type === type && r.targetId === targetId && r.status !== 'failed');
export function retainedResult(state: State, operation: RecordData) {
  return {...operation,result:operation.resultId ? state.records.get(operation.resultId)?.data ?? null : null};
}
