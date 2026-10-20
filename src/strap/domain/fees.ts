import { humanOwner, id, insist, list, now, record, text, type State, type RecordData } from './types';
import type { Transaction } from './store';
import { balance, recordPayment } from './money';

const isFee = (charge: RecordData) => ['late_cancel_fee','no_show_fee'].includes(charge.reason);

/** Explicit receipt links distinguish an assessment from money received. Older
 * unallocated receipts remain in the member balance, never invented fee receipts. */
export function feeStatus(state: State, charge: RecordData): RecordData & {status: string; receipt: RecordData | null; reversal: RecordData | null} {
  const receipt = list(state,'payment').find(p => p.chargeId === charge.id);
  const reversal = list(state,'charge').find(c => c.reversesChargeId === charge.id);
  return {...charge,status:reversal ? 'waived' : receipt ? 'collected' : 'pending',receipt:receipt ?? null,reversal:reversal ?? null};
}
export const fees = (state: State) => list(state,'charge').filter(isFee).map(c => feeStatus(state,c));

function assessedFee(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const charge = record(tx.state,input.id,'charge');
  insist(isFee(charge),'fee_required');
  insist(!list(tx.state,'charge').some(c => c.reversesChargeId === charge.id),'fee_already_waived',409);
  return charge;
}

/** Record an exact external receipt; no processor or card is contacted. */
export function collectFee(tx: Transaction, input: Record<string,unknown>) {
  const charge = assessedFee(tx,input);
  insist(!list(tx.state,'payment').some(p => p.chargeId === charge.id),'fee_already_collected',409);
  // Existing unallocated receipts may already have paid this balance. Reconcile
  // those before recording further money, rather than collecting twice.
  insist(balance(tx.state,charge.personId) >= charge.amountCents,'fee_balance_already_covered',409);
  const payment = recordPayment(tx,{personId:charge.personId,amountCents:charge.amountCents,reference:input.reference});
  tx.put('payment',{...payment,chargeId:charge.id,bookingId:charge.bookingId,kind:'fee_receipt'});
  return feeStatus(tx.state,charge);
}

/** Waiving a charge does not rewrite attendance or its spent visit. A collected
 * fee becomes member credit; attendance-correction refunds stay with ATT-003. */
export function waiveFee(tx: Transaction, input: Record<string,unknown>) {
  const charge = assessedFee(tx,input), reason = text(input.reason,'waiver_reason',500);
  tx.put('charge',{id:id(),personId:charge.personId,bookingId:charge.bookingId,classId:charge.classId,amountCents:-charge.amountCents,reason:'fee_reversal',reversesChargeId:charge.id,note:reason,createdAt:now(),createdBy:tx.who.id});
  return feeStatus(tx.state,charge);
}
