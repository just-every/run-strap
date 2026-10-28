import { list, type State } from '../domain/types';
import { configId } from './model';

export function taxSnapshot(state: State) {
  const config = state.records.get(configId)?.data;
  const {connectionHash:_,...publicConfig} = config ?? {id:'' ,connectionHash:null};
  return {mode:'test',productionReady:false,filing:'Studio and tax service responsibility; evidence export only',
    config:config ? publicConfig : null,calculations:list(state,'taxCalculation'),invoices:list(state,'taxInvoice'),reversals:list(state,'taxReversal'),
    payments:list(state,'payment').filter(p=>p.taxInvoiceId),
    operations:list(state,'taxOperation').map(({connectionHash,inputFingerprint,...operation})=>operation)};
}
export function taxEvidence(state: State) {
  return [...list(state,'taxInvoice').map(i=>({id:i.id,kind:'invoice',createdAt:i.createdAt,mode:i.mode,currency:i.currency,originalChargeId:i.originalChargeId,originalChargeFingerprint:i.originalChargeFingerprint,calculationId:i.providerCalculationId,transactionId:i.providerTransactionId,originalTransactionId:'',reference:i.reference,priceCents:i.priceCents,taxCents:i.taxCents,productId:i.product.id,taxCode:i.product.taxCode,refundChargeId:'',refundBusinessReference:'',personId:i.personId,locationId:i.locationId,chargeId:i.taxChargeId})),
    ...list(state,'taxReversal').map(r=>{const invoice = state.records.get(r.invoiceId)?.data;return {id:r.id,kind:'reversal',createdAt:r.createdAt,mode:r.mode,currency:r.currency,originalChargeId:r.originalChargeId,originalChargeFingerprint:r.originalChargeFingerprint,calculationId:invoice?.providerCalculationId ?? '',transactionId:r.providerTransactionId,originalTransactionId:r.providerOriginalTransactionId,reference:r.reference,priceCents:r.priceCents,taxCents:r.taxCents,productId:invoice?.product.id ?? '',taxCode:invoice?.product.taxCode ?? '',refundChargeId:r.refundChargeId ?? '',refundBusinessReference:r.refundBusinessReference,personId:r.personId,locationId:r.locationId,chargeId:r.taxChargeId};})]
    .sort((a,b)=>a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
const csvCell = (value: unknown) => {
  const plain = String(value ?? '');
  const safe = typeof value === 'string' && /^[=+\-@\t\r]/.test(plain) ? "'" + plain : plain;
  return '"' + safe.replace(/"/g,'""') + '"';
};
export function taxFilingCsv(state: State, query = new URLSearchParams()) {
  const month = query.get('month');
  const rows = taxEvidence(state).filter(r=>(!month || r.createdAt.startsWith(month)) && (!query.get('locationId') || r.locationId === query.get('locationId')));
  const fields = ['id','kind','createdAt','mode','currency','originalChargeId','originalChargeFingerprint','calculationId','transactionId','originalTransactionId','reference','priceCents','taxCents','productId','taxCode','refundChargeId','refundBusinessReference','personId','locationId','chargeId'] as const;
  return [fields.map(csvCell).join(','),...rows.map(row=>fields.map(field=>csvCell(row[field])).join(','))].join('\r\n') + '\r\n';
}
