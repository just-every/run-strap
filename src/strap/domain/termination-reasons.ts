import { humanOwner, insist, integer, list, now, record, text, type RecordData, type State } from './types';
import type { Transaction } from './store';

export const terminationReasons = (state: State) => list(state,'terminationReason').sort((a,b) => a.code.localeCompare(b.code));

/** Codes never change or disappear; each termination retains its reviewed label. */
export function saveTerminationReason(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const code = text(input.code,'code',50);
  insist(/^[a-z][a-z0-9_-]*$/.test(code),'invalid_termination_reason_code');
  const id = 'termination-reason:'+code, current = tx.state.records.get(id);
  insist(!current || current.kind === 'terminationReason','termination_reason_conflict',409);
  insist(integer(input.revision,'revision',0,Number.MAX_SAFE_INTEGER) === (current?.data.revision ?? 0),'termination_reason_changed',409);
  insist(typeof input.active === 'boolean','invalid_active');
  const reason = {id,code,label:text(input.label,'label',100),active:input.active,revision:(current?.data.revision ?? 0)+1,
    createdAt:current?.data.createdAt ?? now(),createdBy:current?.data.createdBy ?? tx.who.id,updatedAt:now(),updatedBy:tx.who.id};
  tx.put('terminationReason',reason); return reason;
}

export function activeTerminationReason(state: State, code: unknown) {
  const reason = record(state,'termination-reason:'+text(code,'reasonCode',50),'terminationReason');
  insist(reason.active,'termination_reason_retired',409); return reason;
}

export function terminationReasonChanged(state: State, cancellation: RecordData) {
  if (cancellation.mode !== 'early') return false;
  const reason = state.records.get(cancellation.reasonCatalogId);
  return reason?.kind !== 'terminationReason' || !reason.data.active || reason.data.revision !== cancellation.reasonCatalogRevision;
}
