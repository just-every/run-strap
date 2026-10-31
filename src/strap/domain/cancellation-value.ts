import { coolingRefund } from './cooling-refunds';
import { coolingAgreementPackIds, voidUnpaidCoolingInvoices } from './cooling-void';
import { studioSettings } from './studio';
import { humanOwner, id, insist, instant, integer, list, now, record, text, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { refundSettlementWindow } from './cancellation-calendar';
import { contractRegion } from './contract-copies';

/** Link actual external receipt evidence, never assume a catalog price was paid. */
export function recordContractPrepayment(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const pack = record(tx.state,input.packId,'pack'), payment = record(tx.state,input.paymentId,'payment'), charge = record(tx.state,input.chargeId,'charge');
  const amountCents = integer(input.amountCents,'amountCents',1,100_000_000), reference = text(input.reference,'reference',100);
  const prior = list(tx.state,'contractPrepayment').find(a => a.reference === reference);
  if (prior) { insist(prior.packId === pack.id && prior.paymentId === payment.id && prior.chargeId === charge.id && prior.amountCents === amountCents,'prepayment_changed',409); return prior; }
  insist(!list(tx.state,'charge').some(c=>c.reversesChargeId===charge.id),'charge_already_reversed',409);
  insist(payment.amountCents > 0 && charge.amountCents > 0 && charge.packId === pack.id && charge.personId === payment.personId && (!payment.chargeId || payment.chargeId === charge.id),'prepayment_evidence_mismatch',409);
  const allocations = list(tx.state,'contractPrepayment');
  insist(allocations.filter(a => a.paymentId === payment.id).reduce((n,a) => n+a.amountCents,0)+amountCents <= payment.amountCents,'receipt_overallocated',409);
  insist(allocations.filter(a => a.chargeId === charge.id).reduce((n,a) => n+a.amountCents,0)+amountCents <= charge.amountCents,'charge_overallocated',409);
  const allocation = {id:id(),personId:pack.personId,payerId:payment.personId,packId:pack.id,paymentId:payment.id,chargeId:charge.id,amountCents,reference,createdAt:now(),createdBy:tx.who.id};
  tx.put('contractPrepayment',allocation); return allocation;
}
const rounded = (n: bigint,d: bigint) => Number((2n*n+d)/(2n*d));
/** Elapsed access time excludes confirmed freezes; extension days add no price. */
export function unusedPrepaid(state: State, pack: RecordData, effectiveAt: string) {
  const start = Date.parse(pack.termStartAt ?? pack.createdAt), end = Date.parse(pack.allowanceExpiresAt ?? pack.expiresAt), at = Date.parse(effectiveAt);
  const duration = Math.max(1,end-start);
  let frozen = 0;
  for (const f of list(state,'freeze').filter(f => f.packId === pack.id && f.confirmedAt && f.startAt<=now() && !['withdrawn','declined'].includes(f.status))) {
    frozen += Math.max(0,Math.min(at,Date.parse(f.endAt ?? effectiveAt))-Math.max(start,Date.parse(f.startAt)));
  }
  const elapsed = Math.max(0,at-start-frozen), unused = Math.max(0,duration-Math.min(duration,elapsed));
  const allocations = list(state,'contractPrepayment').filter(a => a.packId === pack.id), paidCents = allocations.reduce((n,a) => n+a.amountCents,0);
  const prepayments = list(state,'contractPrepayment'), charges = list(state,'charge');
  // Only a receipt eligible for a still-unallocated charge on this pack can
  // delay valuation. Booking-fee receipts and a delegate's own money cannot.
  const availableCharges = charges.filter(c => c.packId === pack.id && c.amountCents > 0
    && !charges.some(r => r.reversesChargeId === c.id)
    && prepayments.filter(a => a.chargeId === c.id).reduce((n,a) => n+a.amountCents,0) < c.amountCents);
  const unresolvedReceipt = list(state,'payment').some(p => p.amountCents > 0
    && prepayments.filter(a => a.paymentId === p.id).reduce((n,a) => n+a.amountCents,0) < p.amountCents
    && availableCharges.some(c => c.personId === p.personId && (!p.chargeId || p.chargeId === c.id)));
  const complete = !unresolvedReceipt;
  let cumulative=0,allocatedRefund=0;
  const payers=[...new Set(allocations.map(a=>a.payerId))].sort().map(payerId=>{const prepaidCents=allocations.filter(a=>a.payerId===payerId).reduce((n,a)=>n+a.amountCents,0);cumulative+=prepaidCents;const next=rounded(BigInt(cumulative)*BigInt(unused),BigInt(duration)),unusedCents=next-allocatedRefund;allocatedRefund=next;return {payerId,prepaidCents,unusedCents};});
  return {paidCents,knownUnusedCents:rounded(BigInt(paidCents)*BigInt(unused),BigInt(duration)),amountCents:complete ? rounded(BigInt(paidCents)*BigInt(unused),BigInt(duration)) : null,
    needsAllocation:!complete,formula:{startAt:new Date(start).toISOString(),durationMs:duration,elapsedAccessMs:elapsed,unusedMs:unused,rounding:'half-up cents'},
    payers};
}
export function retainRefundDue(tx: Transaction, cancellation: RecordData) {
  const key = `refund-due:${cancellation.id}`, prior = tx.state.records.get(key)?.data;
  if (prior) return prior;
  const pack=record(tx.state,cancellation.packId,'pack'),valuationAt=cancellation.coolingOff?.renewal?pack.termStartAt??pack.createdAt:cancellation.effectiveAt;
  const coolingOptions={packIds:coolingAgreementPackIds(tx.state,cancellation),regions:[studioSettings(tx.state)?.address?.region,contractRegion(tx.state,cancellation.personId)].filter(Boolean),policy:cancellation.policy};
  const statutoryCooling=cancellation.mode==='statutory'&&cancellation.reasonCode==='cooling-off';
  const value = statutoryCooling?coolingRefund(tx.state,pack,cancellation.effectiveAt,coolingOptions):unusedPrepaid(tx.state,pack,valuationAt),refundDeadline=cancellation.refundDeadline??refundSettlementWindow(tx.state,now(),[contractRegion(tx.state,cancellation.personId)].filter(Boolean));
  if(statutoryCooling&&!value.needsAllocation)voidUnpaidCoolingInvoices(tx,cancellation);
  const due = {coolingOptions:statutoryCooling?coolingOptions:null,valuationPack:{...record(tx.state,cancellation.packId,'pack')},id:key,personId:cancellation.personId,packId:cancellation.packId,cancellationId:cancellation.id,effectiveAt:cancellation.effectiveAt,valuationAt,settleBy:refundDeadline.settleBy,refundDeadline,amountCents:value.amountCents,knownUnusedCents:value.knownUnusedCents,payers:value.payers,formula:value.formula,status:value.needsAllocation ? 'needs_allocation' : 'refund_due',settledCents:0,createdAt:now()};
  tx.put('cancellationRefund',due); return due;
}
export function reconcileCancellationRefund(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);const due=record(tx.state,input.id,'cancellationRefund'),c=record(tx.state,due.cancellationId,'contractCancellation');
  insist(!due.settledCents,'refund_already_settled',409);
  const value=due.coolingOptions?coolingRefund(tx.state,due.valuationPack,c.effectiveAt,due.coolingOptions):unusedPrepaid(tx.state,due.valuationPack,due.valuationAt??c.effectiveAt);if(due.coolingOptions&&!value.needsAllocation)voidUnpaidCoolingInvoices(tx,c);const updated={...due,amountCents:value.amountCents,knownUnusedCents:value.knownUnusedCents,payers:value.payers,formula:value.formula,status:value.needsAllocation?'needs_allocation':'refund_due',reconciledAt:now(),reconciledBy:tx.who.id};
  tx.put('cancellationRefund',updated);return updated;
}
export function settleCancellationRefund(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);const due=record(tx.state,input.id,'cancellationRefund'), reference=text(input.reference,'reference',160),payerId=text(input.payerId,'payerId',100),amountCents=integer(input.amountCents,'amountCents',1,100_000_000),settledAt=instant(input.settledAt,'settledAt');
  insist(settledAt<=now(),'settlement_must_be_past');
  const prior=list(tx.state,'cancellationRefundSettlement').find(s=>s.reference===reference);
  if(prior){insist(prior.refundId===due.id&&prior.amountCents===amountCents&&prior.payerId===payerId&&prior.settledAt===settledAt,'refund_settlement_changed',409);return prior;}
  insist(!list(tx.state,'payment').some(p=>p.reference===reference),'payment_reference_used',409);
  insist(due.amountCents!==null&&due.status!=='needs_allocation','refund_needs_allocation',409);
  const payee=due.payers.find((p:RecordData)=>p.payerId===payerId), settlements=list(tx.state,'cancellationRefundSettlement').filter(s=>s.refundId===due.id);
  insist(payee&&settlements.filter(s=>s.payerId===payerId).reduce((n,s)=>n+s.amountCents,0)+amountCents<=payee.unusedCents,'refund_exceeds_due',409);
  insist(due.settledCents+amountCents<=due.amountCents,'refund_exceeds_due',409);
  const settlement={id:id(),personId:due.personId,refundId:due.id,payerId,amountCents,reference,settledAt,recordedAt:now(),recordedBy:tx.who.id,collection:'external-settlement-only'};
  tx.put('cancellationRefundSettlement',settlement);tx.put('cancellationRefund',{...due,settledCents:due.settledCents+amountCents,status:due.settledCents+amountCents===due.amountCents?'settled':'partly_settled'});return settlement;
}
