import { id, list, now, record, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { freezeWithdrawal } from './freeze-lifecycle';
import { appendPackEvent } from './pack-credits';

/** Uses the current freeze lifecycle's calendar preview; never old elapsed-day math. */
export function cancellationFreezeEffects(state: State, packId: string) {
  return list(state,'freeze').filter(f => f.packId === packId && ['scheduled','active'].includes(f.status)).map(f => {
    const withdrawal = f.startAt > now() ? freezeWithdrawal(state,f) : null;
    return {id:f.id,status:withdrawal ? 'withdraw' : 'end_at_termination',revisedExpiresAt:withdrawal?.revisedExpiresAt ?? null,feeReversedCents:withdrawal?.feeReversedCents ?? 0,chargeId:f.chargeId ?? null,originalAllowanceExpiresAt:f.originalAllowanceExpiresAt ?? null};
  });
}
export function cancellationTermEnd(state: State, pack: RecordData) {
  return cancellationFreezeEffects(state,pack.id).find(f => f.revisedExpiresAt)?.revisedExpiresAt ?? pack.expiresAt;
}
export function supersedeScheduledFreezes(tx: Transaction, c: RecordData) {
  for (const effect of c.effects.freezes.filter((f: RecordData) => f.status === 'withdraw')) {
    const f=record(tx.state,effect.id,'freeze');if(f.status==='withdrawn')continue;tx.future(f.startAt);
    const charge=effect.chargeId?tx.state.records.get(effect.chargeId)?.data:null;
    if(charge&&!list(tx.state,'charge').some(r=>r.reversesChargeId===charge.id))tx.put('charge',{id:id(),personId:charge.personId,packId:c.packId,freezeId:f.id,cancellationId:c.id,amountCents:-charge.amountCents,reason:'freeze_fee_reversal',reversesChargeId:charge.id,createdAt:now(),createdBy:c.terminatedBy});
    const pack=record(tx.state,c.packId,'pack');
    tx.put('pack',{...pack,allowanceExpiresAt:effect.originalAllowanceExpiresAt});
    appendPackEvent(tx,record(tx.state,pack.id,'pack'),{type:'adjust',credits:0,expiresAt:effect.revisedExpiresAt,reason:'Scheduled freeze superseded by contract cancellation'});
    tx.put('freeze',{...f,status:'withdrawn',withdrawnAt:now(),withdrawnBy:c.terminatedBy,cancellationId:c.id,withdrawalReason:'Contract cancellation',withdrawRequestId:c.id});
  }
}
export function endCancellationFreezes(tx: Transaction,c:RecordData) {
  for(const f of list(tx.state,'freeze').filter(f=>f.packId===c.packId&&['active','scheduled'].includes(f.status)))tx.put('freeze',{...f,status:'ended_by_cancellation',endAt:c.effectiveAt,endedAt:c.effectiveAt,cancellationId:c.id});
}
